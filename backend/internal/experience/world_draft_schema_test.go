package experience

import (
	"context"
	"elselife/backend/internal/capability/model"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// Synthetic provider: validates transport requirements, not model quality.
type structuredOnlyModel struct{ newtestsFeedbackModel }

func (*structuredOnlyModel) RequiresOutputSchema() bool { return true }
func (m *structuredOnlyModel) Generate(ctx context.Context, r model.Request) (model.Result, error) {
	if len(r.Schema) == 0 {
		return model.Result{}, model.ErrRequestFailed
	}
	return m.newtestsFeedbackModel.Generate(ctx, r)
}
func completeWorldDraft() WorldDraft {
	return WorldDraft{Title: "雾港", Description: "港口城镇", Era: "近代", Rules: []string{"每封信都有来处"}, Characters: []WorldCharacter{{Name: "阿禾", Role: "店主", Public: "照看旧书店", Goal: "作者目标", History: "作者经历", Secret: "幕后密文"}}, Identity: "送信人", Location: "码头", Goal: "寻找收件人", Opening: "你站在码头边。", Narrative: WorldNarrative{Perspective: "第二人称", Length: "适中", Pace: "从容"}}
}
func assertStrictObjects(t *testing.T, value any) {
	t.Helper()
	m, ok := value.(map[string]any)
	if !ok {
		return
	}
	if m["type"] == "object" {
		if m["additionalProperties"] != false {
			t.Fatal("schema permits unknown fields")
		}
		props := m["properties"].(map[string]any)
		required := map[string]bool{}
		for _, v := range m["required"].([]any) {
			required[v.(string)] = true
		}
		if len(required) != len(props) {
			t.Fatal("schema missing required fields")
		}
		for key, child := range props {
			if !required[key] {
				t.Fatalf("optional structural field %s", key)
			}
			assertStrictObjects(t, child)
		}
	}
	if items, ok := m["items"]; ok {
		assertStrictObjects(t, items)
	}
}
func TestWorldDraftUsesCompleteStructuredSchemaAndReturnsAuthorDraft(t *testing.T) {
	expected := completeWorldDraft()
	raw, _ := json.Marshal(expected)
	m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{text: string(raw)}}
	got, err := newtestsInterpreter(m).GenerateWorld(context.Background(), WorldDraftRequest{RequestID: "draft-1", Idea: "海边的送信人"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Opening != expected.Opening || got.Identity != expected.Identity || got.Characters[0].Secret != "幕后密文" {
		t.Fatal("incomplete author draft")
	}
	if m.calls != 1 || len(m.requests) != 1 || m.requests[0].Messages[1].Content != "海边的送信人" {
		t.Fatal("request changed or retried")
	}
	var schema any
	if err = json.Unmarshal(m.requests[0].Schema, &schema); err != nil {
		t.Fatal(err)
	}
	assertStrictObjects(t, schema)
}

// Fixed model responses cover schema and transport behavior, not prose quality.
func TestWorldDraftGeneratesWithoutAStyleSetting(t *testing.T) {
	raw, _ := json.Marshal(completeWorldDraft())
	var object map[string]any
	_ = json.Unmarshal(raw, &object)
	delete(object["narrative"].(map[string]any), "style")
	raw, _ = json.Marshal(object)
	m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{text: string(raw)}}
	draft, err := newtestsInterpreter(m).GenerateWorld(context.Background(), WorldDraftRequest{RequestID: "draft-style", Idea: "近代港口的送信人"})
	if err != nil || draft.Opening != "你站在码头边。" {
		t.Fatalf("style-free draft rejected: %+v %v", draft, err)
	}
	var schema map[string]any
	_ = json.Unmarshal(m.requests[0].Schema, &schema)
	narrative := schema["properties"].(map[string]any)["narrative"].(map[string]any)
	if _, exists := narrative["properties"].(map[string]any)["style"]; exists {
		t.Fatal("model schema still asks for a style setting")
	}
	for _, key := range narrative["required"].([]any) {
		if key == "style" {
			t.Fatal("model schema still requires a style setting")
		}
	}
}

func TestWorldDraftRejectsModelProvidedStyleSetting(t *testing.T) {
	raw, _ := json.Marshal(completeWorldDraft())
	var object map[string]any
	_ = json.Unmarshal(raw, &object)
	object["narrative"].(map[string]any)["style"] = "细腻克制"
	raw, _ = json.Marshal(object)
	m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{text: string(raw)}}
	draft, err := newtestsInterpreter(m).GenerateWorld(context.Background(), WorldDraftRequest{RequestID: "draft-style", Idea: "送信人"})
	if err == nil || draft.Title != "" {
		t.Fatal("model output outside the style-free schema accepted")
	}
}
func TestWorldDraftRejectsIncompleteAndUnsavableModelOutput(t *testing.T) {
	valid := completeWorldDraft()
	raw, _ := json.Marshal(valid)
	cases := []string{
		strings.Replace(string(raw), `"secret":"幕后密文",`, "", 1),
		strings.Replace(string(raw), `"secret":"幕后密文"`, `"secret":null`, 1),
		strings.Replace(string(raw), `"identity":"送信人"`, `"identity":""`, 1),
		strings.Replace(string(raw), `"opening":"你站在码头边。"`, `"opening":""`, 1),
		strings.Replace(string(raw), `"characters":[`, `"unexpected":true,"characters":[`, 1),
		`{"title":"假的成功"}`,
	}
	// Struct field order puts secret last, so remove its preceding comma.
	cases[0] = strings.Replace(string(raw), `,"secret":"幕后密文"`, "", 1)
	for _, response := range cases {
		m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{text: response}}
		got, err := newtestsInterpreter(m).GenerateWorld(context.Background(), WorldDraftRequest{RequestID: "draft", Idea: "想法"})
		if err == nil || got.Title != "" {
			t.Fatalf("malformed response returned usable draft: %+v %v", got, err)
		}
	}
	for name, mutate := range map[string]func(*WorldDraft){"long name": func(d *WorldDraft) { d.Characters[0].Name = strings.Repeat("x", 101) }, "long role": func(d *WorldDraft) { d.Characters[0].Role = strings.Repeat("x", 201) }, "long identity": func(d *WorldDraft) { d.Identity = strings.Repeat("x", 501) }, "null rules": func(d *WorldDraft) { d.Rules = nil }, "null characters": func(d *WorldDraft) { d.Characters = nil }} {
		t.Run(name, func(t *testing.T) {
			d := completeWorldDraft()
			mutate(&d)
			if validateWorldDraft(d) == nil {
				t.Fatal("unsavable draft accepted")
			}
		})
	}
}
func TestWorldDraftModelFailureDoesNotReturnFallback(t *testing.T) {
	m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{err: errors.New("provider private diagnostic")}}
	draft, err := newtestsInterpreter(m).GenerateWorld(context.Background(), WorldDraftRequest{RequestID: "draft", Idea: "想法"})
	if err == nil || err.Error() != "model_failed" || draft.Title != "" || m.calls != 1 {
		t.Fatalf("draft=%+v error=%v calls=%d", draft, err, m.calls)
	}
}
func TestFeedbackStructuredOnlyProviderReceivesItsOwnSchema(t *testing.T) {
	m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{text: `{"proposals":[{"dimension":"节奏","value":"慢一点","quote":"慢一点"}],"explanation":"待确认"}`}}
	got, err := newtestsInterpreter(m).Interpret(context.Background(), FeedbackRequest{Text: "请慢一点"})
	if err != nil || got.Status != "draft" || m.calls != 1 {
		t.Fatalf("feedback=%+v error=%v calls=%d", got, err, m.calls)
	}
	var schema any
	_ = json.Unmarshal(m.requests[0].Schema, &schema)
	assertStrictObjects(t, schema)
	if !requiresOutputSchema(&model.CodexCLI{}) {
		t.Fatal("Codex requires output schema")
	}
	if requiresOutputSchema(&newtestsFeedbackModel{}) {
		t.Fatal("compatible provider must keep no-schema one-attempt behavior")
	}
}
