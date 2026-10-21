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

// These are transport diagnostics, not model-quality tests. The exact messages
// were captured from codex-cli 0.159.0-alpha.12.1 against a synthetic loopback
// provider in .validation/codex-loopback-templates-20261020T072531Z.
const observedCodexRetry429 = "exceeded retry limit, last status: 429 Too Many Requests"
const observedCodexHighDemand = "We’re currently experiencing high demand, which may cause temporary errors."

func TestCodexCLIReportedReasonFromObservedTerminalMessages(t *testing.T) {
	for _, tc := range []struct{ name, message, reason string }{
		{"retry_429", observedCodexRetry429, "retry_limit_429"},
		{"high_demand", observedCodexHighDemand, "high_demand"},
	} {
		for _, exit := range []int{0, 7} {
			t.Run(fmt.Sprintf("%s/exit_%d", tc.name, exit), func(t *testing.T) {
				wire := codexReportedReasonWire(t, tc.message)
				details, raw := generateCodexDiagnosticWire(t, wire, exit)
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(raw, &fields); err != nil {
					t.Fatal(err)
				}
				var reason string
				if err := json.Unmarshal(fields["reported_reason"], &reason); err != nil || reason != tc.reason {
					t.Fatalf("observed terminal message lost its bounded reported reason: %s", raw)
				}
				if exit == 0 && (details.Phase != "event" || details.Category != "reported_failure") ||
					exit != 0 && (details.Phase != "exit" || details.Category != "process_error" || details.ExitCode == nil || *details.ExitCode != exit) {
					t.Fatalf("original failure classification changed: %+v", details)
				}
				if strings.Contains(string(raw), tc.message) {
					t.Fatal("raw CLI message escaped into metadata")
				}
			})
		}
	}
}

func TestCodexCLIReportedReasonAcceptsOnlyTerminalEventMessages(t *testing.T) {
	pair := codexReportedReasonWire(t, observedCodexHighDemand)
	lines := strings.SplitAfter(pair, "\n")
	for _, tc := range []struct{ name, wire string }{
		{"error_only", lines[0]},
		{"turn_failed_only", lines[1]},
		{"ordinary_prefix", `{"type":"thread.started","thread_id":"synthetic"}` + "\n" +
			`{"type":"item.completed","item":{"id":"0","type":"error","message":"secret configuration warning"}}` + "\n" +
			`{"type":"turn.started"}` + "\n" + pair},
	} {
		t.Run(tc.name, func(t *testing.T) {
			details, _ := generateCodexDiagnosticWire(t, tc.wire, 0)
			if details.ReportedReason != "high_demand" {
				t.Fatalf("valid terminal report was not recognized: %+v", details)
			}
		})
	}
}

