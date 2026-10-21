//go:build integration && codexlive

package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/protobuf/proto"
)

type deepStagePair struct {
	Stage      string        `json:"stage"`
	RequestSeq int           `json:"request_event_seq"`
	ResultSeq  int           `json:"result_event_seq"`
	RequestSHA string        `json:"request_event_sha256"`
	ResultSHA  string        `json:"result_event_sha256"`
	Request    model.Request `json:"request"`
	Result     model.Result  `json:"result"`
}
type deepStageSource struct {
	Root          string          `json:"source_root"`
	EventsSHA     string          `json:"source_events_sha256"`
	FixtureSHA    string          `json:"source_fixture_sha256"`
	SourceTreeSHA string          `json:"source_tree_sha256"`
	RuntimeSHA    string          `json:"source_runtime_sha256"`
	Context       Context         `json:"reconstructed_context"`
	Authority     State           `json:"original_authority_state"`
	Pairs         []deepStagePair `json:"pairs"`
	CandidateRaw  json.RawMessage `json:"candidate"`
	Candidate     Candidate       `json:"-"`
}

func decodeDeepStageSource(raw []byte, root string, fixtureRaw []byte) (*deepStageSource, error) {
	if len(raw) == 0 || len(raw) > 32<<20 || raw[len(raw)-1] != '\n' {
		return nil, fmt.Errorf("unsealed stage source")
	}
	var fixture deepFixture
	if StrictJSON(fixtureRaw, &fixture) != nil || fixture.ID != "FUN-001" {
		return nil, fmt.Errorf("stage source case differs")
	}
	replay, err := decodeDeepReplay(raw, root, fixture)
	if err != nil || len(replay.Pages) != 7 || replay.Pages[6].Step != "06" {
		return nil, fmt.Errorf("stage source formal prefix differs: %v", err)
	}
	lines := bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'})
	if len(lines) != 167 {
		return nil, fmt.Errorf("expected sealed first FUN-001/07 failure")
	}
	events := make([]deepControlEvent, len(lines))
	hashes := make([]string, len(lines))
	for i, line := range lines {
		if !uniqueJSON(line) || json.Unmarshal(line, &events[i]) != nil {
			return nil, fmt.Errorf("invalid source event")
		}
		hashes[i] = fmt.Sprintf("%x", sha256.Sum256(line))
	}
	var manifest struct {
		FixtureSHA string `json:"fixture_sha256"`
		Model      string `json:"model"`
		Engine     string `json:"engine"`
		Tree       string `json:"source_tree_sha256"`
		Runtime    string `json:"runtime_sha256"`
		Calls      int    `json:"max_model_calls_per_operation"`
		Repairs    int    `json:"max_repairs"`
	}
	if json.Unmarshal(events[0].Data, &manifest) != nil || manifest.FixtureSHA != fmt.Sprintf("%x", sha256.Sum256(fixtureRaw)) || manifest.Model == "" || manifest.Tree == "" || manifest.Runtime == "" || manifest.Engine != "narrative-engine.v4.4" || manifest.Calls != 12 || manifest.Repairs != 1 {
		return nil, fmt.Errorf("stage source manifest/budget differs")
	}
	var ending struct {
		Status string `json:"status"`
	}
	if events[165].Kind != "operation_failure" || events[165].Step != "07" || events[166].Kind != "run_end" || json.Unmarshal(events[166].Data, &ending) != nil || ending.Status != "FAIL" {
		return nil, fmt.Errorf("original failed attempt was not preserved")
	}
	var operation struct {
		Request AdvanceRequest `json:"request"`
		Before  State          `json:"before"`
	}
	if events[134].Kind != "operation_request" || events[134].Step != "07" || json.Unmarshal(events[134].Data, &operation) != nil || operation.Request.ExpectedRevision != 7 || operation.Request.Mode != "act" || !reflect.DeepEqual(operation.Before, replay.Pages[6].State) {
		return nil, fmt.Errorf("operation before differs from authoritative revision 7")
	}
	source := &deepStageSource{Root: root, EventsSHA: fmt.Sprintf("%x", sha256.Sum256(raw)), FixtureSHA: manifest.FixtureSHA, SourceTreeSHA: manifest.Tree, RuntimeSHA: manifest.Runtime, Authority: operation.Before, Pairs: []deepStagePair{}}
	stages := []string{"memory", "actor", "plan", "evaluate", "write", "extract", "review"}
	for i, stage := range stages {
		seq := 136 + 3*i
		requestEvent, resultEvent, stageEvent := events[seq-1], events[seq], events[seq+1]
		var request struct {
			Call    int           `json:"call"`
			Request model.Request `json:"request"`
		}
		var result struct {
			Call   int          `json:"call"`
			Result model.Result `json:"result"`
			Error  string       `json:"error"`
		}
		var observed struct {
			Stage string `json:"stage"`
			Error string `json:"error"`
		}
		if requestEvent.Kind != "model_request" || resultEvent.Kind != "model_result" || stageEvent.Kind != "stage" || requestEvent.Step != "07" || resultEvent.Step != "07" || stageEvent.Step != "07" || json.Unmarshal(requestEvent.Data, &request) != nil || json.Unmarshal(resultEvent.Data, &result) != nil || json.Unmarshal(stageEvent.Data, &observed) != nil || request.Call != 41+i || result.Call != request.Call || result.Error != "" || observed.Stage != stage || observed.Error != "" {
			return nil, fmt.Errorf("source %s request/result/stage binding differs", stage)
		}
		if request.Request.Model != manifest.Model || request.Request.MaxOutputTokens != 8192 || len(request.Request.Schema) == 0 || !json.Valid(request.Request.Schema) {
			return nil, fmt.Errorf("source model/schema/output budget differs")
		}
		if _, err := deepStageUser(request.Request); err != nil {
			return nil, err
		}
		verified, err := model.VerifyContextBudget(request.Request, 65536, 8192, true)
		if err != nil {
			return nil, err
		}
		source.Pairs = append(source.Pairs, deepStagePair{Stage: stage, RequestSeq: seq, ResultSeq: seq + 1, RequestSHA: hashes[seq-1], ResultSHA: hashes[seq], Request: verified, Result: result.Result})
	}
	memory, err := deepStageUser(source.Pairs[0].Request)
	if err != nil {
		return nil, err
	}
	review, err := deepStageUser(source.Pairs[6].Request)
	if err != nil {
		return nil, err
	}
	var next int64
	if json.Unmarshal(memory["next_revision"], &next) != nil || next != 8 || !bytes.Equal(bytes.TrimSpace(memory["historical_recalls"]), []byte("[]")) {
		return nil, fmt.Errorf("source requires unsupported historical reads")
	}
	memoryContext := map[string]json.RawMessage{}
	for k, v := range memory {
		if k != "read_budget" {
			memoryContext[k] = v
		}
	}
	if !deepStageJSONEqual(narrativeJSON(memoryContext), review["context"]) {
		return nil, fmt.Errorf("review context differs from original memory projection")
	}
	delete(memory, "next_revision")
	memory["recalls"] = memory["historical_recalls"]
	delete(memory, "historical_recalls")
	memory["pipeline"] = narrativeJSON(NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1})
	if StrictJSON(narrativeJSON(memory), &source.Context) != nil || source.Context.Revision != 7 || source.Context.Mode != operation.Request.Mode || source.Context.Input != operation.Request.Input || source.Context.BranchID != operation.Request.BranchID || source.Context.Seed != fixture.Seed {
		return nil, fmt.Errorf("reconstructed context differs from source operation")
	}
	if err := validateContract(narrativeJSON(source.Context), "context"); err != nil {
		return nil, err
	}
	source.Context.AuthorityState = &source.Authority
	if source.Context.State.StoryTime != source.Authority.StoryTime || !reflect.DeepEqual(source.Context.State.Narrative, source.Authority.Narrative) || !reflect.DeepEqual(source.Context.State.Gameplay, source.Authority.Gameplay) {
		return nil, fmt.Errorf("projected source state is not its original authority")
	}
	for _, item := range source.Context.State.Facts {
		found := false
		for _, original := range source.Authority.Facts {
			if reflect.DeepEqual(item, original) {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("projected fact differs from authority")
		}
	}
	for _, item := range source.Context.State.Entities {
		found := false
		for _, original := range source.Authority.Entities {
			if reflect.DeepEqual(item, original) {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("projected entity differs from authority")
		}
	}
	for _, item := range source.Context.State.Threads {
		found := false
		for _, original := range source.Authority.Threads {
			if reflect.DeepEqual(item, original) {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("projected thread differs from authority")
		}
	}
	for _, page := range source.Context.History {
		if page.Revision < 1 || page.Revision > 7 || !reflect.DeepEqual(page, replay.Pages[page.Revision-1].Page.HistoryPage) {
			return nil, fmt.Errorf("context history differs from official source")
		}
	}
	decodeResult := func(index int) (json.RawMessage, error) {
		var envelope struct {
			Result json.RawMessage `json:"result"`
		}
		err := StrictJSON([]byte(source.Pairs[index].Result.Text), &envelope)
		return envelope.Result, err
	}
	scene, err := decodeResult(0)
	if err != nil {
		return nil, err
	}
	actor, err := decodeResult(1)
	if err != nil {
		return nil, err
	}
	if !deepStageJSONEqual(scene, review["scene"]) || !deepStageJSONEqual(narrativeJSON([]json.RawMessage{actor}), review["actors"]) {
		return nil, fmt.Errorf("review actors/scene differ from original outputs")
	}
	plansRaw, err := decodeResult(2)
	if err != nil {
		return nil, err
	}
	var plans struct {
		Candidates []json.RawMessage `json:"candidates"`
	}
	if StrictJSON(plansRaw, &plans) != nil {
		return nil, fmt.Errorf("invalid source plans")
	}
	selected := false
	for _, plan := range plans.Candidates {
		if deepStageJSONEqual(plan, review["selected_plan"]) {
			selected = true
		}
	}
	if !selected {
		return nil, fmt.Errorf("selected plan absent from original plans")
	}
	draftRaw, err := decodeResult(4)
	if err != nil {
		return nil, err
	}
	var draft narrativeDraft
	if StrictJSON(draftRaw, &draft) != nil {
		return nil, fmt.Errorf("invalid original draft")
	}
	extractRaw, err := decodeResult(5)
	if err != nil {
		return nil, err
	}
	var extracted struct {
		Candidate string `json:"candidate_json"`
	}
	if StrictJSON(extractRaw, &extracted) != nil || StrictJSON([]byte(extracted.Candidate), &source.Candidate) != nil || !deepStageJSONEqual([]byte(extracted.Candidate), review["candidate"]) {
		return nil, fmt.Errorf("review candidate differs from original extraction")
	}
	candidate := source.Candidate
	if !textOK(candidate.Passage) || !reflect.DeepEqual(draft, narrativeDraft{Title: candidate.Title, Passage: candidate.Passage, StoryTime: candidate.StoryTime, Outcome: candidate.Outcome, Suggestions: candidate.Suggestions}) {
		return nil, fmt.Errorf("extraction changed original draft")
	}
	source.CandidateRaw = append(json.RawMessage(nil), review["candidate"]...)
	return source, nil
}
func sameDeepStageRequest(actual, expected model.Request) error {
	if actual.Model != expected.Model || actual.AccountID != expected.AccountID || actual.PlanKey != expected.PlanKey || actual.Task != expected.Task || actual.MaxOutputTokens != expected.MaxOutputTokens || actual.ContextTokenLimit != expected.ContextTokenLimit || !deepStageJSONEqual(actual.Schema, expected.Schema) || len(actual.Messages) != len(expected.Messages) {
		return fmt.Errorf("model/schema/budget/message shape changed")
	}
	for i, message := range actual.Messages {
		old := expected.Messages[i]
		if message.Role != old.Role || message.Role != "system" && message.Content != old.Content {
			return fmt.Errorf("non-system prompt content changed")
		}
	}
	_, err := deepStageUser(actual)
	return err
}

func deepStageJSONEqual(a, b []byte) bool {
	var x, y any
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && reflect.DeepEqual(x, y)
}
func deepStageUser(request model.Request) (map[string]json.RawMessage, error) {
	if len(request.Messages) != 2 || request.Messages[0].Role != "system" || !textOK(request.Messages[0].Content) || request.Messages[1].Role != "user" {
		return nil, fmt.Errorf("source must have exactly one product system and one original user")
	}
	var result map[string]json.RawMessage
	if StrictJSON([]byte(request.Messages[1].Content), &result) != nil || result == nil {
		return nil, fmt.Errorf("invalid source user JSON")
	}
	return result, nil
}

// Portable synthetic events test evidence plumbing only, never benchmark quality.
func deepStageSyntheticSource(t *testing.T, mutate func(map[int]map[string]any)) ([]byte, string, []byte) {
	t.Helper()
	state := EmptyState()
	state.Entities = []Entity{{ID: "npc", Kind: "character", Name: "Witness", Description: "", Known: true, RelatedIDs: []string{}}}
	state.Facts = []Fact{{ID: "seen", Kind: "fact", Text: "An observed event.", Known: true, KnownBy: []string{"npc"}, SourceRevision: 1}}
	f := deepFixture{ID: "FUN-001", Seed: "room", Opening: "A room.", State: state, Steps: []deepStep{}}
	for i := 1; i <= 13; i++ {
		f.Steps = append(f.Steps, deepStep{ID: fmt.Sprintf("%02d", i), Mode: "player", Input: fmt.Sprintf("Synthetic action %d.", i)})
	}
	fixtureRaw := narrativeJSON(f)
	c := Context{Version: 2, ExperienceID: "synthetic", BranchID: "main", Revision: 7, Mode: "act", Input: f.Steps[6].Input, Seed: f.Seed, State: state, Preferences: []Preference{}, History: []HistoryPage{}, HistoryComplete: false, StateCoverage: StateCoverage{Policy: "full.v1", Complete: true, Total: counts(state), SourceHandle: "synthetic", Audience: "author"}, Recalls: []ReadReply{}, ReadBudget: ReadBudget{MaxReads: 4, MaxReplyBytes: 65536, MaxTotalReplyBytes: 131072}, Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}
	c.AuthorityState = &c.State
	memory := map[string]any{"version": 2, "experience_id": c.ExperienceID, "branch_id": c.BranchID, "revision": 7, "next_revision": 8, "mode": "act", "input": c.Input, "seed": c.Seed, "state": state, "preferences": c.Preferences, "history": c.History, "history_complete": false, "state_coverage": c.StateCoverage, "historical_recalls": []any{}, "read_budget": c.ReadBudget, "reading_request": "", "gameplay_action": nil}
	contextView := map[string]any{}
	for k, v := range memory {
		if k != "read_budget" {
			contextView[k] = v
		}
	}
	trigger := narrativeTrigger{ActorID: "npc", Trigger: state.Facts[0].Text, FactIDs: []string{"seen"}}
	scene := map[string]any{"actors": []narrativeTrigger{trigger}, "objective": "Observe the room.", "relevant_fact_ids": []string{"seen"}}
	actor := map[string]any{"actor_id": "npc", "intent": "Wait.", "action": "Remain nearby.", "speech": "", "conditions": []string{}, "used_fact_ids": []string{"seen"}}
	actors := []any{actor}
	plan := map[string]any{"id": "a", "purpose": "Observe.", "beats": []string{"Observe."}, "causes": []string{}, "costs": []string{}, "consequences": []string{}, "thread_ids": []string{}, "fact_ids": []string{"seen"}}
	plans := map[string]any{"candidates": []any{plan}}
	candidate := candidate(c)
	candidate.Passage = "Synthetic passage."
	draft := narrativeDraft{Title: candidate.Title, Passage: candidate.Passage, StoryTime: candidate.StoryTime, Outcome: candidate.Outcome, Suggestions: candidate.Suggestions}
	actorRaw, err := newNarrativeRun(c).actorProjection(trigger)
	must(t, err)
	var actorInput any
	must(t, json.Unmarshal(actorRaw, &actorInput))
	inputs := []any{memory, actorInput, map[string]any{"context": contextView, "scene": scene, "actors": actors}, map[string]any{"context": contextView, "scene": scene, "actors": actors, "plans": plans}, map[string]any{"context": contextView, "scene": scene, "actors": actors, "selected_plan": plan}, map[string]any{"context": contextView, "draft": draft, "selected_plan": plan, "candidate_format": map[string]any{}}, map[string]any{"context": contextView, "scene": scene, "actors": actors, "selected_plan": plan, "candidate": candidate}}
	results := []any{scene, actor, plans, map[string]any{"evaluations": []any{}}, draft, map[string]any{"candidate_json": string(narrativeJSON(candidate))}, NarrativeReview{Approved: false, Issues: []NarrativeIssue{{Code: "synthetic_issue", Detail: "Synthetic rejection."}}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}, RevealSupports: []NarrativeRevealSupport{}}}
	stages := []string{"memory", "actor", "plan", "evaluate", "write", "extract", "review"}
	events := map[int]map[string]any{}
	for i := 1; i <= 167; i++ {
		events[i] = map[string]any{"seq": i, "kind": "stage", "step": "", "data": map[string]any{}}
	}
	set := func(seq int, kind, step string, data any) {
		events[seq]["kind"], events[seq]["step"], events[seq]["data"] = kind, step, data
	}
	set(1, "manifest", "", map[string]any{"fixture": f, "fixture_sha256": fmt.Sprintf("%x", sha256.Sum256(fixtureRaw)), "model": "test-model", "engine": "narrative-engine.v4.4", "source_tree_sha256": "synthetic", "runtime_sha256": "synthetic", "max_model_calls_per_operation": 12, "max_repairs": 1})
	pages := []Page{{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}}}
	set(2, "initial_readback", "", map[string]any{"snapshot": state, "public_view": View{Revision: 1, Pages: append([]Page(nil), pages...)}})
	for i := 1; i <= 6; i++ {
		seq := i*2 + 1
		if i == 6 {
			seq = 133
		}
		step := f.Steps[i-1]
		set(seq, "operation_request", step.ID, map[string]any{"request": AdvanceRequest{Mode: "act", Input: step.Input, ExpectedRevision: int64(i)}})
		pages = append(pages, Page{HistoryPage: HistoryPage{Revision: int64(i + 1), Mode: "act", Input: step.Input, Text: fmt.Sprintf("Synthetic history %d.", i)}})
		set(seq+1, "operation_committed", step.ID, map[string]any{"snapshot": state, "public_view": View{Title: fmt.Sprintf("Synthetic title %d", i+1), Revision: int64(i + 1), Pages: append([]Page(nil), pages...)}})
	}
	set(135, "operation_request", "07", map[string]any{"request": AdvanceRequest{Mode: "act", Input: c.Input, BranchID: "main", ExpectedRevision: 7}, "before": state})
	for i, stage := range stages {
		seq := 136 + 3*i
		request := model.Request{Model: "test-model", MaxOutputTokens: 8192, Schema: json.RawMessage(`{"type":"object"}`), Messages: []model.Message{{Role: "system", Content: "Source product instruction: " + stage}, {Role: "user", Content: string(narrativeJSON(inputs[i]))}}}
		set(seq, "model_request", "07", map[string]any{"call": 41 + i, "request": request})
		set(seq+1, "model_result", "07", map[string]any{"call": 41 + i, "result": model.Result{Text: string(narrativeJSON(map[string]any{"result": results[i]}))}, "error": ""})
		set(seq+2, "stage", "07", map[string]any{"stage": stage, "error": ""})
	}
	set(166, "operation_failure", "07", map[string]any{"error": "synthetic failure"})
	set(167, "run_end", "07", map[string]any{"status": "FAIL"})
	if mutate != nil {
		mutate(events)
	}
	var raw []byte
	previous := ""
	for i := 1; i <= 167; i++ {
		events[i]["previous_sha256"] = previous
		line := narrativeJSON(events[i])
		previous = fmt.Sprintf("%x", sha256.Sum256(line))
		raw = append(raw, line...)
		raw = append(raw, '\n')
	}
	return raw, previous, fixtureRaw
}

