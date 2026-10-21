package experience

import (
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"encoding/json"
	"strings"
	"testing"
)

func TestNarrativePipelineRejectsSkippedReviewAndAlteredCandidate(t *testing.T) {
	c := Context{Mode: "read", Revision: 0, State: EmptyState(), Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}
	p := newNarrativeRun(c)
	call := &pb.ModelCallRequest{NarrativeStage: "write"}
	if _, err := p.before(call); err == nil {
		t.Fatal("skipped planning accepted")
	}
	candidate := Candidate{Title: "t", Passage: "雨停了。", StoryTime: "", Outcome: "continues", Suggestions: []string{}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{}, ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{}, NarrativeUpdate: notebookFixture(1)}
	approval := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(candidate), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
	if err := verifyNarrativeApproval(candidate, approval); err != nil {
		t.Fatal(err)
	}
	candidate.Passage = "我把雨停了。"
	if verifyNarrativeApproval(candidate, approval) == nil {
		t.Fatal("changed reviewed prose accepted")
	}
}

func TestNarrativeExtractionRepairIsBoundedAndDoesNotAuthorizeStoryRewrite(t *testing.T) {
	context := Context{Mode: "read", State: EmptyState(), Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}
	p := newNarrativeRun(context)
	p.last = "write"
	p.draft = &narrativeDraft{Title: "t", Passage: "雨停了。", Outcome: "continues", Suggestions: []string{}}
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "extract"}); err != nil {
		t.Fatal(err)
	}
	if err := p.after(&pb.ModelCallResult{Text: `{"result":{"candidate_json":"{"}}`}); err != nil {
		t.Fatalf("structural fault should reach Rust repair budget: %v", err)
	}
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "review"}); err == nil {
		t.Fatal("invalid extraction reached review")
	}
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "repair_extract"}); err != nil {
		t.Fatal(err)
	}
	candidate := Candidate{Title: "t", Passage: "changed story", Outcome: "continues", Suggestions: []string{}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{}, ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{}, NarrativeUpdate: notebookFixture(1)}
	result := &pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": map[string]any{"candidate": candidate}}))}
	if err := p.after(result); err == nil || err.Error() != "narrative_extraction_mismatch" {
		t.Fatalf("rewritten story accepted: %v", err)
	}
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "repair_extract"}); err == nil {
		t.Fatal("repeated repair accepted")
	}
	if p.repairs != 1 {
		t.Fatalf("repair not charged: %d", p.repairs)
	}
}

func TestNarrativeExtractionRepairCannotBeRequestedForAValidCandidate(t *testing.T) {
	p := newNarrativeRun(Context{Mode: "read", Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}})
	p.last = "extract"
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "repair_extract"}); err == nil {
		t.Fatal("unjustified repair granted")
	}
}
func TestNarrativeActorProjectionExcludesPrivateWorldAndOtherKnowledge(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "n", Kind: "character", Name: "守卫", RelatedIDs: []string{}}}
	s.Facts = []Fact{{ID: "known", Text: "城门关闭", KnownBy: []string{"n"}}, {ID: "secret", Text: "秘密账册在仓库", KnownBy: []string{}}}
	c := Context{Mode: "act", Input: "秘密交接", Seed: "幕后秘密", State: s, Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}
	p := newNarrativeRun(c)
	p.last = "memory"
	p.actors = map[string]narrativeTrigger{"n": {ActorID: "n", Trigger: "秘密账册在仓库", FactIDs: []string{"known"}}}
	call := &pb.ModelCallRequest{NarrativeStage: "actor", NarrativeActorId: "n", Messages: []*pb.ModelMessage{{Role: "system", Content: "actor"}, {Role: "user", Content: `{"context":"all secrets"}`}}}
	author, err := p.before(call)
	if err != nil {
		t.Fatal(err)
	}
	if author {
		t.Fatal("actor authorized private author attachment")
	}
	raw := string(narrativeJSON(call.Messages))
	if strings.Contains(raw, "secret") || strings.Contains(raw, "秘密") || strings.Contains(raw, "all secrets") {
		t.Fatalf("actor leak %s", raw)
	}
	if !strings.Contains(raw, "城门关闭") {
		t.Fatal("known evidence missing")
	}
}
func TestNarrativeApprovalRequiresEveryFactAndKnowledgeQuote(t *testing.T) {
	c := Candidate{Passage: "他交出了戒指。", NewFacts: []Fact{{ID: "f"}}, KnowledgeChanges: []KnowledgeChange{{SubjectID: "n", FactID: "f"}}}
	a := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(c), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{{FactID: "f", Quote: "交出了戒指"}}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
	if verifyNarrativeApproval(c, a) == nil {
		t.Fatal("missing knowledge evidence accepted")
	}
	a.Result.KnowledgeSupports = []NarrativeKnowledgeSupport{{SubjectID: "n", FactID: "f", Quote: "交出了戒指"}}
	if err := verifyNarrativeApproval(c, a); err != nil {
		t.Fatal(err)
	}
	a.Result.Supports[0].Quote = "从未出现"
	if verifyNarrativeApproval(c, a) == nil {
		t.Fatal("invented evidence accepted")
	}
}

