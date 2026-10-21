//go:build integration && codexlive

package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

type deepEditorialCounter struct {
	model.Generator
	calls int
}

func (m *deepEditorialCounter) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	m.calls++
	return m.Generator.Generate(ctx, request)
}

// Evaluation-only binding: polish creates a candidate, never a formal page.
func runDeepEditorial(ctx context.Context, s *Service, account string, before View, step deepStep, interpreter *FeedbackInterpreter, evidence *deepEvidence) (View, State, error) {
	if step.Mode != "editorial_request" || evidence == nil {
		return before, EmptyState(), fmt.Errorf("invalid editorial adapter call")
	}
	frozen, err := s.Get(ctx, account, before.ID, before.BranchID)
	if err != nil {
		return before, EmptyState(), err
	}
	if frozen.Revision < 1 || len(frozen.Pages) != int(frozen.Revision) || !reflect.DeepEqual(frozen, before) {
		return frozen, EmptyState(), fmt.Errorf("editorial source view changed before request")
	}
	state, err := deepSnapshot(ctx, s, account, frozen)
	if err != nil {
		return frozen, state, err
	}
	preferences, err := s.PreferenceSnapshots(ctx, account)
	if err != nil {
		return frozen, state, err
	}
	original := frozen.Pages[len(frozen.Pages)-1]
	request := AssistRequest{RequestID: "benchmark-editorial-" + step.ID, BranchID: frozen.BranchID, ExpectedRevision: frozen.Revision, Kind: "polish", Request: step.Input}
	if err := evidence.append("editorial_request", map[string]any{"step": step, "request": request, "before": state, "public_view": frozen, "original_page": original, "before_preferences": preferences}); err != nil {
		return frozen, state, err
	}
	counted := &deepEditorialCounter{}
	if interpreter != nil {
		copy := *interpreter
		if interpreter.Model != nil {
			counted.Generator = interpreter.Model
			copy.Model = counted
		}
		interpreter = &copy
	}
	started := time.Now()
	result, assistErr := s.Assist(ctx, account, frozen.ID, request, interpreter)
	// Failure or cancellation still gets an independent, bounded readback.
	auditContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	after, readbackErr := s.Get(auditContext, account, frozen.ID, frozen.BranchID)
	afterState := EmptyState()
	var afterPreferences []PreferenceSnapshot
	if readbackErr == nil {
		afterState, readbackErr = deepSnapshot(auditContext, s, account, after)
	}
	if readbackErr == nil {
		afterPreferences, readbackErr = s.PreferenceSnapshots(auditContext, account)
	}
	readOnly := readbackErr == nil && reflect.DeepEqual(frozen, after) && reflect.DeepEqual(state, afterState) && reflect.DeepEqual(preferences, afterPreferences)
	finalErr := assistErr
	if readbackErr != nil {
		finalErr = fmt.Errorf("editorial assist: %v; independent readback: %w", assistErr, readbackErr)
	} else if !readOnly {
		finalErr = fmt.Errorf("formal state or preferences changed during editorial request; assist: %v", assistErr)
	} else if finalErr == nil && (result.Kind != "polish" || result.BranchID != request.BranchID || result.BaseRevision != request.ExpectedRevision || !textOK(result.Text) || result.Proposal != nil) {
		finalErr = fmt.Errorf("editorial candidate is not bound to the requested original page")
	}
	errText := ""
	if finalErr != nil {
		errText = finalErr.Error()
	}
	if err := evidence.append("editorial_result", map[string]any{"result": result, "snapshot": afterState, "public_view": after, "original_page": original, "after_preferences": afterPreferences, "model_calls": counted.calls, "elapsed_ms": time.Since(started).Milliseconds(), "applied": false, "read_only_verified": readOnly, "error": errText}); err != nil {
		return after, afterState, err
	}
	return after, afterState, finalErr
}