func TestDeepBenchmarkStageReplaySourceBindsFrozenPrefix(t *testing.T) {
	raw, root, fixtureRaw := deepStageSyntheticSource(t, nil)
	source, err := decodeDeepStageSource(raw, root, fixtureRaw)
	must(t, err)
	if len(source.Pairs) != 7 || source.Context.Revision != 7 || source.Context.Input != "Synthetic action 7." || source.Candidate.Passage != "Synthetic passage." {
		t.Fatal("source identity lost")
	}
	for _, mutation := range []string{"wrong_case", "authority", "candidate", "actor", "schema", "call", "stage", "budget", "multiple_user"} {
		t.Run(mutation, func(t *testing.T) {
			raw, root, fixtureRaw := deepStageSyntheticSource(t, func(events map[int]map[string]any) {
				if mutation == "wrong_case" {
					f := events[1]["data"].(map[string]any)["fixture"].(deepFixture)
					f.ID = "NAR-001"
					events[1]["data"].(map[string]any)["fixture"] = f
					return
				}
				if mutation == "authority" {
					v := events[135]["data"].(map[string]any)
					s := v["before"].(State)
					s.StoryTime = "changed"
					v["before"] = s
					return
				}
				if mutation == "call" {
					events[154]["data"].(map[string]any)["call"] = 48
					return
				}
				if mutation == "stage" {
					events[156]["data"].(map[string]any)["stage"] = "revise"
					return
				}
				d := events[154]["data"].(map[string]any)
				r := d["request"].(model.Request)
				switch mutation {
				case "candidate":
					r.Messages[1].Content = strings.Replace(r.Messages[1].Content, "Synthetic passage.", "Changed candidate.", 1)
				case "actor":
					r.Messages[1].Content = strings.Replace(r.Messages[1].Content, "Remain nearby.", "Do something else.", 1)
				case "schema":
					r.Schema = nil
				case "budget":
					r.MaxOutputTokens = 4096
				case "multiple_user":
					r.Messages = append(r.Messages, r.Messages[1])
				}
				d["request"] = r
			})
			if _, err := decodeDeepStageSource(raw, root, fixtureRaw); err == nil {
				t.Fatal("accepted source drift")
			}
		})
	}
	if _, err := decodeDeepStageSource(raw, "wrong-root", fixtureRaw); err == nil {
		t.Fatal("wrong root accepted")
	}
	if _, err := decodeDeepStageSource(raw[:len(raw)-1], root, fixtureRaw); err == nil {
		t.Fatal("unsealed source accepted")
	}
}

