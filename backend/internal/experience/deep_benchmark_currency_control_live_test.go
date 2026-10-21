//go:build integration && codexlive

package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
)

const deepCurrencyStepInput = "正控制：在另一新世界正式定义两种币及3比1固定汇率，再提出换算。"
const deepCurrencyInput = "按这里的固定汇率，2枚岚币可以兑换多少枚贝币？"
const deepCurrencyRule = "本世界使用贝币和岚币，固定汇率为3枚贝币兑换1枚岚币。"

type deepCurrencySource struct {
	Root, EventsSHA, FixtureSHA, SourceTreeSHA string
	Fixture                                    deepFixture
	Replay                                     *deepReplay
}

type deepCurrencyScope struct {
	Role         string `json:"role"`
	Account      string `json:"account"`
	ExperienceID string `json:"experience_id"`
	BranchID     string `json:"branch_id"`
}

type deepCurrencyReadback struct {
	Scope       deepCurrencyScope    `json:"scope"`
	History     deepRestoredReadback `json:"history"`
	Preferences []PreferenceSnapshot `json:"preferences"`
	Error       string               `json:"error,omitempty"`
}

type deepCurrencyResult struct {
	Readback   deepCurrencyReadback `json:"readback"`
	Operation  Operation            `json:"operation"`
	ModelCalls int                  `json:"model_calls"`
	ElapsedMS  int64                `json:"elapsed_ms"`
	Error      string               `json:"error"`
}

func deepCurrencyFixture() deepFixture {
	state := EmptyState()
	state.StoryTime = "商港开市时"
	state.Entities = []Entity{
		{ID: "shell-currency", Kind: "currency", Name: "贝币", Description: "商港使用的货币", Known: true, RelatedIDs: []string{}},
		{ID: "mist-currency", Kind: "currency", Name: "岚币", Description: "商港使用的货币", Known: true, RelatedIDs: []string{}},
	}
	state.Facts = []Fact{{ID: "fixed-currency-rate", Kind: "rule", Text: deepCurrencyRule, Known: true, KnownBy: []string{}, SourceRevision: 1}}
	return deepFixture{ID: "SYS-014-S05-currency-control", Variant: "supplement", Seed: "商港使用贝币和岚币。", Opening: deepCurrencyRule, State: state, Steps: []deepStep{{ID: "currency-ask", Mode: "ask", Input: deepCurrencyInput}}, PrivateTokens: []string{}, Omissions: []string{"Evaluator-authored synthetic formal prehistory. No cash balance, exchange transaction or expected answer is initialized."}}
}

