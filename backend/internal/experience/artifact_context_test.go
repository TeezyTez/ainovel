package experience

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestArtifactPublicContextSeparatesCurrentTurnFromEarlierRequests(t *testing.T) {
	view := View{
		ID:       "experience-context",
		BranchID: "selected-branch",
		Revision: 3,
		Seed:     "private-world-seed",
		Pages: []Page{
			{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: "private-world-seed", Text: "公开开场。"}},
			{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: "把收入做成表格", Text: "去年收入尚未确定。"}},
			{HistoryPage: HistoryPage{Revision: 3, Mode: "read", Input: "先静静听雨", Text: "雨声逐渐变轻。"}, Outcome: "awaits_player", Suggestions: []string{"另一项建议"}},
		},
	}
	public := artifactPublicContext(view, 4)
	want := map[string]any{"revision": int64(3), "mode": "read", "input": "先静静听雨", "prose": "雨声逐渐变轻。"}
	if !reflect.DeepEqual(public["currentTurn"], want) {
		t.Fatalf("current turn mixes historical requests or extra page fields: %#v", public["currentTurn"])
	}
	if !reflect.DeepEqual(public["recentInputs"], []string{"把收入做成表格", "先静静听雨"}) {
		t.Fatalf("historical context lost: %#v", public["recentInputs"])
	}
	if !strings.Contains(public["prose"].(string), "去年收入尚未确定。") {
		t.Fatal("earlier public evidence lost")
	}
	raw, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "private-world-seed") {
		t.Fatal("private seed leaked to presentation context")
	}
}

func TestArtifactPublicContextCurrentOpeningOmitsSeedInput(t *testing.T) {
	view := View{Revision: 1, Seed: "unpublished-seed", Pages: []Page{{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: "unpublished-seed", Text: "公开开场。"}}}}
	public := artifactPublicContext(view, 1)
	want := map[string]any{"revision": int64(1), "mode": "begin", "input": "", "prose": "公开开场。"}
	if !reflect.DeepEqual(public["currentTurn"], want) {
		t.Fatalf("opening turn includes private input or loses public prose: %#v", public["currentTurn"])
	}
	raw, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "unpublished-seed") {
		t.Fatal("private opening seed leaked")
	}
}

func TestArtifactPublicContextDoesNotInventMissingCurrentTurn(t *testing.T) {
	for _, test := range []struct {
		name string
		view View
	}{
		{name: "no pages", view: View{Revision: 2}},
		{name: "only earlier page", view: View{Revision: 2, Pages: []Page{{HistoryPage: HistoryPage{Revision: 1, Mode: "ask", Input: "旧请求", Text: "旧回复"}}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			public := artifactPublicContext(test.view, 1)
			current, exists := public["currentTurn"]
			if !exists || current != nil {
				t.Fatalf("missing current page must be explicit null: %#v", current)
			}
		})
	}
}
