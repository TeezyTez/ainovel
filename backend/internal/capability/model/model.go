// 文件职责：OpenAI 兼容 Model 的 Adapter——请求/结果/流式/结构化契约、HTTP 认证、超时/大小上限与错误分类。
// 主要依赖：标准库 bytes、context、encoding/json、errors、fmt、io、net/http、net/url、strings。
// 调用边界：由运行时在模型调用任务中调用 Generate/Stream；NewOpenAI 在装配期构造，可注入 *http.Client 供测试。
// 状态边界：OpenAI 持有只读 baseURL/apiKey/model 与独立 *http.Client，无共享可变状态，并发安全。
// 安全边界：apiKey 只进 Authorization 头；Prompt/Token/原始响应正文绝不进入错误消息；响应 5 MiB 上限。

package model

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// maxResponseBytes 是上游响应体硬上限：5 MiB，超出即 ErrResponseTooLarge。
const maxResponseBytes = 5 << 20

// authorizationScheme 是 API key 唯一落点 Authorization 头的前缀。
const authorizationScheme = "Bearer"

// chatCompletionsPath 是拼接在 base URL 后的补全端点路径。
const chatCompletionsPath = "/chat/completions"

// Message 是一条对话消息。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Request 是一次模型调用。Schema 非空时优先 json_schema；明确不支持时以 JSON mode 重试。
// JSON mode 不保证 Schema 合规，调用方仍须校验结构与业务语义。
type Request struct {
	Messages []Message       `json:"messages"`
	Schema   json.RawMessage `json:"schema,omitempty"`
	Model    string          `json:"model,omitempty"`
	// AccountID、PlanKey、Task 只参与已发布路由的选择，不发给上游。
	AccountID string `json:"-"`
	PlanKey   string `json:"-"`
	Task      string `json:"-"`
	// MaxOutputTokens 是调用方预留的输出预算；零使用供应商默认，负数拒绝。
	MaxOutputTokens int `json:"max_output_tokens,omitempty"`
	// ContextTokenLimit 是这次请求已经冻结的上下文上界，不发给上游。零表示调用方没有声明上界。
	ContextTokenLimit int `json:"-"`
}

// Usage 是令牌计量，仅在真实返回时随结果回传（不伪造）。
type Usage struct {
	PromptTokens                                      int `json:"prompt_tokens"`
	CompletionTokens                                  int `json:"completion_tokens"`
	TotalTokens                                       int `json:"total_tokens"`
	promptProvided, completionProvided, totalProvided bool
}

// UnmarshalJSON preserves field presence: an omitted count is unknown, not zero.
func (u *Usage) UnmarshalJSON(data []byte) error {
	var wire struct{ Prompt, Completion, Total *int }
	var fields struct {
		Prompt     *int `json:"prompt_tokens"`
		Completion *int `json:"completion_tokens"`
		Total      *int `json:"total_tokens"`
	}
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	wire.Prompt, wire.Completion, wire.Total = fields.Prompt, fields.Completion, fields.Total
	*u = Usage{}
	for _, v := range []*int{wire.Prompt, wire.Completion, wire.Total} {
		if v != nil && *v < 0 {
			return ErrInvalidResponse
		}
	}
	if wire.Prompt != nil {
		u.PromptTokens = *wire.Prompt
		u.promptProvided = true
	}
	if wire.Completion != nil {
		u.CompletionTokens = *wire.Completion
		u.completionProvided = true
	}
	if wire.Total != nil {
		u.TotalTokens = *wire.Total
		u.totalProvided = true
	}
	return nil
}

// Units returns only observed counts; legacy nonzero fixture counts remain usable.
func (u Usage) Units() (input, output, total *int64) {
	if u.promptProvided || u.PromptTokens > 0 {
		n := int64(u.PromptTokens)
		input = &n
	}
	if u.completionProvided || u.CompletionTokens > 0 {
		n := int64(u.CompletionTokens)
		output = &n
	}
	if u.totalProvided || u.TotalTokens > 0 {
		n := int64(u.TotalTokens)
		total = &n
	}
	return
}

