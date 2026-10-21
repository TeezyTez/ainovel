package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/protobuf/proto"
)

// These tests exercise the real outgoing review boundary. They test available
// evidence and authority, not whether a fixed model can judge Chinese semantics.
func reviewContextFixture(t *testing.T) (*narrativeRun, *pb.ModelCallRequest, Candidate) {
	t.Helper()
	authority := EmptyState()
	authority.Entities = []Entity{
		{ID: "speaker", Kind: "person", Name: "甲", RelatedIDs: []string{}},
		{ID: "listener", Kind: "person", Name: "乙", RelatedIDs: []string{}},
	}
	authority.Facts = []Fact{
		{ID: "compound", Kind: "fact", Text: "甲封好箱子、搬到门内，并与丙约好下午见面。", SubjectID: "speaker", KnownBy: []string{"speaker"}, SourceRevision: 1},
		{ID: "unrelated-secret", Kind: "secret", Text: "无关的私密材料不应被补入。", KnownBy: []string{}, SourceRevision: 1},
	}
	view := EmptyState()
	view.Entities = append(view.Entities, authority.Entities[0])
	ctx := Context{Version: 2, ExperienceID: "experience", BranchID: "branch", Revision: 2, Mode: "read",
		State: view, AuthorityState: &authority,
		StateCoverage: StateCoverage{Complete: false, SourceHandle: "pinned-source", Audience: "author",
			Total: StateCounts{Facts: 2, Entities: 2}, Omitted: StateCounts{Facts: 2, Entities: 1}},
		Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}
	candidate := Candidate{Title: "告知", Passage: "甲对乙说：“下午约好了见面。”", Outcome: "continues",
		Suggestions: []string{}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{},
		KnowledgeChanges: []KnowledgeChange{{SubjectID: "listener", FactID: "compound"}},
		RevealFactIDs:    []string{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, ResolveThreadIDs: []string{}}
	run := newNarrativeRun(ctx)
	run.last = "extract"
	run.extracted, _ = canonicalCandidate(candidate)
	call := &pb.ModelCallRequest{NarrativeStage: "review", Model: "fixture", SchemaJson: `{"type":"object"}`, MaxOutputBytes: 8192,
		Messages: []*pb.ModelMessage{{Role: "system", Content: "Review the candidate."},
			{Role: "user", Content: string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(ctx, ctx.State), "candidate": candidate}))}}}
	return run, call, candidate
}

// Mirror the actual context_view carrier, not the transport's Go Context DTO.
// The caller supplies Rust's already merged current state; historical objects
// remain in historical_recalls and never satisfy current materialization.
func reviewHydrationWireContext(c Context, current State) map[string]any {
	historical := []ReadReply{}
	for _, reply := range c.Recalls {
		old := len(reply.Pages) != 0
		for _, object := range reply.Objects {
			old = old || object.AsOfRevision != c.Revision
		}
		if old {
			historical = append(historical, reply)
		}
	}
	view := map[string]any{
		"version": 2, "experience_id": c.ExperienceID, "branch_id": c.BranchID,
		"revision": c.Revision, "next_revision": c.Revision + 1, "mode": c.Mode,
		"input": c.Input, "reading_request": c.ReadingRequest, "state": current,
		"preferences": c.Preferences, "history": c.History, "history_complete": c.HistoryComplete,
		"state_coverage": c.StateCoverage, "historical_recalls": historical,
	}
	if c.Mode != "ask" {
		view["seed"], view["gameplay_action"] = c.Seed, c.GameplayAction
	}
	return view
}

