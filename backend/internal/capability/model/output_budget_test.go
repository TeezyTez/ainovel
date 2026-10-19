// 输出预算在流式、非流式及格式协商重试中保持相同约束。
package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestModelStreamRequiresCompletionMarker(t *testing.T) {
	done := false
	err := readSSE(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"), func(chunk Chunk) error { done = done || chunk.Done; return nil })
	if !errors.Is(err, ErrIncompleteResponse) || done {
		t.Fatal("truncated stream announced completion")
	}
}

func TestOutputBudgetReachesProvider(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request chatRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				if request.MaxTokens != 257 {
					t.Errorf("max_tokens=%d", request.MaxTokens)
				}
				if calls == 1 {
					w.WriteHeader(400)
					fmt.Fprint(w, `{"error":{"code":"invalid_request_error","message":"This response_format type is unavailable now"}}`)
					return
				}
				if stream {
					fmt.Fprint(w, "data: [DONE]\n\n")
				} else {
					fmt.Fprint(w, `{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}`)
				}
			}))
			defer server.Close()
			client, err := NewOpenAI(server.URL, "", "fixture")
			if err != nil {
				t.Fatal(err)
			}
			request := Request{MaxOutputTokens: 257, Schema: json.RawMessage(`{"type":"object"}`)}
			if stream {
				err = client.Stream(context.Background(), request, func(Chunk) error { return nil })
			} else {
				_, err = client.Generate(context.Background(), request)
			}
			if err != nil || calls != 2 {
				t.Fatalf("calls=%d error=%v", calls, err)
			}
			request.MaxOutputTokens = -1
			if _, err := client.Generate(context.Background(), request); err == nil || calls != 2 {
				t.Fatal("negative budget sent")
			}
		})
	}
}