func TestCodexCLIReportedReasonLeavesAmbiguousOrUntrustedOutputUnknown(t *testing.T) {
	good := codexReportedReasonWire(t, observedCodexHighDemand)
	quoted, _ := json.Marshal(observedCodexHighDemand)
	for _, tc := range []struct{ name, wire string }{
		{"near_ascii_apostrophe", codexReportedReasonWire(t, strings.ReplaceAll(observedCodexHighDemand, "’", "'"))},
		{"leading_space", codexReportedReasonWire(t, " "+observedCodexHighDemand)},
		{"trailing_space", codexReportedReasonWire(t, observedCodexHighDemand+" ")},
		{"request_id_suffix", codexReportedReasonWire(t, observedCodexRetry429+", request id: secret")},
		{"arbitrary_provider_body", codexReportedReasonWire(t, "unexpected status 401 Unauthorized: "+observedCodexHighDemand+", url: https://secret.invalid")},
		{"bare_status", codexReportedReasonWire(t, "429 500 secret")},
		{"unknown_failure", codexReportedReasonWire(t, "secret unknown failure")},
		{"conflicting_reports", strings.SplitAfter(good, "\n")[0] + strings.SplitAfter(codexReportedReasonWire(t, observedCodexRetry429), "\n")[1]},
		{"known_then_unknown", strings.SplitAfter(good, "\n")[0] + `{"type":"turn.failed","error":{"message":"secret"}}` + "\n"},
		{"unknown_then_known", `{"type":"error","message":"secret"}` + "\n" + strings.SplitAfter(good, "\n")[1]},
		{"extra_error_field", `{"type":"error","message":` + string(quoted) + `,"code":"secret"}` + "\n"},
		{"extra_nested_field", `{"type":"turn.failed","error":{"message":` + string(quoted) + `,"status":500}}` + "\n"},
		{"wrong_error_shape", `{"type":"turn.failed","error":` + string(quoted) + `}` + "\n"},
		{"null_message", `{"type":"error","message":null}` + "\n"},
		{"array_message", `{"type":"error","message":[` + string(quoted) + `]}` + "\n"},
		{"duplicate_message", `{"type":"error","message":"secret","message":` + string(quoted) + `}` + "\n"},
		{"duplicate_type", `{"type":"turn.completed","type":"error","message":` + string(quoted) + `}` + "\n"},
		{"duplicate_nested_message", `{"type":"turn.failed","error":{"message":"secret","message":` + string(quoted) + `}}` + "\n"},
		{"duplicate_error_event", strings.SplitAfter(good, "\n")[0] + good},
		{"duplicate_terminal_event", good + strings.SplitAfter(good, "\n")[1]},
		{"success_and_failure", `{"type":"turn.completed"}` + "\n" + good},
		{"failure_then_success", good + `{"type":"turn.completed"}` + "\n"},
		{"unknown_event", `{"type":"secret-event","message":` + string(quoted) + `}` + "\n" + good},
		{"arbitrary_text_prefix", "secret log " + observedCodexHighDemand + "\n" + good},
		{"malformed_tail", good + `{"type":"error"`},
		{"no_final_lf", strings.TrimSuffix(good, "\n")},
		{"only_agent_message", `{"type":"item.completed","item":{"type":"agent_message","text":` + string(quoted) + `}}` + "\n"},
		{"only_item_error", `{"type":"item.completed","item":{"type":"error","message":` + string(quoted) + `}}` + "\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			details, raw := generateCodexDiagnosticWire(t, tc.wire, 7)
			if details.ReportedReason != "" || strings.Contains(string(raw), "reported_reason") {
				t.Fatalf("ambiguous/untrusted output gained a diagnostic reason: %s", raw)
			}
		})
	}
	// The successful-process path returns on its first error event; diagnosis
	// must still inspect the rest of stdout and reject inconsistent evidence.
	t.Run("exit_zero_conflicting_tail", func(t *testing.T) {
		details, _ := generateCodexDiagnosticWire(t,
			strings.SplitAfter(good, "\n")[0]+strings.SplitAfter(codexReportedReasonWire(t, observedCodexRetry429), "\n")[1], 0)
		if details.ReportedReason != "" {
			t.Fatal("later conflicting terminal event was ignored")
		}
	})
}

func TestCodexCLIReportedReasonPreservesCancellationCaptureAndSignal(t *testing.T) {
	for _, tc := range []struct {
		name, tail, category string
		want                 error
	}{
		{"deadline", "exec sleep 5", "context_deadline", context.DeadlineExceeded},
		{"capture_limit", "exec head -c 1200000 /dev/zero", "response_too_large", ErrResponseTooLarge},
		{"signal", "kill -KILL $$", "process_error", ErrRequestFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider, dir := fakeCodex(t, "cat \"$TEST_WIRE_FILE\"\nprintf x >> \"$TEST_CALLS_FILE\"\n"+tc.tail)
			wire, calls := filepath.Join(dir, "wire"), filepath.Join(dir, "calls")
			if err := os.WriteFile(wire, []byte(codexReportedReasonWire(t, observedCodexHighDemand)), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("TEST_WIRE_FILE", wire)
			t.Setenv("TEST_CALLS_FILE", calls)
			ctx := context.Background()
			if tc.name == "deadline" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 200*time.Millisecond)
				defer cancel()
			}
			_, err := provider.Generate(ctx, codexRequest())
			details, ok := CodexFailureMetadata(err)
			if !ok || !errors.Is(err, tc.want) || err.Error() != tc.want.Error() ||
				errors.Unwrap(err) != tc.want || details.Category != tc.category {
				t.Fatalf("failure priority or error chain changed: %v %+v", err, details)
			}
			if tc.name != "signal" && details.ReportedReason != "" {
				t.Fatal("earlier message displaced cancellation/capture-limit classification")
			}
			if tc.name == "signal" && (details.ExitCode == nil || *details.ExitCode != -1) {
				t.Fatalf("signal exit metadata changed: %+v", details)
			}
			raw, marshalErr := json.Marshal(details)
			if marshalErr != nil || strings.Contains(string(raw), observedCodexHighDemand) || strings.Contains(string(raw), "oom") {
				t.Fatalf("unsafe or invented diagnostic: %s %v", raw, marshalErr)
			}
			count, readErr := os.ReadFile(calls)
			if readErr != nil || string(count) != "x" {
				t.Fatalf("failure was retried: %q %v", count, readErr)
			}
		})
	}
}

