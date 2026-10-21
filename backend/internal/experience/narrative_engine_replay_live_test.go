//go:build integration && codexlive

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

// Replay accepts only the checked-in synthetic scenario. It never queries a
// existing product database. Historical presentation metadata absent from the
// source report is reconstructed; mode, input, prose and state remain exact.
func narrativeReplayContext(source []byte) (Context, error) {
	var scenario struct {
		ID    string              `json:"id"`
		Seed  string              `json:"seed"`
		Steps []narrativeEvalStep `json:"steps"`
	}
	var report engineLiveReport
	if err := json.Unmarshal(narrativeScenarioJSON, &scenario); err != nil {
		return Context{}, err
	}
	if err := json.Unmarshal(source, &report); err != nil {
		return Context{}, err
	}
	if report.Scenario != scenario.ID || len(scenario.Steps) < 4 {
		return Context{}, fmt.Errorf("replay_scenario_mismatch")
	}
	selected := make(map[int64]engineLivePage)
	for _, page := range report.Pages {
		if page.Revision < 1 || page.Revision > 4 {
			continue
		}
		if _, exists := selected[page.Revision]; exists {
			return Context{}, fmt.Errorf("replay_duplicate_revision")
		}
		selected[page.Revision] = page
	}
	c := Context{Version: 2, ExperienceID: "synthetic-replay", BranchID: "synthetic-replay-main", Revision: 4, Mode: "read", Seed: scenario.Seed, Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}, History: []HistoryPage{}, HistoryComplete: true, Preferences: []Preference{}, Recalls: []ReadReply{}, ReadBudget: ReadBudget{}}
	for revision := int64(1); revision <= 4; revision++ {
		page, ok := selected[revision]
		step := scenario.Steps[revision-1]
		if !ok || page.Mode != step.Mode || page.Input != step.Input || !textOK(page.Text) {
			return Context{}, fmt.Errorf("replay_history_mismatch_revision_%d", revision)
		}
		if err := validateArchiveState(page.State, revision); err != nil {
			return Context{}, fmt.Errorf("replay_state_revision_%d: %w", revision, err)
		}
		c.History = append(c.History, HistoryPage{Revision: revision, Mode: page.Mode, Input: page.Input, Text: page.Text})
		c.State = page.State
	}
	c.StateCoverage = StateCoverage{Policy: "full.v1", Complete: true, Total: counts(c.State), SourceHandle: "synthetic-replay-full", Audience: "author"}
	c.AuthorityState = &c.State
	if err := validateContract(narrativeJSON(c), "context"); err != nil {
		return Context{}, err
	}
	return c, nil
}

func seedNarrativeReplay(ctx context.Context, s *Service, source []byte, account string) (Context, error) {
	c, err := narrativeReplayContext(source)
	if err != nil {
		return Context{}, err
	}
	var report engineLiveReport
	if err = json.Unmarshal(source, &report); err != nil {
		return Context{}, err
	}
	err = s.transaction(ctx, func(q *pgq.Queries) error {
		if err := q.ExperienceCreate(ctx, pgq.ExperienceCreateParams{AccountID: account, ID: c.ExperienceID, Seed: c.Seed, ActiveBranchID: c.BranchID}); err != nil {
			return err
		}
		if err := q.ExperienceBranchCreate(ctx, pgq.ExperienceBranchCreateParams{AccountID: account, ExperienceID: c.ExperienceID, ID: c.BranchID, Name: "同前史回放", Title: "合成场景", Revision: 4, State: narrativeJSON(c.State)}); err != nil {
			return err
		}
		for _, p := range report.Pages {
			if p.Revision < 1 || p.Revision > 4 {
				continue
			}
			page := Page{HistoryPage: HistoryPage{Revision: p.Revision, Mode: p.Mode, Input: p.Input, Text: p.Text}, StoryTime: p.State.StoryTime, CreatedAt: time.Now().UTC(), Suggestions: []string{}, Outcome: "continues", Reader: ProjectReader(p.State, p.Revision)}
			if err := q.ExperiencePageCreate(ctx, pgq.ExperiencePageCreateParams{AccountID: account, ExperienceID: c.ExperienceID, BranchID: c.BranchID, Revision: p.Revision, Page: narrativeJSON(page), State: narrativeJSON(p.State), Title: "合成场景前史"}); err != nil {
				return err
			}
		}
		return nil
	})
	return c, err
}