func deepEditorialFixture(t *testing.T) (*Service, View, deepStep) {
	t.Helper()
	s, _, _ := testService(t)
	raw, err := os.ReadFile("testdata/deep_benchmark/NAR-014.json")
	must(t, err)
	var fixture deepFixture
	must(t, StrictJSON(raw, &fixture))
	// Synthetic formal prefix proves adapter boundaries, not model prose quality.
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: fixture.Seed, Text: fixture.Opening}, StoryTime: fixture.State.StoryTime, Suggestions: []string{}, Outcome: "continues", CreatedAt: time.Now().UTC(), Reader: ProjectReader(fixture.State, 1)}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "read", Text: "何絮把订单拢在手边，向童澈点了点头。"}, StoryTime: fixture.State.StoryTime, Suggestions: []string{}, Outcome: "continues", CreatedAt: time.Now().UTC(), Reader: ProjectReader(fixture.State, 2)}
	view, err := seedDeepFixture(context.Background(), s, fixture, "editorial-regression", &deepReplay{Pages: []deepReplayPage{{Page: p1, State: fixture.State}, {Page: p2, State: fixture.State}}})
	must(t, err)
	preference := "以后保留适量人物幽默"
	_, err = s.ChangePreference(context.Background(), "editorial-regression", PreferenceChange{Dimension: "表达", Value: &preference, Expression: preference, Confirmation: "direct_expression"})
	must(t, err)
	for _, step := range fixture.Steps {
		if step.ID == "S06" {
			return s, view, step
		}
	}
	t.Fatal("missing editorial fixture step")
	return nil, View{}, deepStep{}
}

func deepEditorialEvidence(t *testing.T) (*deepEvidence, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "events.jsonl")
	file, err := os.Create(path)
	must(t, err)
	t.Cleanup(func() { file.Close() })
	return &deepEvidence{file: file, step: "S06"}, path
}

func deepEditorialEvents(t *testing.T, path string) []struct {
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data"`
} {
	t.Helper()
	raw, err := os.ReadFile(path)
	must(t, err)
	var events []struct {
		Kind string          `json:"kind"`
		Data json.RawMessage `json:"data"`
	}
	for _, line := range bytes.Split(bytes.TrimSpace(raw), []byte("\n")) {
		var event struct {
			Kind string          `json:"kind"`
			Data json.RawMessage `json:"data"`
		}
		must(t, json.Unmarshal(line, &event))
		events = append(events, event)
	}
	return events
}

func TestDeepBenchmarkEditorialPreservesFormalHistoryAndPreferences(t *testing.T) {
	s, view, step := deepEditorialFixture(t)
	ctx := context.Background()
	beforeArchive, err := s.ExportArchive(ctx, "editorial-regression")
	must(t, err)
	beforeState, err := deepSnapshot(ctx, s, "editorial-regression", view)
	must(t, err)
	beforePreferences, err := s.PreferenceSnapshots(ctx, "editorial-regression")
	must(t, err)
	evidence, path := deepEditorialEvidence(t)
	fixtureModel := &newtestsFeedbackModel{text: `{"text":"合成润色候选：何絮拢好订单，朝童澈点头。"}`}
	measured := &deepMeasuredModel{Generator: fixtureModel, evidence: evidence}
	after, snapshot, err := runDeepEditorial(ctx, s, "editorial-regression", view, step, newtestsInterpreter(measured), evidence)
	must(t, err)
	afterArchive, err := s.ExportArchive(ctx, "editorial-regression")
	must(t, err)
	afterPreferences, err := s.PreferenceSnapshots(ctx, "editorial-regression")
	must(t, err)
	if !reflect.DeepEqual(beforeArchive, afterArchive) || !reflect.DeepEqual(view, after) || !reflect.DeepEqual(beforeState, snapshot) || !reflect.DeepEqual(beforePreferences, afterPreferences) {
		t.Fatal("editorial candidate changed formal history, branches, state or confirmed preference")
	}
	if measured.calls != 1 || fixtureModel.calls != 1 {
		t.Fatalf("model calls=%d/%d", measured.calls, fixtureModel.calls)
	}
	var input map[string]string
	must(t, json.Unmarshal([]byte(fixtureModel.requests[0].Messages[1].Content), &input))
	if !reflect.DeepEqual(input, map[string]string{"original": view.Pages[len(view.Pages)-1].Text, "request": step.Input}) {
		t.Fatalf("editorial model input changed original/request or added evaluator material: %+v", input)
	}
	if strings.Contains(fixtureModel.requests[0].Messages[1].Content, "长期合同") {
		t.Fatal("editorial request received hidden state")
	}
	events := deepEditorialEvents(t, path)
	kinds := []string{}
	for _, e := range events {
		kinds = append(kinds, e.Kind)
	}
	if !reflect.DeepEqual(kinds, []string{"editorial_request", "model_request", "model_result", "editorial_result"}) {
		t.Fatalf("editorial evidence does not enclose actual model call: %v", kinds)
	}
	var request struct {
		Request     AssistRequest        `json:"request"`
		Original    Page                 `json:"original_page"`
		Preferences []PreferenceSnapshot `json:"before_preferences"`
	}
	must(t, json.Unmarshal(events[0].Data, &request))
	if request.Request.Kind != "polish" || request.Request.Request != step.Input || request.Request.ExpectedRevision != view.Revision || !reflect.DeepEqual(request.Original, view.Pages[len(view.Pages)-1]) || !reflect.DeepEqual(request.Preferences, beforePreferences) {
		t.Fatal("request evidence lost source scope, original page or confirmed preference snapshot")
	}
	var result struct {
		Result      AssistResult         `json:"result"`
		Applied     bool                 `json:"applied"`
		ReadOnly    bool                 `json:"read_only_verified"`
		Calls       int                  `json:"model_calls"`
		Error       string               `json:"error"`
		Preferences []PreferenceSnapshot `json:"after_preferences"`
	}
	must(t, json.Unmarshal(events[len(events)-1].Data, &result))
	if result.Applied || !result.ReadOnly || result.Calls != 1 || result.Error != "" || result.Result.Text == "" || result.Result.BaseRevision != view.Revision || !reflect.DeepEqual(result.Preferences, beforePreferences) {
		t.Fatalf("candidate read-only evidence is incomplete: %+v", result)
	}
}

