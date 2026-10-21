package experience

import (
	"encoding/json"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/protobuf/proto"
)

// Synthetic verifier controls, not trusted approval issuance: this test
// deliberately edits private credential data and recomputes all fingerprints.
// It tests independent payload/revision binding, not model entailment or SQL.
func memoryFactBindingFixture(t *testing.T, location string) (Candidate, map[string]json.RawMessage) {
	t.Helper()
	_, candidate := memoryEvidenceApprovalFixture(t)
	evidence := candidate.Review.Evidence
	var stage pb.ModelCallRequest
	if err := proto.Unmarshal(evidence.StageRequest, &stage); err != nil {
		t.Fatal(err)
	}
	var body map[string]json.RawMessage
	if err := StrictJSON([]byte(stage.Messages[1].Content), &body); err != nil {
		t.Fatal(err)
	}
	// Retain the real fixture's candidate/pin and its candidate source. Install
	// one controlled extra record at each actual source-bearing location.
	sources := []memoryEvidenceSource{}
	currentID := ""
	for _, source := range evidence.Registry.Sources {
		if source.Kind == "candidate" {
			sources = append(sources, source)
			currentID = source.ID
		}
	}
	if currentID == "" || len(sources) != 1 || evidence.Origin.BaseRevision != 2 {
		t.Fatal("control requires the existing two-revision fixture")
	}
	var view map[string]json.RawMessage
	if err := StrictJSON(body["context"], &view); err != nil {
		t.Fatal(err)
	}
	var state State
	if err := StrictJSON(view["state"], &state); err != nil {
		t.Fatal(err)
	}
	state.Facts = []Fact{}
	delete(body, "review_evidence")
	delete(body, "evidence_objects")
	fact := Fact{ID: "binding-record", Kind: "fact", Text: "The recorded box is closed.",
		SubjectID: "speaker", KnownBy: []string{"speaker"}, SourceRevision: 1}
	revision := evidence.Origin.BaseRevision
	switch location {
	case "/context/state/facts/0":
		state.Facts = []Fact{fact}
	case "/review_evidence/knowledge_targets/0":
		body["review_evidence"] = narrativeMarshal(map[string]any{"knowledge_targets": []Fact{fact}})
	case "/evidence_objects/0/body":
		revision = 1
		body["evidence_objects"] = narrativeMarshal([]ReadObject{{
			Type: "fact", AsOfRevision: revision, Body: narrativeMarshal(fact),
		}})
	default:
		t.Fatal("unknown control location")
	}
	view["state"] = narrativeMarshal(state)
	body["context"] = narrativeMarshal(view)
	hash, err := memoryFactSHA256(fact)
	if err != nil {
		t.Fatal(err)
	}
	evidence.Registry.Sources = append(sources, memoryEvidenceSource{
		ID: "binding-source", Kind: "authority_fact", Location: location,
		FactID: fact.ID, AsOfRevision: revision, RecordSHA256: hash,
	})
	candidate.Review.Result.MemorySupports[0].SourceIDs = []string{currentID, "binding-source"}
	memoryFactBindingReseal(t, candidate, body)
	resolved, err := resolveMemoryEvidence(candidate, candidate.Review)
	if err != nil {
		t.Fatal("valid control did not establish matching source/position", err)
	}
	evidence.Resolved = resolved
	if err := verifyNarrativeApproval(candidate, candidate.Review); err != nil {
		t.Fatal("valid control rejected by complete verifier", err)
	}
	return candidate, body
}

