//go:build integration

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

func copyActualRuntimeBinary(source, binary string) (string, error) {
	input, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer input.Close()
	output, err := os.OpenFile(binary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if err != nil {
		return "", err
	}
	sum := sha256.New()
	// Hide File.WriteTo so CopyBuffer always uses this bounded read buffer,
	// including on DrvFS where one executable-sized read can fail with ENOMEM.
	_, copyErr := io.CopyBuffer(io.MultiWriter(output, sum), struct{ io.Reader }{input}, make([]byte, 64<<10))
	closeErr := output.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return fmt.Sprintf("%x", sum.Sum(nil)), nil
}

func actualReadRuntime(t *testing.T) string {
	t.Helper()
	source := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if source == "" {
		t.Skip("explicit actual Rust executable required")
	}
	binary := filepath.Join(t.TempDir(), "runtime")
	sum, err := copyActualRuntimeBinary(source, binary)
	must(t, err)
	t.Logf("actual Rust executable sha256=%s", sum)
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	must(t, err)
	addr := lis.Addr().String()
	lis.Close()
	cmd := exec.Command(binary, "--listen", addr, "--insecure-plaintext")
	cmd.Dir = t.TempDir()
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + cmd.Dir}
	logPath := filepath.Join(cmd.Dir, "runtime.log")
	output, err := os.Create(logPath)
	must(t, err)
	t.Cleanup(func() { _ = output.Close() })
	cmd.Stdout, cmd.Stderr = output, output
	runtimeLog := func() string {
		raw, err := os.ReadFile(logPath)
		if err != nil {
			return "runtime log unavailable: " + err.Error()
		}
		return string(raw)
	}
	must(t, cmd.Start())
	// A closed channel broadcasts completion to readiness and cleanup. A single
	// error value would be consumed by readiness and make cleanup falsely time out.
	exited := make(chan struct{})
	var waitErr error
	go func() {
		waitErr = cmd.Wait()
		close(exited)
	}()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		select {
		case <-exited:
		case <-time.After(3 * time.Second):
			t.Errorf("runtime failed to exit\n%s", runtimeLog())
		}
	})
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		conn, err := net.DialTimeout("tcp", addr, 20*time.Millisecond)
		if err == nil {
			conn.Close()
			return addr
		}
		select {
		case <-exited:
			t.Fatalf("runtime exited before becoming ready: %v\n%s", waitErr, runtimeLog())
		case <-deadline.C:
			t.Fatalf("runtime never ready\n%s", runtimeLog())
		case <-tick.C:
		}
	}
}
func bootstrapOldState(t *testing.T, s *Service, account string) View {
	t.Helper()
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		v := candidate(c)
		if c.Revision == 0 {
			for i := 0; i < 80; i++ {
				v.NewFacts = append(v.NewFacts, Fact{ID: fmt.Sprintf("old-%03d", i), Kind: "fact", Text: fmt.Sprintf("第%d个早期承诺：", i) + strings.Repeat("中文原字  保留。\n", 25), Known: true, KnownBy: []string{}, SourceRevision: 1})
			}
		}
		return v, nil
	})
	v := begin(t, s, account, "start")
	for i := 1; i < 20; i++ {
		v = advance(t, s, account, v, fmt.Sprintf("bootstrap-%d", i), "read")
	}
	return v
}

