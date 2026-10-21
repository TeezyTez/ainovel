package model

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// CodexCLI runs the official Codex CLI using an existing ChatGPT login.
// It is intended only for an explicitly selected local development provider.
// Authentication files are owned and read by the CLI; this adapter never
// opens them and never includes subprocess output in returned errors.
type CodexCLI struct {
	Path            string
	AuthHome        string
	Model           string // empty selects the CLI's current default model
	ReasoningEffort string
	TempDir         string       // must be visible to the CLI; a Windows drive mount for WSL -> .exe
	Proxy           string       // optional, subprocess only
	diagnostic      func([]byte) // test-only; raw output is never included in returned errors
}

var ErrCodexConfig = errors.New("model: codex cli configuration invalid")

func NewCodexCLI(path, authHome, modelName, tempDir string) (*CodexCLI, error) {
	if path == "" || authHome == "" || tempDir == "" || !filepath.IsAbs(path) || !filepath.IsAbs(tempDir) {
		return nil, ErrCodexConfig
	}
	if runtime.GOOS != "windows" && strings.EqualFold(filepath.Ext(path), ".exe") && !windowsDriveMount(tempDir) {
		return nil, ErrCodexConfig
	}
	return &CodexCLI{Path: path, AuthHome: authHome, Model: modelName, ReasoningEffort: "low", TempDir: tempDir}, nil
}

func windowsDriveMount(path string) bool {
	return len(path) >= 8 && strings.HasPrefix(path, "/mnt/") && ((path[5] >= 'a' && path[5] <= 'z') || (path[5] >= 'A' && path[5] <= 'Z')) && path[6] == '/'
}

func (c *CodexCLI) visiblePath(path string) (string, error) {
	if runtime.GOOS == "windows" || !strings.EqualFold(filepath.Ext(c.Path), ".exe") {
		return path, nil
	}
	if !windowsDriveMount(path) {
		return "", ErrCodexConfig
	}
	return strings.ToUpper(path[5:6]) + ":\\" + strings.ReplaceAll(path[7:], "/", "\\"), nil
}

