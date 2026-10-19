package experience

import (
	"context"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

type modelCallFailureGenerator struct {
	err   error
	calls int
}

func (generator *modelCallFailureGenerator) Generate(context.Context, model.Request) (model.Result, error) {
	generator.calls++
	return model.Result{}, generator.err
}

func (generator *modelCallFailureGenerator) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return generator.err
}

func TestModelCallFailureClassification(t *testing.T) {
	for _, testCase := range []struct {
		name          string
		providerError error
		contextError  error
		missingModel  bool
		requestModel  string
		wantCode      string
		wantCalls     int
	}{
		{name: "request failed", providerError: model.ErrRequestFailed, wantCode: "model_failed", wantCalls: 1},
		{name: "invalid response", providerError: model.ErrInvalidResponse, wantCode: "model_failed", wantCalls: 1},
		{name: "unavailable", providerError: model.ErrUnavailable, wantCode: "model_unavailable", wantCalls: 1},
		{name: "provider deadline", providerError: context.DeadlineExceeded, wantCode: "model_deadline_exceeded", wantCalls: 1},
		{name: "provider canceled", providerError: context.Canceled, wantCode: "model_canceled", wantCalls: 1},
		{name: "context deadline", providerError: model.ErrRequestFailed, contextError: context.DeadlineExceeded, wantCode: "model_deadline_exceeded", wantCalls: 1},
		{name: "context canceled", providerError: model.ErrRequestFailed, contextError: context.Canceled, wantCode: "model_canceled", wantCalls: 1},
		{name: "missing provider", missingModel: true, wantCode: "model_unavailable"},
		{name: "model mismatch", requestModel: "other-model", wantCode: "model_unavailable"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			generator := &modelCallFailureGenerator{err: testCase.providerError}
			algorithm := &Algorithm{
				Model:                       generator,
				ModelName:                   "test-model",
				ModelContextTokens:          131072,
				ModelByteTokenBoundVerified: true,
			}
			if testCase.missingModel {
				algorithm.Model = nil
			}
			ctx := context.Background()
			switch testCase.contextError {
			case context.DeadlineExceeded:
				var cancel context.CancelFunc
				ctx, cancel = context.WithDeadline(ctx, time.Unix(0, 0))
				defer cancel()
			case context.Canceled:
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			request := &pb.ModelCallRequest{
				Model:          testCase.requestModel,
				Messages:       []*pb.ModelMessage{{Role: "user", Content: "Begin."}},
				SchemaJson:     `{"type":"object"}`,
				MaxOutputBytes: 4096,
			}
			result := algorithm.modelCall(ctx, request)
			if result.ErrorCode != testCase.wantCode || result.Text != "" {
				t.Fatalf("result = %v, want error_code %q without text", result, testCase.wantCode)
			}
			if generator.calls != testCase.wantCalls {
				t.Fatalf("model calls = %d, want %d", generator.calls, testCase.wantCalls)
			}
		})
	}
}
