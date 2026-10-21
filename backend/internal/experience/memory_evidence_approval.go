package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"

	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"elselife/backend/internal/sqlc/pgq"
	"google.golang.org/protobuf/proto"
)

// Go-only operation identity. Model context/frame strings cannot create it.
type narrativeEvidenceOrigin struct {
	Kind         string `json:"kind"`
	ID           string `json:"id"`
	ExperienceID string `json:"experience_id"`
	BranchID     string `json:"branch_id"`
	BaseRevision int64  `json:"base_revision"`
	BaseFence    int64  `json:"base_fence"`
	SourceHandle string `json:"source_handle"`
	Pin          string `json:"pin"`
}

type narrativeEvidenceApproval struct {
	Version               int                            `json:"version"`
	Origin                narrativeEvidenceOrigin        `json:"origin"`
	CandidateSHA256       string                         `json:"candidate_sha256"`
	Stage                 string                         `json:"stage"`
	Sequence              int                            `json:"sequence"`
	StageRequestSHA256    string                         `json:"stage_request_sha256"`
	ProviderRequestSHA256 string                         `json:"provider_request_sha256"`
	RegistrySHA256        string                         `json:"registry_sha256"`
	Registry              memoryEvidencePacket           `json:"registry"`
	StageRequest          []byte                         `json:"stage_request"`
	ProviderRequest       model.Request                  `json:"provider_request"`
	Resolved              map[string][]MemoryEvidenceRef `json:"resolved"`
}

func (support *NarrativeMemorySupport) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if StrictJSON(raw, &fields) != nil {
		return fail("narrative_memory_evidence_invalid")
	}
	quote, hasQuote := fields["quote"]
	sources, hasSources := fields["source_ids"]
	if hasQuote == hasSources || hasQuote && bytes.Equal(bytes.TrimSpace(quote), []byte("null")) ||
		hasSources && bytes.Equal(bytes.TrimSpace(sources), []byte("null")) {
		return fail("narrative_memory_evidence_invalid")
	}
	type wire NarrativeMemorySupport
	var decoded wire
	if StrictJSON(raw, &decoded) != nil || !keyOK(decoded.MemoryID) {
		return fail("narrative_memory_evidence_invalid")
	}
	if hasQuote && !textOK(decoded.Quote) || hasSources && len(decoded.SourceIDs) == 0 {
		return fail("narrative_memory_evidence_invalid")
	}
	*support = NarrativeMemorySupport(decoded)
	return nil
}

func (o narrativeEvidenceOrigin) valid() bool {
	return (o.Kind == "operation" || o.Kind == "preparation") && keyOK(o.ID) && keyOK(o.ExperienceID) && keyOK(o.BranchID) &&
		o.BaseRevision >= 0 && o.BaseFence >= 0 && o.SourceHandle != "" && memoryHashOK(o.Pin)
}

func (r *sourceReader) MemoryEvidenceOrigin(ctx context.Context) (narrativeEvidenceOrigin, error) {
	var origin narrativeEvidenceOrigin
	err := r.service.transaction(ctx, func(q *pgq.Queries) error {
		if err := r.check(ctx, q); err != nil {
			return err
		}
		origin = r.memoryOrigin()
		if !origin.valid() {
			return fail("narrative_memory_origin_invalid")
		}
		return nil
	})
	return origin, err
}

func (r *sourceReader) memoryOrigin() narrativeEvidenceOrigin {
	if r.preparationEvidence != nil {
		return *r.preparationEvidence
	}
	o := r.operation
	pin := digest("memory-origin", o.RequestID, struct {
		Context Context
		Config  any
	}{r.generation, r.service.preparationConfig()})
	return narrativeEvidenceOrigin{Kind: "operation", ID: o.RequestID, ExperienceID: o.ExperienceID,
		BranchID: o.BranchID, BaseRevision: o.BaseRevision, BaseFence: o.Fence,
		SourceHandle: r.generation.StateCoverage.SourceHandle, Pin: pin}
}

