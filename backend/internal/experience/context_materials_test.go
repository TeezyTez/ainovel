package experience

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// These are retrieval/permission regressions, not an evaluation of generated prose.
func TestActorMaterialsRecoverOldIdentityFromAuthority(t *testing.T) {
	full := EmptyState()
	full.Entities = []Entity{{ID: "tc", Kind: "character", Name: "唐澈", RelatedIDs: []string{}}}
	full.Facts = []Fact{
		{ID: "tc-voice", Kind: "fact", Text: "唐澈习惯用一个不太贴切的比喻缓和熟人的难堪。", SubjectID: "tc", KnownBy: []string{"tc"}, SourceRevision: 1},
		{ID: "tc-goal", Kind: "belief", Text: "他想有一天能把自己的小店交给妹妹。", SubjectID: "tc", KnownBy: []string{"tc"}, SourceRevision: 1},
		{ID: "order", Kind: "fact", Text: "这批点心需要装盒。", KnownBy: []string{"tc"}, SourceRevision: 9},
	}
	view := full
	view.Facts = full.Facts[2:]
	p := newNarrativeRun(Context{Revision: 9, State: view, AuthorityState: &full})
	raw, err := p.actorProjection(narrativeTrigger{ActorID: "tc", FactIDs: []string{"order"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"tc-voice", "tc-goal", "order"} {
		if !strings.Contains(string(raw), id) {
			t.Fatalf("old authorized personality/goal was lost after initial projection: missing %s in %s", id, raw)
		}
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
}

func materialFixture() *narrativeRun {
	s := EmptyState()
	s.Entities = []Entity{
		{ID: "a", Kind: "person", Name: "陈禾", RelatedIDs: []string{"promise"}},
		{ID: "b", Kind: "person", Name: "林舟", RelatedIDs: []string{}},
	}
	s.Facts = []Fact{
		{ID: "self", Kind: "belief", Text: "陈禾不喜欢把关心解释得太郑重。", SubjectID: "a", KnownBy: []string{"a"}, SourceRevision: 1},
		{ID: "promise", Kind: "statement", Text: "林舟答应陈禾，晚归时发一个字就好。", SubjectID: "b", KnownBy: []string{"a", "b"}, SourceRevision: 1},
		{ID: "change", Kind: "fact", Text: "陈禾昨天第一次直接向林舟道谢。", SubjectID: "a", KnownBy: []string{"a", "b"}, SourceRevision: 9},
		{ID: "unrelated", Kind: "secret", Text: "柜子后藏着信。", SubjectID: "b", KnownBy: []string{"b"}, SourceRevision: 1},
	}
	m := MemoryEntry{MemoryChange: MemoryChange{ID: "promise-note", Kind: "commitment", SubjectIDs: []string{"b"}, TargetIDs: []string{"a"}, Cue: "告知晚归", Summary: "林舟答应晚归时告知陈禾，约定仍待后续履行。", Status: "active", RetrievalKeys: []string{"等候", "告知"}, FactIDs: []string{"promise"}, Quote: "晚了发一个字就行。"}, SourceRevision: 1, UpdatedRevision: 1}
	s.LiteraryMemory = &LiteraryMemory{Version: 1, IndexedThroughRevision: 9, Entries: []MemoryEntry{m}}
	return newNarrativeRun(Context{Version: 2, Mode: "read", Revision: 9, State: s, AuthorityState: &s, StateCoverage: StateCoverage{SourceHandle: "source", Audience: "author"}, Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}})
}

func TestMaterialSelectionPermissionPrecedesCountsAndRanking(t *testing.T) {
	p := materialFixture()
	needs := ContextNeeds{ParticipantIDs: []string{"a"}}
	before, err := p.prepareMaterials("actor", "a", needs, 4096)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		p.context.AuthorityState.Facts = append(p.context.AuthorityState.Facts, Fact{ID: fmt.Sprintf("hidden-%d", i), Kind: "rule", Text: strings.Repeat("private ", 100), SubjectID: "a", KnownBy: []string{"b"}, SourceRevision: 1})
	}
	p.context.AuthorityState.LiteraryMemory.Entries[0].Summary = "PRIVATE INTERPRETATION"
	after, err := p.prepareMaterials("actor", "a", needs, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(narrativeMarshal(before), narrativeMarshal(after)) {
		t.Fatal("hidden records changed actor output or metadata")
	}
	if len(after.Memories) != 0 || strings.Contains(string(narrativeMarshal(after)), "known_by") {
		t.Fatal("actor received author material or other knowers")
	}
}

func TestMaterialSelectionUsesRelationshipWithoutKeywordOverlap(t *testing.T) {
	p := materialFixture()
	bundle, err := p.prepareMaterials("write", "", ContextNeeds{ParticipantIDs: []string{"a", "b"}, Topics: []string{"搬花盆"}}, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Memories) != 1 || bundle.Memories[0].ID != "promise-note" {
		t.Fatal("relationship/unfinished commitment depended on keyword overlap", bundle)
	}
	actor, err := p.prepareMaterials("actor", "a", ContextNeeds{ParticipantIDs: []string{"a"}}, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(narrativeMarshal(actor)), "promise") {
		t.Fatal("authorized entity relation was omitted")
	}
}

func TestMaterialSelectionPreservesOldAndChangedSelfUnderRoutineLoad(t *testing.T) {
	p := materialFixture()
	for i := 0; i < 50; i++ {
		p.context.AuthorityState.Facts = append(p.context.AuthorityState.Facts, Fact{ID: fmt.Sprintf("routine-%02d", i), Kind: "fact", Text: strings.Repeat("按流程装盒。", 30), SubjectID: "a", KnownBy: []string{"a"}, SourceRevision: 2 + int64(i%7)})
	}
	bundle, err := p.prepareMaterials("actor", "a", ContextNeeds{ParticipantIDs: []string{"a"}}, 1800)
	if err != nil {
		t.Fatal(err)
	}
	raw := string(narrativeMarshal(bundle))
	if !strings.Contains(raw, `"self"`) || !strings.Contains(raw, `"change"`) {
		t.Fatal("routine work crowded out foundation or contrary newer evidence", raw)
	}
	if bundle.Coverage.BudgetOmitted == 0 || bundle.Coverage.HistoryComplete {
		t.Fatal("selection pretended complete history", bundle.Coverage)
	}
}

func TestMaterialBudgetNeverCutsEvidenceAndFailsForRequiredOversize(t *testing.T) {
	p := materialFixture()
	original := strings.Repeat("只有她到场才答应，缺席则不承诺。", 200)
	p.context.AuthorityState.Facts[0].Text = original
	bundle, err := p.prepareMaterials("actor", "a", ContextNeeds{ParticipantIDs: []string{"a"}}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range bundle.ActorFacts {
		if f.ID == "self" && f.Text != original {
			t.Fatal("truncated condition or negation")
		}
	}
	if _, err := p.prepareMaterials("actor", "a", ContextNeeds{FactIDs: []string{"self"}}, 1000); err == nil || err.Error() != "context_budget_exceeded" {
		t.Fatal("critical oversized evidence silently dropped", err)
	}
}

func TestMaterialSourceMismatchFailsClosed(t *testing.T) {
	p := materialFixture()
	p.materialSource = func(actorID string, factIDs, memoryIDs []string) (State, error) {
		source := p.authority()
		source.Facts = append([]Fact{}, source.Facts...)
		source.Facts[0].Text = "changed after pin"
		return source, nil
	}
	if _, err := p.prepareMaterials("actor", "a", ContextNeeds{}, 4096); err == nil || err.Error() != "recall_scope_mismatch" {
		t.Fatal("changed pinned source was accepted", err)
	}
}

func TestStageReviewCompilesFromActualCandidateAndPreservesPinChecks(t *testing.T) {
	run, call, candidate := reviewContextFixture(t)
	run.materialBudget = 4096
	run.stageInputBudget = 16 << 10
	run.needs = ContextNeeds{ParticipantIDs: []string{"unrelated"}}
	if _, err := run.before(call); err != nil {
		t.Fatal(err)
	}
	var body struct {
		Context struct {
			State State `json:"state"`
		} `json:"context"`
		Materials ContextBundle `json:"context_materials"`
	}
	if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(narrativeMarshal(body.Context.State.Facts)), "compound") || strings.Contains(string(narrativeMarshal(body.Context.State.Facts)), "unrelated-secret") {
		t.Fatal("review inherited wrong writer selection", call.Messages[1].Content)
	}
	if body.Materials.Stage != "review" || body.Materials.BaseRevision != run.context.Revision {
		t.Fatal("missing stage provenance")
	}
	if !bytes.Equal(run.reviewed, narrativeMarshal(candidate)) {
		expected, _ := canonicalCandidate(candidate)
		if !bytes.Equal(run.reviewed, expected) {
			t.Fatal("selection changed frozen candidate")
		}
	}
	run, call, _ = reviewContextFixture(t)
	run.materialBudget = 4096
	call.Messages[1].Content = strings.Replace(call.Messages[1].Content, "pinned-source", "forged-source", 1)
	if _, err := run.before(call); err == nil {
		t.Fatal("recompilation erased a forged source pin")
	}
}

func TestStageCompilerAccountsForFixedInputAndDropsWholeOptionalItems(t *testing.T) {
	p := materialFixture()
	p.materialBudget = 12 << 10
	p.stageInputBudget = 5000
	p.last = "evaluate"
	p.context.Input = "陈禾搬花盆。"
	p.context.AuthorityState.Narrative = &NarrativeState{Version: 1, ThroughRevision: 9, Characters: []NarrativeCharacter{{EntityID: "a", Voice: strings.Repeat("style ", 1000), UpdatedRevision: 9}}}
	body := map[string]any{"context": reviewHydrationWireContext(p.context, p.context.State), "selected_plan": strings.Repeat("fixed ", 100)}
	call := &pb.ModelCallRequest{NarrativeStage: "write", SchemaJson: strings.Repeat("s", 1000), Messages: []*pb.ModelMessage{{Role: "system", Content: "writer"}, {Role: "user", Content: string(narrativeMarshal(body))}}}
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	if narrativeCallBytes(call) > p.stageInputBudget {
		t.Fatal("actual stage exceeded configured input")
	}
	if strings.Contains(call.Messages[1].Content, strings.Repeat("style ", 1000)) {
		t.Fatal("oversized legacy block was unconditionally copied")
	}
}

func TestActorReadReentryRetainsIdentityAndValidatesActualEvidence(t *testing.T) {
	p := materialFixture()
	p.last = "memory"
	p.actors["a"] = narrativeTrigger{ActorID: "a", FactIDs: []string{}}
	call := &pb.ModelCallRequest{NarrativeStage: "actor", NarrativeActorId: "a"}
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	p.readCompleted = true
	if _, err := p.before(&pb.ModelCallRequest{NarrativeStage: "actor", NarrativeActorId: "b"}); err == nil {
		t.Fatal("read continuation changed actor")
	}
	if _, err := p.before(call); err != nil {
		t.Fatal("same actor was counted twice", err)
	}
	if len(p.seen) != 1 {
		t.Fatal("same actor counted twice")
	}
	result := map[string]any{"actor_id": "a", "intent": "help", "action": "move pot", "speech": "", "conditions": []string{}, "used_fact_ids": []string{"unrelated"}}
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": result}))}); err == nil {
		t.Fatal("actor cited evidence never in its actual packet")
	}
}

func TestMemoryMaterialsOfferWholeSourceSummaryAndCue(t *testing.T) {
	p := materialFixture()
	needs := ContextNeeds{ParticipantIDs: []string{"a", "b"}}
	full, err := p.prepareMaterials("write", "", needs, 12<<10)
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Memories) != 1 || full.Memories[0].Granularity != "source" || full.Memories[0].Quote == "" || full.Memories[0].RequiresSource {
		t.Fatal("commitment did not retain exact source", full)
	}
	p.context.AuthorityState.LiteraryMemory.Entries[0].Summary = strings.Repeat("没有明确说几点回来；不能推断他故意失约。", 100)
	small, err := p.prepareMaterials("write", "", needs, 1500)
	if err != nil {
		t.Fatal(err)
	}
	if len(small.Memories) != 1 || small.Memories[0].Granularity != "cue" || small.Memories[0].Summary != "" || small.Memories[0].Quote != "" || !small.Memories[0].RequiresSource {
		t.Fatal("low budget mechanically truncated memory instead of changing granularity", small)
	}
	p.context.AuthorityState.LiteraryMemory.Entries[0].Kind = "episode"
	p.context.AuthorityState.LiteraryMemory.Entries[0].Summary = "他答应了告知晚归，后来发生什么尚不清楚。"
	summary, err := p.prepareMaterials("write", "", needs, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Memories) != 1 || summary.Memories[0].Granularity != "summary" || summary.Memories[0].Summary == "" || summary.Memories[0].Quote != "" {
		t.Fatal("summary layer missing", summary)
	}
}