func TestDeepBenchmarkStageRequestAllowsOnlySystemPromptDifference(t *testing.T) {
	expected := model.Request{Model: "m", MaxOutputTokens: 8192, ContextTokenLimit: 65536, Schema: json.RawMessage(`{"type":"object"}`), Messages: []model.Message{{Role: "system", Content: "old product prompt"}, {Role: "user", Content: `{"candidate":"fixed","actors":[]}`}}}
	for _, mutation := range []string{"system", "user", "schema", "model", "output", "context", "role", "extra"} {
		t.Run(mutation, func(t *testing.T) {
			actual := expected
			actual.Messages = append([]model.Message(nil), expected.Messages...)
			switch mutation {
			case "system":
				actual.Messages[0].Content = "new product prompt"
			case "user":
				actual.Messages[1].Content = `{"candidate":"changed","actors":[]}`
			case "schema":
				actual.Schema = json.RawMessage(`{"type":"string"}`)
			case "model":
				actual.Model = "other"
			case "output":
				actual.MaxOutputTokens = 4096
			case "context":
				actual.ContextTokenLimit = 131072
			case "role":
				actual.Messages[1].Role = "assistant"
			case "extra":
				actual.Messages = append(actual.Messages, model.Message{Role: "system", Content: "extra oracle"})
			}
			err := sameDeepStageRequest(actual, expected)
			if (mutation == "system") != (err == nil) {
				t.Fatalf("unexpected comparison: %v", err)
			}
		})
	}
}

