//go:build integration && codexlive

package experience

// This opt-in comparison uses a synthetic scenario and real model calls. It
// records prose and timings for human review; passing is not a quality score.
// Both arms use the current commit/validation code. The baseline freezes only
// the previous prompt, model-facing schema and absence of the advisory brief.
import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

//go:embed testdata/narrative/baseline-v2-prompt.txt
var narrativeBaselinePrompt string

//go:embed testdata/narrative/continuous-reading.json
var narrativeScenarioJSON []byte

const narrativeBaselineSchema = `{"type":"object","additionalProperties":false,"required":["result"],"properties":{"result":{"type":"object","additionalProperties":false,"required":["narrative","title","story_time","suggestions","metadata_json"],"properties":{"narrative":{"type":"string"},"title":{"type":"string"},"story_time":{"type":"string"},"suggestions":{"type":"array","items":{"type":"string"}},"metadata_json":{"type":"string"}}}}}`

type narrativeEvalStep struct {
	ID    string `json:"id"`
	Mode  string `json:"mode"`
	Input string `json:"input"`
	Focus string `json:"focus"`
}

type narrativeEvalPage struct {
	Step              narrativeEvalStep   `json:"step"`
	Text              string              `json:"text"`
	Revision          int64               `json:"revision"`
	FirstReadableMS   int64               `json:"first_readable_ms"`
	ModelMS           int64               `json:"model_ms"`
	ModelCalls        int                 `json:"model_calls"`
	ModelRequestBytes int                 `json:"model_request_bytes"`
	StateCounts       StateCounts         `json:"state_counts"`
	State             State               `json:"state"`
	KnownBy           map[string][]string `json:"known_by"`
}

type narrativeEvalArm struct {
	Name  string              `json:"name"`
	Pages []narrativeEvalPage `json:"pages"`
	Error string              `json:"error,omitempty"`
}

type narrativeEvalReport struct {
	Scenario string             `json:"scenario"`
	Model    string             `json:"model"`
	Boundary string             `json:"measurement_boundary"`
	Arms     []narrativeEvalArm `json:"arms"`
}

type narrativeEvalModel struct {
	model.Generator
	baseline bool
	calls    int
	elapsed  time.Duration
	bytes    int
}

func (m *narrativeEvalModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	if m.baseline {
		request.Schema = json.RawMessage(narrativeBaselineSchema)
		request.Messages = append([]model.Message(nil), request.Messages...)
		for i := range request.Messages {
			message := &request.Messages[i]
			if i == 0 && message.Role == "system" {
				message.Content = narrativeBaselinePrompt
			}
			if message.Role == "user" {
				var input map[string]json.RawMessage
				if json.Unmarshal([]byte(message.Content), &input) == nil && input["authoring"] != nil {
					var authoring map[string]json.RawMessage
					if json.Unmarshal(input["authoring"], &authoring) != nil {
						return model.Result{}, model.ErrInvalidResponse
					}
					delete(authoring, "narrative_brief")
					authoring["prompt_version"] = json.RawMessage(`"elselife.narrative.v2"`)
					input["authoring"], _ = json.Marshal(authoring)
					raw, _ := json.Marshal(input)
					message.Content = string(raw)
				}
			}
		}
	}
	m.calls++
	raw, _ := json.Marshal(request)
	m.bytes += len(raw)
	started := time.Now()
	result, err := m.Generator.Generate(ctx, request)
	m.elapsed += time.Since(started)
	return result, err
}

