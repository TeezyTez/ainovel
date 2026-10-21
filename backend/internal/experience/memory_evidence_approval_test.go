package experience

import (
	"bytes"
	"encoding/json"
	"testing"

	"elselife/backend/internal/capability/model"
	"google.golang.org/protobuf/proto"
)

// Synthetic private-credential controls. No result here certifies entailment,
// literary quality, or a database preparation handoff.
func memoryEvidenceApprovalFixture(t *testing.T) (*narrativeRun, Candidate) {
	t.Helper()
	p, call := memoryEvidenceCallFixture(t)
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	p.evidenceOrigin = &narrativeEvidenceOrigin{Kind: "operation", ID: "request", ExperienceID: p.context.ExperienceID,
		BranchID: p.context.BranchID, BaseRevision: p.context.Revision, BaseFence: 5,
		SourceHandle: p.context.StateCoverage.SourceHandle, Pin: memoryPageSHA256("fixed test configuration")}
	request := model.Request{Model: "fixture", Schema: json.RawMessage(call.SchemaJson), MaxOutputTokens: 8192}
	for _, message := range call.Messages {
		request.Messages = append(request.Messages, model.Message{Role: message.Role, Content: message.Content})
	}
	raw, err := proto.Marshal(call)
	if err != nil {
		t.Fatal(err)
	}
	if err = p.bindMemoryEvidenceRequest(7, raw, request); err != nil {
		t.Fatal(err)
	}
	var c Candidate
	if err = StrictJSON(p.reviewed, &c); err != nil {
		t.Fatal(err)
	}
	c.Review = &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: p.reviewed, Evidence: p.evidenceCall,
		Result: NarrativeReview{Approved: true, RepairScope: "none", Issues: []NarrativeIssue{},
			Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{},
			MemorySupports: []NarrativeMemorySupport{{MemoryID: "returned", SourceIDs: []string{"s1"}}}}}
	resolved, err := resolveMemoryEvidence(c, c.Review)
	if err != nil {
		t.Fatal(err)
	}
	c.Review.Evidence.Resolved = resolved
	return p, c
}

func TestMemoryEvidenceApprovalBindsFullCandidateAndActualRequest(t *testing.T) {
	p, c := memoryEvidenceApprovalFixture(t)
	refs, err := verifyMemoryDeltaApproval(p.context, c)
	if err != nil || len(refs["returned"]) != 1 || refs["returned"][0].Revision != p.context.Revision+1 {
		t.Fatal("valid actual request failed", err, refs)
	}
	for _, mutation := range []string{"summary", "provider", "registry", "source-id", "false-review", "branch", "missing-origin", "same-body-new-state"} {
		t.Run(mutation, func(t *testing.T) {
			p, c := memoryEvidenceApprovalFixture(t)
			switch mutation {
			case "summary":
				c.MemoryDelta.Entries[0].Summary = "An unrelated agreement."
			case "same-body-new-state":
				c.MemoryDelta.Entries[0].TargetIDs = []string{"listener"}
			case "provider":
				c.Review.Evidence.ProviderRequest.Messages[1].Content = "{}"
			case "registry":
				c.Review.Evidence.Registry.Sources[0].Location = "/candidate/title"
			case "source-id":
				c.Review.Result.MemorySupports[0].SourceIDs = []string{"unprovided"}
			case "false-review":
				c.Review.Result.Approved = false
			case "branch":
				p.context.BranchID = "another-branch"
			case "missing-origin":
				c.Review.Evidence.Origin.ID = ""
			}
			if _, err := verifyMemoryDeltaApproval(p.context, c); err == nil {
				t.Fatal("unbound evidence approved", mutation)
			}
		})
	}
}

func TestMemoryEvidenceApprovalRejectsUnloadedRequiredPage(t *testing.T) {
	p, c := memoryEvidenceApprovalFixture(t)
	p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{{
		MemoryChange: MemoryChange{ID: "returned", Kind: "episode", SubjectIDs: []string{"speaker"}, TargetIDs: []string{},
			Cue: "old", Summary: "Earlier return.", Status: "active", RetrievalKeys: []string{}, FactIDs: []string{}, Quote: "Earlier return."},
		SourceRevision: 1, SourceSHA256: memoryPageSHA256("Earlier return."), UpdatedRevision: 1,
	}}}
	if _, err := verifyMemoryDeltaApproval(p.context, c); err == nil {
		t.Fatal("approval ignored newly required old memory source")
	}
}

func TestMemoryEvidenceFactHashIncludesKnowledgeAndIntegerVersion(t *testing.T) {
	f := Fact{ID: "f", Kind: "fact", Text: "A book.", KnownBy: []string{"speaker"}, SourceRevision: 9007199254740993}
	before, _ := memoryFactSHA256(f)
	f.KnownBy = append(f.KnownBy, "listener")
	after, _ := memoryFactSHA256(f)
	if before == after {
		t.Fatal("full record hash erased knowledge")
	}
	f.SourceRevision--
	next, _ := memoryFactSHA256(f)
	if next == after {
		t.Fatal("full record hash rounded adjacent large integer revisions")
	}
}

// JSONB preserves JSON values but may rewrite whitespace/key order in embedded
// RawMessages. The protobuf request bytes remain the original bytes. Its schema
// must still equal the provider schema by JSON value after a storage round trip.
func TestMemoryEvidenceApprovalPreservesSchemaAcrossJSONStorage(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(map[bool]string{false: "format-only", true: "changed-value"}[changed], func(t *testing.T) {
			_, c := memoryEvidenceApprovalFixture(t)
			e := c.Review.Evidence
			var formatted bytes.Buffer
			if err := json.Indent(&formatted, e.ProviderRequest.Schema, "", "  "); err != nil {
				t.Fatal(err)
			}
			e.ProviderRequest.Schema = formatted.Bytes()
			if changed {
				e.ProviderRequest.Schema = json.RawMessage(`{"type":"string"}`)
				// Reseal the provider fingerprint too: schema equality must be
				// checked against the original protobuf, not only its own hash.
				e.ProviderRequestSHA256, _ = receiptHash(e.ProviderRequest)
			}
			err := verifyNarrativeApproval(c, c.Review)
			if changed && err == nil || !changed && err != nil {
				t.Fatalf("changed=%v error=%v", changed, err)
			}
		})
	}
}
