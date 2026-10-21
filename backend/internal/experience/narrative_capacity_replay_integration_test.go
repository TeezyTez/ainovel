//go:build integration

package experience

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

// Recorded synthetic-world model outputs reproduce NAR-009 S07's pre-model
// capacity failure. This replay measures context/authority, not prose quality.
//
//go:embed testdata/narrative/nar009-capacity-replay.json
var narrativeCapacityReplayJSON []byte

type narrativeCapacityReplay struct {
	Boundary     string         `json:"boundary"`
	SourceSHA256 string         `json:"source_sha256"`
	Seed         string         `json:"seed"`
	Request      AdvanceRequest `json:"request"`
	Revisions    []struct {
		Page  Page  `json:"page"`
		State State `json:"state"`
	} `json:"revisions"`
}

// The fixed model makes the real Rust pipeline request an omitted fact, then
// requires its unchanged body in the selected plan's downstream working set.
// Review independently selects from the frozen candidate; this fixture makes
// no fact/knowledge changes, so review need not retain an unrelated recalled
// target. This measures retrieval and authority, not literary quality.
type recordedCapacityRecallModel struct {
	pipelineCapacityModel
	omitted Fact
	failure string
}

func (m *recordedCapacityRecallModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	result, err := m.pipelineCapacityModel.Generate(ctx, request)
	if err != nil {
		return result, err
	}
	stage := m.stages[len(m.stages)-1]
	var input struct {
		State         State         `json:"state"`
		StateCoverage StateCoverage `json:"state_coverage"`
		Context       *struct {
			State State `json:"state"`
		} `json:"context"`
	}
	for _, message := range request.Messages {
		if message.Role == "user" {
			if err := json.Unmarshal([]byte(message.Content), &input); err != nil {
				return model.Result{}, err
			}
		}
	}
	state := input.State
	if input.Context != nil {
		state = input.Context.State
	}
	var observed *Fact
	for i := range state.Facts {
		if state.Facts[i].ID == m.omitted.ID {
			observed = &state.Facts[i]
		}
	}
	var response any
	if m.calls == 1 {
		if stage != "memory" || observed != nil {
			m.failure = fmt.Sprintf("first request stage=%s target_present=%t", stage, observed != nil)
			return model.Result{}, fmt.Errorf("recall fixture must start without its deferred fact: %s", m.failure)
		}
		response = ReadRequest{RequestID: "pipeline-deferred-fact", SourceHandle: input.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: m.omitted.ID}}}, MaxReplyBytes: 4096}
	} else {
		required := stage != "review"
		if !required && (len(m.current.NewFacts) != 0 || len(m.current.KnowledgeChanges) != 0 ||
			len(m.current.RevealFactIDs) != 0 || len(m.current.MemoryChanges) != 0 || m.current.MemoryDelta == nil || len(m.current.MemoryDelta.Entries) != 0) {
			return model.Result{}, fmt.Errorf("independent-review control must have no fact, knowledge or memory changes")
		}
		if required && observed == nil || observed != nil && !reflect.DeepEqual(*observed, m.omitted) {
			m.failure = fmt.Sprintf("stage=%s call=%d target_present=%t", stage, m.calls, observed != nil)
			return model.Result{}, fmt.Errorf("%s did not receive the exact recalled fact and knowledge edges: %s", stage, m.failure)
		}
		// Reference the recalled identity in the real scene/plan validators, so
		// forwarding it only as inert text cannot satisfy the pipeline.
		switch stage {
		case "memory":
			response = map[string]any{"actors": []any{}, "relevant_fact_ids": []string{m.omitted.ID}, "objective": "固定回取边界测试"}
		case "plan":
			plans := []any{}
			for _, id := range []string{"p1", "p2"} {
				plans = append(plans, map[string]any{"id": id, "purpose": "固定回取边界测试", "beats": []string{"观察"}, "causes": []string{}, "costs": []string{}, "consequences": []string{}, "thread_ids": []string{}, "fact_ids": []string{m.omitted.ID}})
			}
			response = map[string]any{"candidates": plans}
		}
	}
	if response != nil {
		raw, err := json.Marshal(map[string]any{"result": response})
		return model.Result{Text: string(raw)}, err
	}
	return result, nil
}

