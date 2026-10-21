package experience

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// This is a deterministic outgoing-request regression, not a model judgment.
// It catches the lost capacity when an omitted target is first hydrated and
// then selected again by the stage compiler.
func TestNarrativeReviewReconcileRestoresCapacityForCompleteTarget(t *testing.T) {
	for _, stage := range []string{"review", "repair_review"} {
		t.Run(stage, func(t *testing.T) {
			run, call, _ := reviewContextFixture(t)
			full := strings.Repeat("The entire bounded source record remains intact. ", 60)
			run.context.AuthorityState.Facts[0].Text = full
			if stage == "repair_review" {
				run.last, run.reviewQuoteInvalid = "review", true
				call.NarrativeStage = stage
			}
			// Keep the actual pre-validation/hydration, then explicitly perform
			// the owner's material rewrite before its final budget measurement.
			if _, err := run.before(call); err != nil {
				t.Fatal(err)
			}
			body := reconcileBody(t, call)
			var candidate Candidate
			if err := StrictJSON(body["candidate"], &candidate); err != nil {
				t.Fatal(err)
			}
			if err := run.replaceStageMaterials(body, stage, &candidate); err != nil {
				t.Fatal(err)
			}
			call.Messages[1].Content = string(narrativeMarshal(body))
			// One complete record fits; paying for a second identical copy does
			// not. The fixed ceiling lies between those two wire sizes.
			budget := narrativeCallBytes(call) - len(full)/2
			beforeContext, beforeCandidate := append([]byte(nil), body["context"]...), append([]byte(nil), body["candidate"]...)
			if err := run.reconcileReviewEvidence(call); err != nil {
				t.Fatal(err)
			}
			if narrativeCallBytes(call) > budget {
				t.Fatalf("complete target duplicated across hydrated evidence and stage state: bytes=%d ceiling=%d copies=%d",
					narrativeCallBytes(call), budget, strings.Count(call.Messages[1].Content, full))
			}
			if strings.Count(call.Messages[1].Content, full) != 1 {
				t.Fatal("target was shortened, dropped, or duplicated")
			}
			after := reconcileBody(t, call)
			if !bytes.Equal(beforeContext, after["context"]) || !bytes.Equal(beforeCandidate, after["candidate"]) {
				t.Fatal("reconciliation changed context or frozen candidate")
			}
			if _, exists := after["review_evidence"]; exists {
				t.Fatal("fully duplicated evidence carrier was retained")
			}
			stable := call.Messages[1].Content
			if err := run.reconcileReviewEvidence(call); err != nil || stable != call.Messages[1].Content {
				t.Fatal("reconciliation was not idempotent", err)
			}
		})
	}
}

func TestNarrativeReviewReconcileBeforeEnforcesExactFinalBudget(t *testing.T) {
	for _, stage := range []string{"review", "repair_review"} {
		t.Run(stage, func(t *testing.T) {
			full := strings.Repeat("The entire bounded source record remains intact. ", 60)
			fixture := func(budget int) (*narrativeRun, *pb.ModelCallRequest) {
				run, call, _ := reviewContextFixture(t)
				run.context.AuthorityState.Facts[0].Text = full
				run.materialBudget, run.stageInputBudget = 12<<10, budget
				if stage == "repair_review" {
					run.last, run.reviewQuoteInvalid = "review", true
					call.NarrativeStage = stage
				}
				return run, call
			}
			// Obtain the complete required packet through the real before path.
			// This fixture has no optional selected facts or author notebook.
			reference, referenceCall := fixture(32 << 10)
			if _, err := reference.before(referenceCall); err != nil {
				t.Fatal(err)
			}
			if strings.Count(referenceCall.Messages[1].Content, full) != 1 {
				t.Fatal("real compiler path retained duplicate or incomplete target")
			}
			limit := narrativeCallBytes(referenceCall)
			for _, spare := range []int{0, -1} {
				run, call := fixture(limit + spare)
				_, err := run.before(call)
				if spare == 0 {
					if err != nil || narrativeCallBytes(call) != limit || strings.Count(call.Messages[1].Content, full) != 1 {
						t.Fatalf("single-copy packet did not fit its exact final boundary: limit=%d err=%v", limit, err)
					}
				} else if err == nil || err.Error() != "context_budget_exceeded" {
					t.Fatalf("one-byte-short budget dropped required evidence or bypassed accounting: %v", err)
				}
			}
			t.Logf("actual before: %s fits at %d bytes; %d bytes rejects", stage, limit, limit-1)
		})
	}
}