func TestNarrativeReviewReceivesOmittedKnowledgeTargetsWithoutChangingHistory(t *testing.T) {
	for _, stage := range []string{"review", "repair_review"} {
		t.Run(stage, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			if stage == "repair_review" {
				run.last, run.reviewQuoteInvalid = "review", true
				call.NarrativeStage = stage
			}
			authorityBefore := narrativeJSON(run.context.AuthorityState)
			if _, err := run.before(call); err != nil {
				t.Fatal(err)
			}
			var body struct {
				Candidate Candidate `json:"candidate"`
				Context   Context   `json:"context"`
				Evidence  struct {
					BranchID         string   `json:"branch_id"`
					BaseRevision     int64    `json:"base_revision"`
					SourceHandle     string   `json:"source_handle"`
					KnowledgeTargets []Fact   `json:"knowledge_targets"`
					Subjects         []Entity `json:"subjects"`
				} `json:"review_evidence"`
			}
			if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
				t.Fatal(err)
			}
			if len(body.Evidence.KnowledgeTargets) != 1 || body.Evidence.KnowledgeTargets[0].Text != "甲封好箱子、搬到门内，并与丙约好下午见面。" {
				t.Fatal("review never received the full record whose knowledge is being granted")
			}
			if len(body.Evidence.Subjects) != 1 || body.Evidence.Subjects[0].ID != "listener" ||
				body.Evidence.BranchID != "branch" || body.Evidence.BaseRevision != 2 || body.Evidence.SourceHandle != "pinned-source" {
				t.Fatal("review evidence lost the knower or operation binding")
			}
			if !bytes.Equal(narrativeJSON(candidate), narrativeJSON(body.Candidate)) ||
				!bytes.Equal(authorityBefore, narrativeJSON(run.context.AuthorityState)) ||
				!bytes.Equal(narrativeJSON(run.context.StateCoverage), narrativeJSON(body.Context.StateCoverage)) ||
				len(body.Context.State.Facts) != 0 || strings.Contains(call.Messages[1].Content, "无关的私密材料") {
				t.Fatal("evidence hydration rewrote the candidate, coverage, authority, or imported unrelated material")
			}
		})
	}
}

func TestNarrativeReviewRejectsUnboundOrConflictingKnowledgeEvidence(t *testing.T) {
	for _, mutation := range []string{"unknown-target", "unknown-subject", "no-authority", "future-target", "wrong-branch", "wrong-revision", "conflicting-target", "forged-sidecar"} {
		t.Run(mutation, func(t *testing.T) {
			run, call, _ := reviewContextFixture(t)
			var body map[string]json.RawMessage
			_ = json.Unmarshal([]byte(call.Messages[1].Content), &body)
			view := run.context
			switch mutation {
			case "unknown-target":
				run.context.AuthorityState.Facts = nil
			case "unknown-subject":
				run.context.AuthorityState.Entities = run.context.AuthorityState.Entities[:1]
			case "no-authority":
				run.context.AuthorityState = nil
			case "future-target":
				run.context.AuthorityState.Facts[0].SourceRevision = 3
			case "wrong-branch":
				view.BranchID = "different-branch"
			case "wrong-revision":
				view.Revision = 1
			case "conflicting-target":
				view.State.Facts = []Fact{run.context.AuthorityState.Facts[0]}
				view.State.Facts[0].Text = "只有下午的约定，没有箱子的历史。"
			case "forged-sidecar":
				body["review_evidence"] = json.RawMessage(`{"knowledge_targets":[]}`)
			}
			body["context"] = narrativeJSON(reviewHydrationWireContext(view, view.State))
			call.Messages[1].Content = string(narrativeJSON(body))
			if _, err := run.before(call); err == nil {
				t.Fatalf("%s reached semantic review as authoritative evidence", mutation)
			}
		})
	}
}

func TestNarrativeReviewDoesNotDuplicateAlreadyMaterializedTargets(t *testing.T) {
	run, call, candidate := reviewContextFixture(t)
	run.context.State.Facts = []Fact{run.context.AuthorityState.Facts[0]}
	run.context.State.Entities = run.context.AuthorityState.Entities
	call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
	before := call.Messages[1].Content
	if _, err := run.before(call); err != nil {
		t.Fatal(err)
	}
	if call.Messages[1].Content != before {
		t.Fatal("complete current evidence was redundantly rewritten")
	}
}