func TestRecordedNarrativePipelineRecallsDeferredFactBeforePlanAndReview(t *testing.T) {
	addr := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	s, _, _ := testService(t)
	// Keep the recorded structural-control window. The entry view and the
	// actual stage working set are different in v4.9: choose a target omitted
	// by stage selection, then require the real outgoing first request to
	// confirm that omission. Do not shrink the model window to force it.
	a := &Algorithm{Link: link, ModelName: "capacity-recall-fixture", Timeout: 5 * time.Second, ModelContextTokens: 59392, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
	s.NarrativeEngine, s.Generator = true, a
	fixture, view := seedCapacityReplay(t, s)
	_, fresh, err := s.Advance(ctx, "capacity-replay", view.ID, fixture.Request)
	must(t, err)
	if !fresh {
		t.Fatal("replay operation was not accepted")
	}
	q := pgq.New(s.DB)
	op, err := q.ExperienceClaim(ctx, pgq.ExperienceClaimParams{AccountID: "capacity-replay", RequestID: fixture.Request.RequestID})
	must(t, err)
	authority, err := s.buildContext(ctx, op)
	must(t, err)
	generation, err := s.buildGeneration(ctx, op, authority)
	must(t, err)
	probe := newNarrativeRun(generation)
	materials, err := probe.prepareMaterials("memory", "", probe.needsForStage("memory", nil), defaultMaterialBudget)
	must(t, err)
	loaded := map[string]bool{}
	for _, fact := range materials.Facts {
		loaded[fact.ID] = true
	}
	var omitted Fact
	for _, fact := range authority.State.Facts {
		if !loaded[fact.ID] && len(fact.KnownBy) != 0 {
			omitted = fact
			break
		}
	}
	if omitted.ID == "" {
		t.Fatal("recorded first-stage materials did not omit a fact with knowledge provenance")
	}
	t.Logf("entry_facts=%d first_stage_facts=%d authority_facts=%d material_bytes=%d target=%s",
		len(generation.State.Facts), len(materials.Facts), len(authority.State.Facts), len(narrativeJSON(materials)), omitted.ID)
	n, err := q.ExperienceFreezeContext(ctx, pgq.ExperienceFreezeContextParams{AccountID: op.AccountID, RequestID: op.RequestID, Fence: op.Fence, Context: narrativeJSON(generation)})
	must(t, err)
	if n != 1 {
		t.Fatal("generation context was not frozen")
	}
	producer := &recordedCapacityRecallModel{omitted: omitted}
	a.Model = producer
	result, err := a.GenerateWithReads(ctx, generation, "experience-recorded-capacity-recall", newSourceReader(s, op, generation))
	if err != nil {
		t.Fatalf("pipeline=%v stages=%v fixed_model_failure=%s", err, producer.stages, producer.failure)
	}
	if !reflect.DeepEqual(producer.stages, []string{"memory", "memory", "plan", "evaluate", "write", "extract", "review"}) {
		t.Fatal("same-operation recall did not complete all required stages", producer.stages)
	}
	after, err := Apply(authority, result)
	must(t, err)
	if !reflect.DeepEqual(after.Facts, authority.State.Facts) || !reflect.DeepEqual(after.Narrative, authority.State.Narrative) || len(result.Passage) != 7800 {
		t.Fatal("recall changed formal facts/knowledge or truncated the large candidate")
	}
	reads, err := q.ExperienceReadAudit(ctx, pgq.ExperienceReadAuditParams{AccountID: op.AccountID, OperationID: op.RequestID})
	must(t, err)
	models, err := q.ExperienceModelInputAudit(ctx, pgq.ExperienceModelInputAuditParams{AccountID: op.AccountID, OperationID: op.RequestID})
	must(t, err)
	if len(reads) != 1 || len(models) != 7 {
		t.Fatal("same-operation source/model audits missing", len(reads), len(models))
	}
	var reply ReadReply
	must(t, json.Unmarshal(reads[0].Reply, &reply))
	if reply.BaseRevision != op.BaseRevision || reply.SourceHandle != generation.StateCoverage.SourceHandle || reply.Audience != "author" || len(reply.Objects) != 1 || !reply.Complete {
		t.Fatal("recall lost frozen scope", reply)
	}
	var recalled Fact
	must(t, json.Unmarshal(reply.Objects[0].Body, &recalled))
	if reply.Objects[0].AsOfRevision != op.BaseRevision || !reflect.DeepEqual(recalled, omitted) {
		t.Fatal("audited source changed original fact/knowledge provenance")
	}
	for i, record := range models {
		var audited Context
		must(t, json.Unmarshal(record.Context, &audited))
		wantReads := 1
		if i == 0 {
			wantReads = 0
		}
		if record.Fence != op.Fence || len(audited.Recalls) != wantReads || !reflect.DeepEqual(audited.State, generation.State) {
			t.Fatal("model audit rewrote frozen state or lost same-operation recall", i+1)
		}
	}
	t.Logf("recorded S07 same-operation recall: fact=%s reads=%d models=%d full_facts=%d", omitted.ID, len(reads), len(models), len(after.Facts))
}

func seedCapacityReplay(t *testing.T, s *Service) (narrativeCapacityReplay, View) {
	t.Helper()
	var fixture narrativeCapacityReplay
	must(t, StrictJSON(narrativeCapacityReplayJSON, &fixture))
	if len(fixture.Revisions) != 7 || len(fixture.SourceSHA256) != 64 {
		t.Fatal("recorded regression fixture changed shape")
	}
	ctx := context.Background()
	const account, experience, branch = "capacity-replay", "benchmark-story", "benchmark-main"
	last := fixture.Revisions[len(fixture.Revisions)-1]
	must(t, s.transaction(ctx, func(q *pgq.Queries) error {
		if err := q.ExperienceCreate(ctx, pgq.ExperienceCreateParams{AccountID: account, ID: experience, Seed: fixture.Seed, ActiveBranchID: branch}); err != nil {
			return err
		}
		if err := q.ExperienceBranchCreate(ctx, pgq.ExperienceBranchCreateParams{AccountID: account, ExperienceID: experience, ID: branch, Name: "capacity replay", Title: "recorded synthetic scene", Revision: last.Page.Revision, State: narrativeJSON(last.State)}); err != nil {
			return err
		}
		for _, revision := range fixture.Revisions {
			if err := validateArchiveState(revision.State, revision.Page.Revision); err != nil {
				return err
			}
			if err := q.ExperiencePageCreate(ctx, pgq.ExperiencePageCreateParams{AccountID: account, ExperienceID: experience, BranchID: branch, Revision: revision.Page.Revision, Page: narrativeJSON(revision.Page), State: narrativeJSON(revision.State), Title: "recorded synthetic scene"}); err != nil {
				return err
			}
		}
		return nil
	}))
	view, err := s.Get(ctx, account, experience, branch)
	must(t, err)
	return fixture, view
}

func TestRecordedSixTurnNarrativeFitsAndRetainsPinnedAuthority(t *testing.T) {
	for _, tc := range []struct {
		name   string
		window int
	}{
		{"default_retains_full_authority", 65536},
		{"bounded_window_retains_scoped_recall", 59392},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testRecordedSixTurnNarrativeAuthority(t, tc.window)
		})
	}
}

