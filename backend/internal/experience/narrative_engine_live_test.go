//go:build integration && codexlive

package experience

// Real model evidence on a synthetic story and isolated PostgreSQL. This test
// proves the pipeline can execute and records prose for human review; it is not
// a literary-quality score. Failed attempts remain in the output report.
import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

type engineLiveStage struct {
	Stage string `json:"stage"`
	MS    int64  `json:"ms"`
	Error string `json:"error,omitempty"`
}
type engineLiveCall struct {
	RequestBytes int    `json:"request_bytes"`
	MS           int64  `json:"ms"`
	Output       string `json:"output"`
	Error        string `json:"error,omitempty"`
}
type engineLivePage struct {
	Mode       string `json:"mode"`
	Input      string `json:"input"`
	Revision   int64  `json:"revision"`
	WaitMS     int64  `json:"wait_ms"`
	ModelCalls int    `json:"model_calls"`
	Text       string `json:"text"`
	State      State  `json:"state"`
}
type engineLiveReport struct {
	Boundary          string            `json:"boundary"`
	Scenario          string            `json:"scenario"`
	RuntimeSHA256     string            `json:"runtime_sha256"`
	Model             string            `json:"model"`
	Stages            []engineLiveStage `json:"stages"`
	Calls             []engineLiveCall  `json:"calls"`
	Pages             []engineLivePage  `json:"pages"`
	PreparationMS     int64             `json:"preparation_ms"`
	PreparationStatus string            `json:"preparation_status"`
	Error             string            `json:"error,omitempty"`
}
type engineLiveModel struct {
	model.Generator
	mu     sync.Mutex
	report *engineLiveReport
}

func (m *engineLiveModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	raw, _ := json.Marshal(request)
	start := time.Now()
	result, err := m.Generator.Generate(ctx, request)
	entry := engineLiveCall{RequestBytes: len(raw), MS: time.Since(start).Milliseconds(), Output: result.Text}
	if err != nil {
		entry.Error = err.Error()
	}
	m.mu.Lock()
	m.report.Calls = append(m.report.Calls, entry)
	m.mu.Unlock()
	return result, err
}

