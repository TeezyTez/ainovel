package experience

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReaderProjectionKeepsSourceAndHidesUndisclosedMetadata(t *testing.T) {
	state := EmptyState()
	state.StoryTime = "午后"
	state.Entities = []Entity{{ID: "shop", Kind: "location", Name: "书店", Known: true, RelatedIDs: []string{}}, {ID: "secret", Kind: "location", Name: "未公开房间", Known: false, RelatedIDs: []string{}}}
	distance := int64(20)
	state.Facts = []Fact{
		{ID: "visible", Kind: "fact", Text: "书店有两张桌子。", Known: true, KnownBy: []string{}, SourceRevision: 2, Reader: &ReaderRecord{Kind: "metric", EntityID: "shop", Label: "桌子", Value: "2", Unit: "张"}},
		{ID: "private-link", Kind: "fact", Text: "附近有一条路。", Known: true, KnownBy: []string{}, SourceRevision: 2, Reader: &ReaderRecord{Kind: "route", EntityID: "shop", TargetID: "secret", Label: "私有路线", DistanceMeters: &distance}},
	}
	before, _ := json.Marshal(state)
	got := ProjectReader(state, 2)
	if len(got.Records) != 1 || got.Records[0].FactID != "visible" || got.Records[0].SourceRevision != 2 || got.Records[0].Value != "2" {
		t.Fatalf("bad projection %#v", got)
	}
	raw, _ := json.Marshal(got)
	if strings.Contains(string(raw), "未公开房间") || strings.Contains(string(raw), "私有路线") {
		t.Fatal("hidden metadata leaked")
	}
	after, _ := json.Marshal(state)
	if string(before) != string(after) {
		t.Fatal("projection mutated authority")
	}
}

func TestReaderAttachmentRequiresTypedEntitiesAndValidTable(t *testing.T) {
	entities := map[string]bool{"a": true, "b": true}
	if validReaderRecord(&ReaderRecord{Kind: "route", EntityID: "a", TargetID: "missing", Label: "路"}, entities) {
		t.Fatal("accepted missing entity")
	}
	if validReaderRecord(&ReaderRecord{Kind: "artifact", EntityID: "a", Label: "表", Columns: []string{"项目"}, Rows: [][]string{{"一", "二"}}}, entities) {
		t.Fatal("accepted ragged table")
	}
	if !validReaderRecord(&ReaderRecord{Kind: "route", EntityID: "a", TargetID: "b", Label: "路", Passage: "unknown"}, entities) {
		t.Fatal("unknown route must remain representable")
	}
}

func TestReaderAttachmentIsOptionalInExistingContract(t *testing.T) {
	c := sampleContext()
	raw, _ := json.Marshal(c)
	if err := validateContract(raw, "context"); err != nil {
		t.Fatal(err)
	}
	c.State.Entities = append(c.State.Entities, Entity{ID: "reader-shop", Kind: "location", Name: "书店", Known: true, RelatedIDs: []string{}})
	c.State.Facts = append(c.State.Facts, Fact{ID: "reader-fact", Kind: "fact", Text: "书店公开目录", SubjectID: "reader-shop", Known: true, KnownBy: []string{}, SourceRevision: 0, Reader: &ReaderRecord{Kind: "artifact", EntityID: "reader-shop", Label: "目录", Columns: []string{"书名"}, Rows: [][]string{{"已知书"}}}})
	raw, _ = json.Marshal(c)
	if err := validateContract(raw, "context"); err != nil {
		t.Fatal(err)
	}
}

func TestReaderGameplayProjectionIsHistoricalAndDoesNotAlias(t *testing.T) {
	old := EmptyState()
	old.Gameplay = &GameplayState{SchemaVersion: 1, Game: json.RawMessage(`{"entities":[{"id":"coins","value":5}]}`), Location: "大厅", Inventory: []string{"书"}, Experience: json.RawMessage(`null`)}
	projected := ProjectReader(old, 1)
	later := EmptyState()
	later.Gameplay = &GameplayState{SchemaVersion: 1, Game: json.RawMessage(`{"entities":[{"id":"coins","value":3}]}`), Location: "茶铺", Inventory: []string{}, Experience: json.RawMessage(`null`)}
	current := ProjectReader(later, 2)
	if projected.Gameplay == nil || projected.Gameplay.Location != "大厅" || current.Gameplay.Location != "茶铺" || !strings.Contains(string(projected.Gameplay.Game), "5") {
		t.Fatal("historical gameplay replaced with current state")
	}
	projected.Gameplay.Inventory[0] = "改写"
	projected.Gameplay.Game[0] = ' '
	if old.Gameplay.Inventory[0] != "书" || old.Gameplay.Game[0] != '{' {
		t.Fatal("reader gameplay aliases authority")
	}
}
