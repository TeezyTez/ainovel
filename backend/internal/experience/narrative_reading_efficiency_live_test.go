//go:build integration && codexlive

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
)

type readingEfficiencyLiveCall struct {
	Stage             string `json:"stage"`
	MS                int64  `json:"ms"`
	RequestBytes      int    `json:"request_bytes"`
	OutputBytes       int    `json:"output_bytes"`
	ContextTokenLimit int    `json:"context_token_limit"`
	RequestFile       string `json:"request_file,omitempty"`
	Output            string `json:"output"`
	Error             string `json:"error,omitempty"`
}

type readingEfficiencyLiveReport struct {
	Boundary       string                      `json:"boundary"`
	Seed           string                      `json:"synthetic_seed"`
	SeedPassage    string                      `json:"synthetic_seed_passage"`
	Model          string                      `json:"model"`
	RuntimeSHA256  string                      `json:"runtime_sha256"`
	Mode           string                      `json:"mode"`
	Input          string                      `json:"input"`
	ReadingRequest string                      `json:"reading_request"`
	Stages         []engineLiveStage           `json:"stages"`
	Calls          []readingEfficiencyLiveCall `json:"calls"`
	WaitMS         int64                       `json:"wait_ms"`
	Status         string                      `json:"status"`
	Revision       int64                       `json:"revision"`
	Characters     int                         `json:"characters"`
	Han            int                         `json:"han_characters"`
	Paragraphs     int                         `json:"paragraphs"`
	ExtractBytes   int                         `json:"extract_output_bytes"`
	Text           string                      `json:"committed_text"`
	Error          string                      `json:"error,omitempty"`
}

type readingEfficiencyLiveModel struct {
	model.Generator
	mu           sync.Mutex
	report       *readingEfficiencyLiveReport
	directory    string
	savedExtract bool
}

func (m *readingEfficiencyLiveModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	raw, err := json.Marshal(request)
	if err != nil {
		return model.Result{}, err
	}
	stage, requestFile := readingEfficiencyStage(request), ""
	if stage == "extract" || stage == "repair_extract" {
		// model.Request contains only the synthetic model input, never CLI
		// credentials. ContextTokenLimit is json:-, so retain it in the call
		// report for exact replay alongside this unmodified request.
		requestFile = fmt.Sprintf("%s-request-%02d.json", stage, len(m.report.Calls)+1)
		if err := os.WriteFile(filepath.Join(m.directory, requestFile), append(raw, '\n'), 0600); err != nil {
			return model.Result{}, err
		}
		if stage == "extract" && !m.savedExtract {
			if err := os.WriteFile(filepath.Join(m.directory, "extract-request.json"), append(raw, '\n'), 0600); err != nil {
				return model.Result{}, err
			}
			m.savedExtract = true
		}
	}
	started := time.Now()
	result, err := m.Generator.Generate(ctx, request)
	entry := readingEfficiencyLiveCall{Stage: stage, MS: time.Since(started).Milliseconds(), RequestBytes: len(raw), OutputBytes: len(result.Text), ContextTokenLimit: request.ContextTokenLimit, RequestFile: requestFile, Output: result.Text}
	if err != nil {
		entry.Error = err.Error()
	}
	m.mu.Lock()
	m.report.Calls = append(m.report.Calls, entry)
	if entry.Stage == "extract" || entry.Stage == "repair_extract" {
		m.report.ExtractBytes += entry.OutputBytes
	}
	m.mu.Unlock()
	return result, err
}