func TestNarrativeQualityComparisonLive(t *testing.T) {
	outDir := os.Getenv("ELSELIFE_NARRATIVE_EVAL_DIR")
	binary := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if outDir == "" || binary == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit live configuration and evaluation output directory required")
	}
	var scenario struct {
		ID    string              `json:"id"`
		Seed  string              `json:"seed"`
		Steps []narrativeEvalStep `json:"steps"`
	}
	must(t, json.Unmarshal(narrativeScenarioJSON, &scenario))
	must(t, os.MkdirAll(outDir, 0700))
	report := narrativeEvalReport{Scenario: scenario.ID, Model: os.Getenv("ELSELIFE_DEV_CODEX_MODEL"),
		Boundary: "Real model, synthetic story, isolated temporary PostgreSQL. Baseline changes prompt/schema/advisory only; both arms use current backend and validation. first_readable_ms spans GenerateAccepted through committed page retrieval; no token/paragraph streaming or concurrency claim. One sample per arm; human literary review required.", Arms: []narrativeEvalArm{}}
	defer func() {
		raw, err := json.MarshalIndent(report, "", "  ")
		if err == nil {
			err = os.WriteFile(filepath.Join(outDir, "comparison.json"), append(raw, '\n'), 0600)
		}
		if err != nil {
			t.Errorf("write evaluation evidence: %v", err)
		}
	}()
	cmd := exec.Command(binary, "--listen", "127.0.0.1:0", "--insecure-plaintext")
	stdout, err := cmd.StdoutPipe()
	must(t, err)
	must(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "listening ") {
		t.Fatal("runtime did not announce its local endpoint")
	}
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: strings.TrimPrefix(scanner.Text(), "listening "), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), report.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	for _, name := range []string{"baseline-prompt-v2", "revised-prompt-v3"} {
		arm := narrativeEvalArm{Name: name, Pages: []narrativeEvalPage{}}
		report.Arms = append(report.Arms, arm)
		current := &report.Arms[len(report.Arms)-1]
		s, _, _ := testService(t)
		measured := &narrativeEvalModel{Generator: cli, baseline: name == "baseline-prompt-v2"}
		s.ProseFirst = true
		s.Generator = &Algorithm{ProseFirst: true, Link: link, Model: measured, ModelName: report.Model, Timeout: 3 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 5}
		ctx := context.Background()
		account := "synthetic-narrative-evaluation"
		var view View
		for index, step := range scenario.Steps {
			requestID := fmt.Sprintf("%s-%s", name, step.ID)
			if index == 0 {
				view, _, err = s.Create(ctx, account, CreateRequest{RequestID: requestID, Seed: scenario.Seed})
			} else {
				_, _, err = s.Advance(ctx, account, view.ID, AdvanceRequest{RequestID: requestID, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: step.Mode, Input: step.Input})
			}
			if err != nil {
				current.Error = fmt.Sprintf("%s accept: %v", step.ID, err)
				t.Error(current.Error)
				break
			}
			beforeCalls, beforeMS, beforeBytes := measured.calls, measured.elapsed, measured.bytes
			started := time.Now()
			err = s.GenerateAccepted(ctx, account, requestID)
			if err == nil {
				view, err = s.Get(ctx, account, view.ID, view.BranchID)
			}
			elapsed := time.Since(started)
			if err != nil || view.Revision != int64(index+1) {
				current.Error = fmt.Sprintf("%s generation failed: %v; operation=%+v", step.ID, err, view.Operation)
				t.Error(current.Error)
				break
			}
			snapshot, readErr := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: account, ExperienceID: view.ID, BranchID: view.BranchID, Revision: view.Revision})
			must(t, readErr)
			var state State
			must(t, StrictJSON(snapshot, &state))
			knowledge := map[string][]string{}
			for _, fact := range state.Facts {
				knowledge[fact.ID] = fact.KnownBy
			}
			current.Pages = append(current.Pages, narrativeEvalPage{Step: step, Text: view.Pages[len(view.Pages)-1].Text, Revision: view.Revision, FirstReadableMS: elapsed.Milliseconds(), ModelMS: (measured.elapsed - beforeMS).Milliseconds(), ModelCalls: measured.calls - beforeCalls, ModelRequestBytes: measured.bytes - beforeBytes, StateCounts: counts(state), State: state, KnownBy: knowledge})
			t.Logf("%s %s: committed=%d wait_ms=%d model_calls=%d facts=%d", name, step.ID, view.Revision, elapsed.Milliseconds(), measured.calls-beforeCalls, len(state.Facts))
		}
	}
}

// Continue the saved synthetic comparison with a read-only question, without
// paying to regenerate or cherry-pick its five preceding scenes.
func TestNarrativeUnknownQuestionLive(t *testing.T) {
	testNarrativeFollowup(t, false)
}

func TestNarrativeRefinedContinuationLive(t *testing.T) {
	testNarrativeFollowup(t, true)
}

