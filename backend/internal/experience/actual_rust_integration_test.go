//go:build integration

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
)

func rustErrorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// This runs the ACTUAL sibling executable with local HTTP only. The fixture's
// explicit window/byte fallback is a test declaration, not supplier certification.
func TestActualRustCanonicalPartialHistoryReverseHTTPAndCapacityFailure(t *testing.T) {
	source := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if source == "" {
		t.Skip("explicit actual Rust executable required")
	}
	in, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	binary := filepath.Join(t.TempDir(), "algorithm-runtime")
	out, err := os.OpenFile(binary, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0700)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.New()
	_, err = io.Copy(io.MultiWriter(out, digest), in)
	out.Close()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("actual Rust immutable executable sha256=%x", digest.Sum(nil))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	command := exec.Command(binary, "--listen", addr, "--insecure-plaintext")
	command.Dir = t.TempDir()
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + command.Dir}
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()
	t.Cleanup(func() {
		_ = command.Process.Kill()
		select {
		case <-exited:
		case <-time.After(5 * time.Second):
			t.Error("actual Rust process did not exit")
		}
	})
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	ready := false
	for !ready {
		conn, e := net.DialTimeout("tcp", addr, 50*time.Millisecond)
		if e == nil {
			conn.Close()
			ready = true
			break
		}
		select {
		case e := <-exited:
			t.Fatal("actual Rust listener exited", e)
		case <-deadline.C:
			t.Fatal("actual Rust listener unavailable")
		case <-tick.C:
		}
	}
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-http-only" {
			t.Error("HTTP credential missing")
		}
		var body struct {
			Model     string          `json:"model"`
			Messages  []model.Message `json:"messages"`
			MaxTokens int             `json:"max_tokens"`
			Format    json.RawMessage `json:"response_format"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Messages) != 2 || body.Model != "world-explicit" || body.MaxTokens != 8192 {
			t.Error("whole actual carrier mismatch")
		}
		calls.Add(1)
		raw, _ := json.Marshal(map[string]any{"result": sampleCandidate()})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(raw)}, "finish_reason": "stop"}}})
	}))
	defer provider.Close()
	adapter, err := model.NewOpenAIWithClient(provider.URL, "fixture-http-only", "world-explicit", provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	a := &Algorithm{Link: link, Model: adapter, ModelName: "world-explicit", Timeout: 5 * time.Second, ModelContextTokens: 131072, ModelByteTokenBoundVerified: true}
	ctx := sampleContext()
	// The sibling executable on disk may still be a v1-only decoder. The
	// frozen v2 contract requires a v1 consumer to reject v2 rather than read
	// partial state as complete, so without an explicitly v2-capable binary we
	// assert that fail-closed boundary and do NOT claim the v2 success path.
	v2capable := os.Getenv("ELSELIFE_TEST_RUST_EXPERIENCE_V2") == "1"
	for n := 0; n < 2; n++ {
		if n == 1 {
			ctx.Mode = "read"
			ctx.Revision = 1
			ctx.History = []HistoryPage{{Revision: 1, Mode: "begin", Text: "完整最近页  原字。\n不可假装全历史。"}}
			ctx.HistoryComplete = false
		}
		got, err := a.Generate(context.Background(), ctx, fmt.Sprintf("actual-rust-%d", n))
		if !v2capable {
			if rustErrorCode(err) != "algorithm_protocol" || calls.Load() != 0 {
				t.Fatalf("v1-only Rust did not fail closed on a v2 context: err=%v calls=%d", err, calls.Load())
			}
			continue
		}
		if err != nil || got.Passage != sampleCandidate().Passage {
			t.Fatal("actual Rust canonical decision failed", err)
		}
	}
	if !v2capable {
		t.Log("frozen v2 boundary rejected by the on-disk v1-only Rust as required; v2 success path needs a v2-capable Rust binary and stays UNKNOWN")
		return
	}
	if calls.Load() != 2 {
		t.Fatal("one logical round did not make one fixture request", calls.Load())
	}
	a.ModelContextTokens = 10000
	if _, err := a.Generate(context.Background(), ctx, "actual-budget-exceeded"); rustErrorCode(err) != "context_budget_exceeded" || calls.Load() != 2 {
		t.Fatal("actual result.frame budget reason lost", err, calls.Load())
	}
	a.ModelByteTokenBoundVerified = false
	if _, err := a.Generate(context.Background(), ctx, "actual-unknown-capacity"); rustErrorCode(err) != "context_limit_unknown" || calls.Load() != 2 {
		t.Fatal("unknown capacity fabricated", err)
	}
}
