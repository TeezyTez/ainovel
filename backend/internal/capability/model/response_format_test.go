package model

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const unsupportedFormatBody = `{"error":{"code":"invalid_request_error","message":"This response_format type is unavailable now (request id: secret-provider-id)"}}`

func TestResponseFormatNegotiation(t *testing.T) {
	for _, stream := range []bool{false, true} {
		name := "generate"
		if stream {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			calls := 0
			schema := json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}`)
			messages := make([]Message, 1, 3)
			messages[0] = Message{Role: "user", Content: "produce JSON"}
			before := append([]Message(nil), messages[:cap(messages)]...)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var chat chatRequest
				if err := json.NewDecoder(r.Body).Decode(&chat); err != nil {
					t.Error(err)
				}
				if r.Header.Get("Authorization") != "Bearer test-secret" || chat.Stream != stream {
					t.Error("transport contract changed")
				}
				if calls == 1 {
					if chat.ResponseFormat.Type != "json_schema" || !reflect.DeepEqual(chat.Messages, messages) {
						t.Error("initial request changed")
					}
					w.WriteHeader(400)
					io.WriteString(w, unsupportedFormatBody)
					return
				}
				if chat.ResponseFormat.Type != "json_object" || chat.ResponseFormat.JSONSchema != nil {
					t.Error("not pure JSON mode")
				}
				if len(chat.Messages) != 2 || !strings.Contains(chat.Messages[0].Content, string(schema)) || chat.Messages[1] != messages[0] {
					t.Error("schema or messages lost")
				}
				if stream {
					io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"ok\\\":true}\"}}]}\n\ndata: [DONE]\n\n")
				} else {
					io.WriteString(w, `{"model":"test","choices":[{"message":{"content":"{\"ok\":true}"}}]}`)
				}
			}))
			defer server.Close()
			adapter, _ := NewOpenAIWithClient(server.URL, "test-secret", "test", server.Client())
			req := Request{Messages: messages, Schema: schema}
			var text string
			var err error
			if stream {
				err = adapter.Stream(context.Background(), req, func(c Chunk) error { text += c.Text; return nil })
			} else {
				var result Result
				result, err = adapter.Generate(context.Background(), req)
				text = result.Text
			}
			if err != nil || text != `{"ok":true}` || calls != 2 {
				t.Fatalf("calls=%d text=%q err=%v", calls, text, err)
			}
			if !reflect.DeepEqual(before, messages[:cap(messages)]) {
				t.Fatal("caller backing array mutated")
			}
		})
	}
}

func TestResponseFormatNegotiationFailClosed(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		schema    bool
		wantCalls int
	}{
		{"unrelated400", 400, `{"error":{"code":"invalid_request_error","message":"bad schema"}}`, true, 1},
		{"prefixIsNotTheSentence", 400, `{"error":{"code":"invalid_request_error","message":"This response_format type is unavailable now (request id: x) leaked-key"}}`, true, 1},
		{"auth", 401, unsupportedFormatBody, true, 1},
		{"rateLimit", 429, unsupportedFormatBody, true, 1},
		{"server", 500, unsupportedFormatBody, true, 1},
		{"malformed", 400, `not json`, true, 1},
		{"oversized", 400, strings.Repeat(" ", 16<<10) + unsupportedFormatBody, true, 1},
		{"plain", 400, unsupportedFormatBody, false, 1},
		{"retryRejected", 400, unsupportedFormatBody, true, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			}))
			defer server.Close()
			adapter, _ := NewOpenAIWithClient(server.URL, "test-secret", "test", server.Client())
			req := Request{Messages: []Message{{Role: "user", Content: "private prompt"}}}
			if tc.schema {
				req.Schema = json.RawMessage(`{"type":"object"}`)
			}
			_, err := adapter.Generate(context.Background(), req)
			if !errors.Is(err, ErrBadStatus) || calls != tc.wantCalls {
				t.Fatalf("calls=%d err=%v", calls, err)
			}
			for _, secret := range []string{"private prompt", "test-secret", "secret-provider-id", "bad schema"} {
				if strings.Contains(err.Error(), secret) {
					t.Fatal("error leaked raw data")
				}
			}
		})
	}
}
