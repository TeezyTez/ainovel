// 文件职责：锁 OpenAI 兼容 Adapter 的缺配置显式 unavailable、base URL 校验、plain/streamed/schema 三种夹具、
// Credential 落点与 Prompt/Token/上游正文不进错误。全部 httptest 本地夹具，无真实公网请求。
// 主要依赖：testing、context、encoding/json、errors、io、net/http、net/http/httptest、strings。
// 调用边界：只在 go test 中运行。
// 状态边界：每个用例建独立 httptest.Server 与 OpenAI，不共享。
// 安全边界：断言 apiKey 只进 Authorization 头、Prompt/Token/上游正文绝不进入错误，验证硬约束真实落地。

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
	"time"
)

// newTestOpenAI 起一个 httptest 上游并返回注入其 client 的 OpenAI 与收到的请求通道。
func newTestOpenAI(t *testing.T, apiKey string, handler http.HandlerFunc) (*OpenAI, chan *http.Request) {
	t.Helper()
	requests := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	adapter, err := NewOpenAIWithClient(server.URL, apiKey, "test-model", server.Client())
	if err != nil {
		t.Fatalf("构造 OpenAI 失败: %v", err)
	}
	return adapter, requests
}

// TestNewOpenAIRemitsUnavailableOnMissingConfig 锁缺 base URL 或 model 返回显式 ErrUnavailable（绝非模板答案）。
func TestNewOpenAIRemitsUnavailableOnMissingConfig(t *testing.T) {
	cases := []struct{ baseURL, apiKey, modelName string }{
		{"", "", ""},
		{"", "key", "m"},
		{"http://example.com/v1", "key", ""},
		{"   ", "key", "m"},
	}
	for _, c := range cases {
		if _, err := NewOpenAI(c.baseURL, c.apiKey, c.modelName); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("缺配置 %+v 应为 ErrUnavailable，实际 %v", c, err)
		}
	}
}

// TestNewOpenAIRejectsInvalidBaseURL 锁非法 base URL 返回 ErrInvalidBaseURL。
func TestNewOpenAIRejectsInvalidBaseURL(t *testing.T) {
	for _, baseURL := range []string{"not-a-url", "ftp://example.com/v1", "://", "https://user:pass@example.com/v1"} {
		if _, err := NewOpenAI(baseURL, "key", "m"); !errors.Is(err, ErrInvalidBaseURL) {
			t.Fatalf("非法 base URL %q 应为 ErrInvalidBaseURL，实际 %v", baseURL, err)
		}
	}
}

// TestGeneratePlain 锁普通生成（plain 夹具）返回文本、模型名与真实令牌计量。
func TestGeneratePlain(t *testing.T) {
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": "test-model",
			"choices": []map[string]any{
				{"message": map[string]any{"role": "assistant", "content": "Hello"}},
			},
			"usage": map[string]any{"prompt_tokens": 5, "completion_tokens": 1, "total_tokens": 6},
		})
	})

	result, err := adapter.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("生成失败: %v", err)
	}
	if result.Text != "Hello" || result.Model != "test-model" {
		t.Fatalf("plain 结果不符: %+v", result)
	}
	if result.Usage.TotalTokens != 6 || result.Usage.PromptTokens != 5 || result.Usage.CompletionTokens != 1 {
		t.Fatalf("令牌计量不符: %+v", result.Usage)
	}
}

// TestGenerateSchemaConstrained 锁 schema 约束夹具：请求下发 response_format 且返回结构化内容。
func TestGenerateSchemaConstrained(t *testing.T) {
	var gotBody []byte
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "test-model",
			"choices": []map[string]any{{"message": map[string]any{"content": `{"summary":"ok"}`}}},
		})
	})

	schema := json.RawMessage(`{"type":"object","properties":{"summary":{"type":"string"}}}`)
	result, err := adapter.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "summarize"}},
		Schema:   schema,
	})
	if err != nil {
		t.Fatalf("结构化生成失败: %v", err)
	}
	if result.Text != `{"summary":"ok"}` {
		t.Fatalf("结构化内容不符: %q", result.Text)
	}

	var body map[string]any
	if err := json.Unmarshal(gotBody, &body); err != nil {
		t.Fatalf("请求体非法: %v", err)
	}
	rf, ok := body["response_format"].(map[string]any)
	if !ok || rf["type"] != "json_schema" {
		t.Fatalf("应下发 response_format json_schema，实际 %v", body["response_format"])
	}
}