// Capture runs after private author attachment and the final capacity check,
// immediately before Generate. The earlier protobuf audit remains distinct.
func (p *narrativeRun) bindMemoryEvidenceRequest(sequence int, stageRaw []byte, request model.Request) error {
	if p.evidencePacket == nil {
		return nil
	}
	if p.evidenceOrigin == nil || !p.evidenceOrigin.valid() {
		return fail("narrative_memory_origin_invalid")
	}
	var candidate Candidate
	if StrictJSON(p.reviewed, &candidate) != nil || candidate.MemoryDelta == nil {
		return fail("narrative_memory_evidence_invalid")
	}
	providerHash, err := receiptHash(request)
	if err != nil {
		return err
	}
	registryHash, err := receiptHash(p.evidencePacket)
	if err != nil {
		return err
	}
	p.evidenceCall = &narrativeEvidenceApproval{Version: 2, Origin: *p.evidenceOrigin,
		CandidateSHA256: memoryPageSHA256(string(p.reviewed)), Stage: p.last, Sequence: sequence,
		StageRequestSHA256: memoryPageSHA256(string(stageRaw)), ProviderRequestSHA256: providerHash,
		RegistrySHA256: registryHash, Registry: *p.evidencePacket, StageRequest: append([]byte(nil), stageRaw...),
		ProviderRequest: request, Resolved: map[string][]MemoryEvidenceRef{}}
	_, err = validateMemoryEvidenceRequest(candidate, p.evidenceCall)
	return err
}