func decodeDeepCurrencySource(raw []byte, root string, fixtureRaw, buildManifest, registeredFixture []byte) (*deepCurrencySource, error) {
	if !bytes.Equal(fixtureRaw, registeredFixture) {
		return nil, fmt.Errorf("currency source fixture bytes differ from registered original")
	}
	var f deepFixture
	if StrictJSON(fixtureRaw, &f) != nil || f.ID != "SYS-014" || len(f.Steps) != 5 || f.Steps[4].ID != "S05" || f.Steps[4].Mode != "harness" || f.Steps[4].Input != deepCurrencyStepInput {
		return nil, fmt.Errorf("currency source is not original SYS-014/S05")
	}
	replay, err := decodeDeepReplay(raw, root, f)
	if err != nil {
		return nil, err
	}
	source := &deepCurrencySource{Root: root, EventsSHA: fmt.Sprintf("%x", sha256.Sum256(raw)), FixtureSHA: fmt.Sprintf("%x", sha256.Sum256(fixtureRaw)), SourceTreeSHA: fmt.Sprintf("%x", sha256.Sum256(bytes.TrimSuffix(buildManifest, []byte{'\n'}))), Fixture: f, Replay: replay}
	var manifestFiles map[string]string
	if StrictJSON(buildManifest, &manifestFiles) != nil || manifestFiles["backend/internal/experience/testdata/deep_benchmark/SYS-014.json"] != source.FixtureSHA {
		return nil, fmt.Errorf("currency source build manifest does not pin fixture")
	}
	requests, results := map[int]bool{}, map[int]bool{}
	blocked := 0
	for i, line := range bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'}) {
		var event struct {
			Kind string          `json:"kind"`
			Step string          `json:"step"`
			Data json.RawMessage `json:"data"`
		}
		if !uniqueJSON(line) || json.Unmarshal(line, &event) != nil {
			return nil, fmt.Errorf("ambiguous currency source event")
		}
		if i == 0 {
			var manifest struct {
				FixtureSHA string `json:"fixture_sha256"`
				SourceTree string `json:"source_tree_sha256"`
				Engine     string `json:"engine"`
				Model      string `json:"model"`
			}
			if json.Unmarshal(event.Data, &manifest) != nil || manifest.FixtureSHA != source.FixtureSHA || manifest.SourceTree != source.SourceTreeSHA || manifest.Engine == "" || manifest.Model == "" {
				return nil, fmt.Errorf("currency source manifest differs")
			}
		}
		if event.Step == "S05" && event.Kind == "operation_request" {
			return nil, fmt.Errorf("currency source already executed S05")
		}
		if event.Kind == "blocked_step" && event.Step == "S05" {
			var value struct {
				Step deepStep `json:"step"`
			}
			if json.Unmarshal(event.Data, &value) != nil || !reflect.DeepEqual(value.Step, f.Steps[4]) {
				return nil, fmt.Errorf("currency source changed original blocked step")
			}
			blocked++
		}
		if event.Kind == "model_request" || event.Kind == "model_result" {
			var call struct {
				Call int `json:"call"`
			}
			if json.Unmarshal(event.Data, &call) != nil || call.Call < 1 {
				return nil, fmt.Errorf("currency source has invalid model call")
			}
			if event.Kind == "model_request" {
				if requests[call.Call] {
					return nil, fmt.Errorf("duplicate source model request")
				}
				requests[call.Call] = true
			} else {
				if !requests[call.Call] || results[call.Call] {
					return nil, fmt.Errorf("source model result is not paired")
				}
				results[call.Call] = true
			}
		}
		if event.Kind == "run_end" {
			var end struct {
				Status string `json:"status"`
			}
			if json.Unmarshal(event.Data, &end) != nil || (end.Status != "REVIEW" && end.Status != "FAIL") {
				return nil, fmt.Errorf("invalid source terminal status")
			}
		}
	}
	if blocked != 1 || len(requests) != len(results) {
		return nil, fmt.Errorf("source missing original blocked step or complete calls")
	}
	return source, nil
}

