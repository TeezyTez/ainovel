package experience

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func archiveFixture() Archive {
	now := time.Date(2026, 10, 15, 10, 0, 0, 0, time.UTC)
	state := EmptyState()
	state.StoryTime = "雨夜"
	state.Entities = []Entity{{ID: "npc", Kind: "person", Name: "故人", Description: "", Known: true, RelatedIDs: []string{"secret"}}}
	state.Facts = []Fact{{ID: "secret", Kind: "secret", Text: "尚未知晓的事实", KnownBy: []string{"npc"}, SourceRevision: 1}}
	page := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: "种子", Text: "原文。\n  保留空格。"}, StoryTime: state.StoryTime, CreatedAt: now, Suggestions: []string{"询问"}, Outcome: "awaits_player"}
	return Archive{Format: archiveFormat, Version: 1, Experiences: []ArchiveExperience{{ID: "exp_1", Seed: "种子", ActiveBranchID: "branch_1", CreatedAt: now, Branches: []ArchiveBranch{{ID: "branch_1", Name: "主分支", Title: "世界", Revision: 1, State: state, CreatedAt: now, Pages: []ArchivePage{{Page: page, State: state, Title: "世界", CreatedAt: now}}}}}}}
}
func TestArchiveStrictRoundtripPreservesRawProseAndHiddenState(t *testing.T) {
	original := archiveFixture()
	raw, _ := json.Marshal(original)
	got, err := DecodeArchive(raw)
	if err != nil || !reflect.DeepEqual(original, got) {
		t.Fatalf("roundtrip=%+v error=%v", got, err)
	}
	if got.Experiences[0].Branches[0].State.Facts[0].Known {
		t.Fatal("hidden state became reader known")
	}
}
func TestArchiveRejectsMalformedAuthorityBeforeImport(t *testing.T) {
	cases := map[string]func(*Archive){
		"version":                   func(a *Archive) { a.Version = 2 },
		"missing active branch":     func(a *Archive) { a.Experiences[0].ActiveBranchID = "missing" },
		"duplicate experience":      func(a *Archive) { a.Experiences = append(a.Experiences, a.Experiences[0]) },
		"page gap":                  func(a *Archive) { a.Experiences[0].Branches[0].Pages[0].Page.Revision = 2 },
		"missing history":           func(a *Archive) { a.Experiences[0].Branches[0].Revision = 2 },
		"dangling entity":           func(a *Archive) { a.Experiences[0].Branches[0].State.Facts[0].KnownBy = []string{"missing"} },
		"future provenance":         func(a *Archive) { a.Experiences[0].Branches[0].State.Facts[0].SourceRevision = 2 },
		"duplicate object identity": func(a *Archive) { a.Experiences[0].Branches[0].State.Entities[0].ID = "secret" },
		"branch cycle": func(a *Archive) {
			b := &a.Experiences[0].Branches[0]
			id := b.ID
			r := int64(1)
			b.ParentBranchID = &id
			b.ParentRevision = &r
		},
		"branch state mismatch": func(a *Archive) { a.Experiences[0].Branches[0].State.StoryTime = "明天" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			a := archiveFixture()
			mutate(&a)
			raw, _ := json.Marshal(a)
			if _, err := DecodeArchive(raw); err == nil {
				t.Fatal("invalid authority accepted")
			}
		})
	}
	raw, _ := json.Marshal(archiveFixture())
	for _, invalid := range []string{strings.Replace(string(raw), `"known":false`, `"known":false,"known":true`, 1), strings.Replace(string(raw), `"known":false,`, "", 1), strings.Replace(string(raw), `"version":1`, `"version":1,"operations":[]`, 1), string(raw) + `{}`} {
		if _, err := DecodeArchive([]byte(invalid)); err == nil {
			t.Fatal("invalid JSON structure accepted")
		}
	}
	if _, err := DecodeArchive(make([]byte, MaxArchiveBytes+1)); err == nil {
		t.Fatal("oversized archive accepted")
	}
}