type deepStagePrefixModel struct {
	source   *deepStageSource
	requests []model.Request
	replayed int
	err      error
}

func (*deepStagePrefixModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return fmt.Errorf("stage replay cannot stream")
}
func (m *deepStagePrefixModel) Generate(_ context.Context, request model.Request) (model.Result, error) {
	index := len(m.requests)
	m.requests = append(m.requests, request)
	if index >= 7 {
		m.err = fmt.Errorf("unexpected request beyond first review")
		return model.Result{}, m.err
	}
	if err := sameDeepStageRequest(request, m.source.Pairs[index].Request); err != nil {
		m.err = fmt.Errorf("%s source request changed: %w", m.source.Pairs[index].Stage, err)
		return model.Result{}, m.err
	}
	if index == 6 {
		return model.Result{}, fmt.Errorf("evaluation_capture_complete_no_model_invocation")
	}
	m.replayed++
	return m.source.Pairs[index].Result, nil
}

type deepStagePairOutcome struct {
	Variant string       `json:"variant"`
	Result  model.Result `json:"result"`
	Error   string       `json:"error"`
	Elapsed int64        `json:"elapsed_ms"`
}

func runDeepStagePair(ctx context.Context, generator model.Generator, old, current model.Request, emit func(string, any) error) ([]deepStagePairOutcome, error) {
	if err := sameDeepStageRequest(current, old); err != nil {
		return nil, err
	}
	if _, err := deepStageUser(old); err != nil {
		return nil, err
	}
	if old.Messages[0].Content == current.Messages[0].Content {
		return nil, fmt.Errorf("product system prompts are identical")
	}
	outcomes := []deepStagePairOutcome{}
	for i, request := range []model.Request{old, current} {
		variant := []string{"old", "new"}[i]
		if err := emit("model_request", map[string]any{"call": i + 1, "variant": variant, "request": request, "context_token_limit": request.ContextTokenLimit}); err != nil {
			return outcomes, err
		}
		started := time.Now()
		result, err := generator.Generate(ctx, request)
		outcome := deepStagePairOutcome{Variant: variant, Result: result, Elapsed: time.Since(started).Milliseconds()}
		if err != nil {
			outcome.Error = err.Error()
		}
		outcomes = append(outcomes, outcome)
		if writeErr := emit("model_result", map[string]any{"call": i + 1, "outcome": outcome}); writeErr != nil {
			return outcomes, writeErr
		}
		if err != nil {
			return outcomes, err
		}
	}
	return outcomes, nil
}

