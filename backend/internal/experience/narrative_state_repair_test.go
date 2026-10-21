package experience

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Synthetic state-machine tests. These prove feedback, authority and frozen
// bytes reach the right stage; they do not assess model semantic judgment.
func stateRepairFixture(t *testing.T, scope string) (*narrativeRun, Candidate, []NarrativeIssue) {
	return stateRepairFixtureWithContext(t, scope, nil)
}

func stateRepairFixtureWithContext(t *testing.T, scope string, configure func(*narrativeRun, *Candidate)) (*narrativeRun, Candidate, []NarrativeIssue) {
	t.Helper()
	p, call, c := reviewContextFixture(t)
	if configure != nil {
		configure(p, &c)
	}
	c.NarrativeUpdate = notebookFixture(3)
	p.draft = &narrativeDraft{Title: c.Title, Passage: c.Passage, StoryTime: c.StoryTime, Outcome: c.Outcome, Suggestions: c.Suggestions}
	p.extracted, _ = canonicalCandidate(c)
	call = reviewCall("review", c, p.context)
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	issues := []NarrativeIssue{{Code: "synthetic-state-scope", Detail: "Inspect the complete old record before granting knowledge."}}
	review := map[string]any{"approved": false, "issues": issues, "supports": []any{}, "knowledge_supports": []any{}, "reveal_supports": []any{}, "memory_supports": []any{}}
	if scope != "legacy" {
		review["repair_scope"] = scope
	}
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": review}))}); err != nil {
		t.Fatalf("valid %s rejection must remain repairable: %v", scope, err)
	}
	return p, c, issues
}

func stateRepairCall(p *narrativeRun, c Candidate, issues []NarrativeIssue) *pb.ModelCallRequest {
	return &pb.ModelCallRequest{NarrativeStage: "repair_state", SchemaJson: `{"type":"object"}`,
		Messages: []*pb.ModelMessage{{Role: "system", Content: "Synthetic state repair."}, {Role: "user", Content: string(narrativeMarshal(map[string]any{
			"context": reviewHydrationWireContext(p.context, p.context.State), "candidate": c, "issues": issues,
		}))}}}
}

func feedbackExtractCall(t *testing.T, p *narrativeRun, original Candidate, issues []NarrativeIssue) *pb.ModelCallRequest {
	t.Helper()
	return &pb.ModelCallRequest{NarrativeStage: "extract", SchemaJson: `{"type":"object"}`,
		Messages: []*pb.ModelMessage{{Role: "user", Content: string(narrativeMarshal(map[string]any{
			"context": reviewHydrationWireContext(p.context, p.context.State), "draft": p.draft,
			"repair_feedback": map[string]any{"candidate_state": json.RawMessage(compactExtractionState(t, original)), "issues": issues},
		}))}}}
}

func feedbackReviseCall(p *narrativeRun, issues []NarrativeIssue) *pb.ModelCallRequest {
	return &pb.ModelCallRequest{NarrativeStage: "revise", SchemaJson: `{"type":"object"}`,
		Messages: []*pb.ModelMessage{{Role: "user", Content: string(narrativeMarshal(map[string]any{
			"context": reviewHydrationWireContext(p.context, p.context.State), "draft": p.draft, "issues": issues,
		}))}}}
}

