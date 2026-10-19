//go:build codexlive

package model

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// Explicitly opt in with -tags codexlive and the three environment variables.
// This uses the logged-in CLI and may consume account usage.
func TestCodexCLILive(t *testing.T) {
	path, home, temp := os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR")
	if path == "" || home == "" || temp == "" {
		t.Skip("explicit Codex CLI live-test configuration absent")
	}
	provider, err := NewCodexCLI(path, home, os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), temp)
	if err != nil {
		t.Fatal(err)
	}
	provider.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	provider.diagnostic = func(stderr []byte) {
		safe := string(stderr)
		safe = regexp.MustCompile(`(?i)[a-z]:\\[^\s"']+`).ReplaceAllString(safe, "<PATH>")
		safe = regexp.MustCompile(`https?://[^\s"']+`).ReplaceAllString(safe, "<URL>")
		safe = regexp.MustCompile(`[A-Za-z0-9_-]{24,}`).ReplaceAllString(safe, "<LONG>")
		t.Logf("Codex CLI stderr (redacted, %d bytes): %s", len(stderr), strings.TrimSpace(safe[:min(len(safe), 300)]))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := provider.Generate(ctx, Request{
		Messages: []Message{{Role: "system", Content: "Return exactly one JSON object whose answer is the string ok."}, {Role: "user", Content: "Reply now."}},
		Schema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["answer"],"properties":{"answer":{"type":"string","enum":["ok"]}}}`),
		MaxOutputTokens: 64,
	})
	if err != nil {
		t.Fatal(err)
	}
	var answer struct { Answer string `json:"answer"` }
	if json.Unmarshal([]byte(result.Text), &answer) != nil || answer.Answer != "ok" {
		t.Fatal("Codex CLI returned a nonconforming response")
	}
}
