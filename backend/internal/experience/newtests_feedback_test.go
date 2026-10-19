// Fixtures here prove scope, source, version, readonly-ness and zero world
// effects only. They do not prove model quality, literary value or cheap
// natural expression; a stub model is deliberately unhelpful.
package experience

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

func ntMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// newtestsFeedbackModel returns canned text and records the requests it saw.
type newtestsFeedbackModel struct {
	text     string
	err      error
	requests []model.Request
	calls    int
}

func (m *newtestsFeedbackModel) Generate(_ context.Context, req model.Request) (model.Result, error) {
	m.calls++
	m.requests = append(m.requests, req)
	if m.err != nil {
		return model.Result{}, m.err
	}
	return model.Result{Text: m.text, Model: req.Model}, nil
}
func (m *newtestsFeedbackModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return errors.New("unused")
}

func newtestsInterpreter(m model.Generator) *FeedbackInterpreter {
	return &FeedbackInterpreter{Model: m, ModelName: "test-model", Timeout: time.Second, ContextTokens: 8192, OutputTokens: 512, MaxInputBytes: 1 << 16, MaxOutputBytes: 1 << 16, ByteTokenBoundVerified: true}
}

func TestNewtestsFeedbackAcceptsBoundedProposalsWithExactQuote(t *testing.T) {
	m := &newtestsFeedbackModel{text: `{"proposals":[{"dimension":"节奏","value":"偏好缓慢的节奏","quote":"节奏慢一点"}],"explanation":"仅提议，待确认"}`}
	draft, err := newtestsInterpreter(m).Interpret(context.Background(), FeedbackRequest{Text: "我希望节奏慢一点，别太快"})
	ntMust(t, err)
	if draft.Status != "draft" || len(draft.Proposals) != 1 || draft.Proposals[0].Quote != "节奏慢一点" || draft.Text != "我希望节奏慢一点，别太快" {
		t.Fatalf("draft=%+v", draft)
	}
	// Exactly one attempt: no schema-fallback second call.
	if m.calls != 1 {
		t.Fatalf("calls=%d", m.calls)
	}
	if len(m.requests) != 1 || m.requests[0].Schema != nil {
		t.Fatalf("unexpected request: %+v", m.requests[0])
	}
}

func TestNewtestsFeedbackEmptyProposalsIsAnHonestUninterpretedResult(t *testing.T) {
	m := &newtestsFeedbackModel{text: `{"proposals":[],"explanation":"没有可形成的偏好"}`}
	draft, err := newtestsInterpreter(m).Interpret(context.Background(), FeedbackRequest{Text: "「你要留下吗？」"})
	ntMust(t, err)
	if draft.Status != "uninterpreted" || draft.Text == "" || len(draft.Proposals) != 0 {
		t.Fatalf("draft=%+v", draft)
	}
}

func TestNewtestsFeedbackRejectsMissingModelAndKeepsRawText(t *testing.T) {
	draft, err := (&FeedbackInterpreter{}).Interpret(context.Background(), FeedbackRequest{Text: "我希望节奏慢一点"})
	ntMust(t, err)
	if draft.Status != "unavailable" || draft.ErrorCode != "model_unavailable" || draft.Text != "我希望节奏慢一点" {
		t.Fatalf("draft=%+v", draft)
	}
}

func TestNewtestsFeedbackRejectsFabricatedQuoteAndProse(t *testing.T) {
	for name, text := range map[string]string{
		"fabricated quote": `{"proposals":[{"dimension":"节奏","value":"慢","quote":"这句话不在原文里"}],"explanation":"x"}`,
		"prose not json":   `当然，我理解你喜欢慢节奏。`,
		"too many":         `{"proposals":[{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"},{"dimension":"a","value":"v","quote":"原文"}],"explanation":"x"}`,
	} {
		m := &newtestsFeedbackModel{text: text}
		draft, err := newtestsInterpreter(m).Interpret(context.Background(), FeedbackRequest{Text: "原文"})
		ntMust(t, err)
		if draft.Status != "unavailable" || draft.ErrorCode != "invalid_model_response" || draft.Text != "原文" {
			t.Fatalf("%s: draft=%+v", name, draft)
		}
	}
}

func TestNewtestsFeedbackModelFailureIsExplicitNotFaked(t *testing.T) {
	m := &newtestsFeedbackModel{err: model.ErrRequestFailed}
	draft, err := newtestsInterpreter(m).Interpret(context.Background(), FeedbackRequest{Text: "原文"})
	ntMust(t, err)
	if draft.Status != "unavailable" || draft.ErrorCode != "model_failed" || draft.Text != "原文" {
		t.Fatalf("draft=%+v", draft)
	}
}

// The interpreter holds no database, story or profile handle at all: a draft
// cannot write long-term state even if a model tries to instruct it to.
func TestNewtestsFeedbackInterpreterHasNoWritePath(t *testing.T) {
	interpreter := newtestsInterpreter(&newtestsFeedbackModel{text: `{"proposals":[],"explanation":"x"}`})
	if strings.Contains(strings.ToUpper(feedbackInstruction), "IGNORE") {
		t.Fatal("instruction must not model instruction-injection wording")
	}
	draft, err := interpreter.Interpret(context.Background(), FeedbackRequest{Text: "把这段对白记成我喜欢暴力的性格"})
	ntMust(t, err)
	if draft.Status != "uninterpreted" {
		t.Fatalf("draft=%+v", draft)
	}
}