func TestNarrativeEngineLive(t *testing.T) {
	outDir := os.Getenv("ELSELIFE_NARRATIVE_EVAL_DIR")
	binary := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if outDir == "" || binary == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit real-model configuration and report directory required")
	}
	must(t, os.MkdirAll(outDir, 0700))
	report := engineLiveReport{Boundary: "Real model; synthetic story; isolated PostgreSQL; short pages are only measured after formal commit. Background preparation time is separate from cache-hit wait. Stage tests do not prove literary quality.", Scenario: "engine-smoke", Model: os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), Stages: []engineLiveStage{}, Calls: []engineLiveCall{}, Pages: []engineLivePage{}}
	runtimeFile, err := os.Open(binary)
	must(t, err)
	runtimeHash := sha256.New()
	_, err = io.Copy(runtimeHash, runtimeFile)
	_ = runtimeFile.Close()
	must(t, err)
	report.RuntimeSHA256 = fmt.Sprintf("%x", runtimeHash.Sum(nil))
	saveReport := func() {
		data, err := json.MarshalIndent(report, "", "  ")
		if err == nil {
			err = os.WriteFile(filepath.Join(outDir, "engine-v4.json"), append(data, '\n'), 0600)
		}
		if err != nil {
			t.Errorf("write real-model evidence: %v", err)
		}
	}
	defer saveReport()
	cmd := exec.Command(binary, "--listen", "127.0.0.1:0", "--insecure-plaintext")
	stdout, err := cmd.StdoutPipe()
	must(t, err)
	must(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "listening ") {
		t.Fatal("runtime did not announce endpoint")
	}
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: strings.TrimPrefix(scanner.Text(), "listening "), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), report.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	measured := &engineLiveModel{Generator: cli, report: &report}
	algorithm := &Algorithm{Link: link, Model: measured, ModelName: report.Model, Timeout: 8 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
	algorithm.StageObserver = func(stage string, elapsed time.Duration, errorCode string) {
		report.Stages = append(report.Stages, engineLiveStage{Stage: stage, MS: elapsed.Milliseconds(), Error: errorCode})
		t.Logf("stage=%s ms=%d error=%s", stage, elapsed.Milliseconds(), errorCode)
	}
	s, _, _ := testService(t)
	s.NarrativeEngine = true
	s.ProseFirst = false
	s.Generator = algorithm
	ctx := context.Background()
	account := "synthetic-narrative-engine"
	seed := "雨夜的临港城，我是落魄账房，带着证明家族身份的银戒和一本走私账册。同伴林舟信任我，但最在意妹妹的安全，公开账册可能牵连她。商人顾安愿意收旧物。守卫周岚在远处城门值守，不知道账册存在。故事从码头旧货摊开始，第二人称，中文叙述。"
	steps := []narrativeEvalStep{{Mode: "begin", Input: seed}, {Mode: "act", Input: "我把银戒卖给顾安，谈妥价格后收钱离开。"}, {Mode: "read"}, {Mode: "ask", Input: "根据我已经知道的事，银戒现在在哪里？周岚知道账册吗？"}}
	if os.Getenv("ELSELIFE_NARRATIVE_EVAL_SCENARIO") == "continuous-reading" {
		var scenario struct {
			ID    string              `json:"id"`
			Seed  string              `json:"seed"`
			Steps []narrativeEvalStep `json:"steps"`
		}
		must(t, json.Unmarshal(narrativeScenarioJSON, &scenario))
		seed, steps, report.Scenario = scenario.Seed, scenario.Steps, scenario.ID
		steps = append(steps, narrativeEvalStep{Mode: "ask", Input: "根据我已经知道的事，戒指和账册现在分别在哪里？守卫知道账册吗？"})
	}
	var view View
	var beforeAsk State
	for index, step := range steps {
		if step.Mode == "read" {
			start := time.Now()
			err = s.PrepareNext(ctx, account, view.ID, view.BranchID, view.Revision)
			report.PreparationMS = time.Since(start).Milliseconds()
			if err != nil {
				report.Error = fmt.Sprintf("prepare: %v", err)
				t.Error(report.Error)
				return
			}
			status, statusErr := s.Preparation(ctx, account, view.ID, view.BranchID, view.Revision)
			if statusErr != nil {
				report.Error = fmt.Sprintf("prepare status: %v", statusErr)
				t.Error(report.Error)
				return
			}
			encoded, _ := json.Marshal(status)
			var fields map[string]any
			_ = json.Unmarshal(encoded, &fields)
			report.PreparationStatus, _ = fields["status"].(string)
			if report.PreparationStatus != "ready" {
				report.Error = "preparation did not become ready"
				t.Error(report.Error)
				return
			}
		}
		requestID := fmt.Sprintf("engine-v4-%d", index)
		calls := len(report.Calls)
		start := time.Now()
		if index == 0 {
			view, _, err = s.Create(ctx, account, CreateRequest{RequestID: requestID, Seed: seed})
		} else {
			_, _, err = s.Advance(ctx, account, view.ID, AdvanceRequest{RequestID: requestID, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: step.Mode, Input: step.Input})
		}
		if err == nil {
			err = s.GenerateAccepted(ctx, account, requestID)
		}
		if err == nil {
			view, err = s.Get(ctx, account, view.ID, view.BranchID)
		}
		if err != nil || view.Revision != int64(index+1) {
			operation, _ := json.Marshal(view.Operation)
			report.Error = fmt.Sprintf("%s: %v; operation=%s", step.Mode, err, operation)
			t.Error(report.Error)
			return
		}
		raw, readErr := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: account, ExperienceID: view.ID, BranchID: view.BranchID, Revision: view.Revision})
		must(t, readErr)
		var state State
		must(t, StrictJSON(raw, &state))
		page := engineLivePage{Mode: step.Mode, Input: step.Input, Revision: view.Revision, WaitMS: time.Since(start).Milliseconds(), ModelCalls: len(report.Calls) - calls, Text: view.Pages[len(view.Pages)-1].Text, State: state}
		report.Pages = append(report.Pages, page)
		saveReport()
		t.Logf("mode=%s revision=%d wait_ms=%d calls=%d", step.Mode, page.Revision, page.WaitMS, page.ModelCalls)
		if step.Mode == "read" && page.ModelCalls != 0 {
			t.Error("prepared read unexpectedly called model")
		}
		if step.Mode == "ask" && !reflect.DeepEqual(state, beforeAsk) {
			t.Error("ask mutated formal state")
		}
		beforeAsk = state
	}
}
