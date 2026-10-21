package experience

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestPublicFactCarriesRecordVersionWithoutChangingHistoricalKnowledge(t *testing.T) {
	old := EmptyState()
	old.StoryTime = "霜月10日"
	old.Facts = []Fact{
		{ID: "current-date", Kind: "fact", Text: "当前故事日期为霜月10日。", Known: true, KnownBy: []string{}, SourceRevision: 1},
		{ID: "letter", Kind: "secret", Text: "信中记载离城日期为霜月6日；玩家尚未阅读。", Known: false, KnownBy: []string{}, SourceRevision: 1},
	}
	before, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	later := old
	later.Facts = append([]Fact(nil), old.Facts...)
	later.Facts[1].Known = true
	later.Facts = append(later.Facts, Fact{ID: "read-letter", Kind: "fact", Text: "霜月10日，玩家接过并读完了信。", Known: true, KnownBy: []string{}, SourceRevision: 3})
	var projected []map[string]any
	raw, err := json.Marshal(Project(later))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &projected); err != nil {
		t.Fatal(err)
	}
	versions := map[string]float64{"fact:current-date": 1, "fact:letter": 1, "fact:read-letter": 3}
	for _, item := range projected {
		id := item["id"].(string)
		if item["recorded_revision"] != versions[id] {
			t.Fatalf("public historical fact %s lost its actual record version: %s", id, raw)
		}
		if _, exists := item["source_version"]; exists {
			t.Fatal("private creation revision must not masquerade as first public prose source")
		}
	}
	if len(Project(old)) != 1 || len(ProjectReader(old, 1).Information) != 1 {
		t.Fatal("later disclosure leaked into historical projection")
	}
	after, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) || later.Facts[1].Text != old.Facts[1].Text {
		t.Fatal("display metadata rewrote original evidence")
	}
}

func TestFactRecordVersionDoesNotExposeHiddenSubjectOrInventLegacyOrigin(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "hidden", Kind: "person", Name: "秘密人物", Known: false, RelatedIDs: []string{}}}
	s.Facts = []Fact{
		{ID: "hidden-belief", Kind: "belief", Text: "秘密人物相信门开了", SubjectID: "hidden", Known: true, KnownBy: []string{"hidden"}, SourceRevision: 1},
		{ID: "legacy", Kind: "fact", Text: "没有可靠版次的旧记录", Known: true, KnownBy: []string{}},
	}
	var items []map[string]any
	raw, err := json.Marshal(Project(s))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0]["id"] != "fact:legacy" {
		t.Fatalf("hidden subject leaked: %s", raw)
	}
	if _, exists := items[0]["recorded_revision"]; exists {
		t.Fatal("legacy origin was invented")
	}
}