// The actual sibling binary asks Go for omitted committed source in the SAME
// operation, then invokes the policy-free local HTTP carrier again and commits
// once. The view is bounded while 80 complete authority facts remain binding.
func TestActualRustSameOperationSourceReadAndFullAuthorityCommit(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := bootstrapOldState(t, s, "actual-read")
	s.MaxContextBytes = 9000
	s.RecentRevisions = 2
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []model.Message `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Messages) != 2 {
			t.Error("actual model messages invalid")
			w.WriteHeader(400)
			return
		}
		var input struct {
			Context Context `json:"context"`
		}
		if json.Unmarshal([]byte(body.Messages[1].Content), &input) != nil {
			t.Error("actual prompt context invalid")
			w.WriteHeader(400)
			return
		}
		c := input.Context
		n := calls.Add(1)
		if c.StateCoverage.Complete || c.StateCoverage.Total.Facts != 80 || len(c.State.Facts) != 0 || c.ReadBudget.MaxReads != 4 {
			t.Errorf("not bounded authorized generation: %+v", c.StateCoverage)
		}
		var result any
		if n == 1 {
			result = ReadRequest{RequestID: "old-promise", SourceHandle: c.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: "old-079"}}}, MaxReplyBytes: 8192}
		} else {
			if len(c.Recalls) != 1 || !c.Recalls[0].Complete || len(c.Recalls[0].Objects) != 1 {
				t.Error("real recall missing")
				w.WriteHeader(400)
				return
			}
			var fact Fact
			_ = json.Unmarshal(c.Recalls[0].Objects[0].Body, &fact)
			if fact.ID != "old-079" || !strings.Contains(fact.Text, "中文原字  保留。\n") || c.Recalls[0].Objects[0].AsOfRevision != 20 || fact.SourceRevision != 1 {
				t.Error("raw source/asof/provenance lost")
			}
			result = candidate(c)
		}
		raw, _ := json.Marshal(map[string]any{"result": result})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(raw)}, "finish_reason": "stop"}}})
	}))
	defer provider.Close()
	adapter, err := model.NewOpenAIWithClient(provider.URL, "local-fixture", "world-explicit", provider.Client())
	must(t, err)
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: actualReadRuntime(t), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	s.Generator = &Algorithm{Link: link, Model: adapter, ModelName: "world-explicit", Timeout: 5 * time.Second, ModelContextTokens: 131072, ModelByteTokenBoundVerified: true, MaxModelCalls: 5}
	req := AdvanceRequest{RequestID: "read-old", BranchID: v.BranchID, ExpectedRevision: 20, Mode: "read", Input: "继续"}
	_, fresh, err := s.Advance(ctx, "actual-read", v.ID, req)
	must(t, err)
	if !fresh {
		t.Fatal("not accepted")
	}
	must(t, s.GenerateAccepted(ctx, "actual-read", req.RequestID))
	after, err := s.Get(ctx, "actual-read", v.ID, v.BranchID)
	must(t, err)
	rawState, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "actual-read", ExperienceID: v.ID, BranchID: v.BranchID, Revision: after.Revision})
	must(t, err)
	var full State
	must(t, json.Unmarshal(rawState, &full))
	if after.Revision != 21 || len(after.Pages) != 21 || len(full.Facts) != 80 || calls.Load() != 2 {
		t.Fatalf("authority or single commit lost: revision=%d facts=%d calls=%d", after.Revision, len(full.Facts), calls.Load())
	}
	_, fresh, err = s.Advance(ctx, "actual-read", v.ID, req)
	must(t, err)
	if fresh {
		t.Fatal("same request generated again")
	}
	q := pgq.New(s.DB)
	reads, err := q.ExperienceReadAudit(ctx, pgq.ExperienceReadAuditParams{AccountID: "actual-read", OperationID: req.RequestID})
	must(t, err)
	models, err := q.ExperienceModelInputAudit(ctx, pgq.ExperienceModelInputAuditParams{AccountID: "actual-read", OperationID: req.RequestID})
	must(t, err)
	if len(reads) != 1 || len(models) != 2 {
		t.Fatal("actual view/receipt not durable", len(reads), len(models))
	}
	var second Context
	must(t, json.Unmarshal(models[1].Context, &second))
	if len(second.Recalls) != 1 || second.StateCoverage.Complete {
		t.Fatal("audit did not retain actual partial view plus source evidence")
	}
	t.Logf("actual read closure: models=%d reads=%d revision=%d authorityfacts=%d contract=%s", len(models), len(reads), after.Revision, len(full.Facts), ContractSHA256)
}
