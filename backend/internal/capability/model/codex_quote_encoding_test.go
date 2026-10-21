package model

import (
	"encoding/json"
	"testing"
)

// Exercise the actual CLI event decoder and synthetic-null normalizer. JSON
// transport must preserve the difference a downstream exact-quote gate checks.
func TestCodexOutputPreservesNewlineAndLiteralEscapeQuoteBytes(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"result":{"type":"object","properties":{"quote":{"type":"string"}},"required":["quote"],"additionalProperties":false}},"required":["result"],"additionalProperties":false}`)
	for _, quote := range []string{"原句。\n\n下一段。", `原句。\n\n下一段。`} {
		message, err := json.Marshal(map[string]any{"result": map[string]string{"quote": quote}})
		if err != nil {
			t.Fatal(err)
		}
		event, err := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]string{"type": "agent_message", "text": string(message)}})
		if err != nil {
			t.Fatal(err)
		}
		wire := append(event, []byte("\n{\"type\":\"turn.completed\"}\n")...)
		final, err := codexFinalMessage(wire)
		if err != nil {
			t.Fatal(err)
		}
		out, err := codexNormalizeOutput(final, schema)
		if err != nil {
			t.Fatal(err)
		}
		var decoded struct {
			Result struct {
				Quote string `json:"quote"`
			} `json:"result"`
		}
		if err := json.Unmarshal([]byte(out), &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.Result.Quote != quote {
			t.Fatalf("quote bytes changed: got %q want %q", decoded.Result.Quote, quote)
		}
	}
}
