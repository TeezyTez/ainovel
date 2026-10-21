package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Fake CLI subprocesses exercise failure plumbing only, never model quality.
func TestCodexCLIFailureMetadataPreservesGenericExitAndHidesOutput(t *testing.T) {
	provider, dir := fakeCodex(t, `
printf 'stdout-secret-payload'
printf 'stderr-secret-token' >&2
printf x >> "$TEST_CALLS_FILE"
exit 7`)
	calls := filepath.Join(dir, "calls")
	t.Setenv("TEST_CALLS_FILE", calls)
	req := codexRequest()
	req.Messages[1].Content = "prompt-secret-payload"
	_, err := provider.Generate(context.Background(), req)
	if !errors.Is(err, ErrRequestFailed) || err.Error() != ErrRequestFailed.Error() || errors.Unwrap(err) != ErrRequestFailed {
		t.Fatalf("generic sentinel changed: %v", err)
	}
	details, ok := CodexFailureMetadata(err)
	if !ok || details.Phase != "exit" || details.Category != "process_error" || details.ExitCode == nil || *details.ExitCode != 7 || details.EventType != "" || details.CapturedStdoutBytes != len("stdout-secret-payload") || details.CapturedStderrBytes != len("stderr-secret-token") {
		t.Fatalf("incorrect bounded exit metadata: %+v present=%v", details, ok)
	}
	raw, marshalErr := json.Marshal(details)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	for _, secret := range []string{"stdout-secret", "stderr-secret", "prompt-secret", dir, provider.Path, provider.AuthHome} {
		if strings.Contains(string(raw), secret) || strings.Contains(err.Error(), secret) {
			t.Fatal("failure metadata disclosed private data")
		}
	}
	called, readErr := os.ReadFile(calls)
	if readErr != nil || string(called) != "x" {
		t.Fatalf("failure was retried: %q %v", called, readErr)
	}
	*details.ExitCode = 99
	again, _ := CodexFailureMetadata(err)
	if *again.ExitCode != 7 {
		t.Fatal("accessor aliases stored diagnostic")
	}
}
func TestCodexCLIFailureMetadataClassifiesPreparationAndStart(t *testing.T) {
	for _, tc := range []struct{ name, phase, category string }{{"prepare", "prepare", "io"}, {"start", "start", "process_error"}} {
		t.Run(tc.name, func(t *testing.T) {
			provider, dir := fakeCodex(t, "exit 0")
			if tc.name == "prepare" {
				provider.TempDir = filepath.Join(dir, "private-path-missing-parent", "missing")
			} else {
				provider.Path = filepath.Join(dir, "private-path-missing-executable")
			}
			_, err := provider.Generate(context.Background(), codexRequest())
			details, ok := CodexFailureMetadata(err)
			if !errors.Is(err, ErrRequestFailed) || err.Error() != ErrRequestFailed.Error() || !ok || details.Phase != tc.phase || details.Category != tc.category || details.ExitCode != nil || details.CapturedStdoutBytes != 0 || details.CapturedStderrBytes != 0 {
				t.Fatalf("wrong preparation/start result: %v %+v", err, details)
			}
			raw, err := json.Marshal(details)
			if err != nil || strings.Contains(string(raw), "private-path") {
				t.Fatal("metadata lost closed boundary")
			}
		})
	}
}

