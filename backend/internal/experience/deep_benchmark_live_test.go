//go:build integration && codexlive

package experience

// Evaluator-side adapter, never linked into product-dev. Fixtures establish a
// synthetic prehistory in isolated PostgreSQL. All subsequent text and state
// changes go through the real Service, Rust runtime, model and commit path.
import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
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

type deepStep struct {
	ID            string   `json:"id"`
	Mode          string   `json:"mode"`
	Input         string   `json:"input"`
	Epilogue      bool     `json:"epilogue,omitempty"`
	RequiresSteps []string `json:"requires_steps,omitempty"`
	EvidenceGate  string   `json:"evidence_gate,omitempty"`
}

// Evaluator controls are never sent to the model as story facts or input.
// A committed application is not proof that an NPC granted its permission.
func deepStepBlockedReason(step deepStep, completed map[string]bool) string {
	for _, dependency := range step.RequiresSteps {
		if !completed[dependency] {
			return "required step was not completed: " + dependency
		}
	}
	if step.EvidenceGate != "" {
		return "external evidence gate awaits a source-bound independent decision: " + step.EvidenceGate
	}
	return ""
}

func deepEndingBlocks(outcome string, step deepStep) bool {
	if outcome != "ending" || step.Epilogue {
		return false
	}
	return step.Mode == "act" || step.Mode == "player" || step.Mode == "read" || step.Mode == "continue"
}

func deepLatestStoryOutcome(pages []Page) string {
	for i := len(pages) - 1; i >= 0; i-- {
		if pages[i].Mode != "ask" {
			return pages[i].Outcome
		}
	}
	return ""
}

func deepCanaryPrivate(state State, token string) bool {
	// Use pre-operation public knowledge, so an ask cannot excuse a leak by
	// illegally marking the secret known in its own resulting snapshot.
	public := ReaderState(state)
	for _, fact := range public.Facts {
		if strings.Contains(fact.Text, token) {
			return false
		}
	}
	for _, entity := range public.Entities {
		if strings.Contains(entity.Name, token) || strings.Contains(entity.Description, token) {
			return false
		}
	}
	for _, thread := range public.Threads {
		if strings.Contains(thread.Text, token) {
			return false
		}
	}
	return true
}

type deepFixture struct {
	ID            string     `json:"id"`
	SourceSHA256  string     `json:"source_sha256"`
	SourceLine    int        `json:"source_line"`
	Variant       string     `json:"variant"`
	Seed          string     `json:"seed"`
	Opening       string     `json:"opening"`
	State         State      `json:"state"`
	Steps         []deepStep `json:"steps"`
	PrivateTokens []string   `json:"private_tokens"`
	Omissions     []string   `json:"omissions"`
}
type deepEvidence struct {
	mu       sync.Mutex
	file     *os.File
	sequence int
	previous string
	step     string
}

func (e *deepEvidence) append(kind string, value any) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.sequence++
	entry := map[string]any{"seq": e.sequence, "at": time.Now().UTC(), "step": e.step, "kind": kind, "previous_sha256": e.previous, "data": value}
	raw, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	e.previous = fmt.Sprintf("%x", sha256.Sum256(raw))
	_, err = e.file.Write(append(raw, '\n'))
	if err == nil {
		err = e.file.Sync()
	}
	return err
}

type deepMeasuredModel struct {
	model.Generator
	evidence *deepEvidence
	calls    int
}