// mergeUsage merges cumulative snapshots, not deltas: repeated frames do not add tokens.
func mergeUsage(previous, next Usage) Usage {
	if next.promptProvided || next.PromptTokens > 0 {
		previous.PromptTokens = next.PromptTokens
		previous.promptProvided = true
	}
	if next.completionProvided || next.CompletionTokens > 0 {
		previous.CompletionTokens = next.CompletionTokens
		previous.completionProvided = true
	}
	if next.totalProvided || next.TotalTokens > 0 {
		previous.TotalTokens = next.TotalTokens
		previous.totalProvided = true
	}
	return previous
}

// Result 是普通（非流式）生成的产物。
type Result struct {
	Text  string `json:"text"`
	Model string `json:"model"`
	Usage Usage  `json:"usage"`
}

// Chunk 是流式增量；Done 为 true 表示流结束。
type Chunk struct {
	Text  string `json:"text"`
	Done  bool   `json:"done"`
	Usage Usage  `json:"usage,omitempty"`
	Model string `json:"model,omitempty"`
}

// Generator 是模型能力的执行接口，OpenAI 与 Fake 均实现。
type Generator interface {
	Generate(ctx context.Context, req Request) (Result, error)
	Stream(ctx context.Context, req Request, onChunk func(Chunk) error) error
}

// 分类错误哨兵：全部为通用消息，不含 Prompt、Token、凭据或上游原始错误正文。
var (
	// ErrUnavailable 表示缺少 base URL 或 model 配置，能力显式不可用（capability_unavailable）。
	ErrUnavailable = errors.New("capability_unavailable")
	// ErrInvalidBaseURL 表示 base URL 不是合法 http(s) URL、缺 host 或带 URL 凭证。
	ErrInvalidBaseURL = errors.New("model: invalid base url")
	// ErrRequestFailed 表示上游请求传输失败（不透传含 URL 的 *url.Error）。
	ErrRequestFailed = errors.New("model: request failed")
	// ErrBadStatus 表示上游返回非 2xx 状态。
	ErrBadStatus = errors.New("model: upstream bad status")
)

// UpstreamStatusError 携带 HTTP 状态。429 与 5xx 可重试；其它 4xx 立即死，禁止毒帧循环。
type UpstreamStatusError struct {
	Status int
}

func (e UpstreamStatusError) Error() string {
	return fmt.Sprintf("%s: status %d", ErrBadStatus.Error(), e.Status)
}

func (e UpstreamStatusError) Unwrap() error { return ErrBadStatus }

func (e UpstreamStatusError) Retryable() bool {
	return e.Status == 429 || e.Status >= 500
}

// Code 是这次 HTTP 失败的稳定名字。429 与 5xx 可重试；401/403、402、其余 4xx 分开，不折成一个 upstream_4xx。
func (e UpstreamStatusError) Code() string {
	switch e.Status {
	case 401, 403:
		return "credential_rejected"
	case 402:
		return "credential_quota"
	default:
		if e.Retryable() {
			return "upstream_retryable"
		}
		if e.Status >= 400 && e.Status < 500 {
			return "upstream_rejected"
		}
		return "upstream_retryable"
	}
}

var (
	ErrResponseTooLarge = errors.New("model: response too large")
	// ErrInvalidResponse 表示上游响应不是合法 JSON/SSE 或不符合预期结构。
	ErrInvalidResponse = errors.New("model: invalid response")
	// ErrIncompleteResponse 表示 provider 未正常完成，调用方可按策略安全重试。
	ErrIncompleteResponse = errors.New("model: incomplete response")
)

// OpenAI 是 OpenAI 兼容 HTTP Adapter。
type OpenAI struct {
	baseURL *url.URL
	apiKey  string
	model   string
	client  *http.Client
}

// NewOpenAI 校验配置后构造 OpenAI，客户端用 http.DefaultClient（受 ctx deadline 约束）。
// baseURL 或 model 为空返回 ErrUnavailable（缺配置显式 unavailable，绝不模板答案）；apiKey 可选。
func NewOpenAI(baseURL, apiKey, modelName string) (*OpenAI, error) {
	return NewOpenAIWithClient(baseURL, apiKey, modelName, http.DefaultClient)
}

