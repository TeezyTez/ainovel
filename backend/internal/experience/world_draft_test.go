package experience

import (
	"context"
	"strings"
	"testing"
)

func TestWorldDraftUnavailableAndValidation(t *testing.T) {
	var interpreter *FeedbackInterpreter
	if _, err := interpreter.GenerateWorld(context.Background(), WorldDraftRequest{RequestID: "id", Idea: "一座海边城镇"}); err == nil {
		t.Fatal("missing model must fail")
	}
	draft := WorldDraft{Title: "海边城镇", Description: "一座小镇", Identity: "旅人", Location: "码头", Opening: "你抵达码头。", Rules: []string{}, Characters: []WorldCharacter{}, Narrative: WorldNarrative{"第二人称", "适中", "细腻克制", "从容"}}
	if err := validateWorldDraft(draft); err != nil {
		t.Fatal(err)
	}
	draft.Narrative.Perspective = "unknown"
	if validateWorldDraft(draft) == nil {
		t.Fatal("unknown perspective accepted")
	}
	draft.Narrative.Perspective = "第二人称"
	draft.Title = strings.Repeat("x", 161)
	if validateWorldDraft(draft) == nil {
		t.Fatal("long title accepted")
	}
}