type deepStagePairControl struct {
	requests []model.Request
	failAt   int
	invalid  bool
}

func (*deepStagePairControl) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return fmt.Errorf("unexpected stream")
}
func (m *deepStagePairControl) Generate(_ context.Context, request model.Request) (model.Result, error) {
	m.requests = append(m.requests, request)
	if len(m.requests) == m.failAt {
		return model.Result{}, model.ErrRequestFailed
	}
	if m.invalid {
		return model.Result{Text: "invalid model response"}, nil
	}
	return model.Result{Text: `{"result":{"approved":false,"issues":[{"code":"real_issue","detail":"A legitimate rejection."}],"supports":[],"knowledge_supports":[],"reveal_supports":[]}}`}, nil
}
func TestDeepBenchmarkStagePrefixStopsBeforeOriginalReviewResult(t *testing.T) {
	raw, root, fixture := deepStageSyntheticSource(t, nil)
	source, err := decodeDeepStageSource(raw, root, fixture)
	must(t, err)
	m := &deepStagePrefixModel{source: source}
	for i, pair := range source.Pairs {
		got, err := m.Generate(context.Background(), pair.Request)
		if i < 6 && (err != nil || !reflect.DeepEqual(got, pair.Result)) {
			t.Fatalf("prefix %d changed: %v", i, err)
		}
		if i == 6 && (err == nil || got.Text != "") {
			t.Fatal("captured review must stop without replaying its original result")
		}
	}
	if m.replayed != 6 || len(m.requests) != 7 || m.err != nil {
		t.Fatal("capture counts differ")
	}
	if _, err := m.Generate(context.Background(), source.Pairs[6].Request); err == nil {
		t.Fatal("extra request accepted")
	}
	m = &deepStagePrefixModel{source: source}
	changed := source.Pairs[0].Request
	changed.Messages = append([]model.Message(nil), changed.Messages...)
	changed.Messages[1].Content = `{"changed":true}`
	if _, err := m.Generate(context.Background(), changed); err == nil || m.replayed != 0 {
		t.Fatal("changed prefix replayed")
	}
}
func TestDeepBenchmarkStagePairIsFixedOldThenNewWithoutSelection(t *testing.T) {
	old := model.Request{Model: "m", MaxOutputTokens: 8192, ContextTokenLimit: 65536, Schema: json.RawMessage(`{"type":"object"}`), Messages: []model.Message{{Role: "system", Content: "old"}, {Role: "user", Content: `{"candidate":"fixed"}`}}}
	current := old
	current.Messages = append([]model.Message(nil), old.Messages...)
	current.Messages[0].Content = "new"
	for _, tc := range []struct {
		name    string
		failAt  int
		invalid bool
		calls   int
		wantErr bool
	}{{"rejected", 0, false, 2, false}, {"invalid_content", 0, true, 2, false}, {"transport_first", 1, false, 1, true}, {"transport_second", 2, false, 2, true}} {
		t.Run(tc.name, func(t *testing.T) {
			m := &deepStagePairControl{failAt: tc.failAt, invalid: tc.invalid}
			events := []string{}
			out, err := runDeepStagePair(context.Background(), m, old, current, func(kind string, _ any) error { events = append(events, kind); return nil })
			if (err != nil) != tc.wantErr || len(m.requests) != tc.calls || len(out) != tc.calls || len(events) != tc.calls*2 {
				t.Fatalf("calls/evidence/error differ: %d/%d/%v/%v", len(m.requests), len(out), events, err)
			}
			for i, r := range m.requests {
				expected := old
				if i == 1 {
					expected = current
				}
				if !reflect.DeepEqual(r, expected) {
					t.Fatal("order/request changed")
				}
			}
		})
	}
	changed := current
	changed.MaxOutputTokens = 4096
	m := &deepStagePairControl{}
	if _, err := runDeepStagePair(context.Background(), m, old, changed, func(string, any) error { return nil }); err == nil || len(m.requests) != 0 {
		t.Fatal("invalid comparison consumed a model call")
	}
}