func runDeepCurrencyControl(ctx context.Context, original, control *Service, originalAccount, controlAccount string, originalView, initial View, source *deepCurrencySource, measured *deepMeasuredModel, evidence *deepEvidence) (deepCurrencyResult, error) {
	var result deepCurrencyResult
	algorithm, ok := control.Generator.(*Algorithm)
	if !ok || !control.NarrativeEngine || algorithm.Model != measured || evidence == nil || measured == nil || source == nil || source.Replay == nil || original.DB == control.DB || originalAccount == controlAccount {
		return result, fmt.Errorf("currency control requires distinct scopes and real narrative Algorithm")
	}
	read := func(readCtx context.Context, s *Service, role, account string, scope View, replay *deepReplay) (deepCurrencyReadback, error) {
		value := deepCurrencyReadback{Scope: deepCurrencyScope{role, account, scope.ID, scope.BranchID}}
		var err error
		if replay != nil {
			value.History, err = readDeepRestored(readCtx, s, account, scope, replay)
		} else {
			value.History, err = readDeepControlHistory(readCtx, s, account, scope)
		}
		if err == nil {
			value.Preferences, err = s.PreferenceSnapshots(readCtx, account)
		}
		if err != nil {
			value.Error = err.Error()
		}
		return value, err
	}
	originalBefore, err := read(ctx, original, "original-restored", originalAccount, originalView, source.Replay)
	if err != nil {
		return result, err
	}
	if err = evidence.append("original_readback_before", originalBefore); err != nil {
		return result, err
	}
	before, err := read(ctx, control, "currency-positive-control", controlAccount, initial, nil)
	if err != nil {
		return result, err
	}
	if err = evidence.append("currency_initial_readback", before); err != nil {
		return result, err
	}
	f := deepCurrencyFixture()
	if !reflect.DeepEqual(before.History.View, initial) || initial.Revision != 1 || len(initial.Pages) != 1 || initial.Seed != f.Seed || initial.Pages[0].Input != f.Seed || initial.Pages[0].Text != f.Opening || len(before.History.Snapshots) != 1 || !reflect.DeepEqual(before.History.Snapshots[0].State, f.State) {
		return result, fmt.Errorf("currency initial formal premise differs from preregistration")
	}
	request := AdvanceRequest{RequestID: "currency-positive-control-ask", BranchID: initial.BranchID, ExpectedRevision: 1, Mode: "ask", Input: deepCurrencyInput}
	if err = evidence.append("currency_operation_request", map[string]any{"request": request, "before": f.State, "scope": before.Scope}); err != nil {
		return result, err
	}
	started, calls := time.Now(), measured.calls
	_, fresh, operationErr := control.Advance(ctx, controlAccount, initial.ID, request)
	if operationErr == nil && !fresh {
		operationErr = fmt.Errorf("currency request was not fresh")
	}
	if operationErr == nil {
		operationErr = control.GenerateAccepted(ctx, controlAccount, request.RequestID)
	}
	audit, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	result.Readback, err = read(audit, control, "currency-positive-control", controlAccount, initial, nil)
	operation, lookupErr := control.GetOperation(audit, controlAccount, initial.ID, request.RequestID)
	result.Operation, result.ModelCalls, result.ElapsedMS = operation, measured.calls-calls, time.Since(started).Milliseconds()
	finalErr := errors.Join(operationErr, err, lookupErr)
	after := result.Readback.History
	if finalErr == nil && (operation.Status != "committed" || operation.CommittedRevision == nil || *operation.CommittedRevision != 2 || after.View.Revision != 2 || len(after.View.Pages) != 2 || len(after.Snapshots) != 2) {
		finalErr = fmt.Errorf("currency ask did not produce one formal answer")
	}
	if finalErr == nil && (!reflect.DeepEqual(after.View.Pages[0], initial.Pages[0]) || after.View.Pages[1].Mode != "ask" || after.View.Pages[1].Input != deepCurrencyInput || !textOK(after.View.Pages[1].Text) || !reflect.DeepEqual(after.Snapshots[0].State, f.State) || !reflect.DeepEqual(after.Snapshots[1].State, f.State) || !reflect.DeepEqual(before.Preferences, result.Readback.Preferences)) {
		finalErr = fmt.Errorf("currency ask changed initial page, state, preferences or registered input")
	}
	originalAfter, originalErr := read(audit, original, "original-restored", originalAccount, originalView, source.Replay)
	if originalErr == nil && !reflect.DeepEqual(originalBefore, originalAfter) {
		originalErr = fmt.Errorf("original world changed during separate currency ask")
	}
	finalErr = errors.Join(finalErr, originalErr)
	kind := "currency_operation_committed"
	if finalErr != nil {
		kind = "currency_operation_failure"
		result.Error = finalErr.Error()
	}
	writeErr := evidence.append(kind, result)
	readbackWriteErr := evidence.append("original_readback_after", originalAfter)
	return result, errors.Join(finalErr, writeErr, readbackWriteErr)
}