func TestReviewMemoryChangeRetrievesOldSourceWithoutNamesInProse(t *testing.T) {
	p := materialFixture()
	p.context.AuthorityState.LiteraryMemory.IndexedThroughRevision = 2
	p.context.AuthorityState.LiteraryMemory.Entries[0].PriorSources = []MemorySource{{Revision: 1, SHA256: strings.Repeat("a", 64), Quote: "最初是他说，可以晚归，但要留个消息。"}}
	change := p.context.AuthorityState.LiteraryMemory.Entries[0].MemoryChange
	change.Quote = "他点头说这回记住了。"
	candidate := Candidate{Passage: change.Quote, MemoryChanges: []MemoryChange{change}}
	needs := p.needsForStage("review", &candidate)
	bundle, err := p.prepareMaterials("review", "", needs, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Memories) != 1 || bundle.Memories[0].Granularity != "source" || bundle.Memories[0].Quote == change.Quote {
		t.Fatal("review did not independently retrieve old version")
	}
	if len(bundle.Memories[0].PriorSources) != 1 || bundle.Memories[0].PriorSources[0].Quote != "最初是他说，可以晚归，但要留个消息。" {
		t.Fatal("review lost the inherited source chain")
	}
	if bundle.Coverage.IndexedThroughRevision == nil || *bundle.Coverage.IndexedThroughRevision != 2 || !containsID(bundle.Coverage.Unqueried, "pages_from_3") {
		t.Fatal("unindexed historical gap was concealed")
	}
	p.context.AuthorityState.LiteraryMemory.Entries[0].Quote = strings.Repeat("旧约定的完整原句。", 1000)
	if _, err := p.prepareMaterials("review", "", needs, 4096); err == nil || err.Error() != "context_budget_exceeded" {
		t.Fatal("review silently weakened required old memory source", err)
	}
}