func TestNarrativeStateRepairFreezesDraftAndNeedsIndependentReview(t *testing.T) {
	p, c, issues := stateRepairFixture(t, "candidate_state")
	authority := narrativeMarshal(p.authority())
	p.materialBudget = defaultMaterialBudget
	call := stateRepairCall(p, c, issues)
	if _, err := p.before(call); err != nil {
		t.Fatalf("state-only rejection must enter bound state repair: %v", err)
	}
	if p.repairs != 1 || !strings.Contains(call.Messages[1].Content, "搬到门内") {
		t.Fatal("state repair lost its old authority target or shared repair budget")
	}
	// Synthetic correction leaves the prose untouched. Whether a real model
	// should remove/split an edge needs an independent semantic experiment.
	c.KnowledgeChanges = []KnowledgeChange{}
	if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, c))}); err != nil {
		t.Fatal(err)
	}
	var extracted Candidate
	if err := json.Unmarshal(p.extracted, &extracted); err != nil {
		t.Fatal(err)
	}
	if extracted.Passage != p.draft.Passage || extracted.Title != p.draft.Title || extracted.StoryTime != p.draft.StoryTime ||
		extracted.Outcome != p.draft.Outcome || !bytes.Equal(narrativeMarshal(extracted.Suggestions), narrativeMarshal(p.draft.Suggestions)) ||
		!bytes.Equal(authority, narrativeMarshal(p.authority())) {
		t.Fatal("state repair changed frozen prose or authority")
	}
	if _, err := p.finish(extracted); err == nil {
		t.Fatal("state repair bypassed review")
	}
	if _, err := p.before(reviewCall("review", extracted, p.context)); err != nil {
		t.Fatal(err)
	}
	r := map[string]any{"approved": true, "repair_scope": "none", "issues": []any{}, "supports": []any{}, "knowledge_supports": []any{}, "reveal_supports": []any{}, "memory_supports": []any{}}
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": r}))}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.finish(extracted); err != nil {
		t.Fatal(err)
	}
}

func TestNarrativeStateRepairRejectsUnboundRequest(t *testing.T) {
	for _, mutation := range []string{"candidate", "issues", "branch", "source", "draft", "extra-user", "extra-payload", "duplicate-issue-key", "wrong-route", "spent-budget"} {
		t.Run(mutation, func(t *testing.T) {
			p, c, issues := stateRepairFixture(t, "candidate_state")
			call := stateRepairCall(p, c, issues)
			var body map[string]json.RawMessage
			_ = json.Unmarshal([]byte(call.Messages[1].Content), &body)
			switch mutation {
			case "candidate":
				c.KnowledgeChanges = []KnowledgeChange{}
				body["candidate"] = narrativeMarshal(c)
			case "issues":
				body["issues"] = []byte(`[]`)
			case "branch", "source":
				ctx := p.context
				if mutation == "branch" {
					ctx.BranchID = "other"
				} else {
					ctx.StateCoverage.SourceHandle = "other"
				}
				body["context"] = narrativeMarshal(reviewHydrationWireContext(ctx, ctx.State))
			case "draft":
				c.Passage += " invented explanation"
				body["candidate"] = narrativeMarshal(c)
			case "extra-user":
				call.Messages = append(call.Messages, &pb.ModelMessage{Role: "user", Content: `{}`})
			case "extra-payload":
				body["alternate_candidate"] = []byte(`{"knowledge_changes":[]}`)
			case "duplicate-issue-key":
				body["issues"] = []byte(`[{"code":"a","code":"b","detail":"duplicate"}]`)
			case "wrong-route":
				call.NarrativeStage = "revise"
			case "spent-budget":
				p.repairs = 1
			}
			call.Messages[1].Content = string(narrativeMarshal(body))
			if _, err := p.before(call); err == nil {
				t.Fatalf("unbound state repair accepted: %s", mutation)
			}
		})
	}
}

func TestNarrativeMixedRepairPreservesFeedbackAcrossChangedDraft(t *testing.T) {
	for _, scope := range []string{"draft", "mixed", "undetermined", "legacy"} {
		t.Run(scope, func(t *testing.T) {
			p, original, issues := stateRepairFixture(t, scope)
			if _, err := p.before(feedbackReviseCall(p, issues)); err != nil {
				t.Fatal(err)
			}
			revised := *p.draft
			revised.Passage += "\n新的正文，仍不是原状态意见。"
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": revised}))}); err != nil {
				t.Fatal(err)
			}
			p.materialBudget = defaultMaterialBudget
			call := feedbackExtractCall(t, p, original, issues)
			if _, err := p.before(call); err != nil {
				t.Fatalf("valid feedback must survive revise clearing extracted state: %v", err)
			}
			var got struct {
				Draft    narrativeDraft `json:"draft"`
				Feedback struct {
					State  json.RawMessage  `json:"candidate_state"`
					Issues []NarrativeIssue `json:"issues"`
				} `json:"repair_feedback"`
			}
			_ = json.Unmarshal([]byte(call.Messages[0].Content), &got)
			if got.Draft.Passage != revised.Passage || !bytes.Equal(got.Feedback.State, compactExtractionState(t, original)) ||
				!bytes.Equal(narrativeMarshal(got.Feedback.Issues), narrativeMarshal(issues)) || !strings.Contains(call.Messages[0].Content, "搬到门内") || p.repairs != 1 {
				t.Fatal("new draft, old state, feedback, authority target or shared budget lost")
			}
		})
	}
}

