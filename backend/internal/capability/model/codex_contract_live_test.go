//go:build codexlive

package model

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCodexCLIContractLive(t *testing.T) {
	if os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit live configuration absent")
	}
	p, err := NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	if err != nil {
		t.Fatal(err)
	}
	p.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	p.diagnostic = func(raw []byte) {
		for _, marker := range []string{"schema", "required", "oneOf", "additionalProperties", "permission", "authentication", "Unauthorized", "invalid_json_schema", "stream", "reconnect", "connection", "proxy", "timed out", "certificate", "401", "403", "400", "429", "usage", "login", "unexpected status", "request"} {
			if strings.Contains(string(raw), marker) {
				t.Log("diagnostic category:", marker)
			}
		}
		t.Log("stderr bytes:", len(raw))
	}
	raw, err := os.ReadFile("../../../../contracts/experience/v1/contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract map[string]any
	if err = json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	defs := contract["$defs"].(map[string]any)
	schema := defs["generation_result"].(map[string]any)
	picked := contractDefinitionClosure(t, defs, "generation_result")
	schema["$defs"] = picked
	encoded, _ := json.Marshal(schema)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := p.Generate(ctx, Request{Messages: []Message{{Role: "system", Content: "Generate a short fictional Chinese opening about a bookstore after rain. Use the candidate result. Use empty arrays for state changes and suggestions."}, {Role: "user", Content: "Begin."}}, Schema: encoded, MaxOutputTokens: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid([]byte(result.Text)) {
		t.Fatal("invalid response")
	}
	t.Log("structured contract response received")
}