func (c *CodexCLI) Generate(ctx context.Context, req Request) (Result, error) {
	prepareFailure := func(cause error, category string) error {
		return codexDiagnosticError(cause, CodexFailureDiagnostic{Phase: "prepare", Category: category})
	}
	if err := ctx.Err(); err != nil {
		return Result{}, prepareFailure(err, codexContextCategory(err))
	}
	if c == nil || c.Path == "" || c.AuthHome == "" || c.TempDir == "" {
		return Result{}, prepareFailure(ErrUnavailable, "configuration")
	}
	if len(req.Messages) == 0 || len(req.Schema) == 0 || !json.Valid(req.Schema) || req.MaxOutputTokens < 0 {
		return Result{}, prepareFailure(ErrRequestFailed, "request")
	}
	if req.Model != "" && c.Model != "" && req.Model != c.Model {
		return Result{}, prepareFailure(ErrUnavailable, "configuration")
	}
	transportSchema, err := codexTransportSchema(req.Schema)
	if err != nil {
		return Result{}, prepareFailure(err, "schema")
	}
	if req.ContextTokenLimit > 0 {
		transported := req
		transported.Schema = transportSchema
		if _, err := VerifyContextBudget(transported, req.ContextTokenLimit, req.MaxOutputTokens, true); err != nil {
			return Result{}, prepareFailure(err, "capacity")
		}
	}
	dir, err := os.MkdirTemp(c.TempDir, "elselife-codex-")
	if err != nil {
		return Result{}, prepareFailure(ErrRequestFailed, "io")
	}
	schemaFile := filepath.Join(dir, "schema.json")
	instructionsFile := filepath.Join(dir, "instructions.txt")
	defer func() {
		_ = os.Remove(schemaFile)
		_ = os.Remove(instructionsFile)
		_ = os.Remove(dir) // only an empty directory; never delete unknown CLI output
	}()
	if err := os.WriteFile(schemaFile, transportSchema, 0600); err != nil {
		return Result{}, prepareFailure(ErrRequestFailed, "io")
	}
	var system, conversation []Message
	for _, message := range req.Messages {
		switch message.Role {
		case "system":
			system = append(system, message)
		case "user", "assistant":
			conversation = append(conversation, message)
		default:
			return Result{}, prepareFailure(ErrRequestFailed, "request")
		}
	}
	var instructions strings.Builder
	for _, message := range system {
		instructions.WriteString(message.Content)
		instructions.WriteString("\n\n")
	}
	instructions.WriteString("Only output a JSON object matching the supplied schema. Do not call tools. Do not browse or read local project files.")
	if err := os.WriteFile(instructionsFile, []byte(instructions.String()), 0600); err != nil {
		return Result{}, prepareFailure(ErrRequestFailed, "io")
	}
	visibleDir, err := c.visiblePath(dir)
	if err != nil {
		return Result{}, prepareFailure(err, "configuration")
	}
	visibleSchema, err := c.visiblePath(schemaFile)
	if err != nil {
		return Result{}, prepareFailure(err, "configuration")
	}
	visibleInstructions, err := c.visiblePath(instructionsFile)
	if err != nil {
		return Result{}, prepareFailure(err, "configuration")
	}
	// The CLI accepts a single user prompt, not the API's messages array.
	// Preserve a single user's original bytes so JSON stage inputs are not
	// encoded a second time (especially passage newlines and literal slashes).
	// Multiple messages retain their explicit roles/order; never fold them into
	// the trusted instructions file or discard assistant history.
	var prompt []byte
	if len(conversation) == 1 && conversation[0].Role == "user" {
		prompt = []byte(conversation[0].Content)
	} else {
		encoded, err := json.Marshal(conversation)
		if err != nil {
			return Result{}, prepareFailure(ErrRequestFailed, "request")
		}
		prompt = append([]byte("Conversation messages in JSON, in order. Apply the system instructions to these messages and produce one schema-conforming final JSON object:\n"), encoded...)
	}
	if req.ContextTokenLimit > 0 {
		// The actual CLI carrier is one instructions message plus one stdin prompt.
		// Multi-message JSON adds escaping; the original request preflight cannot
		// account for those bytes. The CLI carries one strict schema and has no
		// HTTP JSON-mode fallback, whose instruction is already counted elsewhere.
		total := uint64(req.MaxOutputTokens) + 256 + uint64(len(transportSchema)) +
			uint64(instructions.Len()) + uint64(len(prompt)) +
			uint64(len("system")+len("user")+2*32)
		if total > uint64(req.ContextTokenLimit) {
			return Result{}, prepareFailure(ErrContextBudgetExceeded, "capacity")
		}
	}
	effort := c.ReasoningEffort
	if effort != "low" && effort != "medium" && effort != "high" {
		effort = "low"
	}
	args := []string{
		"exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
		"--sandbox", "read-only", "--json", "--color", "never", "--cd", visibleDir,
		"--output-schema", visibleSchema, "--enable", "skip_host_skill_discovery",
		"-c", "model_instructions_file=" + strconvJSON(visibleInstructions),
		"-c", `web_search="disabled"`, "-c", "project_doc_max_bytes=0",
		"-c", "model_reasoning_effort=" + strconvJSON(effort),
		"-c", `approval_policy="never"`,
	}
	for _, feature := range codexDisabledFeatures {
		args = append(args, "--disable", feature)
	}
	if c.Model != "" {
		args = append(args, "--model", c.Model)
	}
	args = append(args, "-")
	cmd := exec.CommandContext(ctx, c.Path, args...)
	cmd.Dir = dir
	cmd.Env = codexEnv(c.AuthHome, c.Proxy)
	cmd.Stdin = bytes.NewReader(prompt)
	capture := &codexCapture{limit: 1 << 20, kill: func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}}
	cmd.Stdout = codexCaptureWriter{capture: capture, stdout: true}
	cmd.Stderr = codexCaptureWriter{capture: capture}
	err = cmd.Run()
	if ctx.Err() != nil {
		phase := "exit"
		if cmd.Process == nil {
			phase = "start"
		}
		return Result{}, codexDiagnosticError(ctx.Err(), capture.failureDetails(phase, codexContextCategory(ctx.Err())))
	}
	if capture.oversized() {
		return Result{}, codexDiagnosticError(ErrResponseTooLarge, capture.failureDetails("exit", "response_too_large"))
	}
	output := capture.output()
	if err != nil {
		if c.diagnostic != nil {
			c.diagnostic(append(capture.errorOutput(), output...))
		}
		phase := "start"
		if cmd.Process != nil {
			phase = "exit"
		}
		details := capture.failureDetails(phase, "process_error")
		details.EventType = codexKnownFailureEvent(output)
		details.ReportedReason = codexReportedFailureReason(output)
		if cmd.ProcessState != nil {
			code := cmd.ProcessState.ExitCode()
			details.ExitCode = &code
		}
		return Result{}, codexDiagnosticError(ErrRequestFailed, details)
	}
	text, err := codexFinalMessage(output)
	if err != nil {
		details := capture.failureDetails("parse", codexResponseCategory(err))
		if event := codexKnownFailureEvent(output); errors.Is(err, ErrRequestFailed) && event != "" {
			details.Phase, details.Category, details.EventType = "event", "reported_failure", event
			details.ReportedReason = codexReportedFailureReason(output)
		}
		return Result{}, codexDiagnosticError(err, details)
	}
	text, err = codexNormalizeOutput(text, req.Schema)
	if err != nil {
		return Result{}, codexDiagnosticError(err, capture.failureDetails("normalize", codexResponseCategory(err)))
	}
	modelName := c.Model
	if modelName == "" {
		modelName = "codex"
	}
	return Result{Text: text, Model: modelName}, nil
}