// Unlike the original omitted-target fixture, the real Rust carrier can already
// contain a target that the ordinary revise working set would then discard.
func TestNarrativeReviseRetainsPreviouslyVisibleRejectedTarget(t *testing.T) {
	for _, scope := range []string{"mixed", "legacy"} {
		t.Run(scope, func(t *testing.T) {
			p, _, issues := stateRepairFixtureWithContext(t, scope, func(p *narrativeRun, _ *Candidate) {
				p.context.AuthorityState.Facts[0].SubjectID = ""
				p.context.State.Facts = []Fact{p.context.AuthorityState.Facts[0]}
			})
			p.materialBudget = defaultMaterialBudget
			before := narrativeMarshal(p.authority())
			call := feedbackReviseCall(p, issues)
			if _, err := p.before(call); err != nil {
				t.Fatalf("revise discarded its previously visible rejected target: %v", err)
			}
			var body struct {
				Context struct {
					State State `json:"state"`
				} `json:"context"`
			}
			if err := json.Unmarshal([]byte(call.Messages[0].Content), &body); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, fact := range body.Context.State.Facts {
				if fact.ID == "compound" {
					found = bytes.Equal(narrativeMarshal(fact), narrativeMarshal(p.authority().Facts[0]))
				}
				if fact.ID == "unrelated-secret" {
					t.Fatal("repair included an unrelated private record")
				}
			}
			if !found || !bytes.Equal(before, narrativeMarshal(p.authority())) || p.repairs != 1 {
				t.Fatal("revise lost original target, changed authority, or changed shared budget")
			}
		})
	}
}

// A revised page can concern a different existing person. Its words are only
// retrieval cues; they must not become facts or grant that person knowledge.
func TestNarrativeFeedbackExtractSelectsCurrentDraftAuthority(t *testing.T) {
	for _, scope := range []string{"draft", "mixed", "undetermined", "legacy"} {
		t.Run(scope, func(t *testing.T) {
			p, original, issues := stateRepairFixtureWithContext(t, scope, func(p *narrativeRun, _ *Candidate) {
				p.context.AuthorityState.Entities = append(p.context.AuthorityState.Entities,
					Entity{ID: "ding", Kind: "person", Name: "丁岚", RelatedIDs: []string{}})
				p.context.AuthorityState.Facts = append(p.context.AuthorityState.Facts,
					Fact{ID: "ding-existing", Kind: "fact", Text: "丁岚已经把旧账册交还店主。", SubjectID: "ding", KnownBy: []string{"ding"}, SourceRevision: 1},
					Fact{ID: "ding-future", Kind: "fact", Text: "未来版本的记录。", SubjectID: "ding", KnownBy: []string{"ding"}, SourceRevision: 3})
			})
			p.materialBudget = defaultMaterialBudget
			authority := narrativeMarshal(p.authority())
			if _, err := p.before(feedbackReviseCall(p, issues)); err != nil {
				t.Fatal(err)
			}
			revised := *p.draft
			revised.Passage = "丁岚说，她今晚打算烧掉旧账册。"
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": revised}))}); err != nil {
				t.Fatal(err)
			}
			call := feedbackExtractCall(t, p, original, issues)
			if _, err := p.before(call); err != nil {
				t.Fatal(err)
			}
			var body struct {
				Draft   narrativeDraft `json:"draft"`
				Context struct {
					State State `json:"state"`
				} `json:"context"`
				Feedback struct {
					State  json.RawMessage  `json:"candidate_state"`
					Issues []NarrativeIssue `json:"issues"`
				} `json:"repair_feedback"`
			}
			if err := json.Unmarshal([]byte(call.Messages[0].Content), &body); err != nil {
				t.Fatal(err)
			}
			selected := map[string]Fact{}
			for _, fact := range body.Context.State.Facts {
				selected[fact.ID] = fact
				if fact.Text == revised.Passage || fact.ID == "ding-future" || fact.ID == "unrelated-secret" {
					t.Fatal("draft text, future or unrelated record entered authority materials")
				}
			}
			want := p.authority().Facts[2]
			if got, ok := selected[want.ID]; !ok || !bytes.Equal(narrativeMarshal(got), narrativeMarshal(want)) {
				t.Fatalf("current adopted draft's existing authority omitted: selected=%v", selected)
			}
			if _, ok := selected["compound"]; !ok {
				t.Fatal("current draft selection displaced original feedback target")
			}
			if !bytes.Equal(authority, narrativeMarshal(p.authority())) ||
				!bytes.Equal(narrativeMarshal(body.Draft), narrativeMarshal(revised)) ||
				!bytes.Equal(body.Feedback.State, compactExtractionState(t, original)) ||
				!bytes.Equal(narrativeMarshal(body.Feedback.Issues), narrativeMarshal(issues)) || p.repairs != 1 {
				t.Fatal("retrieval changed authority, adopted draft, old feedback, or repair budget")
			}
		})
	}
}

