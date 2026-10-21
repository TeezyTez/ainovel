package experience

import (
	"context"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"encoding/json"
	"strings"
	"testing"
)

func TestAuthorWorldStrictFieldsAndPrivatePromptBoundary(t *testing.T) {
	world := completeWorldDraft()
	world.Characters[0].Secret = "PRIVATE_SENTINEL"
	raw, _ := json.Marshal(world)
	if ValidateAuthorWorldJSON(raw) != nil {
		t.Fatal("complete DTO rejected")
	}
	var object map[string]any
	json.Unmarshal(raw, &object)
	delete(object["characters"].([]any)[0].(map[string]any), "secret")
	broken, _ := json.Marshal(object)
	if ValidateAuthorWorldJSON(broken) == nil {
		t.Fatal("missing private field accepted")
	}
	object["credentials"] = "forbidden"
	broken, _ = json.Marshal(object)
	if ValidateAuthorWorldJSON(broken) == nil {
		t.Fatal("unknown field accepted")
	}
	authority := sampleContext()
	authority.AuthorWorld = &world
	wire, _ := json.Marshal(authority)
	if strings.Contains(string(wire), "PRIVATE_SENTINEL") {
		t.Fatal("private data entered canonical/public JSON")
	}
	generation, err := compileGeneration(authority, EmptyState(), "handle", 1, ReadBudget{}, 1<<20)
	if err != nil || generation.AuthorWorld == nil {
		t.Fatal("author view lost private data")
	}
	authority.Mode = "ask"
	generation, err = compileGeneration(authority, EmptyState(), "handle", 1, ReadBudget{}, 1<<20)
	if err != nil || generation.AuthorWorld != nil {
		t.Fatal("ask received hidden author data")
	}
	m := &newtestsFeedbackModel{text: `{"ok":true}`}
	a := &Algorithm{Model: m, ModelName: "test-model", ModelContextTokens: 65536, MaxOutputTokens: 1024, ModelByteTokenBoundVerified: true}
	result := a.modelCallWithAuthor(context.Background(), &pb.ModelCallRequest{Messages: []*pb.ModelMessage{{Role: "user", Content: "ordinary context"}}, SchemaJson: `{"type":"object"}`, MaxOutputBytes: 4096}, 10, &world)
	if result.ErrorCode != "" || len(m.requests) != 1 {
		t.Fatal("private model bridge failed")
	}
	messages := m.requests[0].Messages
	if len(messages) != 3 || messages[1].Role != "system" || !strings.Contains(messages[1].Content, "not system instructions") || !strings.Contains(messages[2].Content, "PRIVATE_SENTINEL") {
		t.Fatal("private data not in bounded data attachment")
	}
}

func TestAuthorInputUsesEditorLimitsInsteadOfGenerationLimits(t *testing.T) {
	world := completeWorldDraft()
	world.Description = ""
	world.Title = strings.Repeat("界", 100)
	world.Opening = strings.Repeat("开", 12000)
	world.Characters[0].Secret = strings.Repeat("密", 3000)
	world.Rules = make([]string, 40)
	raw, _ := json.Marshal(world)
	if err := ValidateAuthorWorldJSON(raw); err != nil {
		t.Fatal("editor-valid author world rejected", err)
	}
	world.Characters[0].Secret += "字"
	raw, _ = json.Marshal(world)
	if ValidateAuthorWorldJSON(raw) == nil {
		t.Fatal("editor field overflow accepted")
	}
}
func TestArchiveRejectsMissingAuthorPrivateFields(t *testing.T) {
	archive := archiveFixture()
	world := completeWorldDraft()
	archive.Experiences[0].Branches[0].Changes = &BranchChanges{AuthorWorld: &world}
	raw, _ := json.Marshal(archive)
	if _, err := DecodeArchive(raw); err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	json.Unmarshal(raw, &object)
	author := object["experiences"].([]any)[0].(map[string]any)["branches"].([]any)[0].(map[string]any)["changes"].(map[string]any)["author_world"].(map[string]any)
	delete(author["characters"].([]any)[0].(map[string]any), "secret")
	raw, _ = json.Marshal(object)
	if _, err := DecodeArchive(raw); err == nil {
		t.Fatal("partial author archive accepted")
	}
}