func TestDeepBenchmarkEditorialRetainsModelFailuresWithoutApplying(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		err        error
	}{
		{name: "model-failure", err: fmt.Errorf("synthetic model failure")},
		{name: "invalid-candidate", text: `{"text":"","unexpected":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, view, step := deepEditorialFixture(t)
			evidence, path := deepEditorialEvidence(t)
			m := &deepMeasuredModel{Generator: &newtestsFeedbackModel{text: tc.text, err: tc.err}, evidence: evidence}
			after, _, err := runDeepEditorial(context.Background(), s, "editorial-regression", view, step, newtestsInterpreter(m), evidence)
			if err == nil || !reflect.DeepEqual(after, view) {
				t.Fatalf("failure missing or changed formal view: %v", err)
			}
			events := deepEditorialEvents(t, path)
			var result struct {
				Error    string `json:"error"`
				Applied  bool   `json:"applied"`
				ReadOnly bool   `json:"read_only_verified"`
				Calls    int    `json:"model_calls"`
			}
			must(t, json.Unmarshal(events[len(events)-1].Data, &result))
			if events[len(events)-1].Kind != "editorial_result" || result.Error == "" || result.Applied || !result.ReadOnly || result.Calls != 1 {
				t.Fatalf("failed candidate not faithfully recorded: %+v", result)
			}
		})
	}
}

type deepEditorialHookModel struct {
	newtestsFeedbackModel
	hook func()
}

func (m *deepEditorialHookModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	m.hook()
	return m.newtestsFeedbackModel.Generate(ctx, request)
}

func TestDeepBenchmarkEditorialDetectsConcurrentFormalChange(t *testing.T) {
	s, view, step := deepEditorialFixture(t)
	evidence, path := deepEditorialEvidence(t)
	m := &deepEditorialHookModel{newtestsFeedbackModel: newtestsFeedbackModel{text: `{"text":"已经过期的合成候选。"}`}, hook: func() { advance(t, s, "editorial-regression", view, "concurrent-advance", "read") }}
	measured := &deepMeasuredModel{Generator: m, evidence: evidence}
	after, _, err := runDeepEditorial(context.Background(), s, "editorial-regression", view, step, newtestsInterpreter(measured), evidence)
	if err == nil || after.Revision != view.Revision+1 {
		t.Fatalf("stale candidate or state drift undetected: %v", err)
	}
	events := deepEditorialEvents(t, path)
	var result struct {
		Error    string       `json:"error"`
		ReadOnly bool         `json:"read_only_verified"`
		Result   AssistResult `json:"result"`
		Applied  bool         `json:"applied"`
	}
	must(t, json.Unmarshal(events[len(events)-1].Data, &result))
	if result.Error == "" || result.ReadOnly || result.Applied || result.Result.Text != "" {
		t.Fatalf("concurrent change misreported as read-only accepted edit: %+v", result)
	}
}