func TestNarrativeRepairFeedbackCannotBeRemovedOrSubstituted(t *testing.T) {
	for _, mutation := range []string{"missing", "issues", "candidate-state", "frozen-field", "current-draft", "extra-payload", "first-extract"} {
		t.Run(mutation, func(t *testing.T) {
			p, original, issues := stateRepairFixture(t, "legacy")
			if _, err := p.before(feedbackReviseCall(p, issues)); err != nil {
				t.Fatal(err)
			}
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": p.draft}))}); err != nil {
				t.Fatal(err)
			}
			call := feedbackExtractCall(t, p, original, issues)
			var body map[string]json.RawMessage
			_ = json.Unmarshal([]byte(call.Messages[0].Content), &body)
			var feedback map[string]json.RawMessage
			_ = json.Unmarshal(body["repair_feedback"], &feedback)
			switch mutation {
			case "missing":
				delete(body, "repair_feedback")
			case "issues":
				feedback["issues"] = []byte(`[]`)
			case "candidate-state":
				original.KnowledgeChanges = []KnowledgeChange{}
				feedback["candidate_state"] = compactExtractionState(t, original)
			case "frozen-field":
				feedback["candidate_state"] = narrativeMarshal(original)
			case "current-draft":
				changed := *p.draft
				changed.Passage += " not adopted"
				body["draft"] = narrativeMarshal(changed)
			case "extra-payload":
				body["candidate"] = narrativeMarshal(original)
			case "first-extract":
				p, _ = extractionObjectRun("first")
				p.context.Pipeline.MaxRepairs = 1
				p.last = "write"
			}
			if mutation != "missing" {
				body["repair_feedback"] = narrativeMarshal(feedback)
			}
			call.Messages[0].Content = string(narrativeMarshal(body))
			if _, err := p.before(call); err == nil {
				t.Fatal("missing/substituted or unsolicited feedback accepted")
			}
		})
	}
}

func TestNarrativeReviewRepairScopeClosedAndConsistent(t *testing.T) {
	for _, scope := range []string{`null`, `""`, `"unknown"`, `"none"`} {
		t.Run(scope, func(t *testing.T) {
			p, _, _ := reviewContextFixture(t)
			p.last = "review"
			err := p.after(&pb.ModelCallResult{Text: `{"result":{"approved":false,"repair_scope":` + scope + `,"issues":[{"code":"x","detail":"x"}],"supports":[],"knowledge_supports":[]}}`})
			if err == nil {
				t.Fatal("explicit invalid scope accepted")
			}
		})
	}
	for _, scope := range []string{"candidate_state", "draft", "mixed", "undetermined"} {
		t.Run("approved_"+scope, func(t *testing.T) {
			p, _, c := reviewContextFixture(t)
			c.KnowledgeChanges = []KnowledgeChange{}
			p.last = "review"
			p.reviewed, _ = canonicalCandidate(c)
			err := p.after(&pb.ModelCallResult{Text: `{"result":{"approved":true,"repair_scope":"` + scope + `","issues":[],"supports":[],"knowledge_supports":[]}}`})
			if err == nil {
				t.Fatal("approved non-none scope accepted")
			}
		})
	}
}