func validateMemoryEvidenceRequest(candidate Candidate, e *narrativeEvidenceApproval) (map[string]MemoryEvidenceRef, error) {
	bad := func() (map[string]MemoryEvidenceRef, error) { return nil, fail("narrative_memory_evidence_invalid") }
	if e == nil || e.Version != 2 || !e.Origin.valid() || e.Registry.Version != 2 || e.Registry.Sources == nil ||
		e.Registry.RequiredPages == nil || e.Sequence < 1 || e.Sequence > 12 || e.Stage != "review" && e.Stage != "repair_review" {
		return bad()
	}
	raw, err := canonicalCandidate(candidate)
	if err != nil || e.CandidateSHA256 != memoryPageSHA256(string(raw)) ||
		e.StageRequestSHA256 != memoryPageSHA256(string(e.StageRequest)) {
		return bad()
	}
	hash, err := receiptHash(e.ProviderRequest)
	if err != nil || hash != e.ProviderRequestSHA256 {
		return bad()
	}
	hash, err = receiptHash(e.Registry)
	if err != nil || hash != e.RegistrySHA256 {
		return bad()
	}
	var stage pb.ModelCallRequest
	if proto.Unmarshal(e.StageRequest, &stage) != nil {
		return bad()
	}
	// JSONB may format the embedded RawMessage differently when a prepared
	// approval is stored. The provider fingerprint already uses canonical JSON;
	// compare the schema by the same rule, retaining original protobuf bytes.
	stageSchema, stageSchemaErr := canonicalRawJSON([]byte(stage.SchemaJson))
	providerSchema, providerSchemaErr := canonicalRawJSON(e.ProviderRequest.Schema)
	if stage.NarrativeStage != e.Stage ||
		e.ProviderRequest.Model == "" || stage.Model != "" && stage.Model != e.ProviderRequest.Model ||
		stageSchemaErr != nil || providerSchemaErr != nil || !bytes.Equal(stageSchema, providerSchema) ||
		len(e.ProviderRequest.Messages) < len(stage.Messages) {
		return bad()
	}
	for i, message := range stage.Messages {
		if message == nil || message.Role != e.ProviderRequest.Messages[i].Role || message.Content != e.ProviderRequest.Messages[i].Content {
			return bad()
		}
	}
	var body map[string]json.RawMessage
	var bodyRaw []byte
	for _, message := range stage.Messages {
		if message.Role != "user" {
			continue
		}
		var value map[string]json.RawMessage
		if StrictJSON([]byte(message.Content), &value) != nil {
			return bad()
		}
		if _, ok := value["memory_evidence"]; !ok {
			continue
		}
		if body != nil {
			return bad()
		}
		body, bodyRaw = value, []byte(message.Content)
	}
	if body == nil {
		return bad()
	}
	var provided memoryEvidencePacket
	var supplied Candidate
	if StrictJSON(body["memory_evidence"], &provided) != nil || !reflect.DeepEqual(provided, e.Registry) ||
		StrictJSON(body["candidate"], &supplied) != nil {
		return bad()
	}
	full, _ := canonicalCandidate(supplied)
	if !bytes.Equal(raw, full) {
		return bad()
	}
	var pin struct {
		ExperienceID  string        `json:"experience_id"`
		BranchID      string        `json:"branch_id"`
		Revision      int64         `json:"revision"`
		StateCoverage StateCoverage `json:"state_coverage"`
	}
	if json.Unmarshal(body["context"], &pin) != nil || pin.ExperienceID != e.Origin.ExperienceID ||
		pin.BranchID != e.Origin.BranchID || pin.Revision != e.Origin.BaseRevision ||
		pin.StateCoverage.SourceHandle != e.Origin.SourceHandle || pin.StateCoverage.Audience != "author" {
		return bad()
	}
	resolved := map[string]MemoryEvidenceRef{}
	identities, locations := map[string]bool{}, map[string]bool{}
	candidates := 0
	for _, source := range e.Registry.Sources {
		if !keyOK(source.ID) || locations[source.Location] {
			return bad()
		}
		if _, exists := resolved[source.ID]; exists {
			return bad()
		}
		value, err := memoryJSONAt(bodyRaw, source.Location)
		if err != nil {
			return bad()
		}
		var ref MemoryEvidenceRef
		switch source.Kind {
		case "candidate":
			var passage string
			if source.Location != "/candidate/passage" || json.Unmarshal(value, &passage) != nil || passage != candidate.Passage ||
				source.TextSHA256 != memoryPageSHA256(passage) || source.Revision != 0 || source.FactID != "" ||
				source.AsOfRevision != 0 || source.RecordSHA256 != "" {
				return bad()
			}
			ref = MemoryEvidenceRef{Kind: "formal_page", Revision: e.Origin.BaseRevision + 1, TextSHA256: source.TextSHA256}
			candidates++
		case "formal_page":
			if !strings.HasPrefix(source.Location, "/context/history/") && !strings.HasPrefix(source.Location, "/evidence_pages/") {
				return bad()
			}
			var page HistoryPage
			if StrictJSON(value, &page) != nil || page.Revision < 1 || page.Revision > e.Origin.BaseRevision ||
				page.Revision != source.Revision || source.TextSHA256 != memoryPageSHA256(page.Text) ||
				source.FactID != "" || source.AsOfRevision != 0 || source.RecordSHA256 != "" {
				return bad()
			}
			ref = MemoryEvidenceRef{Kind: "formal_page", Revision: page.Revision, TextSHA256: source.TextSHA256}
		case "authority_fact":
			if !strings.HasPrefix(source.Location, "/context/state/facts/") && !strings.HasPrefix(source.Location, "/review_evidence/knowledge_targets/") && !strings.HasPrefix(source.Location, "/evidence_objects/") {
				return bad()
			}
			actualRevision := e.Origin.BaseRevision
			if strings.HasPrefix(source.Location, "/evidence_objects/") {
				if !strings.HasSuffix(source.Location, "/body") {
					return bad()
				}
				objectRaw, err := memoryJSONAt(bodyRaw, strings.TrimSuffix(source.Location, "/body"))
				var object ReadObject
				if err != nil || StrictJSON(objectRaw, &object) != nil || object.Type != "fact" {
					return bad()
				}
				actualRevision = object.AsOfRevision
			}
			if source.AsOfRevision != actualRevision {
				return bad()
			}
			var fact Fact
			if StrictJSON(value, &fact) != nil || source.Revision != 0 || source.TextSHA256 != "" ||
				source.FactID != fact.ID || source.AsOfRevision < 1 || source.AsOfRevision > e.Origin.BaseRevision ||
				fact.SourceRevision > source.AsOfRevision {
				return bad()
			}
			fhash, err := memoryFactSHA256(fact)
			if err != nil || fhash != source.RecordSHA256 {
				return bad()
			}
			ref = MemoryEvidenceRef{Kind: "authority_fact", FactID: fact.ID, AsOfRevision: source.AsOfRevision, RecordSHA256: fhash}
		default:
			return bad()
		}
		identity, valid := memoryEvidenceIdentity(ref)
		if !valid || identities[identity] {
			return bad()
		}
		identities[identity], locations[source.Location] = true, true
		resolved[source.ID] = ref
	}
	if candidates != 1 {
		return bad()
	}
	requiredIDs := map[string]bool{}
	for _, required := range e.Registry.RequiredPages {
		if !keyOK(required.MemoryID) || requiredIDs[required.MemoryID] || required.Revision < 1 || required.Revision > e.Origin.BaseRevision {
			return bad()
		}
		requiredIDs[required.MemoryID] = true
		present := false
		for _, source := range e.Registry.Sources {
			present = present || source.Kind == "formal_page" && source.Revision == required.Revision
		}
		if present != required.Loaded {
			return bad()
		}
	}
	return resolved, nil
}