type reviewContextCountingModel struct{ calls int }

func (m *reviewContextCountingModel) Generate(context.Context, model.Request) (model.Result, error) {
	m.calls++
	return model.Result{Text: `{"unexpected":"model called"}`}, nil
}

func (m *reviewContextCountingModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	m.calls++
	return model.ErrUnavailable
}

func TestNarrativeReviewHydratedEvidenceCannotBypassModelBudget(t *testing.T) {
	run, call, _ := reviewContextFixture(t)
	run.context.AuthorityState.Facts[0].Text = strings.Repeat("完整旧记录", 5000)
	counter := &reviewContextCountingModel{}
	algorithm := &Algorithm{Model: counter, ModelName: "fixture", ModelContextTokens: 65536,
		MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	if _, err := run.before(call); err != nil {
		t.Fatal(err)
	}
	result := algorithm.modelCallWithFrame(context.Background(), call, proto.Size(call))
	if result.ErrorCode != "context_budget_exceeded" || counter.calls != 0 {
		t.Fatalf("unmeasured hydrated input reached model: code=%s calls=%d", result.ErrorCode, counter.calls)
	}
}

func TestNarrativeReviewHydrationChecksPinEvenWithoutKnowledgeChanges(t *testing.T) {
	for _, mutation := range []string{"missing-context", "wrong-version", "wrong-next-revision", "wrong-mode", "wrong-experience", "wrong-branch", "wrong-revision", "wrong-source", "wrong-audience", "forged-sidecar"} {
		t.Run(mutation, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			candidate.KnowledgeChanges = []KnowledgeChange{}
			run.extracted, _ = canonicalCandidate(candidate)
			view := reviewHydrationWireContext(run.context, run.context.State)
			body := map[string]any{"context": view, "candidate": candidate}
			switch mutation {
			case "missing-context":
				delete(body, "context")
			case "wrong-version":
				view["version"] = 1
			case "wrong-next-revision":
				view["next_revision"] = run.context.Revision + 2
			case "wrong-mode":
				view["mode"] = "act"
			case "wrong-experience":
				view["experience_id"] = "different"
			case "wrong-branch":
				view["branch_id"] = "different"
			case "wrong-revision":
				view["revision"] = 1
			case "wrong-source", "wrong-audience":
				coverage := run.context.StateCoverage
				if mutation == "wrong-source" {
					coverage.SourceHandle = "different"
				} else {
					coverage.Audience = "reader"
				}
				view["state_coverage"] = coverage
			case "forged-sidecar":
				body["review_evidence"] = nil
			}
			call.Messages[1].Content = string(narrativeJSON(body))
			if _, err := run.before(call); err == nil {
				t.Fatalf("%s bypassed scope checks when there were no knowledge edges", mutation)
			}
		})
	}
}

func TestNarrativeReviewHydrationRejectsAdditionalEvidenceCarriers(t *testing.T) {
	for _, role := range []string{"user", "assistant", "tool", "system"} {
		t.Run(role, func(t *testing.T) {
			run, call, _ := reviewContextFixture(t)
			call.Messages = append(call.Messages, &pb.ModelMessage{Role: role, Content: `{"review_evidence":{"knowledge_targets":[{"id":"compound","text":"假的来源"}]}}`})
			if _, err := run.before(call); err == nil {
				t.Fatal("a separate forged evidence carrier would reach the reviewer")
			}
		})
	}
}