func TestNarrativeMemoryReviewRequiresExactSupportForEveryChange(t *testing.T) {
	candidate := Candidate{Passage: "她说：“晚了发一个字就行。”", MemoryChanges: []MemoryChange{{ID: "promise", Quote: "晚了发一个字就行。"}}}
	approval := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(candidate), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
	if verifyNarrativeApproval(candidate, approval) == nil {
		t.Fatal("memory changed without semantic review")
	}
	approval.Result.MemorySupports = []NarrativeMemorySupport{{MemoryID: "promise", Quote: "晚了"}}
	if verifyNarrativeApproval(candidate, approval) == nil {
		t.Fatal("review support changed the extraction's source boundaries")
	}
	approval.Result.MemorySupports[0].Quote = candidate.MemoryChanges[0].Quote
	if err := verifyNarrativeApproval(candidate, approval); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyEpisodesAndArcsAreSelectedAuthorHints(t *testing.T) {
	p := materialFixture()
	p.context.AuthorityState.Threads = []Thread{{ID: "return-home", Text: "等待晚归的告知", RelatedFactIDs: []string{"promise"}}}
	p.context.AuthorityState.Narrative = &NarrativeState{Version: 1, ThroughRevision: 9,
		Episodes: []NarrativeEpisode{
			{ID: "shared", Summary: "旧摘要：他们曾因没有告知晚归而不快。", FromRevision: 1, ToRevision: 2, FactIDs: []string{"promise"}},
			{ID: "other", Summary: "无关旧摘要：另一个城市的热闹节日。", FromRevision: 1, ToRevision: 2, FactIDs: []string{"unrelated"}},
		},
		Arcs: []NarrativeArc{{ThreadID: "return-home", Status: "open", NextBeats: []string{"尚未发生的后续设想"}, FactIDs: []string{}, UpdatedRevision: 2}},
	}
	bundle, err := p.prepareMaterials("write", "", ContextNeeds{ParticipantIDs: []string{"a"}}, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.LegacyEpisodes) != 1 || bundle.LegacyEpisodes[0].ID != "shared" || len(bundle.LegacyArcs) != 1 {
		t.Fatal("relevant legacy history disappeared or whole notebook was copied", bundle)
	}
	if !containsID(bundle.Coverage.Uncertain, "legacy_unverified_summary_requires_sources") {
		t.Fatal("legacy summary was presented as proved history")
	}
	actor, err := p.prepareMaterials("actor", "a", ContextNeeds{}, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if len(actor.LegacyEpisodes) != 0 || len(actor.LegacyArcs) != 0 {
		t.Fatal("unscoped old summary reached actor")
	}
}

func TestPlanAndEvaluationReferencesMustBeInActualMaterialPacket(t *testing.T) {
	for _, stage := range []string{"plan", "evaluate"} {
		t.Run(stage, func(t *testing.T) {
			p := materialFixture()
			p.context.State.Facts = p.context.State.Facts[:1]
			call := &pb.ModelCallRequest{Messages: []*pb.ModelMessage{{Role: "user", Content: string(narrativeMarshal(map[string]any{"context": reviewHydrationWireContext(p.context, p.context.State)}))}}}
			if err := p.recordStageReferences(call); err != nil {
				t.Fatal(err)
			}
			p.last = stage
			var result any
			if stage == "plan" {
				result = map[string]any{"candidates": []any{map[string]any{"id": "p", "fact_ids": []string{"unrelated"}, "thread_ids": []string{}}}}
			} else {
				result = map[string]any{"evaluations": []any{map[string]any{"evidence_fact_ids": []string{"unrelated"}}}}
			}
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": result}))}); err == nil {
				t.Fatal("storage existence substituted for actual material")
			}
		})
	}
}

func TestPlanReadDependenciesSurviveStageRecompilationWithoutWholeRecall(t *testing.T) {
	p := materialFixture()
	p.context.AuthorityState.Facts = append(p.context.AuthorityState.Facts,
		Fact{ID: "old-cause", Kind: "fact", Text: "旧桥无法通行。", KnownBy: []string{}, SourceRevision: 1},
		Fact{ID: "unrelated-read", Kind: "fact", Text: "另一个岛上有人晒被子。", KnownBy: []string{}, SourceRevision: 1})
	p.context.AuthorityState.Threads = []Thread{{ID: "bridge", Text: "绕行旧桥", RelatedFactIDs: []string{"old-cause"}}}
	p.context.State = EmptyState()
	p.materialBudget = 4096
	p.last = "plan"
	p.stageFacts = map[string]bool{"old-cause": true, "unrelated-read": true}
	p.stageThreads = map[string]bool{"bridge": true}
	result := map[string]any{"candidates": []any{map[string]any{"id": "selected", "fact_ids": []string{"old-cause"}, "thread_ids": []string{"bridge"}}}}
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": result}))}); err != nil {
		t.Fatal(err)
	}
	p.context.Recalls = []ReadReply{{Objects: []ReadObject{{Type: "fact", AsOfRevision: 9, Body: narrativeJSON(p.context.AuthorityState.Facts[4])}, {Type: "fact", AsOfRevision: 9, Body: narrativeJSON(p.context.AuthorityState.Facts[5])}}}}
	for _, stage := range []string{"evaluate", "write"} {
		p.readCompleted = false
		p.selectedPlanID = "selected"
		body := map[string]json.RawMessage{"context": narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State))}
		if err := p.replaceStageMaterials(body, stage, nil); err != nil {
			t.Fatal(err)
		}
		raw := string(narrativeMarshal(body))
		if !strings.Contains(raw, "旧桥无法通行") || !strings.Contains(raw, `bridge`) {
			t.Fatal("plan references lost their original evidence on next stage", raw)
		}
		if strings.Contains(raw, "unrelated-read") || strings.Contains(raw, "晒被子") {
			t.Fatal("entire old recall was carried forward", raw)
		}
	}
}