func TestNarrativeApprovalCoversNewFactKnowers(t *testing.T) {
	c := Candidate{Passage: "守卫看见交接。", NewFacts: []Fact{{ID: "f", KnownBy: []string{"n"}}}}
	a := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(c), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{{FactID: "f", Quote: "看见交接"}}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
	if verifyNarrativeApproval(c, a) == nil {
		t.Fatal("new fact smuggled unreviewed knowledge edge")
	}
	a.Result.KnowledgeSupports = []NarrativeKnowledgeSupport{{SubjectID: "n", FactID: "f", Quote: "守卫看见交接"}}
	if err := verifyNarrativeApproval(c, a); err != nil {
		t.Fatal(err)
	}
}

func TestNarrativePipelineCannotSkipSelectedActors(t *testing.T) {
	p := newNarrativeRun(Context{Mode: "act", Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}})
	p.last = "memory"
	p.actors["n"] = narrativeTrigger{ActorID: "n", FactIDs: []string{}}
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "plan"}); err == nil {
		t.Fatal("selected actor silently skipped")
	}
}
func TestNarrativeActorDoesNotHearConcealedAction(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "guard", Kind: "character", Name: "周岚", RelatedIDs: []string{}}}
	p := newNarrativeRun(Context{Input: "我背着周岚把账册藏起来，不让周岚知道。", State: s})
	raw, err := p.actorProjection(narrativeTrigger{ActorID: "guard", Trigger: p.context.Input, FactIDs: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "账册") {
		t.Fatal("concealed action leaked")
	}
	p.context.Input = "我对周岚说：“城门什么时候开放？”"
	raw, err = p.actorProjection(narrativeTrigger{ActorID: "guard", Trigger: "城门什么时候开放？", FactIDs: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "conditional_attempt") {
		t.Fatal("direct attempted utterance omitted")
	}
}

func TestNarrativeActorDoesNotPromoteHistoricalRecallToCurrentEvidence(t *testing.T) {
	state := EmptyState()
	state.Entities = []Entity{{ID: "guard", Kind: "character", Name: "守卫", RelatedIDs: []string{}}}
	fact := Fact{ID: "recalled", Text: "旧门曾经打开", KnownBy: []string{"guard"}}
	authority := state
	current := fact
	current.Text = "门已经重新关闭"
	current.KnownBy = []string{}
	authority.Facts = []Fact{current}
	p := newNarrativeRun(Context{Revision: 3, State: state, AuthorityState: &authority, Recalls: []ReadReply{{Objects: []ReadObject{{Type: "fact", AsOfRevision: 2, Body: narrativeJSON(fact)}}}}})
	trigger := narrativeTrigger{ActorID: "guard", FactIDs: []string{}}
	raw, err := p.actorProjection(trigger)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), fact.ID) {
		t.Fatal("historical recall silently became current actor evidence")
	}
	p.context.Recalls[0].Objects[0].AsOfRevision = 3
	raw, err = p.actorProjection(trigger)
	if err != nil || strings.Contains(string(raw), fact.ID) {
		t.Fatal("an untrusted recall granted current knowledge", err)
	}
	authority.Facts[0].KnownBy = []string{"guard"}
	raw, err = p.actorProjection(trigger)
	if err != nil || !strings.Contains(string(raw), current.Text) || strings.Contains(string(raw), fact.Text) {
		t.Fatal("pinned current authority was not independently retrieved", err)
	}
}

func TestNarrativeApprovalRequiresRevealEvidence(t *testing.T) {
	for _, kind := range []string{"fact", "entity", "thread"} {
		t.Run(kind, func(t *testing.T) {
			c := Candidate{Passage: "他关上门。"}
			switch kind {
			case "fact":
				c.RevealFactIDs = []string{"hidden"}
			case "entity":
				c.RevealEntityIDs = []string{"hidden"}
			case "thread":
				c.RevealThreadIDs = []string{"hidden"}
			}
			a := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(c), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
			if verifyNarrativeApproval(c, a) == nil {
				t.Fatal("hidden object revealed without review evidence")
			}
		})
	}
}
func TestNarrativeApprovalCanonicalRawMessages(t *testing.T) {
	c := Candidate{Passage: "same", GameplayUpdate: &GameplayUpdate{Game: json.RawMessage(`{"z":9007199254740993,"a":1}`)}}
	a := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(c), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
	c.GameplayUpdate.Game = json.RawMessage(`{"a":1,"z":9007199254740993}`)
	if err := verifyNarrativeApproval(c, a); err != nil {
		t.Fatalf("equivalent object key order rejected: %v", err)
	}
	c.GameplayUpdate.Game = json.RawMessage(`{"a":1,"z":9007199254740992}`)
	if verifyNarrativeApproval(c, a) == nil {
		t.Fatal("changed >2^53 integer accepted")
	}
}
func narrativeJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