func TestCodexCLIFailureMetadataSeparatesProtocolAndParsing(t *testing.T) {
	for _, tc := range []struct {
		name, wire, phase, category, event string
		exit                               int
		want                               error
	}{
		{"error", `{"type":"error","message":"secret-provider-message"}` + "\n", "event", "reported_failure", "error", 0, ErrRequestFailed},
		{"turn_failed", `{"type":"turn.failed","error":{"message":"secret-provider-message"}}` + "\n", "event", "reported_failure", "turn.failed", 0, ErrRequestFailed},
		{"exit_with_event", `{"type":"error","message":"secret-provider-message"}` + "\n", "exit", "process_error", "error", 7, ErrRequestFailed},
		{"invalid_frame", "secret-invalid-wire\n", "parse", "invalid_response", "", 0, ErrInvalidResponse},
		{"unknown_event", `{"type":"secret-unknown-type","message":"secret-provider-message"}` + "\n", "parse", "incomplete_response", "", 0, ErrIncompleteResponse},
		{"invalid_final", `{"type":"item.completed","item":{"type":"agent_message","text":"secret-not-json"}}` + "\n" + `{"type":"turn.completed"}` + "\n", "parse", "invalid_response", "", 0, ErrInvalidResponse},
		{"normalization", `{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"a\",\"answer\":\"secret-duplicate\"}"}}` + "\n" + `{"type":"turn.completed"}` + "\n", "normalize", "invalid_response", "", 0, ErrInvalidResponse},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider, dir := fakeCodex(t, `cat "$TEST_WIRE_FILE"; printf x >> "$TEST_CALLS_FILE"; exit `+fmt.Sprint(tc.exit))
			wire, calls := filepath.Join(dir, "wire"), filepath.Join(dir, "calls")
			if err := os.WriteFile(wire, []byte(tc.wire), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("TEST_WIRE_FILE", wire)
			t.Setenv("TEST_CALLS_FILE", calls)
			_, err := provider.Generate(context.Background(), codexRequest())
			details, ok := CodexFailureMetadata(err)
			if !errors.Is(err, tc.want) || err.Error() != tc.want.Error() || !ok || details.Phase != tc.phase || details.Category != tc.category || details.EventType != tc.event || details.CapturedStdoutBytes != len(tc.wire) || details.CapturedStderrBytes != 0 {
				t.Fatalf("wrong protocol classification: %v %+v", err, details)
			}
			raw, merr := json.Marshal(details)
			if merr != nil || strings.Contains(string(raw), "secret") || strings.Contains(err.Error(), "secret") {
				t.Fatal("untrusted protocol data escaped")
			}
			count, rerr := os.ReadFile(calls)
			if rerr != nil || string(count) != "x" {
				t.Fatal("model failure retried")
			}
		})
	}
}
func TestCodexCLIFailureMetadataPreservesCancellationAndCaptureLimit(t *testing.T) {
	for _, tc := range []struct {
		name, script, phase, category string
		want                          error
	}{
		{"already_cancelled", "exit 0", "prepare", "context_cancelled", context.Canceled},
		{"deadline", "exec sleep 5", "exit", "context_deadline", context.DeadlineExceeded},
		{"limit", "exec head -c 1200000 /dev/zero", "exit", "response_too_large", ErrResponseTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider, _ := fakeCodex(t, tc.script)
			ctx := context.Background()
			if tc.name == "already_cancelled" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			if tc.name == "deadline" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 80*time.Millisecond)
				defer cancel()
			}
			_, err := provider.Generate(ctx, codexRequest())
			details, ok := CodexFailureMetadata(err)
			if !errors.Is(err, tc.want) || err.Error() != tc.want.Error() || !ok || details.Phase != tc.phase || details.Category != tc.category {
				t.Fatalf("classification/semantics changed: %v %+v", err, details)
			}
			if details.CapturedStdoutBytes < 0 || details.CapturedStderrBytes < 0 || details.CapturedStdoutBytes+details.CapturedStderrBytes > 1<<20 {
				t.Fatal("counts claim uncaptured data")
			}
			if _, err := json.Marshal(details); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCodexFailureMetadataRejectsUntrustedLabelsAndIsAbsentOnSuccess(t *testing.T) {
	good := CodexFailureDiagnostic{Phase: "exit", Category: "process_error"}
	for _, change := range []func(*CodexFailureDiagnostic){func(d *CodexFailureDiagnostic) { d.Phase = "secret-phase" }, func(d *CodexFailureDiagnostic) { d.Category = "secret-category" }, func(d *CodexFailureDiagnostic) { d.EventType = "secret-event" }, func(d *CodexFailureDiagnostic) { d.CapturedStdoutBytes = -1 }, func(d *CodexFailureDiagnostic) { d.CapturedStdoutBytes = 1 << 20; d.CapturedStderrBytes = 1 }} {
		bad := good
		change(&bad)
		raw, err := json.Marshal(bad)
		if err == nil || len(raw) > 0 || strings.Contains(err.Error(), "secret-") {
			t.Fatal("metadata is not closed and bounded")
		}
	}
	provider, _ := fakeCodex(t, `printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"ok\"}"}}' '{"type":"turn.completed"}'`)
	result, err := provider.Generate(context.Background(), codexRequest())
	if err != nil || result.Text != `{"answer":"ok"}` {
		t.Fatal("success changed")
	}
	if _, ok := CodexFailureMetadata(err); ok {
		t.Fatal("success gained failure metadata")
	}
	if _, ok := CodexFailureMetadata(ErrRequestFailed); ok {
		t.Fatal("non-CLI errors should not acquire invented metadata")
	}
}