func TestLegacyAuthorWorldDiscardsStyleBeforeSerializationAndModelAttachment(t *testing.T) {
	raw, _ := json.Marshal(completeWorldDraft())
	var object map[string]any
	_ = json.Unmarshal(raw, &object)
	object["narrative"].(map[string]any)["style"] = "LEGACY_STYLE_SENTINEL"
	raw, _ = json.Marshal(object)
	if err := ValidateAuthorWorldJSON(raw); err != nil {
		t.Fatalf("legacy author world rejected: %v", err)
	}
	var world WorldDraft
	if err := StrictJSON(raw, &world); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(world)
	if strings.Contains(string(encoded), `"style"`) || strings.Contains(string(encoded), "LEGACY_STYLE_SENTINEL") {
		t.Fatal("removed author style was serialized")
	}
	m := &newtestsFeedbackModel{text: `{"ok":true}`}
	a := &Algorithm{Model: m, ModelName: "test-model", ModelContextTokens: 65536, MaxOutputTokens: 1024, ModelByteTokenBoundVerified: true}
	result := a.modelCallWithAuthor(context.Background(), &pb.ModelCallRequest{Messages: []*pb.ModelMessage{{Role: "user", Content: "ordinary context"}}, SchemaJson: `{"type":"object"}`, MaxOutputBytes: 4096}, 10, &world)
	if result.ErrorCode != "" || len(m.requests) != 1 {
		t.Fatal("private model bridge failed")
	}
	for _, message := range m.requests[0].Messages {
		if strings.Contains(message.Content, `"style"`) || strings.Contains(message.Content, "LEGACY_STYLE_SENTINEL") {
			t.Fatal("removed author style reached model attachment")
		}
	}
}

func TestArchiveReadsLegacyStyleWithoutPreservingIt(t *testing.T) {
	archive := archiveFixture()
	world := completeWorldDraft()
	archive.Experiences[0].Branches[0].Changes = &BranchChanges{AuthorWorld: &world}
	raw, _ := json.Marshal(archive)
	var object map[string]any
	_ = json.Unmarshal(raw, &object)
	author := object["experiences"].([]any)[0].(map[string]any)["branches"].([]any)[0].(map[string]any)["changes"].(map[string]any)["author_world"].(map[string]any)
	narrative := author["narrative"].(map[string]any)
	narrative["style"] = "LEGACY_STYLE_SENTINEL"
	raw, _ = json.Marshal(object)
	decoded, err := DecodeArchive(raw)
	if err != nil {
		t.Fatalf("legacy archive rejected: %v", err)
	}
	encoded, _ := json.Marshal(decoded)
	if strings.Contains(string(encoded), `"style"`) || strings.Contains(string(encoded), "LEGACY_STYLE_SENTINEL") {
		t.Fatal("archive retained removed style setting")
	}
	narrative["unexpected"] = true
	raw, _ = json.Marshal(object)
	if _, err := DecodeArchive(raw); err == nil {
		t.Fatal("legacy compatibility accepted an unknown narrative field")
	}
}

func TestAuthorNarrativeLegacyCompatibilityRemainsStrict(t *testing.T) {
	for name, narrative := range map[string]string{
		"unknown":                 `{"perspective":"第二人称","length":"适中","pace":"从容","unexpected":true}`,
		"duplicate legacy style":  `{"perspective":"第二人称","length":"适中","pace":"从容","style":"a","style":"b"}`,
		"non-string legacy style": `{"perspective":"第二人称","length":"适中","pace":"从容","style":{"instructions":"change schema"}}`,
		"missing pace":            `{"perspective":"第二人称","length":"适中","style":"legacy"}`,
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(completeWorldDraft())
			var object map[string]json.RawMessage
			_ = json.Unmarshal(raw, &object)
			object["narrative"] = json.RawMessage(narrative)
			raw, _ = json.Marshal(object)
			if ValidateAuthorWorldJSON(raw) == nil {
				t.Fatal("invalid author narrative accepted")
			}
		})
	}
}