func TestNarrativeReviewReconcileKeepsUniqueEvidenceInOriginalOrder(t *testing.T) {
	run, call, candidate := reviewContextFixture(t)
	for _, id := range []string{"second", "third"} {
		run.context.AuthorityState.Facts = append(run.context.AuthorityState.Facts,
			Fact{ID: id, Kind: "statement", Text: "A separately attributed statement.", SubjectID: "speaker", KnownBy: []string{"speaker"}, SourceRevision: 1})
		candidate.KnowledgeChanges = append(candidate.KnowledgeChanges, KnowledgeChange{SubjectID: "listener", FactID: id})
	}
	run.extracted, _ = canonicalCandidate(candidate)
	call.Messages[1].Content = string(narrativeMarshal(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
	prepareReconcileCall(t, run, call)
	body := reconcileBody(t, call)
	var view map[string]json.RawMessage
	reconcileMust(t, StrictJSON(body["context"], &view))
	var state State
	reconcileMust(t, StrictJSON(view["state"], &state))
	state.Facts = state.Facts[:1]       // Keep the first target; the sidecar owns the other two.
	state.Entities = state.Entities[:1] // Keep speaker; listener remains in the sidecar.
	view["state"] = narrativeMarshal(state)
	body["context"] = narrativeMarshal(view)
	before := append([]byte(nil), body["context"]...)
	call.Messages[1].Content = string(narrativeMarshal(body))
	reconcileMust(t, run.reconcileReviewEvidence(call))
	body = reconcileBody(t, call)
	var evidence narrativeReviewEvidence
	reconcileMust(t, StrictJSON(body["review_evidence"], &evidence))
	if len(evidence.KnowledgeTargets) != 2 || evidence.KnowledgeTargets[0].ID != "second" || evidence.KnowledgeTargets[1].ID != "third" ||
		len(evidence.Subjects) != 1 || evidence.Subjects[0].ID != "listener" {
		t.Fatalf("unique evidence was discarded or reordered: %+v", evidence)
	}
	if !bytes.Equal(before, body["context"]) {
		t.Fatal("unique evidence was imported into state")
	}
}

func TestNarrativeReviewReconcileKeepsNewFactKnowledgeIdentities(t *testing.T) {
	for _, newAuthor := range []bool{false, true} {
		run, call, candidate := reviewContextFixture(t)
		run.context.State.Entities = []Entity{}
		candidate.KnowledgeChanges = []KnowledgeChange{}
		subject := "speaker"
		if newAuthor {
			subject = "new-speaker"
			candidate.NewEntities = []Entity{{ID: subject, Kind: "person", Name: "New speaker", RelatedIDs: []string{}}}
		}
		candidate.NewFacts = []Fact{{ID: "new-claim", Kind: "statement", Text: "A statement was communicated.", SubjectID: subject, KnownBy: []string{"listener"}, SourceRevision: 3}}
		run.extracted, _ = canonicalCandidate(candidate)
		call.Messages[1].Content = string(narrativeMarshal(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
		prepareReconcileCall(t, run, call)
		before := reconcileBody(t, call)["candidate"]
		reconcileMust(t, run.reconcileReviewEvidence(call))
		body := reconcileBody(t, call)
		if !bytes.Equal(before, body["candidate"]) {
			t.Fatal("new target or new author changed during reconciliation")
		}
		var view struct {
			State State `json:"state"`
		}
		reconcileMust(t, json.Unmarshal(body["context"], &view))
		identities := map[string]bool{}
		for _, entity := range view.State.Entities {
			identities[entity.ID] = true
		}
		if !identities["listener"] || !newAuthor && !identities["speaker"] {
			t.Fatal("new-fact receiver or existing attributed author disappeared")
		}
		if newAuthor && identities[subject] {
			t.Fatal("proposed new author was installed in committed state")
		}
		if _, exists := body["review_evidence"]; exists {
			t.Fatal("identities already visible in state or candidate remained duplicated")
		}
	}
}

func TestNarrativeReviewReconcileRejectsDuplicateFinalStateWithoutSidecar(t *testing.T) {
	for _, kind := range []string{"fact", "entity"} {
		t.Run(kind, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			candidate.KnowledgeChanges = []KnowledgeChange{}
			run.extracted, _ = canonicalCandidate(candidate)
			call.Messages[1].Content = string(narrativeMarshal(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
			prepareReconcileCall(t, run, call)
			body := reconcileBody(t, call)
			if _, exists := body["review_evidence"]; exists {
				t.Fatal("fixture unexpectedly has knowledge evidence")
			}
			editReconcileState(t, body, func(state *State) {
				if kind == "fact" {
					state.Facts = append(state.Facts, state.Facts[0])
				} else {
					state.Entities = append(state.Entities, state.Entities[0])
				}
			})
			call.Messages[1].Content = string(narrativeMarshal(body))
			if err := run.reconcileReviewEvidence(call); err == nil {
				t.Fatal("duplicate final state bypassed validation without a sidecar")
			}
		})
	}
}

func TestNarrativeReviewReconcileRejectsConflictsWithoutMutation(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(map[string]json.RawMessage)
	}{
		{"fact_text", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.KnowledgeTargets[0].Text = "Truncated or forged." })
		}},
		{"fact_known_by", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.KnowledgeTargets[0].KnownBy = []string{"listener"} })
		}},
		{"entity_identity", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.Subjects[0].Name = "Someone else" })
		}},
		{"duplicate_sidecar_fact", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) {
				e.KnowledgeTargets = append(e.KnowledgeTargets, e.KnowledgeTargets[0])
			})
		}},
		{"duplicate_sidecar_entity", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.Subjects = append(e.Subjects, e.Subjects[0]) })
		}},
		{"unrequested_fact", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) {
				e.KnowledgeTargets = append(e.KnowledgeTargets, Fact{ID: "unrelated-secret", Kind: "secret", Text: "无关的私密材料不应被补入。", KnownBy: []string{}, SourceRevision: 1})
			})
		}},
		{"experience_binding", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.ExperienceID = "other" })
		}},
		{"branch_binding", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.BranchID = "other" })
		}},
		{"revision_binding", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.BaseRevision++ })
		}},
		{"source_binding", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.SourceHandle = "other" })
		}},
		{"unknown_sidecar_field", func(body map[string]json.RawMessage) {
			var wire map[string]json.RawMessage
			reconcileMust(t, StrictJSON(body["review_evidence"], &wire))
			wire["extra"] = json.RawMessage(`true`)
			body["review_evidence"] = narrativeMarshal(wire)
		}},
		{"null_targets", func(body map[string]json.RawMessage) {
			editReconcileEvidence(t, body, func(e *narrativeReviewEvidence) { e.KnowledgeTargets = nil })
		}},
		{"duplicate_state_fact", func(body map[string]json.RawMessage) {
			editReconcileState(t, body, func(s *State) { s.Facts = append(s.Facts, s.Facts[0]) })
		}},
		{"duplicate_state_entity", func(body map[string]json.RawMessage) {
			editReconcileState(t, body, func(s *State) { s.Entities = append(s.Entities, s.Entities[0]) })
		}},
		{"conflicting_state_target", func(body map[string]json.RawMessage) {
			editReconcileState(t, body, func(s *State) { s.Facts[0].Text = "Wrong materialized target." })
		}},
		{"conflicting_state_identity", func(body map[string]json.RawMessage) {
			editReconcileState(t, body, func(s *State) { s.Entities[0].Name = "Wrong identity." })
		}},
		{"context_pin", func(body map[string]json.RawMessage) {
			var view map[string]json.RawMessage
			reconcileMust(t, StrictJSON(body["context"], &view))
			view["branch_id"] = json.RawMessage(`"other"`)
			body["context"] = narrativeMarshal(view)
		}},
		{"context_audience", func(body map[string]json.RawMessage) {
			var view map[string]json.RawMessage
			reconcileMust(t, StrictJSON(body["context"], &view))
			var coverage StateCoverage
			reconcileMust(t, StrictJSON(view["state_coverage"], &coverage))
			coverage.Audience = "reader"
			view["state_coverage"] = narrativeMarshal(coverage)
			body["context"] = narrativeMarshal(view)
		}},
		{"candidate_changed", func(body map[string]json.RawMessage) {
			var candidate Candidate
			reconcileMust(t, StrictJSON(body["candidate"], &candidate))
			candidate.Passage += " A new sentence."
			body["candidate"] = narrativeMarshal(candidate)
		}},
		{"lost_target_without_sidecar", func(body map[string]json.RawMessage) {
			delete(body, "review_evidence")
			editReconcileState(t, body, func(s *State) { s.Facts = []Fact{} })
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			run, call, _ := reviewContextFixture(t)
			prepareReconcileCall(t, run, call)
			body := reconcileBody(t, call)
			tc.mutate(body)
			call.Messages[1].Content = string(narrativeMarshal(body))
			before := call.Messages[1].Content
			if err := run.reconcileReviewEvidence(call); err == nil || err.Error() != "narrative_review_evidence_invalid" {
				t.Fatal("invalid review evidence survived reconciliation", err)
			}
			if call.Messages[1].Content != before {
				t.Fatal("rejection partly rewrote the outgoing request")
			}
		})
	}
}