type narrativeReplayReport struct {
	engineLiveReport
	SourceSHA256        string             `json:"source_sha256"`
	SourceRuntimeSHA256 string             `json:"source_runtime_sha256"`
	StartedAt           time.Time          `json:"started_at"`
	TotalMS             int64              `json:"total_ms"`
	BaseRevision        int64              `json:"base_revision"`
	CacheWaitMS         int64              `json:"cache_wait_ms"`
	CacheModelCalls     int                `json:"cache_model_calls"`
	AskWaitMS           int64              `json:"ask_wait_ms"`
	AskStateUnchanged   bool               `json:"ask_state_unchanged"`
	ReadCandidate       *Candidate         `json:"read_candidate,omitempty"`
	ReadApproval        *NarrativeApproval `json:"read_approval,omitempty"`
	AskCandidate        *Candidate         `json:"ask_candidate,omitempty"`
	AskApproval         *NarrativeApproval `json:"ask_approval,omitempty"`
}

func TestNarrativeEngineReplayLive(t *testing.T) {
	sourcePath, outDir := os.Getenv("ELSELIFE_NARRATIVE_REPLAY_SOURCE"), os.Getenv("ELSELIFE_NARRATIVE_EVAL_DIR")
	binary, cliPath := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME"), os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH")
	if sourcePath == "" || outDir == "" || binary == "" || cliPath == "" {
		t.Skip("explicit synthetic replay source, output directory, runtime and CLI required")
	}
	if !filepath.IsAbs(sourcePath) || !filepath.IsAbs(outDir) {
		t.Fatal("replay paths must be absolute")
	}
	must(t, os.MkdirAll(outDir, 0700))
	output := filepath.Join(outDir, "read-replay.json")
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("use a fresh output directory to preserve earlier replay evidence")
	}
	started := time.Now()
	report := narrativeReplayReport{engineLiveReport: engineLiveReport{Boundary: "Real model; fixed synthetic scenario; isolated temporary PostgreSQL restored only from source revisions 1..4. Exact historical mode/input/prose/state; missing historical titles/suggestions/outcomes are presentation metadata reconstructed for the fixture. One same-history read comparison; preparation must pass strict approval and Apply, cached read must make zero model calls, ask must preserve state. No literary-quality score, retry or mutation of source evidence.", Model: os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), Stages: []engineLiveStage{}, Calls: []engineLiveCall{}, Pages: []engineLivePage{}}, StartedAt: started.UTC(), BaseRevision: 4}
	save := func() {
		report.TotalMS = time.Since(started).Milliseconds()
		raw, err := json.MarshalIndent(report, "", "  ")
		if err == nil {
			err = os.WriteFile(output, append(raw, '\n'), 0600)
		}
		if err != nil {
			t.Errorf("save replay evidence: %v", err)
		}
	}
	defer func() {
		if t.Failed() && report.Error == "" {
			report.Error = "replay_setup_or_assertion_failed"
		}
		save()
	}()
	failReplay := func(label string, err error) { report.Error = fmt.Sprintf("%s: %v", label, err); t.Error(report.Error) }
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		failReplay("read source", err)
		return
	}
	report.SourceSHA256 = fmt.Sprintf("%x", sha256.Sum256(source))
	var original engineLiveReport
	if err = json.Unmarshal(source, &original); err != nil {
		failReplay("decode source", err)
		return
	}
	report.Scenario, report.SourceRuntimeSHA256 = original.Scenario, original.RuntimeSHA256
	if _, err = narrativeReplayContext(source); err != nil {
		failReplay("validate synthetic history", err)
		return
	}
	runtimeBytes, err := os.ReadFile(binary)
	if err != nil {
		failReplay("read runtime", err)
		return
	}
	report.RuntimeSHA256 = fmt.Sprintf("%x", sha256.Sum256(runtimeBytes))
	addr := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(cliPath, os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), report.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	if err != nil {
		failReplay("model configuration", err)
		return
	}
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	algorithm := &Algorithm{Link: link, Model: &engineLiveModel{Generator: cli, report: &report.engineLiveReport}, ModelName: report.Model, Timeout: 8 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
	algorithm.StageObserver = func(stage string, elapsed time.Duration, errorCode string) {
		report.Stages = append(report.Stages, engineLiveStage{Stage: stage, MS: elapsed.Milliseconds(), Error: errorCode})
		t.Logf("stage=%s ms=%d error=%s", stage, elapsed.Milliseconds(), errorCode)
		save()
	}
	s, _, _ := testService(t)
	s.NarrativeEngine, s.Generator = true, algorithm
	account := "synthetic-narrative-replay"
	c, err := seedNarrativeReplay(ctx, s, source, account)
	if err != nil {
		failReplay("restore synthetic history", err)
		return
	}
	start := time.Now()
	err = s.PrepareNext(ctx, account, c.ExperienceID, c.BranchID, 4)
	report.PreparationMS = time.Since(start).Milliseconds()
	if err != nil {
		failReplay("prepare", err)
		return
	}
	status, err := s.Preparation(ctx, account, c.ExperienceID, c.BranchID, 4)
	report.PreparationStatus = status.Status
	if err != nil || status.Status != "ready" {
		failReplay("preparation not ready", err)
		return
	}
	for _, mode := range []string{"read", "ask"} {
		input, revision := "", int64(4)
		if mode == "ask" {
			input, revision = "根据我已经知道的事，戒指和账册现在分别在哪里？守卫知道账册吗？", 5
		}
		calls := len(report.Calls)
		start = time.Now()
		_, _, err = s.Advance(ctx, account, c.ExperienceID, AdvanceRequest{RequestID: "replay-" + mode, BranchID: c.BranchID, ExpectedRevision: revision, Mode: mode, Input: input})
		if err == nil {
			err = s.GenerateAccepted(ctx, account, "replay-"+mode)
		}
		operation, opErr := pgq.New(s.DB).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: account, RequestID: "replay-" + mode})
		if err != nil || opErr != nil || operation.Status != "committed" {
			failReplay(mode, fmt.Errorf("generate=%v operation=%v status=%s error=%s", err, opErr, operation.Status, operation.ErrorCode.String))
			return
		}
		var candidate Candidate
		var approval NarrativeApproval
		if err = StrictJSON(operation.Candidate, &candidate); err != nil {
			failReplay(mode+" candidate", err)
			return
		}
		if err = StrictJSON(operation.NarrativeApproval, &approval); err != nil {
			failReplay(mode+" approval", err)
			return
		}
		raw, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: account, ExperienceID: c.ExperienceID, BranchID: c.BranchID, Revision: revision + 1})
		if err != nil {
			failReplay(mode+" state", err)
			return
		}
		var state State
		if err = StrictJSON(raw, &state); err != nil {
			failReplay(mode+" decode state", err)
			return
		}
		wait := time.Since(start).Milliseconds()
		report.Pages = append(report.Pages, engineLivePage{Mode: mode, Input: input, Revision: revision + 1, WaitMS: wait, ModelCalls: len(report.Calls) - calls, Text: candidate.Passage, State: state})
		if mode == "read" {
			report.CacheWaitMS, report.CacheModelCalls = wait, len(report.Calls)-calls
			report.ReadCandidate, report.ReadApproval = &candidate, &approval
			if report.CacheModelCalls != 0 {
				failReplay("cache hit", fmt.Errorf("unexpected %d model calls", report.CacheModelCalls))
				return
			}
		} else {
			report.AskWaitMS, report.AskStateUnchanged = wait, reflect.DeepEqual(report.Pages[0].State, state)
			report.AskCandidate, report.AskApproval = &candidate, &approval
			if !report.AskStateUnchanged {
				failReplay("ask", fmt.Errorf("mutated state"))
				return
			}
		}
		save()
		t.Logf("mode=%s revision=%d wait_ms=%d calls=%d", mode, revision+1, wait, len(report.Calls)-calls)
	}
}