func TestDeepBenchmarkStageAuditRejectsExtraStageAndRead(t *testing.T) {
	raw, root, fixture := deepStageSyntheticSource(t, nil)
	source, err := decodeDeepStageSource(raw, root, fixture)
	must(t, err)
	audit := &deepStageReplayAudit{source: source}
	for i, pair := range source.Pairs {
		raw, err := proto.Marshal(&pb.ModelCallRequest{NarrativeStage: pair.Stage})
		must(t, err)
		must(t, audit.RecordModel(context.Background(), source.Context, i+1, raw))
	}
	raw, err = proto.Marshal(&pb.ModelCallRequest{NarrativeStage: "revise"})
	must(t, err)
	if audit.RecordModel(context.Background(), source.Context, 8, raw) == nil {
		t.Fatal("extra revise accepted")
	}
	audit = &deepStageReplayAudit{source: source}
	if audit.RecordModel(context.Background(), source.Context, 1, raw) == nil {
		t.Fatal("wrong first stage accepted")
	}
	if _, err := audit.Read(context.Background(), ReadRequest{}); err == nil || audit.reads != 1 {
		t.Fatal("unrecorded historical read accepted")
	}
}

type deepStageReplayAudit struct {
	source *deepStageSource
	stages []string
	reads  int
}