// Synthetic complete source exercises provenance checks, never H3 arithmetic.
func deepCurrencySyntheticSource(t *testing.T) ([]byte, string, []byte, []byte, deepFixture) {
	t.Helper()
	fixtureRaw, err := os.ReadFile("testdata/deep_benchmark/SYS-014.json")
	must(t, err)
	var f deepFixture
	must(t, StrictJSON(fixtureRaw, &f))
	build := narrativeJSON(map[string]string{"backend/internal/experience/testdata/deep_benchmark/SYS-014.json": fmt.Sprintf("%x", sha256.Sum256(fixtureRaw))})
	file, err := os.Create(filepath.Join(t.TempDir(), "events.jsonl"))
	must(t, err)
	defer file.Close()
	e := &deepEvidence{file: file}
	must(t, e.append("manifest", map[string]any{"fixture": f, "fixture_sha256": fmt.Sprintf("%x", sha256.Sum256(fixtureRaw)), "source_tree_sha256": fmt.Sprintf("%x", sha256.Sum256(build)), "engine": "narrative-engine.v4.4", "model": "synthetic-source-only"}))
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, StoryTime: f.State.StoryTime, CreatedAt: time.Now().UTC(), Suggestions: []string{}, Outcome: "continues", Reader: ProjectReader(f.State, 1)}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: f.Steps[0].Input, Text: "合成结构测试回答，不作数值验收。"}, StoryTime: f.State.StoryTime, CreatedAt: time.Now().UTC(), Suggestions: []string{}, Outcome: "continues", Reader: ProjectReader(f.State, 2)}
	must(t, e.append("initial_readback", map[string]any{"snapshot": f.State, "public_view": View{Revision: 1, Title: "合成世界初始记录", Pages: []Page{p1}}}))
	e.step = "S01"
	must(t, e.append("operation_request", map[string]any{"request": AdvanceRequest{Mode: "ask", Input: f.Steps[0].Input, ExpectedRevision: 1}}))
	must(t, e.append("operation_committed", map[string]any{"snapshot": f.State, "public_view": View{Revision: 2, Title: "合成问答标题", Pages: []Page{p1, p2}}}))
	e.step = "S05"
	must(t, e.append("blocked_step", map[string]any{"step": f.Steps[4], "reason": "unimplemented control"}))
	must(t, e.append("run_end", map[string]any{"status": "REVIEW"}))
	raw, err := os.ReadFile(file.Name())
	must(t, err)
	return raw, e.previous, fixtureRaw, build, f
}

func TestDeepBenchmarkCurrencySourceIsBoundToSealedUnchangedFixture(t *testing.T) {
	raw, root, fraw, build, _ := deepCurrencySyntheticSource(t)
	source, err := decodeDeepCurrencySource(raw, root, fraw, build, fraw)
	must(t, err)
	if source.Root != root || len(source.Replay.Pages) != 2 {
		t.Fatal("source history not preserved")
	}
	for _, tc := range []struct {
		name              string
		raw               []byte
		root              string
		fixture, manifest []byte
	}{
		{"root", raw, strings.Repeat("0", 64), fraw, build},
		{"unsealed", raw[:len(raw)-1], root, fraw, build},
		{"changed_event", append([]byte(" "), raw...), root, fraw, build},
		{"fixture_bytes", raw, root, append(fraw, '\n'), build},
		{"source_manifest", raw, root, fraw, []byte("{}")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := decodeDeepCurrencySource(tc.raw, tc.root, tc.fixture, tc.manifest, fraw); err == nil {
				t.Fatal("changed source accepted")
			}
		})
	}
}

type deepCurrencyFixedModel struct {
	syntheticPipelineModel
	requests []model.Request
	fail     bool
	onFirst  func()
}

func (m *deepCurrencyFixedModel) Generate(ctx context.Context, req model.Request) (model.Result, error) {
	m.requests = append(m.requests, req)
	if len(m.requests) == 1 && m.onFirst != nil {
		m.onFirst()
	}
	if m.fail {
		return model.Result{}, fmt.Errorf("synthetic provider failure")
	}
	result, err := m.syntheticPipelineModel.Generate(ctx, req)
	if err == nil && m.stages[len(m.stages)-1] == "answer" {
		m.current.Passage = "这是合成回答，仅验证询问与状态隔离，不声称换算正确。"
		result.Text = string(narrativeJSON(map[string]any{"result": narrativeDraft{m.current.Title, m.current.Passage, m.current.StoryTime, m.current.Outcome, m.current.Suggestions}}))
	}
	return result, err
}

