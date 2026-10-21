//go:build integration && codexlive

package experience

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"elselife/backend/internal/capability/model"
)

// This deliberately missing local executable tests evidence diagnostics without
// using a model, credentials, a database or a narrative-quality assertion.
func TestDeepBenchmarkModelFailureRecordsSafeMetadata(t *testing.T) {
	dir := t.TempDir()
	provider, err := model.NewCodexCLI(filepath.Join(dir, "private-executable-not-installed"), "private-auth-location", "", dir)
	must(t, err)
	path := filepath.Join(dir, "events.jsonl")
	file, err := os.Create(path)
	must(t, err)
	t.Cleanup(func() { _ = file.Close() })
	measured := &deepMeasuredModel{Generator: provider, evidence: &deepEvidence{file: file}}
	_, err = measured.Generate(context.Background(), model.Request{
		Messages: []model.Message{{Role: "user", Content: "synthetic request"}},
		Schema:   json.RawMessage(`{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}`),
	})
	if !errors.Is(err, model.ErrRequestFailed) || measured.calls != 1 {
		t.Fatalf("failure or call count changed: %v / %d", err, measured.calls)
	}
	raw, err := os.ReadFile(path)
	must(t, err)
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected one request and one failure result, got %d", len(lines))
	}
	var result struct {
		Kind string `json:"kind"`
		Data struct {
			Error   string                       `json:"error"`
			Details model.CodexFailureDiagnostic `json:"failure_details"`
		} `json:"data"`
	}
	must(t, json.Unmarshal([]byte(lines[1]), &result))
	if result.Kind != "model_result" || result.Data.Error != model.ErrRequestFailed.Error() || result.Data.Details.Phase != "start" || result.Data.Details.Category != "process_error" || result.Data.Details.ExitCode != nil {
		t.Fatalf("missing or misclassified process-start evidence: %+v", result)
	}
	for _, secret := range []string{"private-executable", "private-auth-location", dir} {
		if strings.Contains(lines[1], secret) {
			t.Fatal("model failure evidence exposed private configuration")
		}
	}
}

// Real CLI adapter and benchmark event writer, synthetic subprocess only:
// no real model, account, database, or narrative-quality assertion.
func TestDeepBenchmarkModelFailureRecordsReportedReasonWithoutRawOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("synthetic CLI subprocess requires POSIX")
	}
	for _, tc := range []struct{ name, message, reason string }{
		{"retry_429", "exceeded retry limit, last status: 429 Too Many Requests", "retry_limit_429"},
		{"high_demand", "We’re currently experiencing high demand, which may cause temporary errors.", "high_demand"},
	} {
		for _, exit := range []int{0, 7} {
			t.Run(fmt.Sprintf("%s/exit_%d", tc.name, exit), func(t *testing.T) {
				dir := t.TempDir()
				executable := filepath.Join(dir, "private-synthetic-cli")
				script := "#!/bin/sh\ncat \"$DEEP_DIAGNOSTIC_WIRE\"\nprintf x >> \"$DEEP_DIAGNOSTIC_CALLS\"\nprintf 'secret https://secret.invalid/provider-token' >&2\nexit " + fmt.Sprint(exit) + "\n"
				must(t, os.WriteFile(executable, []byte(script), 0700))
				wire, calls := filepath.Join(dir, "wire.jsonl"), filepath.Join(dir, "calls")
				first, err := json.Marshal(map[string]any{"type": "error", "message": tc.message})
				must(t, err)
				last, err := json.Marshal(map[string]any{"type": "turn.failed", "error": map[string]any{"message": tc.message}})
				must(t, err)
				must(t, os.WriteFile(wire, []byte(string(first)+"\n"+string(last)+"\n"), 0600))
				t.Setenv("DEEP_DIAGNOSTIC_WIRE", wire)
				t.Setenv("DEEP_DIAGNOSTIC_CALLS", calls)
				provider, err := model.NewCodexCLI(executable, filepath.Join(dir, "private-auth-location"), "synthetic", dir)
				must(t, err)
				path := filepath.Join(dir, "events.jsonl")
				file, err := os.Create(path)
				must(t, err)
				t.Cleanup(func() { _ = file.Close() })
				measured := &deepMeasuredModel{Generator: provider, evidence: &deepEvidence{file: file}}
				_, err = measured.Generate(context.Background(), model.Request{
					Messages: []model.Message{{Role: "user", Content: "synthetic request"}},
					Schema:   json.RawMessage(`{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}`),
				})
				if !errors.Is(err, model.ErrRequestFailed) || err.Error() != model.ErrRequestFailed.Error() || measured.calls != 1 {
					t.Fatalf("failure or measured count changed: %v / %d", err, measured.calls)
				}
				count, readErr := os.ReadFile(calls)
				must(t, readErr)
				if string(count) != "x" {
					t.Fatalf("subprocess was retried: %q", count)
				}
				raw, err := os.ReadFile(path)
				must(t, err)
				lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
				if len(lines) != 2 {
					t.Fatalf("expected one request and result, got %d", len(lines))
				}
				var event struct {
					Kind string `json:"kind"`
					Data struct {
						Call    int                          `json:"call"`
						Error   string                       `json:"error"`
						Details model.CodexFailureDiagnostic `json:"failure_details"`
					} `json:"data"`
				}
				must(t, json.Unmarshal([]byte(lines[1]), &event))
				if event.Kind != "model_result" || event.Data.Call != 1 || event.Data.Error != model.ErrRequestFailed.Error() ||
					event.Data.Details.ReportedReason != tc.reason || event.Data.Details.EventType != "error" {
					t.Fatalf("reported reason was lost or changed in evidence: %+v", event)
				}
				details := event.Data.Details
				if exit == 0 && (details.Phase != "event" || details.Category != "reported_failure") ||
					exit != 0 && (details.Phase != "exit" || details.Category != "process_error" || details.ExitCode == nil || *details.ExitCode != exit) {
					t.Fatalf("original diagnostic path changed: %+v", details)
				}
				for _, forbidden := range []string{tc.message, `"message"`, "secret", "https://", "private-", dir} {
					if strings.Contains(lines[1], forbidden) {
						t.Fatal("model_result leaked raw message, URL, stderr or private path")
					}
				}
			})
		}
	}
}