func TestNarrativeEngineReplayContext(t *testing.T) {
	var scenario struct {
		ID    string              `json:"id"`
		Seed  string              `json:"seed"`
		Steps []narrativeEvalStep `json:"steps"`
	}
	if err := json.Unmarshal(narrativeScenarioJSON, &scenario); err != nil {
		t.Fatal(err)
	}
	pages := []engineLivePage{}
	for i := 0; i < 4; i++ {
		state := EmptyState()
		state.Narrative = notebookFixture(int64(i + 1))
		pages = append(pages, engineLivePage{Revision: int64(i + 1), Mode: scenario.Steps[i].Mode, Input: scenario.Steps[i].Input, Text: fmt.Sprintf("synthetic page %d", i+1), State: state})
	}
	report := engineLiveReport{Scenario: scenario.ID, Pages: pages}
	c, err := narrativeReplayContext(narrativeJSON(report))
	if err != nil {
		t.Fatal(err)
	}
	if c.Revision != 4 || c.Mode != "read" || c.Seed != scenario.Seed || !c.HistoryComplete || !c.StateCoverage.Complete || len(c.History) != 4 || c.State.Narrative.ThroughRevision != 4 || c.ReadBudget.MaxReads != 0 {
		t.Fatalf("invalid replay context: %+v", c)
	}
	for _, invalid := range []string{"foreign scenario", "missing page", "duplicate revision", "foreign input"} {
		t.Run(invalid, func(t *testing.T) {
			v := report
			v.Pages = append([]engineLivePage(nil), pages...)
			switch invalid {
			case "foreign scenario":
				v.Scenario = "not synthetic fixture"
			case "missing page":
				v.Pages = v.Pages[:3]
			case "duplicate revision":
				v.Pages = append(v.Pages, v.Pages[3])
			case "foreign input":
				v.Pages[1].Input = "unrelated input"
			}
			if _, err := narrativeReplayContext(narrativeJSON(v)); err == nil {
				t.Fatal("nonmatching replay source accepted")
			}
		})
	}
	t.Run("isolated_restore_cache_and_ask_with_synthetic_generator", func(t *testing.T) {
		// Protocol fixture only: no actual model or existing database is used.
		s, _, _ := testService(t)
		s.NarrativeEngine = true
		calls := 0
		s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
			calls++
			return approvedSynthetic(c), nil
		})
		ctx := context.Background()
		c, err := seedNarrativeReplay(ctx, s, narrativeJSON(report), "replay-fixture")
		must(t, err)
		must(t, s.PrepareNext(ctx, "replay-fixture", c.ExperienceID, c.BranchID, 4))
		if calls != 1 {
			t.Fatal("preparation did not run exactly once")
		}
		for i, mode := range []string{"read", "ask"} {
			input := ""
			if mode == "ask" {
				input = "现在有什么已知信息？"
			}
			_, _, err = s.Advance(ctx, "replay-fixture", c.ExperienceID, AdvanceRequest{RequestID: mode, BranchID: c.BranchID, ExpectedRevision: int64(4 + i), Mode: mode, Input: input})
			must(t, err)
			must(t, s.GenerateAccepted(ctx, "replay-fixture", mode))
			operation, err := pgq.New(s.DB).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: "replay-fixture", RequestID: mode})
			must(t, err)
			if operation.Status != "committed" || calls != i+1 {
				t.Fatalf("mode=%s status=%s calls=%d error=%s", mode, operation.Status, calls, operation.ErrorCode.String)
			}
		}
		before, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "replay-fixture", ExperienceID: c.ExperienceID, BranchID: c.BranchID, Revision: 5})
		must(t, err)
		after, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "replay-fixture", ExperienceID: c.ExperienceID, BranchID: c.BranchID, Revision: 6})
		must(t, err)
		if string(before) != string(after) {
			t.Fatal("ask changed restored state")
		}
	})
}

func TestNarrativeEngineReplaySourceEvidence(t *testing.T) {
	path := os.Getenv("ELSELIFE_NARRATIVE_REPLAY_SOURCE")
	if path == "" {
		t.Skip("explicit replay source required; no model calls")
	}
	if !filepath.IsAbs(path) {
		t.Fatal("source must be absolute")
	}
	raw, err := os.ReadFile(path)
	must(t, err)
	c, err := narrativeReplayContext(raw)
	must(t, err)
	t.Logf("validated synthetic source revision=%d context_bytes=%d notebook_bytes=%d", c.Revision, len(narrativeJSON(c)), len(narrativeJSON(c.State.Narrative)))
}