func (a *deepStageReplayAudit) Read(context.Context, ReadRequest) (ReadReply, error) {
	a.reads++
	return ReadReply{}, fmt.Errorf("fixed source prefix has no read request")
}
func (a *deepStageReplayAudit) RecordModel(_ context.Context, _ Context, sequence int, raw []byte) error {
	var call pb.ModelCallRequest
	if err := proto.Unmarshal(raw, &call); err != nil {
		return err
	}
	index := len(a.stages)
	if sequence != index+1 || index >= 7 || call.NarrativeStage != a.source.Pairs[index].Stage {
		return fmt.Errorf("runtime stage order differs from fixed source")
	}
	a.stages = append(a.stages, call.NarrativeStage)
	return nil
}

type deepStageCapture struct {
	Requests    []model.Request `json:"requests"`
	Stages      []string        `json:"stages"`
	Replayed    int             `json:"original_results_replayed"`
	Termination string          `json:"intentional_termination"`
}

func captureDeepStageReview(ctx context.Context, algorithm *Algorithm, source *deepStageSource) (deepStageCapture, error) {
	prefix := &deepStagePrefixModel{source: source}
	audit := &deepStageReplayAudit{source: source}
	a := *algorithm
	a.Model = prefix
	a.ModelName = source.Pairs[0].Request.Model
	a.MaxModelCalls = 12
	a.ModelContextTokens = 65536
	a.MaxOutputTokens = 8192
	a.ModelByteTokenBoundVerified = true
	result, err := a.GenerateWithReads(ctx, source.Context, "fixed-stage-capture-"+fmt.Sprint(time.Now().UnixNano()), audit)
	capture := deepStageCapture{Requests: prefix.requests, Stages: audit.stages, Replayed: prefix.replayed}
	if err != nil {
		capture.Termination = err.Error()
	}
	if prefix.err != nil {
		return capture, prefix.err
	}
	if err == nil || result.Review != nil || len(prefix.requests) != 7 || prefix.replayed != 6 || len(audit.stages) != 7 || audit.reads != 0 {
		return capture, fmt.Errorf("runtime failed to stop at exact first review: calls=%d replays=%d stages=%v reads=%d termination=%v", len(prefix.requests), prefix.replayed, audit.stages, audit.reads, err)
	}
	return capture, nil
}

func deepStageReadSource(t *testing.T, dir string) (*deepStageSource, []byte, []byte, []byte) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "events.jsonl"))
	must(t, err)
	root, err := os.ReadFile(filepath.Join(dir, "root.sha256"))
	must(t, err)
	fixture, err := os.ReadFile(filepath.Join(dir, "fixture.json"))
	must(t, err)
	source, err := decodeDeepStageSource(raw, strings.TrimSpace(string(root)), fixture)
	must(t, err)
	return source, raw, root, fixture
}
func TestDeepBenchmarkStageReplaySourcePreflight(t *testing.T) {
	dir := os.Getenv("ELSELIFE_STAGE_REPLAY_SOURCE")
	if dir == "" {
		t.Skip("explicit sealed stage source required; no model invocation")
	}
	source, _, _, _ := deepStageReadSource(t, dir)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	capture, err := captureDeepStageReview(ctx, &Algorithm{Link: link}, source)
	must(t, err)
	t.Logf("source=%s first_review_seq=154 original_results_replayed=%d captured_stages=%v current_engine=%s system_changed=%v live_model_calls=0", source.Root, capture.Replayed, capture.Stages, narrativeEngineVersion, source.Pairs[6].Request.Messages[0].Content != capture.Requests[6].Messages[0].Content)
}