func TestDeepBenchmarkCurrencyActualRustIsolationAndFailureReadback(t *testing.T) {
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, name := range []string{"committed_ask_is_not_semantic_pass", "model_failure_retained", "initial_currency_drift_blocks_model", "original_old_snapshot_drift_detected"} {
		t.Run(name, func(t *testing.T) {
			raw, root, fraw, build, f := deepCurrencySyntheticSource(t)
			// Use the existing replay parser so helper red controls reach the helper.
			replay, err := decodeDeepReplay(raw, root, f)
			must(t, err)
			source := &deepCurrencySource{Root: root, Fixture: f, Replay: replay, EventsSHA: fmt.Sprintf("%x", sha256.Sum256(raw)), FixtureSHA: fmt.Sprintf("%x", sha256.Sum256(fraw)), SourceTreeSHA: fmt.Sprintf("%x", sha256.Sum256(build))}
			original, admin, originalDSN := testService(t)
			control, controlAdmin, controlDSN := testService(t)
			if originalDSN == controlDSN {
				t.Fatal("not separate isolated databases")
			}
			before, err := seedDeepFixture(ctx, original, f, "original-restored", replay)
			must(t, err)
			initial, err := seedDeepFixture(ctx, control, deepCurrencyFixture(), "currency-positive-control", nil)
			must(t, err)
			e, path := deepEditorialEvidence(t)
			e.step = "S05"
			m := &deepCurrencyFixedModel{fail: name == "model_failure_retained"}
			measured := &deepMeasuredModel{Generator: m, evidence: e}
			control.NarrativeEngine = true
			control.Generator = &Algorithm{Link: link, Model: measured, ModelName: "synthetic-currency-boundaries", Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			if name == "initial_currency_drift_blocks_model" {
				_, err = controlAdmin.ExecContext(ctx, `UPDATE experience_pages SET state=jsonb_set(state,'{story_time}','"changed"') WHERE revision=1`)
				must(t, err)
			}
			if name == "original_old_snapshot_drift_detected" {
				m.onFirst = func() {
					_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET state=jsonb_set(state,'{story_time}','"drift"') WHERE revision=1`)
					must(t, err)
				}
			}
			result, err := runDeepCurrencyControl(ctx, original, control, "original-restored", "currency-positive-control", before, initial, source, measured, e)
			if name == "committed_ask_is_not_semantic_pass" {
				must(t, err)
				if result.Operation.Status != "committed" || result.ModelCalls != 2 || len(m.requests) != 2 || result.Readback.History.View.Revision != 2 {
					t.Fatalf("unexpected actual ask result: %+v", result)
				}
				var input struct {
					Input string `json:"input"`
					State State  `json:"state"`
				}
				must(t, json.Unmarshal([]byte(m.requests[0].Messages[1].Content), &input))
				if input.Input != deepCurrencyInput || !reflect.DeepEqual(input.State, ReaderState(deepCurrencyFixture().State)) {
					t.Fatal("model received changed input or evaluator world")
				}
				if strings.Contains(m.requests[0].Messages[1].Content, "expected") || strings.Contains(m.requests[0].Messages[1].Content, "S05") {
					t.Fatal("evaluator metadata entered product input")
				}
			} else if err == nil {
				t.Fatal("failed control reported success")
			}
			if name == "initial_currency_drift_blocks_model" && measured.calls != 0 {
				t.Fatal("model called before initial premise readback")
			}
			if name == "model_failure_retained" && (result.Operation.Status != "failed" || result.ModelCalls != 1 || result.Error == "") {
				t.Fatalf("provider failure disappeared: %+v", result)
			}
			events := deepEditorialEvents(t, path)
			if name != "initial_currency_drift_blocks_model" && (len(events) == 0 || events[len(events)-1].Kind != "original_readback_after") {
				t.Fatal("missing independent original readback after operation")
			}
		})
	}
}

func deepCurrencyReadSource(t *testing.T, directory string) (*deepCurrencySource, map[string][]byte) {
	t.Helper()
	files := map[string][]byte{}
	for _, name := range []string{"events.jsonl", "root.sha256", "fixture.json"} {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		must(t, err)
		files["source-"+name] = raw
	}
	build, err := os.ReadFile(filepath.Join(filepath.Dir(directory), "source-manifest.json"))
	must(t, err)
	files["source-build-manifest.json"] = build
	registered, err := os.ReadFile("testdata/deep_benchmark/SYS-014.json")
	must(t, err)
	source, err := decodeDeepCurrencySource(files["source-events.jsonl"], strings.TrimSpace(string(files["source-root.sha256"])), files["source-fixture.json"], build, registered)
	must(t, err)
	return source, files
}

func deepCurrencyPreregistration() map[string]any {
	return map[string]any{"version": 1, "currencies": []string{"贝币", "岚币"}, "rule": deepCurrencyRule, "input": deepCurrencyInput}
}

func TestDeepBenchmarkCurrencySourcePreflight(t *testing.T) {
	dir := os.Getenv("ELSELIFE_CURRENCY_CONTROL_SOURCE")
	if dir == "" {
		t.Skip("explicit sealed SYS-014 source required; no model invocation")
	}
	source, _ := deepCurrencyReadSource(t, dir)
	ctx := context.Background()
	s, _, _ := testService(t)
	view, err := seedDeepFixture(ctx, s, source.Fixture, "original-restored", source.Replay)
	must(t, err)
	readback, err := readDeepRestored(ctx, s, "original-restored", view, source.Replay)
	must(t, err)
	must(t, validateArchiveState(deepCurrencyFixture().State, 1))
	t.Logf("original_root=%s restored_pages=%d original_S05_remains_BLOCKED live_model_calls=0", source.Root, len(readback.StoredPages))
}

// This supplementary experiment never edits or completes the original run.
// Exactly one new ask operation uses the real Service/Rust/provider path.
func TestDeepBenchmarkCurrencyControlLive(t *testing.T) {
	dir, sourceDir := os.Getenv("ELSELIFE_CURRENCY_CONTROL_DIR"), os.Getenv("ELSELIFE_CURRENCY_CONTROL_SOURCE")
	if dir == "" || sourceDir == "" {
		t.Skip("explicit isolated currency supplement required")
	}
	currentSource := os.Getenv("ELSELIFE_CURRENCY_CONTROL_SOURCE_SHA256")
	if len(currentSource) != 64 || os.Getenv("ELSELIFE_TEST_RUST_RUNTIME") == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Fatal("frozen source/runtime and real CLI required")
	}
	source, files := deepCurrencyReadSource(t, sourceDir)
	if source.Root != "d5d84fc7da380d8043862987fa28f9cb752ede97524d66f1f05ddc0095a5abf9" || source.EventsSHA != "0a88d7bc33f80f743fd12dbb4e51b9fdf7f6283bcf6b966fa77a69ed2e8150a1" {
		t.Fatal("currency supplement requires the preregistered original SYS-014 source")
	}
	build, err := os.ReadFile(filepath.Join(filepath.Dir(dir), "source-manifest.json"))
	must(t, err)
	if fmt.Sprintf("%x", sha256.Sum256(bytes.TrimSuffix(build, []byte{'\n'}))) != currentSource {
		t.Fatal("current frozen build manifest differs")
	}
	files["current-build-manifest.json"] = build
	files["preregistration.json"] = narrativeJSON(deepCurrencyPreregistration())
	files["currency-fixture.json"] = narrativeJSON(deepCurrencyFixture())
	// Never append to an earlier experiment or overwrite its observed result.
	must(t, os.Mkdir(dir, 0700))
	for name, raw := range files {
		must(t, os.WriteFile(filepath.Join(dir, name), raw, 0600))
	}
	file, err := os.OpenFile(filepath.Join(dir, "events.jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	must(t, err)
	defer file.Close()
	evidence := &deepEvidence{file: file, step: "S05"}
	status := "FAIL"
	defer func() {
		if err := evidence.append("supplement_end", map[string]any{"status": status, "original_run_modified": false, "semantic_status": "REVIEW", "boundary": "Supplementary real ask; synthetic initial history. No automatic H3 or whole-case acceptance."}); err != nil {
			t.Error(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "root.sha256"), []byte(evidence.previous+"\n"), 0600); err != nil {
			t.Error(err)
		}
	}()
	pinned := filepath.Join(dir, "algorithm-runtime")
	runtimeSHA, err := copyActualRuntimeBinary(os.Getenv("ELSELIFE_TEST_RUST_RUNTIME"), pinned)
	must(t, err)
	t.Setenv("ELSELIFE_TEST_RUST_RUNTIME", pinned)
	must(t, evidence.append("supplement_manifest", map[string]any{
		"schema_version": 1, "kind": "sys014_currency_positive_control", "case_id": "SYS-014", "step_id": "S05", "step": source.Fixture.Steps[4], "step_input": deepCurrencyStepInput,
		"source_root": source.Root, "source_events_sha256": source.EventsSHA, "source_fixture_sha256": source.FixtureSHA, "source_tree_sha256": source.SourceTreeSHA,
		"preregistration_sha256": fmt.Sprintf("%x", sha256.Sum256(files["preregistration.json"])), "currency_fixture_sha256": fmt.Sprintf("%x", sha256.Sum256(files["currency-fixture.json"])), "currency_fixture": deepCurrencyFixture(), "currency_input": deepCurrencyInput,
		"current_source_tree_sha256": currentSource, "runtime_sha256": runtimeSHA, "contract_sha256": ContractSHA256, "engine": narrativeEngineVersion, "model": os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), "separate_databases": true,
		"max_model_calls_per_operation": 12, "max_repairs": 1, "context_token_limit": 65536, "max_output_tokens": 8192, "operations_authorized": 1, "retry": false,
		"boundary": "Two distinct isolated databases; original is a verified restoration of sealed history, not a connection to the source DB. Currency R1 is evaluator-authored, later ask is actual Go/Rust/CLI. No evaluator answer is sent to the model.",
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	measured := &deepMeasuredModel{Generator: cli, evidence: evidence}
	algorithm := &Algorithm{Link: link, Model: measured, ModelName: os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), Timeout: 8 * time.Minute, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	algorithm.StageObserver = func(stage string, elapsed time.Duration, code string) {
		if err := evidence.append("stage", map[string]any{"stage": stage, "elapsed_ms": elapsed.Milliseconds(), "error": code}); err != nil {
			t.Error(err)
		}
	}
	original, _, originalDSN := testService(t)
	control, _, controlDSN := testService(t)
	if originalDSN == controlDSN {
		t.Fatal("currency and original must have distinct isolated databases")
	}
	control.NarrativeEngine, control.ProseFirst, control.Generator = true, false, algorithm
	originalView, err := seedDeepFixture(ctx, original, source.Fixture, "original-restored", source.Replay)
	must(t, err)
	initial, err := seedDeepFixture(ctx, control, deepCurrencyFixture(), "currency-positive-control", nil)
	must(t, err)
	result, runErr := runDeepCurrencyControl(ctx, original, control, "original-restored", "currency-positive-control", originalView, initial, source, measured, evidence)
	// Preserve source byte identity independently of all DB comparisons.
	var sourceReadErr error
	fileHashes := map[string]string{}
	for _, name := range []string{"events.jsonl", "root.sha256", "fixture.json"} {
		after, readErr := os.ReadFile(filepath.Join(sourceDir, name))
		fileHashes[name] = fmt.Sprintf("%x", sha256.Sum256(after))
		if readErr != nil || !bytes.Equal(after, files["source-"+name]) {
			sourceReadErr = errors.Join(sourceReadErr, fmt.Errorf("original sealed source bytes changed: %s", name))
		}
	}
	must(t, evidence.append("source_files_readback", map[string]any{"sha256": fileHashes, "unchanged": sourceReadErr == nil, "error": func() string {
		if sourceReadErr != nil {
			return sourceReadErr.Error()
		}
		return ""
	}()}))
	runErr = errors.Join(runErr, sourceReadErr)
	if runErr != nil {
		t.Fatal(runErr)
	}
	status = "REVIEW"
	t.Logf("currency ask committed revision=%d model_calls=%d elapsed_ms=%d; arithmetic requires independent transcript review", result.Readback.History.View.Revision, result.ModelCalls, result.ElapsedMS)
}
