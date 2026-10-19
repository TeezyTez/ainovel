// Development extraction: original HTTP transport without commercial cost-ledger hooks.
package model

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// ErrUsageUnavailable is a pre-send ledger failure, never a provider retry signal.
var ErrUsageUnavailable = errors.New("model: attempt ledger unavailable")

func (o *OpenAI) makeChat(req Request, stream bool) (chatRequest, error) {
	name := strings.TrimSpace(req.Model)
	if name == "" {
		name = o.model
	}
	if req.MaxOutputTokens < 0 {
		return chatRequest{}, ErrRequestFailed
	}
	return chatRequest{Model: name, Messages: req.Messages, Stream: stream, ResponseFormat: o.responseFormat(req.Schema), MaxTokens: req.MaxOutputTokens}, nil
}
func jsonModeChat(chat chatRequest, req Request) chatRequest {
	chat.Messages = make([]Message, 0, len(req.Messages)+1)
	chat.Messages = append(chat.Messages, Message{Role: "system", Content: "Return only a JSON object matching this JSON Schema, without markdown fences or commentary:\n" + string(req.Schema)})
	chat.Messages = append(chat.Messages, req.Messages...)
	chat.ResponseFormat = &responseFormat{Type: "json_object"}
	return chat
}
func attemptErrorCode(err error) string {
	if errors.Is(err, errResponseFormatUnavailable) {
		return "response_format_unavailable"
	}
	var status UpstreamStatusError
	if errors.As(err, &status) {
		return status.Code()
	}
	switch {
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline_exceeded"
	case errors.Is(err, errResponseError):
		return "provider_error"
	case errors.Is(err, errResponseLength):
		return "response_length"
	case errors.Is(err, ErrIncompleteResponse):
		return "incomplete_response"
	case errors.Is(err, ErrResponseTooLarge):
		return "response_too_large"
	case errors.Is(err, ErrInvalidResponse):
		return "invalid_response"
	case errors.Is(err, ErrRequestFailed):
		return "transport_failed"
	default:
		return "consumer_failed"
	}
}
func (o *OpenAI) generateOnce(ctx context.Context, chat chatRequest) (result Result, err error) {
	payload, err := json.Marshal(chat)
	if err != nil {
		return result, ErrRequestFailed
	}
	response, err := o.roundTrip(ctx, payload)
	if response == nil {
		return result, err
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(http.MaxBytesReader(nil, response.Body, maxResponseBytes))
	var upstream chatResponse
	parsed := json.Unmarshal(body, &upstream) == nil
	if parsed {
		result.Model = upstream.Model
		if upstream.Usage != nil {
			result.Usage = *upstream.Usage
		}
	}
	if readErr != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		var tooLarge *http.MaxBytesError
		if errors.As(readErr, &tooLarge) {
			return result, ErrResponseTooLarge
		}
		return result, ErrRequestFailed
	}
	if err != nil {
		return result, err
	}
	if !parsed {
		return result, ErrInvalidResponse
	}
	if hasResponseError(upstream.Error) {
		return result, errResponseError
	}
	if len(upstream.Choices) > 0 {
		result.Text = upstream.Choices[0].Message.Content
		reason := strings.ToLower(strings.TrimSpace(upstream.Choices[0].FinishReason))
		if reason == "length" {
			return result, errResponseLength
		}
		if reason != "" && reason != "stop" && reason != "tool_calls" && reason != "function_call" {
			return result, ErrIncompleteResponse
		}
	}
	return result, nil
}
func (o *OpenAI) streamOnce(ctx context.Context, chat chatRequest, onChunk func(Chunk) error) (err error) {
	payload, err := json.Marshal(chat)
	if err != nil {
		return ErrRequestFailed
	}
	result := Result{}
	response, err := o.roundTrip(ctx, payload)
	if response == nil {
		return err
	}
	defer response.Body.Close()
	if err != nil {
		var upstream chatResponse
		body, _ := io.ReadAll(io.LimitReader(response.Body, 16<<10))
		if json.Unmarshal(body, &upstream) == nil {
			result.Model = upstream.Model
			if upstream.Usage != nil {
				result.Usage = *upstream.Usage
			}
		}
		return err
	}
	err = readSSE(response.Body, func(chunk Chunk) error {
		result.Usage = mergeUsage(result.Usage, chunk.Usage)
		if chunk.Model != "" {
			result.Model = chunk.Model
		}
		return onChunk(chunk)
	})
	if err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}