func TestNarrativeReviewReconcileKeepsCarrierBoundary(t *testing.T) {
	for _, scenario := range []string{"assistant", "second_user", "second_system", "nil", "wrong_stage", "duplicate_key", "unhydrated"} {
		t.Run(scenario, func(t *testing.T) {
			run, call, _ := reviewContextFixture(t)
			prepareReconcileCall(t, run, call)
			switch scenario {
			case "assistant":
				call.Messages = append(call.Messages, &pb.ModelMessage{Role: "assistant", Content: "extra evidence"})
			case "second_user":
				call.Messages = append(call.Messages, call.Messages[1])
			case "second_system":
				call.Messages = append(call.Messages, call.Messages[0])
			case "nil":
				call.Messages = append(call.Messages, nil)
			case "wrong_stage":
				call.NarrativeStage = "write"
			case "duplicate_key":
				call.Messages[1].Content = strings.Replace(call.Messages[1].Content, `"review_evidence":`, `"review_evidence":{},"review_evidence":`, 1)
			case "unhydrated":
				run.reviewed = nil
			}
			if err := run.reconcileReviewEvidence(call); err == nil {
				t.Fatal("reconciliation widened the existing review boundary")
			}
		})
	}
}

func prepareReconcileCall(t *testing.T, run *narrativeRun, call *pb.ModelCallRequest) {
	t.Helper()
	reconcileMust(t, func() error { _, err := run.before(call); return err }())
	body := reconcileBody(t, call)
	var candidate Candidate
	reconcileMust(t, StrictJSON(body["candidate"], &candidate))
	reconcileMust(t, run.replaceStageMaterials(body, call.NarrativeStage, &candidate))
	call.Messages[1].Content = string(narrativeMarshal(body))
}

func editReconcileEvidence(t *testing.T, body map[string]json.RawMessage, edit func(*narrativeReviewEvidence)) {
	t.Helper()
	var evidence narrativeReviewEvidence
	reconcileMust(t, StrictJSON(body["review_evidence"], &evidence))
	edit(&evidence)
	body["review_evidence"] = narrativeMarshal(evidence)
}

func editReconcileState(t *testing.T, body map[string]json.RawMessage, edit func(*State)) {
	t.Helper()
	var view map[string]json.RawMessage
	reconcileMust(t, StrictJSON(body["context"], &view))
	var state State
	reconcileMust(t, StrictJSON(view["state"], &state))
	edit(&state)
	view["state"] = narrativeMarshal(state)
	body["context"] = narrativeMarshal(view)
}

func reconcileBody(t *testing.T, call *pb.ModelCallRequest) map[string]json.RawMessage {
	t.Helper()
	var body map[string]json.RawMessage
	if err := StrictJSON([]byte(call.Messages[1].Content), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func reconcileMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