// Pre-registered old -> new review only. Both calls use the same current CLI.
// The six replayed stage results never reach a provider; no Service or DB exists.
func TestDeepBenchmarkStageReplayLive(t *testing.T) {
	dir, sourceDir := os.Getenv("ELSELIFE_STAGE_REPLAY_DIR"), os.Getenv("ELSELIFE_STAGE_REPLAY_SOURCE")
	if dir == "" || sourceDir == "" {
		t.Skip("explicit paired-review experiment required")
	}
	if os.Getenv("ELSELIFE_TEST_RUST_RUNTIME") == "" || len(os.Getenv("ELSELIFE_STAGE_REPLAY_SOURCE_SHA256")) != 64 {
		t.Fatal("explicit frozen runtime and source manifest SHA required")
	}
	source, raw, root, fixture := deepStageReadSource(t, sourceDir)
	if source.Root != "d9d249b6ac607519a3e4342d2d7903cc1057615cbc791cab29039db0a7a88f58" || source.EventsSHA != "aac912428579801a96227cafedf0fb3a487d5de59c5e727903e669dbf20d535a" {
		t.Fatal("live experiment requires the registered original FUN-001/07 failure bytes")
	}
	// The freezing launcher owns its parent; the evaluator owns this new child.
	must(t, os.Mkdir(dir, 0700))
	file, err := os.OpenFile(filepath.Join(dir, "events.jsonl"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	must(t, err)
	defer file.Close()
	evidence := &deepEvidence{file: file, step: "FUN-001-07-first-review-pair"}
	status := "BLOCKED"
	defer func() {
		if err := evidence.append("run_end", map[string]any{"status": status}); err != nil {
			t.Error(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "root.sha256"), []byte(evidence.previous+"\n"), 0600); err != nil {
			t.Error(err)
		}
	}()
	must(t, os.WriteFile(filepath.Join(dir, "source-events.jsonl"), raw, 0600))
	must(t, os.WriteFile(filepath.Join(dir, "source-root.sha256"), root, 0600))
	must(t, os.WriteFile(filepath.Join(dir, "source-fixture.json"), fixture, 0600))
	pinnedRuntime := filepath.Join(dir, "algorithm-runtime")
	runtimeSHA, err := copyActualRuntimeBinary(os.Getenv("ELSELIFE_TEST_RUST_RUNTIME"), pinnedRuntime)
	must(t, err)
	if declared := os.Getenv("ELSELIFE_STAGE_REPLAY_RUNTIME_SHA256"); declared != "" && declared != runtimeSHA {
		t.Fatal("frozen runtime SHA differs")
	}
	t.Setenv("ELSELIFE_TEST_RUST_RUNTIME", pinnedRuntime)
	must(t, evidence.append("manifest", map[string]any{"kind": "fixed_prefix_paired_first_review", "source": source, "current_engine": narrativeEngineVersion, "current_source_tree_sha256": os.Getenv("ELSELIFE_STAGE_REPLAY_SOURCE_SHA256"), "runtime_sha256": runtimeSHA, "runtime_provenance": "Exact stream-copied binary; build/source binding is recorded by the parent freezing launcher.", "order": []string{"old", "new"}, "model_calls_authorized": 2, "retry": false, "comparison": "Only product system prompt may differ; same current CLI, original user/schema/model/output and context budget.", "boundary": "One fixed old-to-new pair with stochastic model outputs; no Service, DB, world commit, revise, expected answer or automatic semantic/literary PASS.", "context_token_limit": 65536, "context_limit_reason": "Original capacity; nonserialized Request.ContextTokenLimit restored explicitly."}))
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	capture, err := captureDeepStageReview(ctx, &Algorithm{Link: link}, source)
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	must(t, evidence.append("prefix_capture", map[string]any{"capture": capture, "error": errText, "live_model_calls": 0}))
	must(t, err)
	old, current := source.Pairs[6].Request, capture.Requests[6]
	must(t, sameDeepStageRequest(current, old))
	for _, item := range []struct{ name, content string }{{"old", old.Messages[0].Content}, {"new", current.Messages[0].Content}} {
		must(t, os.WriteFile(filepath.Join(dir, item.name+"-system.txt"), []byte(item.content), 0600))
	}
	must(t, evidence.append("paired_requests", map[string]any{"old": old, "new": current, "old_system_sha256": fmt.Sprintf("%x", sha256.Sum256([]byte(old.Messages[0].Content))), "new_system_sha256": fmt.Sprintf("%x", sha256.Sum256([]byte(current.Messages[0].Content))), "non_system_fields_equal": true}))
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), old.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	outcomes, pairErr := runDeepStagePair(ctx, cli, old, current, evidence.append)
	for _, outcome := range outcomes {
		check := checkDeepQuoteReview(source.Candidate, source.CandidateRaw, outcome.Result)
		must(t, evidence.append("review_check", map[string]any{"variant": outcome.Variant, "check": check}))
		t.Logf("variant=%s error=%q parse=%q approved=%v quote_mismatches=%d verification=%q", outcome.Variant, outcome.Error, check.ParseError, check.Approved, len(check.QuoteMismatches), check.VerificationError)
	}
	if pairErr != nil {
		t.Fatalf("paired experiment stopped without retry: %v", pairErr)
	}
	status = "COMPLETED_REVIEW_PAIR"
}
