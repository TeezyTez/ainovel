package experience

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestBoundedContextKeepsWholeTailAndFactProvenance(t *testing.T) {
	c := sampleContext()
	c.Revision = 5
	c.Mode = "read"
	c.State.Facts = []Fact{{ID: "early", Kind: "fact", Text: "第一轮确立的事实", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	for i := int64(1); i <= 5; i++ {
		c.History = append(c.History, HistoryPage{Revision: i, Mode: "read", Input: "", Text: strings.Repeat("中文原字  \n", 100)})
	}
	before, _ := json.Marshal(c.State)
	want := c
	want.History = c.History[3:]
	want.HistoryComplete = false
	raw, _ := json.Marshal(want)
	got, err := boundedContext(c, len(raw))
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(got.State)
	if got.HistoryComplete || !reflect.DeepEqual(got.History, want.History) || string(before) != string(after) {
		t.Fatal("projection changed state/source/page or claimed complete history")
	}
	if len(c.History) != 5 || c.History[0].Revision != 1 {
		t.Fatal("changed original")
	}
	encoded, _ := json.Marshal(got)
	if err = validateContract(encoded, "context"); err != nil {
		t.Fatal(err)
	}
	if _, err = boundedContext(c, 1); err == nil {
		t.Fatal("silently omitted necessary state/latest page")
	}
	got, err = boundedContext(c, 1<<20)
	if err != nil || !got.HistoryComplete || len(got.History) != 5 {
		t.Fatal("unnecessary truncation")
	}
	c.HistoryComplete = false
	got, err = boundedContext(c, 1<<20)
	if err != nil || got.HistoryComplete {
		t.Fatal("upgraded already partial history to complete")
	}
}