func TestNarrativeStateRepairKeepsSharedBudgetAndFrozenOutput(t *testing.T) {
	for _, variant := range []string{"changed-passage", "partial-draft", "bad-state", "second-rejection", "read-continuation"} {
		t.Run(variant, func(t *testing.T) {
			p, c, issues := stateRepairFixture(t, "candidate_state")
			if _, err := p.before(stateRepairCall(p, c, issues)); err != nil {
				t.Fatal(err)
			}
			switch variant {
			case "changed-passage":
				c.Passage += " invented knowledge source"
				if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(narrativeMarshal(c))}); err == nil || err.Error() != "narrative_extraction_mismatch" {
					t.Fatalf("state repair rewrote frozen passage: %v", err)
				}
			case "partial-draft":
				raw := compactExtractionState(t, c)
				raw = append(raw[:len(raw)-1], []byte(`,"title":"changed"}`)...)
				if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(raw)}); err == nil || err.Error() != "narrative_extraction_mismatch" {
					t.Fatalf("partial frozen fields were accepted: %v", err)
				}
			case "bad-state":
				if err := p.after(&pb.ModelCallResult{Text: `{"result":{"candidate":null}}`}); err == nil || err.Error() != "invalid_candidate" {
					t.Fatalf("state repair acquired another structural repair: %v", err)
				}
			case "second-rejection":
				if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, c))}); err != nil {
					t.Fatal(err)
				}
				if _, err := p.before(reviewCall("review", c, p.context)); err != nil {
					t.Fatal(err)
				}
				r := map[string]any{"approved": false, "repair_scope": "candidate_state", "issues": issues, "supports": []any{}, "knowledge_supports": []any{}}
				if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": r}))}); err != nil {
					t.Fatal(err)
				}
				if _, err := p.finish(c); err == nil {
					t.Fatal("rejected state repair authorized commit")
				}
			case "read-continuation":
				// The adapter marks a successful bounded read this way; the
				// actual transport suite separately exercises its DB reader.
				p.readCompleted = true
				p.remainingModelCalls = 2
				if _, err := p.before(stateRepairCall(p, c, issues)); err != nil {
					t.Fatal(err)
				}
				if p.repairs != 1 {
					t.Fatal("read continuation spent another repair")
				}
				p.readCompleted = true
				p.remainingModelCalls = 1
				if _, err := p.before(stateRepairCall(p, c, issues)); err == nil || err.Error() != "model_budget_exhausted" {
					t.Fatalf("read continuation consumed last review slot: %v", err)
				}
				return
			}
			for _, stage := range []string{"repair_state", "repair_extract", "repair_review", "revise"} {
				call := stateRepairCall(p, c, issues)
				call.NarrativeStage = stage
				if _, err := p.before(call); err == nil {
					t.Fatalf("spent repair admitted %s", stage)
				}
			}
		})
	}
}

func TestNarrativeRepairReservesRemainingModelCalls(t *testing.T) {
	for _, tc := range []struct {
		scope, stage string
		slots        int
	}{{"candidate_state", "repair_state", 2}, {"mixed", "revise", 3}} {
		for _, adjustment := range []int{0, -1} {
			t.Run(tc.stage+"/"+jsonNumber(int64(adjustment)), func(t *testing.T) {
				p, c, issues := stateRepairFixture(t, tc.scope)
				p.remainingModelCalls = tc.slots + adjustment
				call := stateRepairCall(p, c, issues)
				if tc.stage == "revise" {
					call = feedbackReviseCall(p, issues)
				}
				_, err := p.before(call)
				if adjustment == 0 && err != nil {
					t.Fatal(err)
				}
				if adjustment < 0 && (err == nil || err.Error() != "model_budget_exhausted" || p.repairs != 0 || p.last != "review") {
					t.Fatalf("repair started without room for independent review: %v", err)
				}
			})
		}
	}
}