func TestCodexReportedReasonSerializationIsClosedAndContextual(t *testing.T) {
	good := CodexFailureDiagnostic{Phase: "event", Category: "reported_failure", EventType: "error", ReportedReason: "high_demand"}
	for _, mutate := range []func(*CodexFailureDiagnostic){
		func(d *CodexFailureDiagnostic) { d.ReportedReason = "secret" },
		func(d *CodexFailureDiagnostic) { d.ReportedReason = "http_500" },
		func(d *CodexFailureDiagnostic) { d.ReportedReason = observedCodexHighDemand },
		func(d *CodexFailureDiagnostic) { d.EventType = "" },
		func(d *CodexFailureDiagnostic) { d.Phase, d.Category = "prepare", "capacity" },
		func(d *CodexFailureDiagnostic) { d.Phase, d.Category = "start", "process_error" },
		func(d *CodexFailureDiagnostic) { d.Phase, d.Category = "exit", "context_deadline" },
		func(d *CodexFailureDiagnostic) { d.Phase, d.Category = "exit", "response_too_large" },
		func(d *CodexFailureDiagnostic) { d.Phase, d.Category = "parse", "invalid_response" },
	} {
		bad := good
		mutate(&bad)
		raw, err := json.Marshal(bad)
		if err == nil || len(raw) != 0 || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), observedCodexHighDemand) {
			t.Fatal("untrusted or context-free reported reason escaped")
		}
	}
	raw, err := json.Marshal(good)
	if err != nil || !strings.Contains(string(raw), `"reported_reason":"high_demand"`) {
		t.Fatal("valid closed reason failed serialization")
	}
	good.ReportedReason = ""
	raw, err = json.Marshal(good)
	if err != nil || strings.Contains(string(raw), "reported_reason") {
		t.Fatal("unknown reason must be absent")
	}
}

func codexReportedReasonWire(t *testing.T, message string) string {
	t.Helper()
	first, err := json.Marshal(map[string]any{"type": "error", "message": message})
	if err != nil {
		t.Fatal(err)
	}
	last, err := json.Marshal(map[string]any{"type": "turn.failed", "error": map[string]any{"message": message}})
	if err != nil {
		t.Fatal(err)
	}
	return string(first) + "\n" + string(last) + "\n"
}

func generateCodexDiagnosticWire(t *testing.T, contents string, exit int) (CodexFailureDiagnostic, []byte) {
	t.Helper()
	provider, dir := fakeCodex(t, `cat "$TEST_WIRE_FILE"; printf x >> "$TEST_CALLS_FILE"; exit `+fmt.Sprint(exit))
	wire, calls := filepath.Join(dir, "wire"), filepath.Join(dir, "calls")
	if err := os.WriteFile(wire, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TEST_WIRE_FILE", wire)
	t.Setenv("TEST_CALLS_FILE", calls)
	_, err := provider.Generate(context.Background(), codexRequest())
	if !errors.Is(err, ErrRequestFailed) || err.Error() != ErrRequestFailed.Error() || errors.Unwrap(err) != ErrRequestFailed {
		t.Fatalf("generic failure chain changed: %v", err)
	}
	details, ok := CodexFailureMetadata(err)
	if !ok {
		t.Fatal("failure metadata absent")
	}
	raw, marshalErr := json.Marshal(details)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	count, readErr := os.ReadFile(calls)
	if readErr != nil || string(count) != "x" {
		t.Fatalf("diagnostic changed subprocess call count: %q %v", count, readErr)
	}
	for _, forbidden := range []string{"secret", dir, provider.Path, provider.AuthHome} {
		if strings.Contains(string(raw), forbidden) || strings.Contains(err.Error(), forbidden) {
			t.Fatal("private CLI data escaped into metadata")
		}
	}
	return details, raw
}