func memoryFactBindingReseal(t *testing.T, candidate Candidate, body map[string]json.RawMessage) {
	t.Helper()
	evidence := candidate.Review.Evidence
	body["memory_evidence"] = narrativeMarshal(evidence.Registry)
	var stage pb.ModelCallRequest
	if err := proto.Unmarshal(evidence.StageRequest, &stage); err != nil {
		t.Fatal(err)
	}
	users := 0
	for i, message := range stage.Messages {
		if message.Role != "user" {
			continue
		}
		if i >= len(evidence.ProviderRequest.Messages) || evidence.ProviderRequest.Messages[i].Role != "user" {
			t.Fatal("stage/provider control messages are not aligned")
		}
		users++
		message.Content = string(narrativeMarshal(body))
		evidence.ProviderRequest.Messages[i].Content = message.Content
	}
	if users != 1 {
		t.Fatal("ambiguous control user message")
	}
	var err error
	evidence.StageRequest, err = proto.Marshal(&stage)
	if err != nil {
		t.Fatal(err)
	}
	evidence.StageRequestSHA256 = memoryPageSHA256(string(evidence.StageRequest))
	evidence.ProviderRequestSHA256, err = receiptHash(evidence.ProviderRequest)
	if err != nil {
		t.Fatal(err)
	}
	evidence.RegistrySHA256, err = receiptHash(evidence.Registry)
	if err != nil {
		t.Fatal(err)
	}
	// Check that the serialized packet also matches the resealed registry:
	// none of the negatives below can be rejected merely for stale hashes.
	var packet memoryEvidencePacket
	if err := StrictJSON(body["memory_evidence"], &packet); err != nil {
		t.Fatal(err)
	}
	packetHash, err := receiptHash(packet)
	if err != nil || packetHash != evidence.RegistrySHA256 {
		t.Fatal("control failed to reseal the serialized registry", err)
	}
}

func TestMemoryEvidenceFactBindingVersionComesFromActualPayloadLocation(t *testing.T) {
	for _, location := range []string{
		"/context/state/facts/0",
		"/review_evidence/knowledge_targets/0",
		"/evidence_objects/0/body",
	} {
		t.Run(location, func(t *testing.T) {
			candidate, body := memoryFactBindingFixture(t, location)
			evidence := candidate.Review.Evidence
			beforeStage, beforeProvider, beforeRegistry := evidence.StageRequestSHA256,
				evidence.ProviderRequestSHA256, evidence.RegistrySHA256
			oldRecordHash := evidence.Registry.Sources[1].RecordSHA256
			// Both 1 and 2 are valid existing revisions, and SourceRevision=1
			// fits both. Only the actual source position distinguishes them.
			if evidence.Registry.Sources[1].AsOfRevision == 1 {
				evidence.Registry.Sources[1].AsOfRevision = 2
			} else {
				evidence.Registry.Sources[1].AsOfRevision = 1
			}
			memoryFactBindingReseal(t, candidate, body)
			if evidence.StageRequestSHA256 == beforeStage || evidence.ProviderRequestSHA256 == beforeProvider ||
				evidence.RegistrySHA256 == beforeRegistry || evidence.Registry.Sources[1].RecordSHA256 != oldRecordHash {
				t.Fatal("control did not isolate revision binding with all fingerprints recomputed")
			}
			if _, err := validateMemoryEvidenceRequest(candidate, evidence); err == nil ||
				err.Error() != "narrative_memory_evidence_invalid" {
				t.Fatalf("same fact bytes were rebound to a different actual input version: %v", err)
			}
		})
	}
}

func TestMemoryEvidenceFactBindingObjectRequiresFactParentAndMatchingAsOf(t *testing.T) {
	for _, mutation := range []string{"parent-type", "parent-revision"} {
		t.Run(mutation, func(t *testing.T) {
			candidate, body := memoryFactBindingFixture(t, "/evidence_objects/0/body")
			evidence := candidate.Review.Evidence
			var objects []ReadObject
			if err := StrictJSON(body["evidence_objects"], &objects); err != nil {
				t.Fatal(err)
			}
			beforeStage, beforeProvider := evidence.StageRequestSHA256, evidence.ProviderRequestSHA256
			if mutation == "parent-type" {
				objects[0].Type = "entity"
			} else {
				objects[0].AsOfRevision = 2
			}
			body["evidence_objects"] = narrativeMarshal(objects)
			memoryFactBindingReseal(t, candidate, body)
			if evidence.StageRequestSHA256 == beforeStage || evidence.ProviderRequestSHA256 == beforeProvider {
				t.Fatal("changed object parent was not bound into both requests")
			}
			if _, err := validateMemoryEvidenceRequest(candidate, evidence); err == nil ||
				err.Error() != "narrative_memory_evidence_invalid" {
				t.Fatalf("non-fact or differently versioned parent supplied fact authority: %v", err)
			}
		})
	}
}