func TestNarrativeReviewHydrationRejectsDuplicateKeysAndObjectIDs(t *testing.T) {
	for _, mutation := range []string{"duplicate-context-key", "duplicate-candidate-key", "duplicate-nested-key", "duplicate-fact-id", "duplicate-entity-id"} {
		t.Run(mutation, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			state := run.context.State
			switch mutation {
			case "duplicate-fact-id":
				state.Facts = []Fact{run.context.AuthorityState.Facts[0], run.context.AuthorityState.Facts[0]}
			case "duplicate-entity-id":
				state.Entities = append(state.Entities, state.Entities[0])
			}
			contextRaw := narrativeJSON(reviewHydrationWireContext(run.context, state))
			candidateRaw := narrativeJSON(candidate)
			raw := `{"context":` + string(contextRaw) + `,"candidate":` + string(candidateRaw) + `}`
			switch mutation {
			case "duplicate-context-key":
				raw = `{"context":` + string(contextRaw) + `,` + raw[1:]
			case "duplicate-candidate-key":
				raw = `{"candidate":` + string(candidateRaw) + `,` + raw[1:]
			case "duplicate-nested-key":
				raw = strings.Replace(raw, `"revision":2`, `"revision":1,"revision":2`, 1)
			}
			call.Messages[1].Content = raw
			if _, err := run.before(call); err == nil {
				t.Fatalf("%s accepted ambiguous evidence", mutation)
			}
		})
	}
}

func TestNarrativeReviewHydrationCurrentRecallAndHistoricalSnapshot(t *testing.T) {
	for _, historical := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "historical"}[historical], func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			fact := run.context.AuthorityState.Facts[0]
			asOf := run.context.Revision
			if historical {
				asOf--
				// The older snapshot legitimately lacks a later acquisition;
				// replacing current knowledge with it would silently erase it.
				later := Entity{ID: "later-knower", Kind: "person", Name: "后来的知情人", RelatedIDs: []string{}}
				run.context.AuthorityState.Entities = append(run.context.AuthorityState.Entities, later)
				run.context.AuthorityState.Facts[0].KnownBy = []string{"speaker", later.ID}
				run.context.StateCoverage.Total = counts(*run.context.AuthorityState)
				run.context.StateCoverage.Omitted = subtract(run.context.StateCoverage.Total, counts(run.context.State))
			}
			run.context.Recalls = []ReadReply{{SourceHandle: run.context.StateCoverage.SourceHandle,
				ExperienceID: run.context.ExperienceID, BranchID: run.context.BranchID, BaseRevision: run.context.Revision,
				Audience: "author", Objects: []ReadObject{{Type: "fact", AsOfRevision: asOf, Body: narrativeJSON(fact)}}}}
			current := run.context.State
			current.Entities = run.context.AuthorityState.Entities
			if !historical {
				current.Facts = []Fact{fact}
			}
			call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, current), "candidate": candidate}))
			before := call.Messages[1].Content
			if _, err := run.before(call); err != nil {
				t.Fatal(err)
			}
			var body map[string]json.RawMessage
			if err := StrictJSON([]byte(call.Messages[1].Content), &body); err != nil {
				t.Fatal(err)
			}
			if !historical {
				if call.Messages[1].Content != before {
					t.Fatal("already merged current recall was duplicated or rewritten")
				}
			} else {
				var evidence narrativeReviewEvidence
				if err := StrictJSON(body["review_evidence"], &evidence); err != nil || len(evidence.KnowledgeTargets) != 1 ||
					!bytes.Equal(narrativeJSON(evidence.KnowledgeTargets[0]), narrativeJSON(run.context.AuthorityState.Facts[0])) {
					t.Fatal("historical known_by replaced the current authority target")
				}
			}
		})
	}
}