func testRecordedSixTurnNarrativeAuthority(t *testing.T, window int) {
	s, _, _ := testService(t)
	a := &Algorithm{ModelName: "gpt-6.1-sol", ModelContextTokens: window, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
	s.NarrativeEngine, s.Generator = true, a
	fixture, view := seedCapacityReplay(t, s)
	ctx := context.Background()
	_, fresh, err := s.Advance(ctx, "capacity-replay", view.ID, fixture.Request)
	must(t, err)
	if !fresh {
		t.Fatal("replay operation was not accepted")
	}
	q := pgq.New(s.DB)
	op, err := q.ExperienceClaim(ctx, pgq.ExperienceClaimParams{AccountID: "capacity-replay", RequestID: fixture.Request.RequestID})
	must(t, err)
	authority, err := s.buildContext(ctx, op)
	must(t, err)
	capacity, err := a.narrativeContextCapacity(authority, s.capacity())
	must(t, err)
	// Same historical reservation, current compiler. v4.9 selects notebook
	// material per stage, so this is not a reproduction of the old compiler.
	control := *a
	control.ModelContextTokens = 65536
	oldCapacity, err := control.narrativeContextCapacity(authority, s.capacity())
	must(t, err)
	oldCapacity -= (40 << 10) - narrativePipelineOverheadBytes
	reserved, reservedErr := compileGeneration(authority, EmptyState(), "fixed-window-control", 1, ReadBudget{}, oldCapacity)
	if reservedErr == nil {
		if len(narrativeJSON(reserved)) > oldCapacity {
			t.Fatal("current compiler accepted an oversized historical-reservation view")
		}
	} else if reservedErr.Error() != "context_capacity" || len(narrativeJSON(reserved)) <= oldCapacity {
		t.Fatal("historical-reservation result disagrees with actual bytes", reservedErr)
	}
	t.Logf("current_compiler_at_recorded_reservation=%d bytes=%d error=%v", oldCapacity, len(narrativeJSON(reserved)), reservedErr)
	minimum, err := compileGeneration(authority, authority.State, "fixed-window-control", authority.Revision, ReadBudget{}, 1)
	code(t, err, "context_capacity")
	minimumBytes := len(narrativeJSON(minimum))
	exact, err := compileGeneration(authority, authority.State, "fixed-window-control", authority.Revision, ReadBudget{}, minimumBytes)
	must(t, err)
	if !reflect.DeepEqual(exact, minimum) {
		t.Fatal("minimum complete view changed at its exact byte boundary")
	}
	below, err := compileGeneration(authority, authority.State, "fixed-window-control", authority.Revision, ReadBudget{}, minimumBytes-1)
	code(t, err, "context_capacity")
	if !reflect.DeepEqual(below, minimum) {
		t.Fatal("one-byte-under rejection truncated the complete view")
	}
	generation, err := s.buildGeneration(ctx, op, authority)
	must(t, err)
	expectedState := authority.State
	expectedState.Narrative, expectedState.LiteraryMemory = nil, nil
	omittedCounts := subtract(counts(authority.State), counts(generation.State))
	if generation.StateCoverage.Total != counts(authority.State) ||
		generation.StateCoverage.Omitted != omittedCounts ||
		generation.StateCoverage.Complete != (omittedCounts == (StateCounts{})) {
		t.Fatal("entry coverage does not describe the actual materialized objects", generation.StateCoverage)
	}
	if window == 65536 && (!generation.StateCoverage.Complete || !reflect.DeepEqual(generation.State, expectedState)) {
		t.Fatal("default capacity no longer retains the complete recorded objects", generation.StateCoverage)
	}
	if len(narrativeJSON(generation)) > capacity || generation.State.Narrative != nil || generation.State.LiteraryMemory != nil {
		t.Fatal("oversized generation or unselected whole notebook sent")
	}
	if !reflect.DeepEqual(generation.History[len(generation.History)-1], authority.History[len(authority.History)-1]) {
		t.Fatal("latest complete page changed")
	}
	if generation.AuthorityState == nil || !reflect.DeepEqual(*generation.AuthorityState, authority.State) {
		t.Fatal("generation lost full commit authority")
	}
	loaded := map[string]Fact{}
	for _, fact := range generation.State.Facts {
		loaded[fact.ID] = fact
	}
	var omitted Fact
	for _, fact := range authority.State.Facts {
		if present, ok := loaded[fact.ID]; ok {
			if !reflect.DeepEqual(present, fact) {
				t.Fatal("materialized fact or knowledge provenance changed", fact.ID)
			}
		} else {
			omitted = fact
			if fact.Kind == "rule" || fact.Kind == "secret" || fact.SourceRevision >= generation.StateCoverage.RecentFromRevision {
				t.Fatal("required root omitted", fact.ID)
			}
		}
	}
	// Both configurations keep original source retrieval and duplicate-ID
	// authority checks whether or not their entry view needs to omit facts.
	// The separate real-pipeline test exercises actual stage omission.
	recallTarget := omitted
	if recallTarget.ID == "" {
		recallTarget = authority.State.Facts[0]
	}
	n, err := q.ExperienceFreezeContext(ctx, pgq.ExperienceFreezeContextParams{AccountID: op.AccountID, RequestID: op.RequestID, Fence: op.Fence, Context: narrativeJSON(generation)})
	must(t, err)
	if n != 1 {
		t.Fatal("context was not frozen")
	}
	reader := newSourceReader(s, op, generation)
	reply := readObjects(t, reader, "recorded-original", ReadTarget{Type: "fact", ID: recallTarget.ID})
	var recalled Fact
	if len(reply.Objects) != 1 {
		t.Fatal("deferred fact could not be recalled")
	}
	must(t, json.Unmarshal(reply.Objects[0].Body, &recalled))
	if !reflect.DeepEqual(recalled, recallTarget) {
		t.Fatal("recall changed original fact or knowledge edges")
	}
	duplicate := candidate(authority)
	duplicate.NewFacts = []Fact{recallTarget}
	duplicate.NewFacts[0].SourceRevision = authority.Revision + 1
	if _, err = Apply(authority, duplicate); err == nil {
		t.Fatal("deferred identity ceased to bind commit authority")
	}
	for _, revision := range fixture.Revisions {
		raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: op.AccountID, ExperienceID: op.ExperienceID, BranchID: op.BranchID, Revision: revision.Page.Revision})
		must(t, err)
		var state State
		must(t, json.Unmarshal(raw, &state))
		if !reflect.DeepEqual(state, revision.State) {
			t.Fatal("capacity projection changed formal snapshot", revision.Page.Revision)
		}
	}
	t.Logf("recorded S07: capacity=%d serialized=%d recent_from=%d facts=%d/%d notebook=%d history=%d/%d", capacity, len(narrativeJSON(generation)), generation.StateCoverage.RecentFromRevision, len(generation.State.Facts), len(authority.State.Facts), len(narrativeJSON(generation.State.Narrative)), len(generation.History), len(authority.History))
	t.Run("actual_runtime_structural_model", func(t *testing.T) {
		addr := actualReadRuntime(t)
		link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
		defer link.Close()
		producer := &pipelineCapacityModel{}
		runtime := &Algorithm{Link: link, Model: producer, ModelName: a.ModelName, Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: a.ModelContextTokens, MaxOutputTokens: a.MaxOutputTokens, ModelByteTokenBoundVerified: true}
		result, err := runtime.GenerateWithReads(ctx, generation, "experience-recorded-capacity-replay", newSourceReader(s, op, generation))
		must(t, err)
		if producer.calls != 6 {
			t.Fatal("recorded context did not reach all strict stages", producer.stages)
		}
		_, err = Apply(authority, result)
		must(t, err)
	})
}
