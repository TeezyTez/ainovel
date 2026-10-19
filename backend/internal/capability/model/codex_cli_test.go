package model

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func fakeCodex(t *testing.T, script string) (*CodexCLI, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script CLI fixture requires POSIX")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "codex-fixture")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewCodexCLI(path, dir, "test-model", dir)
	if err != nil {
		t.Fatal(err)
	}
	return provider, dir
}

func codexRequest() Request {
	return Request{Messages: []Message{{Role: "system", Content: "Return truth"}, {Role: "user", Content: "Say hello"}}, Schema: json.RawMessage(`{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}`), Model: "test-model", MaxOutputTokens: 64}
}

func TestCodexCLIReceivesSchemaAndReturnsFinalJSON(t *testing.T) {
	provider, dir := fakeCodex(t, `
printf '%s\n' "$@" > "$TEST_ARGS_FILE"
cat > "$TEST_STDIN_FILE"
printf '%s\n' '{"type":"thread.started"}' '{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"ok\"}"}}' '{"type":"turn.completed"}'
`)
	argsFile, stdinFile := filepath.Join(dir, "args"), filepath.Join(dir, "stdin")
	t.Setenv("TEST_ARGS_FILE", argsFile)
	t.Setenv("TEST_STDIN_FILE", stdinFile)
	result, err := provider.Generate(context.Background(), codexRequest())
	if err != nil || result.Text != `{"answer":"ok"}` || result.Model != "test-model" {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"--ignore-user-config", "--ephemeral", "read-only", "--output-schema", "web_search=\"disabled\"", "--disable", "unified_exec", "--model", "test-model"} {
		if !strings.Contains(string(args), required) {
			t.Fatalf("missing %q in CLI flags", required)
		}
	}
	stdin, err := os.ReadFile(stdinFile)
	if err != nil || !strings.Contains(string(stdin), "Say hello") || strings.Contains(string(stdin), "Return truth") {
		t.Fatalf("unexpected stdin content or error=%v", err)
	}
	for _, entry := range []string{"schema.json", "instructions.txt"} {
		if _, err := os.Stat(filepath.Join(dir, entry)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("temporary %s should be removed: %v", entry, err)
		}
	}
}

func TestCodexCLIFailsClosedAndSanitizesErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		script string
		want   error
	}{
		{"tool", `printf '%s\n' '{"type":"item.started","item":{"type":"command_execution"}}' '{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"ok\"}"}}' '{"type":"turn.completed"}'`, ErrInvalidResponse},
		{"stderr", `echo 'secret-token-never-return' >&2; exit 7`, ErrRequestFailed},
		{"invalid-json", `printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"not-json"}}' '{"type":"turn.completed"}'`, ErrInvalidResponse},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider, _ := fakeCodex(t, tc.script)
			_, err := provider.Generate(context.Background(), codexRequest())
			if !errors.Is(err, tc.want) || strings.Contains(err.Error(), "secret-token") {
				t.Fatalf("unsanitized or wrong error: %v", err)
			}
		})
	}
}

func TestCodexCLICancellation(t *testing.T) {
	provider, _ := fakeCodex(t, "sleep 5")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := provider.Generate(ctx, codexRequest())
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", err)
	}
}

func TestCodexCLIWindowsVisiblePath(t *testing.T) {
	provider := &CodexCLI{Path: "/mnt/c/codex.exe"}
	got, err := provider.visiblePath("/mnt/c/Users/A/Temp/schema.json")
	if runtime.GOOS == "windows" {
		return
	}
	if err != nil || got != `C:\Users\A\Temp\schema.json` {
		t.Fatalf("visible path=%q error=%v", got, err)
	}
}