func testNarrativeFollowup(t *testing.T, refineContinuation bool) {
	outDir := os.Getenv("ELSELIFE_NARRATIVE_EVAL_DIR")
	binary := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if outDir == "" || binary == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit live configuration and saved synthetic comparison required")
	}
	raw, err := os.ReadFile(filepath.Join(outDir, "comparison.json"))
	must(t, err)
	var report narrativeEvalReport
	must(t, json.Unmarshal(raw, &report))
	var scenario struct {
		Seed string `json:"seed"`
	}
	must(t, json.Unmarshal(narrativeScenarioJSON, &scenario))
	cmd := exec.Command(binary, "--listen", "127.0.0.1:0", "--insecure-plaintext")
	stdout, err := cmd.StdoutPipe()
	must(t, err)
	must(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "listening ") {
		t.Fatal("runtime did not announce its local endpoint")
	}
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: strings.TrimPrefix(scanner.Text(), "listening "), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), report.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	answers := []narrativeEvalArm{}
	filename := "unknown-question.json"
	boundary := "Read-only model/validator follow-up on the saved synthetic comparison; no formal page or database commit. Timing excludes persistence and cannot be compared as committed-page latency."
	if refineContinuation {
		filename = "continuation-refinement.json"
		boundary = "One additional revised-prompt read candidate from exactly the saved revision 4, after the general anti-stalling instruction. Original comparison retained. No database commit, no automatic reroll; timing excludes persistence."
	}
	defer func() {
		result, writeErr := json.MarshalIndent(struct {
			Boundary string             `json:"measurement_boundary"`
			Arms     []narrativeEvalArm `json:"arms"`
		}{boundary, answers}, "", "  ")
		if writeErr == nil {
			writeErr = os.WriteFile(filepath.Join(outDir, filename), append(result, '\n'), 0600)
		}
		if writeErr != nil {
			t.Errorf("write question evidence: %v", writeErr)
		}
	}()
	for _, arm := range report.Arms {
		if refineContinuation && arm.Name != "revised-prompt-v3" {
			continue
		}
		if arm.Error != "" || len(arm.Pages) == 0 {
			t.Fatalf("incomplete saved comparison: %s", arm.Name)
		}
		pages := arm.Pages
		if refineContinuation {
			if len(pages) < 2 {
				t.Fatal("refinement requires a preceding scene")
			}
			pages = pages[:len(pages)-1]
		}
		last := pages[len(pages)-1]
		step := narrativeEvalStep{ID: "unknown-question", Mode: "ask", Input: "请列出账册里尚未向我揭示的全部名字，并告诉我守卫是否已经知道我把账册交给沈岚。请区分已知情况与尚不清楚的部分。", Focus: "读者未知不补猜；询问不推进剧情、时间和人物知情"}
		if refineContinuation {
			step = narrativeEvalStep{ID: "refined-continuation", Mode: "read", Input: "", Focus: "不替玩家决定的前提下，NPC、环境或既有后果继续发展，不重复等待"}
		}
		c := Context{Version: 2, ExperienceID: "synthetic-evaluation", BranchID: arm.Name, Revision: last.Revision, Mode: step.Mode, Input: step.Input, Seed: scenario.Seed, State: last.State, Preferences: []Preference{}, History: []HistoryPage{}, HistoryComplete: true}
		for _, page := range pages {
			c.History = append(c.History, HistoryPage{Revision: page.Revision, Mode: page.Step.Mode, Input: page.Step.Input, Text: page.Text})
		}
		c, err = compileGeneration(c, EmptyState(), "synthetic-ask-source", 1, ReadBudget{}, 48<<10)
		must(t, err)
		measured := &narrativeEvalModel{Generator: cli, baseline: arm.Name == "baseline-prompt-v2"}
		algorithm := &Algorithm{ProseFirst: true, Link: link, Model: measured, ModelName: report.Model, Timeout: 3 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 1}
		answers = append(answers, narrativeEvalArm{Name: arm.Name, Pages: []narrativeEvalPage{}})
		current := &answers[len(answers)-1]
		started := time.Now()
		candidate, genErr := algorithm.Generate(context.Background(), c, step.ID+"-"+arm.Name)
		if genErr != nil {
			current.Error = fmt.Sprintf("ask generation: %v", genErr)
			t.Error(current.Error)
			continue
		}
		_, after, applyErr := applyNarrative(c, candidate)
		if applyErr != nil || !refineContinuation && !reflect.DeepEqual(after, c.State) {
			current.Error = "ask failed validation or changed world state"
			t.Error(current.Error)
			continue
		}
		knowledge := map[string][]string{}
		for _, fact := range after.Facts {
			knowledge[fact.ID] = fact.KnownBy
		}
		current.Pages = []narrativeEvalPage{{Step: step, Text: candidate.Passage, Revision: c.Revision, FirstReadableMS: time.Since(started).Milliseconds(), ModelMS: measured.elapsed.Milliseconds(), ModelCalls: measured.calls, ModelRequestBytes: measured.bytes, StateCounts: counts(after), State: after, KnownBy: knowledge}}
		t.Logf("%s %s: base_revision=%d model_calls=%d", arm.Name, step.ID, c.Revision, measured.calls)
	}
}
