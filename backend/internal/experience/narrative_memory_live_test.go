//go:build integration && codexlive

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"elselife/backend/internal/sqlc/pgq"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Keep allowlisted provider metadata without logging raw stderr or changing
// invocation/retry behavior. A generic error string alone loses this evidence.
type memoryLiveDiagnosticModel struct {
	model.Generator
	directory string
	calls     int
}

func (m *memoryLiveDiagnosticModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	m.calls++
	result, err := m.Generator.Generate(ctx, request)
	if err != nil {
		if diagnostic, ok := model.CodexFailureMetadata(err); ok {
			raw, marshalErr := json.MarshalIndent(diagnostic, "", "  ")
			if marshalErr == nil {
				_ = os.WriteFile(filepath.Join(m.directory, fmt.Sprintf("provider-failure-%02d.json", m.calls)), raw, 0600)
			}
		}
	}
	return result, err
}

// A fixed synthetic prehistory, actual Rust stage machine, real model and an
// isolated PostgreSQL. Every result (including failures) is retained. Passing
// verifies stage execution and commits, not nonempty memory creation or later
// retrieval. Audit the saved pages and exact outgoing requests separately to
// establish that chain; neither result establishes human literary quality.
func TestNarrativeMemoryLive(t *testing.T) {
	dir := os.Getenv("ELSELIFE_MEMORY_LIVE_DIR")
	if dir == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit memory experiment and model configuration required")
	}
	must(t, os.MkdirAll(dir, 0700))
	report := engineLiveReport{Boundary: "Real model, fixed checked-in NAR-014 synthetic prehistory, isolated PostgreSQL. No retries or selection of best prose. Engineering completion is not literary acceptance.", Scenario: "memory-v49-bakery", Model: os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), Calls: []engineLiveCall{}, Stages: []engineLiveStage{}, Pages: []engineLivePage{}}
	save := func() {
		raw, _ := json.MarshalIndent(report, "", "  ")
		must(t, os.WriteFile(filepath.Join(dir, "live.json"), append(raw, '\n'), 0600))
	}
	defer save()
	runtimeBytes, err := os.ReadFile(os.Getenv("ELSELIFE_TEST_RUST_RUNTIME"))
	must(t, err)
	report.RuntimeSHA256 = fmt.Sprintf("%x", sha256.Sum256(runtimeBytes))
	raw, err := os.ReadFile("testdata/deep_benchmark/NAR-014.json")
	must(t, err)
	var fixture deepFixture
	must(t, json.Unmarshal(raw, &fixture))
	s, _, _ := testService(t)
	view, err := seedDeepFixture(context.Background(), s, fixture, "memory-live", nil)
	must(t, err)
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), report.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	diagnosticModel := &memoryLiveDiagnosticModel{Generator: cli, directory: dir}
	algorithm := &Algorithm{Link: link, Model: &engineLiveModel{Generator: diagnosticModel, report: &report}, ModelName: report.Model, Timeout: 8 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 12}
	algorithm.StageObserver = func(stage string, elapsed time.Duration, code string) {
		report.Stages = append(report.Stages, engineLiveStage{Stage: stage, MS: elapsed.Milliseconds(), Error: code})
		save()
		t.Logf("stage=%s ms=%d error=%s", stage, elapsed.Milliseconds(), code)
	}
	s.NarrativeEngine, s.ProseFirst, s.Generator = true, false, algorithm
	steps := []narrativeEvalStep{
		{Mode: "act", Input: "我把一把椅子拉到何絮和童澈旁边，说：“先坐一分钟吧。你们现在最想说什么？”"},
		{Mode: "read", Input: "继续这一小段休息，看看他们怎样相处，不急着解决全部订单。"},
		{Mode: "ask", Input: "我已经知道这批订单为什么晚了吗？"},
	}
	for i, step := range steps {
		seq := fmt.Sprintf("memory-live-%d", i)
		beforeCalls, started := len(report.Calls), time.Now()
		_, _, err = s.Advance(context.Background(), "memory-live", view.ID, AdvanceRequest{RequestID: seq, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: step.Mode, Input: step.Input})
		if err == nil {
			err = s.GenerateAccepted(context.Background(), "memory-live", seq)
		}
		if err != nil {
			report.Error = err.Error()
			t.Fatal(err)
		}
		next, err := s.Get(context.Background(), "memory-live", view.ID, view.BranchID)
		must(t, err)
		audit, err := pgq.New(s.DB).ExperienceModelInputAudit(context.Background(), pgq.ExperienceModelInputAuditParams{AccountID: "memory-live", OperationID: seq})
		must(t, err)
		auditRaw, _ := json.MarshalIndent(audit, "", "  ")
		must(t, os.WriteFile(filepath.Join(dir, seq+"-inputs.json"), auditRaw, 0600))
		// Decode the exact persisted protobuf requests for a readable evidence
		// trail. The Context column alone is not what each model actually saw.
		readable := []map[string]any{}
		for _, input := range audit {
			var call pb.ModelCallRequest
			must(t, proto.Unmarshal(input.ModelRequest, &call))
			requestJSON, err := protojson.Marshal(&call)
			must(t, err)
			readable = append(readable, map[string]any{
				"sequence": input.Sequence, "request": json.RawMessage(requestJSON),
			})
		}
		readableRaw, _ := json.MarshalIndent(readable, "", "  ")
		must(t, os.WriteFile(filepath.Join(dir, seq+"-inputs-readable.json"), readableRaw, 0600))
		if next.Revision != view.Revision+1 {
			operationJSON, _ := json.Marshal(next.Operation)
			report.Error = fmt.Sprintf("operation failed: %s", operationJSON)
			t.Fatal(report.Error)
		}
		stateRaw, err := pgq.New(s.DB).ExperienceSnapshot(context.Background(), pgq.ExperienceSnapshotParams{AccountID: "memory-live", ExperienceID: view.ID, BranchID: view.BranchID, Revision: next.Revision})
		must(t, err)
		var state State
		must(t, json.Unmarshal(stateRaw, &state))
		page := engineLivePage{Mode: step.Mode, Input: step.Input, Revision: next.Revision, WaitMS: time.Since(started).Milliseconds(), ModelCalls: len(report.Calls) - beforeCalls, Text: next.Pages[len(next.Pages)-1].Text, State: state}
		report.Pages = append(report.Pages, page)
		save()
		if step.Mode != "ask" && state.LiteraryMemory == nil {
			t.Fatal("live extraction did not persist a local literary memory result")
		}
		if page.ModelCalls > 12 {
			t.Fatal("operation exceeded unchanged model-call budget")
		}
		view = next
	}
}
