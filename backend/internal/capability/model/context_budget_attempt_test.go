package model

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Capture actual HTTP attempts: native schema and JSON fallback are separate
// requests. A capacity bound must cover the larger request, not their sum.
func TestContextBudgetUsesLargestActualHTTPAttempt(t *testing.T) {
	schema, err := json.Marshal(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean", "description": strings.Repeat("bounded schema detail ", 900)}}, "required": []string{"ok"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	request := Request{Messages: []Message{{Role: "system", Content: "固定规则。"}, {Role: "user", Content: "Return JSON."}}, Schema: schema, MaxOutputTokens: 1024}
	var attempts []chatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var chat chatRequest
		if err := json.NewDecoder(r.Body).Decode(&chat); err != nil {
			t.Error(err)
		}
		attempts = append(attempts, chat)
		if len(attempts) == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, unsupportedFormatBody)
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"{\"ok\":true}"}}]}`)
	}))
	defer server.Close()
	provider, err := NewOpenAIWithClient(server.URL, "synthetic-key", "synthetic-model", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Generate(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 2 {
		t.Fatalf("attempts=%d", len(attempts))
	}
	maximum := 0
	for _, attempt := range attempts {
		bytes, copies := request.MaxOutputTokens+256, 0
		if attempt.ResponseFormat.JSONSchema != nil {
			if string(attempt.ResponseFormat.JSONSchema.Schema) != string(schema) {
				t.Fatal("native schema changed")
			}
			bytes += len(attempt.ResponseFormat.JSONSchema.Schema)
			copies++
		}
		for _, message := range attempt.Messages {
			bytes += len(message.Content) + len(message.Role) + 32
			copies += strings.Count(message.Content, string(schema))
		}
		if copies != 1 {
			t.Fatalf("one request carried %d schemas", copies)
		}
		if bytes > maximum {
			maximum = bytes
		}
	}
	if _, err := VerifyContextBudget(request, maximum, request.MaxOutputTokens, true); err != nil {
		t.Fatalf("largest actual request fits; sequential fallback was over-reserved: %v", err)
	}
	if _, err := VerifyContextBudget(request, maximum-1, request.MaxOutputTokens, true); !errors.Is(err, ErrContextBudgetExceeded) {
		t.Fatalf("one-byte-short budget accepted: %v", err)
	}
}