func TestNarrativeStateRepairFinalInputCapacityBoundary(t *testing.T) {
	setup := func() (*narrativeRun, *pb.ModelCallRequest) {
		p, c, issues := stateRepairFixture(t, "candidate_state")
		// All remaining material is required by the candidate, so a smaller
		// ceiling cannot pass merely by omitting unrelated background facts.
		p.context.AuthorityState.Facts = p.context.AuthorityState.Facts[:1]
		p.materialBudget = defaultMaterialBudget
		return p, stateRepairCall(p, c, issues)
	}
	p, call := setup()
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	size := narrativeCallBytes(call)
	for _, delta := range []int{0, -1} {
		p, call := setup()
		p.stageInputBudget = size + delta
		authority := narrativeMarshal(p.authority())
		_, err := p.before(call)
		if delta == 0 && err != nil {
			t.Fatalf("exact final input budget rejected: %v", err)
		}
		if delta < 0 && (err == nil || err.Error() != "context_budget_exceeded" || p.repairs != 0) {
			t.Fatalf("undersized repair silently omitted required evidence: %v", err)
		}
		if !bytes.Equal(authority, narrativeMarshal(p.authority())) {
			t.Fatal("capacity compilation mutated authority")
		}
	}
	t.Logf("actual repair_state input exact=%d, one-byte-less rejected", size)
}

func TestNarrativeRepairIssuesHaveSharedBoundedShape(t *testing.T) {
	for _, tc := range []struct {
		name         string
		count        int
		code, detail string
		valid        bool
	}{
		{"exact-limit", 12, "state_scope", "Review this candidate field.", true},
		{"over-limit", 13, "state_scope", "Review this candidate field.", false},
		{"empty-code", 1, "", "Review this candidate field.", false},
		{"blank-code", 1, " \n\t", "Review this candidate field.", false},
		{"empty-detail", 1, "state_scope", "", false},
		{"blank-detail", 1, "state_scope", " \n\t", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, _, c := reviewContextFixture(t)
			p.last = "review"
			p.reviewed, _ = canonicalCandidate(c)
			issues := make([]NarrativeIssue, tc.count)
			for i := range issues {
				issues[i] = NarrativeIssue{Code: tc.code, Detail: tc.detail}
			}
			body := map[string]any{"approved": false, "repair_scope": "candidate_state", "issues": issues,
				"supports": []any{}, "knowledge_supports": []any{}}
			err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": body}))})
			if (err == nil) != tc.valid {
				t.Fatalf("bounded nonblank issues valid=%v, error=%v", tc.valid, err)
			}
			if !tc.valid && (p.approval != nil || p.repairSource != nil) {
				t.Fatal("invalid issues retained repair authority")
			}
		})
	}
}

func TestNarrativeReviseBindsRejectedFeedbackBeforeWriter(t *testing.T) {
	for _, mutation := range []string{"issues", "draft", "branch", "source", "extra-user", "extra-payload"} {
		t.Run(mutation, func(t *testing.T) {
			p, _, issues := stateRepairFixture(t, "mixed")
			call := feedbackReviseCall(p, issues)
			var body map[string]json.RawMessage
			_ = json.Unmarshal([]byte(call.Messages[0].Content), &body)
			switch mutation {
			case "issues":
				body["issues"] = []byte(`[]`)
			case "draft":
				draft := *p.draft
				draft.Passage += " not adopted"
				body["draft"] = narrativeMarshal(draft)
			case "branch", "source":
				ctx := p.context
				if mutation == "branch" {
					ctx.BranchID = "other"
				} else {
					ctx.StateCoverage.SourceHandle = "other"
				}
				body["context"] = narrativeMarshal(reviewHydrationWireContext(ctx, ctx.State))
			case "extra-user":
				call.Messages = append(call.Messages, &pb.ModelMessage{Role: "user", Content: `{}`})
			case "extra-payload":
				body["alternate_draft"] = narrativeMarshal(p.draft)
			}
			call.Messages[0].Content = string(narrativeMarshal(body))
			if _, err := p.before(call); err == nil || p.repairs != 0 {
				t.Fatalf("writer received unbound repair instructions: %v", err)
			}
		})
	}
}