// TestGeneratePlainOmitsResponseFormat 锁无 Schema 时不发 response_format（普通生成）。
func TestGeneratePlainOmitsResponseFormat(t *testing.T) {
	var gotBody []byte
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"model":"m","choices":[{"message":{"content":"x"}}]}`)
	})
	if _, err := adapter.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}); err != nil {
		t.Fatalf("生成失败: %v", err)
	}
	if strings.Contains(string(gotBody), "response_format") {
		t.Fatalf("无 Schema 不应发 response_format，实际 %s", gotBody)
	}
}

// TestStreamAccumulatesChunks 锁 streamed 夹具：逐块回放内容并以 Done 结束。
func TestStreamAccumulatesChunks(t *testing.T) {
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	})

	var sb strings.Builder
	done := false
	err := adapter.Stream(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(chunk Chunk) error {
		if chunk.Done {
			done = true
			return nil
		}
		sb.WriteString(chunk.Text)
		return nil
	})
	if err != nil {
		t.Fatalf("流式生成失败: %v", err)
	}
	if sb.String() != "Hello world" {
		t.Fatalf("流式内容应为 Hello world，实际 %q", sb.String())
	}
	if !done {
		t.Fatal("流应以 Done 结束")
	}
}

func TestStreamEmitsBeforeHandlerReturns(t *testing.T) {
	started := make(chan struct{})
	unblock := make(chan struct{})
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("httptest 无 Flusher")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n")
		flusher.Flush()
		close(started)
		<-unblock
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	})
	got := make(chan string, 1)
	errCh := make(chan error, 1)
	go func() {
		errCh <- adapter.Stream(context.Background(), Request{
			Messages: []Message{{Role: "user", Content: "q"}},
		}, func(chunk Chunk) error {
			if chunk.Text != "" {
				got <- chunk.Text
			}
			return nil
		})
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("上游未开始写帧")
	}
	select {
	case text := <-got:
		if text != "Hi" {
			t.Fatalf("增量应为 Hi，实际 %q", text)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("未在完整 body 结束前吐字")
	}
	close(unblock)
	if err := <-errCh; err != nil {
		t.Fatalf("Stream: %v", err)
	}
}

// TestCredentialOnlyInAuthorization 锁 apiKey 只进 Authorization 头，不进 URL 或正文。
func TestCredentialOnlyInAuthorization(t *testing.T) {
	var gotBody []byte
	adapter, requests := newTestOpenAI(t, "secret-key", func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"model":"m","choices":[{"message":{"content":"x"}}]}`)
	})
	if _, err := adapter.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "hi"}},
	}); err != nil {
		t.Fatalf("生成失败: %v", err)
	}
	request := <-requests
	if got := request.Header.Get("Authorization"); got != "Bearer secret-key" {
		t.Fatalf("Authorization 应为 Bearer secret-key，实际 %q", got)
	}
	if strings.Contains(string(gotBody), "secret-key") {
		t.Fatalf("apiKey 不应出现在正文: %s", gotBody)
	}
	if strings.Contains(request.URL.String(), "secret-key") {
		t.Fatalf("apiKey 不应出现在 URL: %q", request.URL.String())
	}
}

// TestErrorHidesPromptTokenAndBody 锁错误消息不含 Prompt、Token 明细与上游原始正文（AC-18.2）。
func TestErrorHidesPromptTokenAndBody(t *testing.T) {
	const secretPrompt = "NEEDLE-PROMPT-xyz"
	adapter, _ := newTestOpenAI(t, "key", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"error":"RAW-BODY-MARKER prompt_tokens"}`)
	})
	_, err := adapter.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: secretPrompt}},
	})
	if !errors.Is(err, ErrBadStatus) {
		t.Fatalf("应为 ErrBadStatus，实际 %v", err)
	}
	for _, marker := range []string{secretPrompt, "RAW-BODY-MARKER", "prompt_tokens"} {
		if strings.Contains(err.Error(), marker) {
			t.Fatalf("错误不应包含敏感内容 %q，实际 %v", marker, err)
		}
	}
}

// TestGenerateResponseTooLarge 锁超 5 MiB 响应返回 ErrResponseTooLarge。
func TestGenerateResponseTooLarge(t *testing.T) {
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(make([]byte, maxResponseBytes+1))
	})
	_, err := adapter.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("超 5 MiB 响应应为 ErrResponseTooLarge，实际 %v", err)
	}
}

// TestGenerateContextCancelled 锁已取消 ctx 根本不发起请求。
func TestGenerateContextCancelled(t *testing.T) {
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"model":"m","choices":[{"message":{"content":"x"}}]}`)
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := adapter.Generate(ctx, Request{Messages: []Message{{Role: "user", Content: "secret-prompt"}}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("取消 ctx 应返回 context.Canceled，实际 %v", err)
	}
}

// TestGenerateRejectsTruncatedCompletion ensures HTTP 200 with length finish is not accepted as success.
func TestGenerateRejectsTruncatedCompletion(t *testing.T) {
	adapter, _ := newTestOpenAI(t, "", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"model":"m","choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}`)
	})
	_, err := adapter.Generate(context.Background(), Request{Messages: []Message{{Role: "user", Content: "hi"}}})
	if !errors.Is(err, ErrIncompleteResponse) {
		t.Fatalf("finish_reason=length 应返回 ErrIncompleteResponse，实际 %v", err)
	}
}