func (c *CodexCLI) Stream(ctx context.Context, req Request, onChunk func(Chunk) error) error {
	if onChunk == nil {
		return ErrRequestFailed
	}
	result, err := c.Generate(ctx, req)
	if err != nil {
		return err
	}
	if err := onChunk(Chunk{Text: result.Text, Model: result.Model}); err != nil {
		return err
	}
	return onChunk(Chunk{Done: true, Model: result.Model})
}

func strconvJSON(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

var codexDisabledFeatures = []string{
	"shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external",
	"browser_use_full_cdp_access", "computer_use", "in_app_browser", "multi_agent", "hooks",
	"image_generation", "view_image", "shell_snapshot", "code_mode_host", "goals", "sleep_tool",
}

func codexEnv(authHome, proxy string) []string {
	env := make([]string, 0, len(os.Environ())+3)
	wslEnv := os.Getenv("WSLENV")
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key == "CODEX_HOME" || key == "WSLENV" || proxy != "" && (key == "HTTP_PROXY" || key == "HTTPS_PROXY") {
			continue
		}
		env = append(env, entry)
	}
	env = append(env, "CODEX_HOME="+authHome)
	if proxy != "" {
		env = append(env, "HTTP_PROXY="+proxy, "HTTPS_PROXY="+proxy)
	}
	// WSL interop does not pass ordinary Linux environment variables to a
	// Windows .exe. Pass only these explicit values across the boundary; keep
	// any caller-defined WSLENV entries intact. Paths are already Windows paths.
	if runtime.GOOS != "windows" {
		for _, key := range []string{"CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY"} {
			found := false
			for _, entry := range strings.Split(wslEnv, ":") {
				if strings.SplitN(entry, "/", 2)[0] == key {
					found = true
					break
				}
			}
			if !found {
				if wslEnv != "" {
					wslEnv += ":"
				}
				wslEnv += key
			}
		}
		env = append(env, "WSLENV="+wslEnv)
	}
	return env
}

type codexCapture struct {
	mu       sync.Mutex
	limit    int
	bytes    int
	tooLarge bool
	stdout   bytes.Buffer
	stderr   bytes.Buffer
	kill     func()
}
type codexCaptureWriter struct {
	capture *codexCapture
	stdout  bool
}

func (w codexCaptureWriter) Write(p []byte) (int, error) {
	c := w.capture
	c.mu.Lock()
	if c.tooLarge {
		c.mu.Unlock()
		return len(p), nil
	}
	c.bytes += len(p)
	if c.bytes > c.limit {
		c.tooLarge = true
		c.mu.Unlock()
		c.kill()
		return len(p), nil
	}
	if w.stdout {
		_, _ = c.stdout.Write(p)
	} else {
		_, _ = c.stderr.Write(p)
	}
	c.mu.Unlock()
	return len(p), nil
}
func (c *codexCapture) oversized() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tooLarge
}
func (c *codexCapture) output() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return bytes.Clone(c.stdout.Bytes())
}

func (c *codexCapture) errorOutput() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return bytes.Clone(c.stderr.Bytes())
}

func codexFinalMessage(raw []byte) (string, error) {
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	var message string
	completed := false
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var event struct {
			Type string `json:"type"`
			Item struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"item"`
		}
		if json.Unmarshal(line, &event) != nil || event.Type == "" {
			return "", ErrInvalidResponse
		}
		switch event.Type {
		case "error", "turn.failed":
			return "", ErrRequestFailed
		case "turn.completed":
			completed = true
		case "item.started", "item.completed", "item.updated":
			switch event.Item.Type {
			case "command_execution", "mcp_tool_call", "web_search", "file_change", "browser_use", "image_generation":
				return "", ErrInvalidResponse
			case "agent_message":
				if event.Type == "item.completed" {
					message = event.Item.Text
				}
			}
		}
	}
	if scanner.Err() != nil || !completed || message == "" {
		return "", ErrIncompleteResponse
	}
	var object map[string]json.RawMessage
	if json.Unmarshal([]byte(message), &object) != nil || object == nil {
		return "", ErrInvalidResponse
	}
	return message, nil
}

var _ Generator = (*CodexCLI)(nil)
var _ io.Writer = codexCaptureWriter{}