func (m *deepMeasuredModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	m.calls++
	call := m.calls
	if err := m.evidence.append("model_request", map[string]any{"call": call, "request": request}); err != nil {
		return model.Result{}, err
	}
	started := time.Now()
	result, err := m.Generator.Generate(ctx, request)
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	entry := map[string]any{"call": call, "elapsed_ms": time.Since(started).Milliseconds(), "result": result, "error": errText}
	if details, ok := model.CodexFailureMetadata(err); ok {
		entry["failure_details"] = details
	}
	if writeErr := m.evidence.append("model_result", entry); writeErr != nil {
		return model.Result{}, writeErr
	}
	return result, err
}
func seedDeepFixture(ctx context.Context, s *Service, f deepFixture, account string, replay *deepReplay) (View, error) {
	if err := validateArchiveState(f.State, 1); err != nil {
		return View{}, fmt.Errorf("invalid initial state: %w", err)
	}
	const experienceID, branchID = "benchmark-story", "benchmark-main"
	page := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, StoryTime: f.State.StoryTime, CreatedAt: time.Now().UTC(), Suggestions: []string{}, Outcome: "continues", Reader: ProjectReader(f.State, 1)}
	pages := []deepReplayPage{{Page: page, State: f.State, Title: deepSyntheticInitialTitle, TitleProvenance: "synthetic_initialization"}}
	if replay != nil {
		pages = replay.Pages
	}
	latest := pages[len(pages)-1]
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := q.ExperienceCreate(ctx, pgq.ExperienceCreateParams{AccountID: account, ID: experienceID, Seed: f.Seed, ActiveBranchID: branchID}); err != nil {
			return err
		}
		if err := q.ExperienceBranchCreate(ctx, pgq.ExperienceBranchCreateParams{AccountID: account, ExperienceID: experienceID, ID: branchID, Name: "初始分支", Title: deepReplayTitle(latest), Revision: latest.Page.Revision, State: narrativeJSON(latest.State)}); err != nil {
			return err
		}
		for _, p := range pages {
			if err := q.ExperiencePageCreate(ctx, pgq.ExperiencePageCreateParams{AccountID: account, ExperienceID: experienceID, BranchID: branchID, Revision: p.Page.Revision, Page: narrativeJSON(p.Page), State: narrativeJSON(p.State), Title: deepReplayTitle(p)}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, account, experienceID, branchID)
}
func deepSnapshot(ctx context.Context, s *Service, account string, v View) (State, error) {
	raw, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: account, ExperienceID: v.ID, BranchID: v.BranchID, Revision: v.Revision})
	var state State
	if err == nil {
		err = StrictJSON(raw, &state)
	}
	return state, err
}