func TestNarrativeReviewHydrationNewTargetAndSubjectBoundaries(t *testing.T) {
	for _, scenario := range []string{"new-fact-old-knower", "new-fact-new-knower", "new-target-change", "new-subject-old-target", "two-knowers-one-target"} {
		t.Run(scenario, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			newSubject := Entity{ID: "new-person", Kind: "person", Name: "丁", RelatedIDs: []string{}}
			newFact := Fact{ID: "new-report", Kind: "statement", Text: "甲说下午已约见。", SubjectID: "speaker", KnownBy: []string{}, SourceRevision: 3}
			wantTargets, wantSubjects := 0, 0
			switch scenario {
			case "new-fact-old-knower":
				candidate.KnowledgeChanges = []KnowledgeChange{}
				newFact.KnownBy = []string{"listener"}
				candidate.NewFacts = []Fact{newFact}
				wantSubjects = 1
			case "new-fact-new-knower":
				candidate.KnowledgeChanges = []KnowledgeChange{}
				newFact.KnownBy = []string{newSubject.ID}
				candidate.NewEntities, candidate.NewFacts = []Entity{newSubject}, []Fact{newFact}
			case "new-target-change":
				candidate.NewFacts = []Fact{newFact}
				candidate.KnowledgeChanges[0].FactID = newFact.ID
				wantSubjects = 1
			case "new-subject-old-target":
				candidate.NewEntities = []Entity{newSubject}
				candidate.KnowledgeChanges[0].SubjectID = newSubject.ID
				wantTargets = 1
			case "two-knowers-one-target":
				candidate.NewEntities = []Entity{newSubject}
				candidate.KnowledgeChanges = append(candidate.KnowledgeChanges, KnowledgeChange{SubjectID: newSubject.ID, FactID: "compound"})
				wantTargets, wantSubjects = 1, 1
			}
			run.extracted, _ = canonicalCandidate(candidate)
			call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
			candidateBefore := narrativeJSON(candidate)
			if _, err := run.before(call); err != nil {
				t.Fatal(err)
			}
			var body struct {
				Candidate Candidate               `json:"candidate"`
				Evidence  narrativeReviewEvidence `json:"review_evidence"`
			}
			if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
				t.Fatal(err)
			}
			if len(body.Evidence.KnowledgeTargets) != wantTargets || len(body.Evidence.Subjects) != wantSubjects ||
				!bytes.Equal(candidateBefore, narrativeJSON(body.Candidate)) {
				t.Fatalf("new records were hydrated from old authority or target duplicated: %+v", body.Evidence)
			}
		})
	}
}

func TestNarrativeReviewHydrationLeavesNoEdgeReaderProjectionUnchanged(t *testing.T) {
	for _, mode := range []string{"read", "ask"} {
		t.Run(mode, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			candidate.KnowledgeChanges = []KnowledgeChange{}
			run.context.Mode = mode
			if mode == "ask" {
				run.last = "answer"
				run.context.StateCoverage.Audience = "reader"
				run.context.State = ReaderState(*run.context.AuthorityState)
			}
			run.extracted, _ = canonicalCandidate(candidate)
			call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
			before := call.Messages[1].Content
			if _, err := run.before(call); err != nil {
				t.Fatal(err)
			}
			if call.Messages[1].Content != before || strings.Contains(call.Messages[1].Content, "无关的私密材料") {
				t.Fatal("a no-edge review imported private authority or rewrote the reader projection")
			}
		})
	}
}

func TestNarrativeReviewHydrationPreservesDecodedFrozenCandidateBytes(t *testing.T) {
	run, call, candidate := reviewContextFixture(t)
	candidate.Passage = "甲对乙说：“约好了。”\n真实换行；字面\\n；引号\"；<标签>与\u2028分隔。"
	run.extracted, _ = canonicalCandidate(candidate)
	extractedBefore := append([]byte{}, run.extracted...)
	call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
	if _, err := run.before(call); err != nil {
		t.Fatal(err)
	}
	var body struct {
		Candidate Candidate `json:"candidate"`
	}
	if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
		t.Fatal(err)
	}
	canonical, err := canonicalCandidate(body.Candidate)
	if err != nil || !bytes.Equal(canonical, extractedBefore) ||
		!bytes.Equal(run.extracted, extractedBefore) || !bytes.Equal([]byte(body.Candidate.Passage), []byte(candidate.Passage)) {
		t.Fatal("hydration altered the frozen candidate or normalized literal escapes")
	}
}

