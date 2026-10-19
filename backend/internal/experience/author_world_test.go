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
	world.Narrative.Style = "自定义：朴素的散文与轻微幽默"
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