func TestStageEntryAndCurrentReadsKeepThreadAndEntityRecords(t *testing.T) {
	p := materialFixture()
	thread := Thread{ID: "unfulfilled", Text: "还有一件尚未说清的事。", RelatedFactIDs: []string{}}
	p.context.AuthorityState.Threads = []Thread{thread}
	p.context.State.Threads = []Thread{thread}
	body := map[string]json.RawMessage{"context": narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State))}
	if err := p.replaceStageMaterials(body, "memory", nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body["context"]), "unfulfilled") {
		t.Fatal("entry forgot an open thread without fact links")
	}
	p.context.State = EmptyState()
	p.readCompleted = true
	p.context.Recalls = []ReadReply{{Objects: []ReadObject{
		{Type: "thread", AsOfRevision: 9, Body: narrativeJSON(thread)},
		{Type: "entity", AsOfRevision: 9, Body: narrativeJSON(p.context.AuthorityState.Entities[1])},
	}}}
	body = map[string]json.RawMessage{"context": narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State))}
	if err := p.replaceStageMaterials(body, "plan", nil); err != nil {
		t.Fatal(err)
	}
	var view struct {
		State State `json:"state"`
	}
	if json.Unmarshal(body["context"], &view) != nil {
		t.Fatal("invalid stage carrier")
	}
	if len(view.State.Threads) != 1 || view.State.Threads[0].ID != thread.ID {
		t.Fatal("explicit current thread read disappeared during repacking")
	}
	found := false
	for _, entity := range view.State.Entities {
		found = found || entity.ID == "b"
	}
	if !found {
		t.Fatal("explicit current entity read disappeared during repacking")
	}
}