func TestNarrativeReviewHydrationAskCannotImportPrivateKnowledgeTargets(t *testing.T) {
	run, call, candidate := reviewContextFixture(t)
	run.context.Mode, run.last = "ask", "answer"
	run.context.StateCoverage.Audience = "reader"
	run.context.State = ReaderState(*run.context.AuthorityState)
	// The real answer path constructs a candidate with no changes. Deliberately
	// seed a malformed but matching candidate here to test this helper's reader
	// boundary independently of the earlier answer-to-candidate guard.
	run.extracted, _ = canonicalCandidate(candidate)
	call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
	before := call.Messages[1].Content
	if _, err := run.before(call); err == nil {
		t.Fatal("ask hydration imported private targets for an illegal knowledge change")
	}
	if call.Messages[1].Content != before {
		t.Fatal("failed ask guard still attached private authority")
	}
}

func TestNarrativeReviewHydrationIncludesOnlyDirectClaimAuthorIdentities(t *testing.T) {
	for _, scenario := range []string{"old-statement", "old-belief", "new-statement-known-by", "new-statement-change", "new-author-in-candidate"} {
		t.Run(scenario, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			run.context.State.Entities = []Entity{}
			claim := Fact{ID: "compound", Kind: "statement", SubjectID: "speaker",
				Text: "他说下午已经约好见面。", KnownBy: []string{"speaker"}, SourceRevision: 1}
			run.context.AuthorityState.Facts[0] = claim
			// An unrelated holder and an unrelated unshared new claim must not
			// cause recursive identity expansion through known_by/related IDs.
			other := Entity{ID: "other", Kind: "person", Name: "无关人物", RelatedIDs: []string{"unrelated-secret"}}
			run.context.AuthorityState.Entities = append(run.context.AuthorityState.Entities, other)
			run.context.AuthorityState.Facts[0].KnownBy = append(claim.KnownBy, other.ID)
			run.context.StateCoverage.Total = counts(*run.context.AuthorityState)
			run.context.StateCoverage.Omitted = subtract(run.context.StateCoverage.Total, counts(run.context.State))
			candidate.NewFacts = []Fact{{ID: "unshared", Kind: "statement", SubjectID: other.ID,
				Text: "另一个人说了无关的话。", KnownBy: []string{}, SourceRevision: 3}}
			wantTargets, wantSubjects := 1, 2
			switch scenario {
			case "old-belief":
				run.context.AuthorityState.Facts[0].Kind = "belief"
			case "new-statement-known-by", "new-statement-change", "new-author-in-candidate":
				claim.ID, claim.SourceRevision, claim.KnownBy = "new-claim", 3, []string{}
				wantTargets = 0
				if scenario == "new-statement-change" {
					candidate.KnowledgeChanges[0].FactID = claim.ID
				} else {
					candidate.KnowledgeChanges = []KnowledgeChange{}
					claim.KnownBy = []string{"listener"}
				}
				if scenario == "new-author-in-candidate" {
					author := Entity{ID: "new-speaker", Kind: "person", Name: "新作者", RelatedIDs: []string{}}
					candidate.NewEntities = []Entity{author}
					claim.SubjectID = author.ID
					wantSubjects = 1
				}
				candidate.NewFacts = append(candidate.NewFacts, claim)
			}
			run.extracted, _ = canonicalCandidate(candidate)
			call.Messages[1].Content = string(narrativeJSON(map[string]any{"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate}))
			if _, err := run.before(call); err != nil {
				t.Fatal(err)
			}
			var body struct {
				Evidence narrativeReviewEvidence `json:"review_evidence"`
			}
			if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
				t.Fatal(err)
			}
			if len(body.Evidence.KnowledgeTargets) != wantTargets || len(body.Evidence.Subjects) != wantSubjects {
				t.Fatalf("missing direct author identity or recursively copied unrelated identities: %+v", body.Evidence)
			}
			for _, entity := range body.Evidence.Subjects {
				if entity.ID != "listener" && entity.ID != "speaker" {
					t.Fatalf("hydrated unrelated or already-present candidate entity %q", entity.ID)
				}
			}
		})
	}
}