// One ordinary default read after a fixed synthetic beginning. The real model
// receives no length override, no expected answer, and no automatic retry for a
// short page. Measurements are evidence for human review, not a quality verdict.
func TestNarrativeReadingEfficiencyLive(t *testing.T) {
	outDir := os.Getenv("ELSELIFE_NARRATIVE_EVAL_DIR")
	binary := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if outDir == "" || binary == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit real-model CLI, Rust runtime and ELSELIFE_NARRATIVE_EVAL_DIR required")
	}
	must(t, os.MkdirAll(outDir, 0700))
	report := readingEfficiencyLiveReport{
		Boundary:    "Real model on one cold default read; fixed synthetic beginning; isolated disposable PostgreSQL. No real-model begin, preparation, rerun-to-length, literary-quality PASS or production acceptance. Character count includes punctuation/whitespace; Han count uses Unicode Han; paragraphs split on blank lines.",
		Seed:        "这是验证入口使用的合成故事。你在临港城旧街的一间小茶铺帮忙，今天傍晚有雨。阿禾是茶铺掌柜，正在核对一册普通的进货账本；一批订好的茶叶比约定晚了一天，到货原因尚不清楚。你们都还没有做出处理决定。用第二人称中文叙述日常经历，人物有自己的工作、情绪和判断，继续阅读时允许展开普通对话、观察与小事件；不要替你决定重大承诺。",
		SeedPassage: "雨水顺着茶铺门口的布帘滴下来。你把最后一张长凳推回墙边，掌柜阿禾还坐在柜台后，指尖停在账本的一行字上。\n\n「说好昨天到的茶，今天也没有来。」她将摊开的账本朝你这边挪了一点，又看了一眼门外渐暗的街道。炉上的水刚冒出细小的响声，前厅还留着两只没有收走的茶杯。",
		Model:       os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), Mode: "read",
		Stages: []engineLiveStage{}, Calls: []readingEfficiencyLiveCall{},
	}
	save := func() {
		raw, err := json.MarshalIndent(report, "", "  ")
		if err == nil {
			err = os.WriteFile(filepath.Join(outDir, "reading-efficiency.json"), append(raw, '\n'), 0600)
		}
		if err != nil {
			t.Errorf("write reading efficiency evidence: %v", err)
		}
	}
	defer save()
	runtimeFile, err := os.Open(binary)
	must(t, err)
	runtimeHash := sha256.New()
	_, err = io.Copy(runtimeHash, runtimeFile)
	_ = runtimeFile.Close()
	must(t, err)
	report.RuntimeSHA256 = fmt.Sprintf("%x", runtimeHash.Sum(nil))

	ctx := context.Background()
	service, _, _ := testService(t)
	service.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		seed := candidate(c)
		seed.Title, seed.Passage, seed.StoryTime = "茶铺傍晚", report.SeedPassage, "傍晚"
		seed.Suggestions = []string{}
		seed.NewEntities = []Entity{{ID: "ahe", Kind: "person", Name: "阿禾", Description: "旧街茶铺的掌柜", Known: true, RelatedIDs: []string{}}}
		seed.NewFacts = []Fact{{ID: "late-tea", Kind: "statement", Text: "阿禾说约定昨天送到的茶叶今天仍未送来，原因尚不清楚。", SubjectID: "ahe", Known: true, KnownBy: []string{"ahe"}, SourceRevision: 1}}
		return seed, nil
	})
	const account = "synthetic-reading-efficiency-live"
	view, fresh, err := service.Create(ctx, account, CreateRequest{RequestID: "synthetic-begin", Seed: report.Seed})
	must(t, err)
	if !fresh {
		t.Fatal("synthetic seed was not fresh")
	}
	must(t, service.GenerateAccepted(ctx, account, "synthetic-begin"))
	view, err = service.Get(ctx, account, view.ID, view.BranchID)
	must(t, err)
	if view.Revision != 1 || len(view.Pages) != 1 || view.Pages[0].Text != report.SeedPassage {
		t.Fatal("fixed synthetic beginning did not commit")
	}

	link := channel.NewLink(ctx, channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), report.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	measured := &readingEfficiencyLiveModel{Generator: cli, report: &report, directory: outDir}
	algorithm := &Algorithm{Link: link, Model: measured, ModelName: report.Model, Timeout: 8 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
	algorithm.StageObserver = func(stage string, elapsed time.Duration, code string) {
		report.Stages = append(report.Stages, engineLiveStage{Stage: stage, MS: elapsed.Milliseconds(), Error: code})
		save()
		t.Logf("stage=%s ms=%d error=%s", stage, elapsed.Milliseconds(), code)
	}
	service.NarrativeEngine, service.ProseFirst, service.Generator = true, false, algorithm
	started := time.Now()
	const requestID = "default-read"
	_, _, err = service.Advance(ctx, account, view.ID, AdvanceRequest{RequestID: requestID, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: "read"})
	if err == nil {
		err = service.GenerateAccepted(ctx, account, requestID)
	}
	report.WaitMS = time.Since(started).Milliseconds()
	if err != nil {
		report.Error = err.Error()
		t.Fatal(err)
	}
	after, err := service.Get(ctx, account, view.ID, view.BranchID)
	must(t, err)
	operation, err := service.GetOperation(ctx, account, view.ID, requestID)
	must(t, err)
	report.Status, report.Revision = operation.Status, after.Revision
	if operation.Status != "committed" || after.Revision != 2 || len(after.Pages) != 2 {
		report.Error = fmt.Sprintf("default read did not commit: status=%s code=%v revision=%d", operation.Status, operation.ErrorCode, after.Revision)
		if operation.ErrorCode != nil {
			report.Error = fmt.Sprintf("default read did not commit: status=%s code=%s revision=%d", operation.Status, *operation.ErrorCode, after.Revision)
		}
		t.Fatal(report.Error)
	}
	report.Text = after.Pages[1].Text
	report.Characters, report.Han, report.Paragraphs = readingEfficiencyTextCounts(report.Text)
	must(t, os.WriteFile(filepath.Join(outDir, "reading-efficiency-passage.txt"), []byte(report.Text), 0600))
	if len(report.Calls) > 12 {
		t.Fatal("default read exceeded unchanged model-call budget")
	}
	reviewed := false
	for _, call := range report.Calls {
		reviewed = reviewed || call.Stage == "review"
	}
	if !reviewed {
		t.Fatal("default read committed without an independent review call")
	}
	t.Logf("default_read wait_ms=%d calls=%d characters=%d han=%d paragraphs=%d extract_output_bytes=%d", report.WaitMS, len(report.Calls), report.Characters, report.Han, report.Paragraphs, report.ExtractBytes)
}
