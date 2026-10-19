//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestIsolatedPGHistoryWindowRetainsEarlyFactsAndFormalRawPages(t *testing.T) {
	s, _, _ := testService(t)
	s.MaxContextBytes = 12000
	text := "旧事没有被删除。\n  " + strings.Repeat("中文原字 \n", 700)
	partial := false
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		raw, _ := json.Marshal(c)
		if len(raw) > s.capacity() {
			t.Fatal("unbounded transmitted context")
		}
		if !c.HistoryComplete {
			partial = true
			if len(c.History) != 1 || c.History[0].Revision != c.Revision {
				t.Fatal("not latest contiguous tail")
			}
			if len(c.State.Facts) != 2 || c.State.Facts[0].SourceRevision != 1 || c.State.Facts[1].Text != "门后有暗井" {
				t.Fatal("lost early fact/provenance")
			}
		}
		v := candidate(c)
		if c.Revision == 0 {
			v = initial(c)
		}
		v.Passage = text
		return v, nil
	})
	v := begin(t, s, "window-account", "window-begin")
	for _, r := range []string{"window-1", "window-2", "window-3", "window-4", "window-5"} {
		v = advance(t, s, "window-account", v, r, "read")
	}
	if !partial || v.Revision != 6 || len(v.Pages) != 6 {
		t.Fatal("no long history projection or formal history missing")
	}
	for _, p := range v.Pages {
		if p.Text != text {
			t.Fatal("formal raw page changed")
		}
	}
	op, err := s.GetOperation(context.Background(), "window-account", v.ID, "window-5")
	must(t, err)
	if op.Status != "committed" {
		t.Fatal(op)
	}
}
