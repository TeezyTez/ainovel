package model

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
)

// CodexFailureDiagnostic contains only fixed labels and observed process metadata.
// Captured byte counts describe retained buffers, not complete provider output.
// Exit codes and failure events do not establish an OOM or network diagnosis.
// MarshalJSON rejects values outside this closed vocabulary.
type CodexFailureDiagnostic struct {
	Phase     string `json:"phase"`
	Category  string `json:"category"`
	ExitCode  *int   `json:"exit_code,omitempty"`
	EventType string `json:"event_type,omitempty"`
	// ReportedReason identifies an exact CLI message, not a verified cause,
	// HTTP status, retry count, or instruction to retry.
	ReportedReason      string `json:"reported_reason,omitempty"`
	CapturedStdoutBytes int    `json:"captured_stdout_bytes"`
	CapturedStderrBytes int    `json:"captured_stderr_bytes"`
}

func (d CodexFailureDiagnostic) MarshalJSON() ([]byte, error) {
	switch d.Phase + "/" + d.Category {
	case "prepare/context_cancelled", "prepare/context_deadline", "start/context_cancelled", "start/context_deadline", "exit/context_cancelled", "exit/context_deadline", "exit/response_too_large",
		"prepare/request", "prepare/configuration", "prepare/schema", "prepare/capacity", "prepare/io",
		"start/process_error", "exit/process_error", "event/reported_failure",
		"parse/invalid_response", "parse/incomplete_response", "normalize/invalid_response", "normalize/incomplete_response":
	default:
		return nil, errors.New("model: invalid failure metadata")
	}
	if d.EventType != "" && d.EventType != "error" && d.EventType != "turn.failed" || d.CapturedStdoutBytes < 0 || d.CapturedStderrBytes < 0 || d.CapturedStdoutBytes > 1<<20 || d.CapturedStderrBytes > 1<<20 || d.CapturedStdoutBytes+d.CapturedStderrBytes > 1<<20 {
		return nil, errors.New("model: invalid failure metadata")
	}
	if d.ReportedReason != "" &&
		(d.ReportedReason != "retry_limit_429" && d.ReportedReason != "high_demand" ||
			d.EventType == "" ||
			d.Phase+"/"+d.Category != "exit/process_error" && d.Phase+"/"+d.Category != "event/reported_failure") {
		return nil, errors.New("model: invalid failure metadata")
	}
	type wire CodexFailureDiagnostic
	return json.Marshal(wire(d))
}

type codexFailureError struct {
	cause   error
	details CodexFailureDiagnostic
}

func (e *codexFailureError) Error() string { return e.cause.Error() }
func (e *codexFailureError) Unwrap() error { return e.cause }

// CodexFailureMetadata returns an independent copy, including the optional code.
// The wrapper never retains OS errors, subprocess output, prompts or credentials.
func CodexFailureMetadata(err error) (CodexFailureDiagnostic, bool) {
	var failure *codexFailureError
	if !errors.As(err, &failure) {
		return CodexFailureDiagnostic{}, false
	}
	return copyCodexFailureDiagnostic(failure.details), true
}
func copyCodexFailureDiagnostic(d CodexFailureDiagnostic) CodexFailureDiagnostic {
	if d.ExitCode != nil {
		value := *d.ExitCode
		d.ExitCode = &value
	}
	return d
}
func codexDiagnosticError(cause error, details CodexFailureDiagnostic) error {
	// Store only a known generic sentinel, never the original error object.
	safe := ErrRequestFailed
	for _, sentinel := range []error{ErrRequestFailed, ErrInvalidResponse, ErrIncompleteResponse, ErrResponseTooLarge, ErrUnavailable, ErrCodexConfig, ErrContextLimitUnknown, ErrContextBudgetExceeded, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(cause, sentinel) {
			safe = sentinel
			break
		}
	}
	return &codexFailureError{cause: safe, details: copyCodexFailureDiagnostic(details)}
}
func (c *codexCapture) failureDetails(phase, category string) CodexFailureDiagnostic {
	c.mu.Lock()
	defer c.mu.Unlock()
	return CodexFailureDiagnostic{Phase: phase, Category: category, CapturedStdoutBytes: c.stdout.Len(), CapturedStderrBytes: c.stderr.Len()}
}
func codexKnownFailureEvent(raw []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		var event struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) == nil && (event.Type == "error" || event.Type == "turn.failed") {
			return event.Type
		}
	}
	return ""
}

// Only exact messages observed with codex-cli 0.159.0-alpha.12.1 are recognized.
// Its exec JSONL discards the internal typed error. A free-form provider error
// could contain the same text, so this label is only what the CLI reported.
// Do not infer a status from high_demand or actual retries from retry_limit_429.
func codexReportedFailureReason(raw []byte) string {
	// Actual CLI JSONL ends every event with LF. An incomplete capture is not
	// sufficient evidence, even when a recognizable message appeared earlier.
	if len(raw) == 0 || len(raw) > 1<<20 || raw[len(raw)-1] != '\n' {
		return ""
	}
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	reason := ""
	seenError, seenTurnFailed := false, false
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		if seenTurnFailed || !codexUniqueJSON(string(line)) {
			return ""
		}
		var event map[string]json.RawMessage
		if json.Unmarshal(line, &event) != nil || event == nil {
			return ""
		}
		var kind string
		if json.Unmarshal(event["type"], &kind) != nil || kind == "" {
			return ""
		}
		var message string
		switch kind {
		case "error":
			if seenError || len(event) != 2 || json.Unmarshal(event["message"], &message) != nil {
				return ""
			}
			seenError = true
		case "turn.failed":
			var failure map[string]json.RawMessage
			if len(event) != 2 || json.Unmarshal(event["error"], &failure) != nil || len(failure) != 1 ||
				json.Unmarshal(failure["message"], &message) != nil {
				return ""
			}
			seenTurnFailed = true
		case "thread.started", "turn.started", "item.started", "item.updated", "item.completed":
			if seenError {
				return ""
			}
			continue
		default:
			// Unknown events and success/failure contradictions stay unclassified.
			return ""
		}
		current := ""
		switch message {
		case "exceeded retry limit, last status: 429 Too Many Requests":
			current = "retry_limit_429"
		case "We’re currently experiencing high demand, which may cause temporary errors.":
			current = "high_demand"
		default:
			return ""
		}
		if reason != "" && reason != current {
			return ""
		}
		reason = current
	}
	if scanner.Err() != nil {
		return ""
	}
	return reason
}

func codexResponseCategory(err error) string {
	if errors.Is(err, ErrIncompleteResponse) {
		return "incomplete_response"
	}
	return "invalid_response"
}

func codexContextCategory(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "context_deadline"
	}
	return "context_cancelled"
}