// NewOpenAIWithClient 同 NewOpenAI，但允许注入自定义 *http.Client（测试/超时控制用）。
// client 为 nil 时回退 http.DefaultClient；缺 baseURL/model 返回 ErrUnavailable（fail-closed）。
func NewOpenAIWithClient(baseURL, apiKey, modelName string, client *http.Client) (*OpenAI, error) {
	if strings.TrimSpace(baseURL) == "" || strings.TrimSpace(modelName) == "" {
		return nil, ErrUnavailable
	}
	parsed, err := validateBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	if client == nil {
		client = http.DefaultClient
	}
	return &OpenAI{baseURL: parsed, apiKey: apiKey, model: modelName, client: client}, nil
}

// validateBaseURL 校验 base URL：http(s)、host 非空、无 URL 凭证（apiKey 只进 Authorization 头）。
// URL 凭证被禁止，强制 apiKey 走 Authorization 头，避免密钥混进 URL 泄漏。
func validateBaseURL(baseURL string) (*url.URL, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidBaseURL, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%w: scheme %q", ErrInvalidBaseURL, parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, ErrInvalidBaseURL
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("%w: credentials in URL are forbidden, use apiKey", ErrInvalidBaseURL)
	}
	return parsed, nil
}

// endpoint 返回补全端点 URL（base URL 路径拼接 /chat/completions）。
// 保留 base URL 的 scheme/host 与既有路径前缀，兼容 OpenAI 及兼容网关。
func (o *OpenAI) endpoint() string {
	u := *o.baseURL
	u.Path = strings.TrimRight(u.Path, "/") + chatCompletionsPath
	return u.String()
}

// chatRequest 是 OpenAI 兼容补全请求体；ResponseFormat 仅在结构化输出时下发。
type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []Message       `json:"messages"`
	Stream         bool            `json:"stream"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
}

// responseFormat 描述结构化输出的 json_schema 约束。
type responseFormat struct {
	Type       string          `json:"type"`
	JSONSchema *jsonSchemaSpec `json:"json_schema,omitempty"`
}

// jsonSchemaSpec 是 response_format 的 json_schema 载体。
type jsonSchemaSpec struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
}

// chatResponse 是 OpenAI 兼容非流式响应信封。
type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *Usage          `json:"usage"`
	Error json.RawMessage `json:"error"`
}

// streamChunk 是 OpenAI 兼容流式增量帧。
type streamChunk struct {
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *Usage          `json:"usage"`
	Error json.RawMessage `json:"error"`
}

// Generate 执行一次非流式（plain 或 schema 约束）补全并返回结构化 Result。
// Prompt 只进入请求正文，绝不进入任何错误；错误均为通用哨兵，不含提示词/令牌/凭据/上游正文。
func (o *OpenAI) Generate(ctx context.Context, req Request) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if o.baseURL == nil || o.model == "" {
		return Result{}, ErrUnavailable
	}

	chat, err := o.makeChat(req, false)
	if err != nil {
		return Result{}, err
	}
	result, err := o.generateOnce(ctx, chat)
	if errors.Is(err, errResponseFormatUnavailable) && len(req.Schema) > 0 {
		chat = jsonModeChat(chat, req)
		return o.generateOnce(ctx, chat)
	}
	return result, err
}

// Stream 执行一次流式补全，逐块回调 onChunk，最后回调 Chunk{Done:true} 表示流结束。
// 解析 OpenAI 兼容 SSE 数据帧，流被 5 MiB 上限约束；错误均为通用哨兵，不含提示词/令牌/凭据/上游正文。
func (o *OpenAI) Stream(ctx context.Context, req Request, onChunk func(Chunk) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if o.baseURL == nil || o.model == "" {
		return ErrUnavailable
	}
	if onChunk == nil {
		return ErrRequestFailed
	}
	chat, err := o.makeChat(req, true)
	if err != nil {
		return err
	}
	err = o.streamOnce(ctx, chat, onChunk)
	if errors.Is(err, errResponseFormatUnavailable) && len(req.Schema) > 0 {
		return o.streamOnce(ctx, jsonModeChat(chat, req), onChunk)
	}
	return err
}

var errResponseLength = fmt.Errorf("%w: output length limit", ErrIncompleteResponse)
var errResponseError = errors.New("model: upstream error envelope")

func hasResponseError(raw json.RawMessage) bool {
	return len(raw) != 0 && string(raw) != "null"
}

func readSSE(body io.Reader, onChunk func(Chunk) error) error {
	limited := http.MaxBytesReader(nil, io.NopCloser(body), maxResponseBytes)
	scanner := bufio.NewScanner(limited)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, maxResponseBytes)
	var usage Usage
	var modelName string
	incomplete := false
	length := false
	providerError := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			if providerError {
				return errResponseError
			}
			if length {
				return errResponseLength
			}
			if incomplete {
				return ErrIncompleteResponse
			}
			return onChunk(Chunk{Done: true, Usage: usage, Model: modelName})
		}
		var frame streamChunk
		if err := json.Unmarshal([]byte(data), &frame); err != nil {
			return ErrInvalidResponse
		}
		if frame.Model != "" {
			modelName = frame.Model
		}
		if frame.Usage != nil {
			usage = mergeUsage(usage, *frame.Usage)
			if err := onChunk(Chunk{Usage: usage, Model: modelName}); err != nil {
				return err
			}
		}
		if hasResponseError(frame.Error) {
			providerError = true
		}
		if len(frame.Choices) > 0 {
			reason := strings.ToLower(strings.TrimSpace(frame.Choices[0].FinishReason))
			if reason == "length" {
				length = true
			}
			if reason != "" && reason != "stop" && reason != "tool_calls" && reason != "function_call" {
				incomplete = true
			}
		}
		if !providerError && len(frame.Choices) > 0 && frame.Choices[0].Delta.Content != "" {
			if err := onChunk(Chunk{Text: frame.Choices[0].Delta.Content}); err != nil {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return ErrResponseTooLarge
		}
		return ErrRequestFailed
	}
	if providerError {
		return errResponseError
	}
	return ErrIncompleteResponse
}

// responseFormat 在 Schema 非空时构造 json_schema 结构化输出约束，否则返回 nil（普通生成）。
// Schema 是调用方提供的 JSON Schema，原样放进 json_schema.schema，不代调用方校验或篡改。
func (o *OpenAI) responseFormat(schema json.RawMessage) *responseFormat {
	if len(schema) == 0 {
		return nil
	}
	return &responseFormat{
		Type: "json_schema",
		JSONSchema: &jsonSchemaSpec{
			Name:   "response",
			Schema: schema,
		},
	}
}

// errResponseFormatUnavailable is internal negotiation evidence, never upstream text.
var errResponseFormatUnavailable = fmt.Errorf("%w: response_format unavailable", UpstreamStatusError{Status: 400})

// responseFormatUnavailable 只认网关这一整句，不认任意 400。
// invalid_request_error 是所有非法请求共用的码，不能单独当判据。
// 网关没有更细的码。request id 只能是句末一对括号，不能靠前缀把后面的文字算进来。
func responseFormatUnavailable(body []byte) bool {
	var upstream struct {
		Error struct {
			Message string `json:"message"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &upstream) != nil || upstream.Error.Code != "invalid_request_error" {
		return false
	}
	return responseFormatSentence(upstream.Error.Message)
}