func resolveMemoryEvidence(candidate Candidate, approval *NarrativeApproval) (map[string][]MemoryEvidenceRef, error) {
	all, err := validateMemoryEvidenceRequest(candidate, approval.Evidence)
	if err != nil {
		return nil, err
	}
	for _, required := range approval.Evidence.Registry.RequiredPages {
		if !required.Loaded {
			return nil, fail("narrative_memory_required_missing")
		}
	}
	out := map[string][]MemoryEvidenceRef{}
	current := MemoryEvidenceRef{Kind: "formal_page", Revision: approval.Evidence.Origin.BaseRevision + 1, TextSHA256: memoryPageSHA256(candidate.Passage)}
	for _, support := range approval.Result.MemorySupports {
		refs := []MemoryEvidenceRef{}
		hasCurrent := false
		for _, id := range support.SourceIDs {
			ref, ok := all[id]
			if !ok {
				return nil, fail("narrative_memory_evidence_invalid")
			}
			refs = append(refs, ref)
			hasCurrent = hasCurrent || ref == current
		}
		if !hasCurrent {
			return nil, fail("narrative_memory_evidence_invalid")
		}
		normalized, err := normalizeMemoryDependencies(refs)
		if err != nil {
			return nil, err
		}
		out[support.MemoryID] = normalized
	}
	return out, nil
}

func verifyMemoryEvidenceApproval(candidate Candidate, approval *NarrativeApproval) (map[string][]MemoryEvidenceRef, error) {
	resolved, err := resolveMemoryEvidence(candidate, approval)
	if err != nil {
		return nil, err
	}
	if approval.Evidence.Resolved == nil || !reflect.DeepEqual(resolved, approval.Evidence.Resolved) {
		return nil, fail("narrative_memory_evidence_invalid")
	}
	return resolved, nil
}

// Apply is not an approval factory. Even empty deltas require the private
// credential; ordinary JSON candidates cannot supply Candidate.Review.
func verifyMemoryDeltaApproval(ctx Context, candidate Candidate) (map[string][]MemoryEvidenceRef, error) {
	if candidate.MemoryDelta == nil {
		return nil, fail("invalid_literary_memory")
	}
	if err := verifyNarrativeApproval(candidate, candidate.Review); err != nil {
		return nil, err
	}
	e := candidate.Review.Evidence
	if e.Origin.ExperienceID != ctx.ExperienceID || e.Origin.BranchID != ctx.BranchID ||
		e.Origin.BaseRevision != ctx.Revision {
		return nil, fail("narrative_memory_origin_invalid")
	}
	state := ctx.State
	if ctx.AuthorityState != nil {
		state = *ctx.AuthorityState
	}
	required := memoryEvidenceRequirements(candidate, state)
	if len(required) != len(e.Registry.RequiredPages) {
		return nil, fail("narrative_memory_required_missing")
	}
	for i, item := range required {
		if e.Registry.RequiredPages[i].MemoryID != item.MemoryID || e.Registry.RequiredPages[i].Revision != item.Revision ||
			!e.Registry.RequiredPages[i].Loaded {
			return nil, fail("narrative_memory_required_missing")
		}
	}
	return verifyMemoryEvidenceApproval(candidate, candidate.Review)
}