func TestDeepBenchmarkLive(t *testing.T) {
	outDir := os.Getenv("ELSELIFE_DEEP_BENCHMARK_DIR")
	binary, cliPath := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME"), os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH")
	if outDir == "" || binary == "" || cliPath == "" {
		t.Skip("explicit isolated real-model benchmark configuration required")
	}
	must(t, os.MkdirAll(outDir, 0700))
	runtimeFile, err := os.Open(binary)
	must(t, err)
	runtimeHash := sha256.New()
	_, err = io.Copy(runtimeHash, runtimeFile)
	closeErr := runtimeFile.Close()
	must(t, err)
	must(t, closeErr)
	runtimeSHA256 := fmt.Sprintf("%x", runtimeHash.Sum(nil))
	files, err := filepath.Glob("testdata/deep_benchmark/*.json")
	must(t, err)
	if len(files) == 0 {
		t.Fatal("no real benchmark fixtures")
	}
	selected := os.Getenv("ELSELIFE_DEEP_CASES")
	matched := 0
	for _, path := range files {
		raw, err := os.ReadFile(path)
		must(t, err)
		var fixture deepFixture
		must(t, StrictJSON(raw, &fixture))
		if selected != "" && !strings.Contains(","+selected+",", ","+fixture.ID+",") {
			continue
		}
		matched++
		t.Run(fixture.ID, func(t *testing.T) {
			// Parallel cases share no database, model conversation or fixture state.
			t.Parallel()
			caseDir := filepath.Join(outDir, fixture.ID)
			must(t, os.Mkdir(caseDir, 0700))
			must(t, os.WriteFile(filepath.Join(caseDir, "fixture.json"), raw, 0600))
			file, err := os.OpenFile(filepath.Join(caseDir, "events.jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			must(t, err)
			evidence := &deepEvidence{file: file}
			defer file.Close()
			boundary := "Actual Go/Rust/model calls and isolated DB reads. Initial prehistory is evaluator-authored, not model output. No human review, external registration, device or full-case PASS is implied."
			must(t, evidence.append("manifest", map[string]any{"evidence_version": 5, "boundary": boundary, "fixture": fixture, "fixture_sha256": fmt.Sprintf("%x", sha256.Sum256(raw)), "runtime_sha256": runtimeSHA256, "contract_sha256": ContractSHA256, "engine": narrativeEngineVersion, "model": os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), "source_tree_sha256": os.Getenv("ELSELIFE_DEEP_SOURCE_SHA256"), "max_model_calls_per_operation": 12, "max_repairs": 1, "background_preparation": "disabled for cold-path fixture run; separately covered by preparation regressions", "remaining_semantic_and_literary_status": "REVIEW"}))
			defer func() {
				status := "REVIEW"
				if t.Failed() {
					status = "FAIL"
				}
				_ = evidence.append("run_end", map[string]any{"status": status})
				_ = os.WriteFile(filepath.Join(caseDir, "root.sha256"), []byte(evidence.previous+"\n"), 0600)
			}()
			addr := actualReadRuntime(t)
			ctx := context.Background()
			link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
			defer link.Close()
			cli, err := model.NewCodexCLI(cliPath, os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
			must(t, err)
			cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
			measured := &deepMeasuredModel{Generator: cli, evidence: evidence}
			algorithm := &Algorithm{Link: link, Model: measured, ModelName: os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), Timeout: 8 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
			algorithm.StageObserver = func(stage string, elapsed time.Duration, code string) {
				if err := evidence.append("stage", map[string]any{"stage": stage, "elapsed_ms": elapsed.Milliseconds(), "error": code}); err != nil {
					t.Error(err)
				}
				t.Logf("%s stage=%s ms=%d error=%s", evidence.step, stage, elapsed.Milliseconds(), code)
			}
			s, _, dsn := testService(t)
			s.NarrativeEngine, s.ProseFirst, s.Generator = true, false, algorithm
			const account = "synthetic-deep-benchmark"
			replay, err := readDeepReplay(os.Getenv("ELSELIFE_DEEP_RESUME_RUN"), fixture)
			must(t, err)
			if replay != nil {
				must(t, evidence.append("resume_manifest", replay))
				must(t, copyDeepReplaySource(os.Getenv("ELSELIFE_DEEP_RESUME_RUN"), fixture.ID, caseDir))
			}
			view, err := seedDeepFixture(ctx, s, fixture, account, replay)
			must(t, err)
			if replay != nil {
				readback, err := readDeepRestored(ctx, s, account, view, replay)
				must(t, err)
				must(t, evidence.append("resume_readback", readback))
			}
			state, err := deepSnapshot(ctx, s, account, view)
			must(t, err)
			initialState, initialView, err := readDeepInitial(ctx, s, account, view)
			must(t, err)
			if !reflect.DeepEqual(initialState, fixture.State) {
				t.Fatal("fixture readback differs")
			}
			must(t, evidence.append("initial_readback", map[string]any{"snapshot": initialState, "public_view": initialView, "projection_method": "initial immutable snapshot, formal page and independently read SQL title; no current branch metadata"}))
			restored := map[string]deepReplayPage{}
			restoredObservations := map[string]deepReplayObservation{}
			restoredEditorials := map[string]deepReplayEditorial{}
			if replay != nil {
				for _, p := range replay.Pages {
					if p.Step != "" {
						restored[p.Step] = p
					}
				}
				for _, observation := range replay.Observations {
					restoredObservations[observation.Step] = observation
				}
				for _, editorial := range replay.Editorials {
					restoredEditorials[editorial.Step] = editorial
				}
			}
			completed := map[string]bool{}
			for _, step := range fixture.Steps {
				evidence.step = step.ID
				if prior, ok := restored[step.ID]; ok {
					must(t, evidence.append("restored_step", prior))
					completed[step.ID] = true
					continue
				}
				if prior, ok := restoredObservations[step.ID]; ok {
					// Reuse the exact source checkpoint; never inspect the latest
					// restored revision under an earlier observation's step ID.
					must(t, evidence.append("restored_observation", prior))
					completed[step.ID] = true
					continue
				}
				if prior, ok := restoredEditorials[step.ID]; ok {
					must(t, evidence.append("restored_editorial", prior))
					completed[step.ID] = true
					continue
				}
				gateAllowed, err := recordDeepGate(caseDir, evidence, fixture, step, replay)
				must(t, err)
				policyStep := step
				if gateAllowed {
					policyStep.EvidenceGate = "" // evaluator permission, never a world fact
				}
				if reason := deepStepBlockedReason(policyStep, completed); reason != "" {
					must(t, evidence.append("blocked_step", map[string]any{"step": step, "reason": reason}))
					continue
				}
				if deepEndingBlocks(deepLatestStoryOutcome(view.Pages), step) {
					must(t, evidence.append("coverage_unreached", map[string]any{"step": step, "reason": "natural ending; no forced continuation"}))
					continue
				}
				if step.Mode == "observe" {
					must(t, evidence.append("observation", map[string]any{"step": step, "snapshot": state, "public_view": view}))
					completed[step.ID] = true
					continue
				}
				if step.Mode == "editorial_request" {
					interpreter := &FeedbackInterpreter{Model: measured, ModelName: algorithm.ModelName, Timeout: algorithm.Timeout, ContextTokens: 65536, OutputTokens: 8192, ByteTokenBoundVerified: true}
					view, state, err = runDeepEditorial(ctx, s, account, view, step, interpreter, evidence)
					if err != nil {
						t.Errorf("%s editorial proposal failed: %v", step.ID, err)
						return
					}
					completed[step.ID] = true
					continue
				}
				if fixture.ID == "SYS-005" && step.ID == "S06" && step.Mode == "harness" {
					view, state, err = runDeepRestoreCancel(ctx, s, dsn, account, view, step, evidence)
					if err != nil {
						t.Errorf("%s restore/cancel control failed: %v", step.ID, err)
						return
					}
					completed[step.ID] = true
					continue
				}
				if step.Mode != "act" && step.Mode != "ask" && step.Mode != "continue" && step.Mode != "read" && step.Mode != "player" {
					must(t, evidence.append("blocked_step", map[string]any{"step": step, "reason": "no binding for this control operation in Go real-model adapter"}))
					continue
				}
				req := AdvanceRequest{RequestID: "benchmark-" + step.ID, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: step.Mode, Input: step.Input}
				if step.Mode == "player" {
					req.Mode = "act"
				}
				if step.Mode == "continue" || step.Mode == "read" {
					req.Mode = "read"
					req.Input = ""
					req.ReadingRequest = step.Input
				}
				authorityBefore, readErr := readDeepStoredHistory(ctx, s, dsn, account, view)
				if readErr != nil || !reflect.DeepEqual(authorityBefore.View, view) || len(authorityBefore.Snapshots) == 0 || !reflect.DeepEqual(authorityBefore.Snapshots[len(authorityBefore.Snapshots)-1].State, state) {
					must(t, evidence.append("authority_before_failure", map[string]any{"step": step, "error": fmt.Sprint(readErr), "reason": "fresh authority baseline unavailable or differs from prior committed view/state"}))
					t.Errorf("%s independent pre-operation readback failed: %v", step.ID, readErr)
					return
				}
				must(t, evidence.append("operation_request", map[string]any{"step": step, "request": req, "before": state, "authority_before": authorityBefore, "authority_method": deepFailureReadMethod}))
				evidence.mu.Lock()
				requestEventSeq := evidence.sequence
				evidence.mu.Unlock()
				before, calls := state, measured.calls
				started := time.Now()
				_, _, err = s.Advance(ctx, account, view.ID, req)
				if err == nil {
					err = s.GenerateAccepted(ctx, account, req.RequestID)
				}
				if err == nil {
					view, err = s.Get(ctx, account, view.ID, view.BranchID)
				}
				if err != nil || view.Revision != req.ExpectedRevision+1 {
					operation, opErr := s.GetOperation(ctx, account, view.ID, req.RequestID)
					must(t, evidence.append("operation_failure", map[string]any{"error": fmt.Sprint(err), "operation": operation, "lookup_error": fmt.Sprint(opErr), "cached_public_view": view, "model_calls": measured.calls - calls, "elapsed_ms": time.Since(started).Milliseconds()}))
					evidence.mu.Lock()
					failureEventSeq := evidence.sequence
					evidence.mu.Unlock()
					audit := captureDeepFailure(ctx, s, dsn, account, view, req, authorityBefore, requestEventSeq, failureEventSeq)
					must(t, evidence.append("failure_readback", audit))
					t.Errorf("%s no committed result: %v operation=%+v", step.ID, err, operation)
					return
				}
				state, err = deepSnapshot(ctx, s, account, view)
				must(t, err)
				must(t, evidence.append("operation_committed", map[string]any{"public_view": view, "snapshot": state, "model_calls": measured.calls - calls, "elapsed_ms": time.Since(started).Milliseconds()}))
				completed[step.ID] = true
				if req.Mode == "ask" {
					unchanged := reflect.DeepEqual(before, state)
					must(t, evidence.append("assertion", map[string]any{"id": "ask-domain-state-unchanged", "passed": unchanged, "scope": "structural; does not prove answer quality"}))
					if !unchanged {
						t.Error("ask changed domain state")
					}
				}
				// Canary matching can prove a leak; absence cannot prove semantic safety.
				if req.Mode == "ask" {
					for _, token := range fixture.PrivateTokens {
						if deepCanaryPrivate(before, token) && strings.Contains(string(narrativeJSON(view)), token) {
							t.Errorf("private canary in public response")
							_ = evidence.append("assertion", map[string]any{"id": "private-canary-disclosure", "passed": false, "token": token})
						}
					}
				}
				t.Logf("%s committed revision=%d elapsed=%s calls=%d", step.ID, view.Revision, time.Since(started), measured.calls-calls)
			}
		})
	}
	if matched == 0 {
		t.Fatal("case selection matched no fixtures")
	}
}