// responseFormatSentence 只认整句，或整句加句末一对 request id。括号后面再多字不算。
func responseFormatSentence(message string) bool {
	const sentence = "This response_format type is unavailable now"
	if message == sentence {
		return true
	}
	const lead = sentence + " (request id: "
	if !strings.HasPrefix(message, lead) || !strings.HasSuffix(message, ")") {
		return false
	}
	id := message[len(lead) : len(message)-1]
	return id != "" && !strings.ContainsAny(id, " 	\r\n()")
}

func (o *OpenAI) roundTrip(ctx context.Context, payload []byte) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, o.endpoint(), bytes.NewReader(payload))
	if err != nil {
		return nil, ErrRequestFailed
	}
	request.Header.Set("Content-Type", "application/json")
	if o.apiKey != "" {
		request.Header.Set("Authorization", authorizationScheme+" "+o.apiKey)
	}
	response, err := o.client.Do(request)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, context.Canceled
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, context.DeadlineExceeded
		}
		return nil, ErrRequestFailed
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 16<<10))
		_ = response.Body.Close()
		response.Body = io.NopCloser(bytes.NewReader(body))
		if response.StatusCode == http.StatusBadRequest && readErr == nil && responseFormatUnavailable(body) {
			return response, errResponseFormatUnavailable
		}
		return response, UpstreamStatusError{Status: response.StatusCode}
	}
	return response, nil
}
