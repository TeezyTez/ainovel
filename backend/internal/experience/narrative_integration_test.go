//go:build integration

package experience

import (
	"context"
	"testing"
)

func TestProseFirstCommitsAndContinuesDespiteInvalidOptionalMetadata(t *testing.T) {
	s, _, _ := testService(t)
	s.ProseFirst = true
	v := begin(t, s, "prose-account", "opening")
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		out := candidate(c)
		out.Passage = "这是测试夹具正文，不是真实模型输出。"
		out.NewFacts = []Fact{{ID: "bad", Text: "invalid index", SourceRevision: 999}}
		return out, nil
	})
	for i, mode := range []string{"act", "read"} {
		v = advance(t, s, "prose-account", v, []string{"action", "continue"}[i], mode)
		if v.Revision != int64(i+2) || v.Pages[len(v.Pages)-1].Text != "这是测试夹具正文，不是真实模型输出。" {
			t.Fatalf("prose missing at %d: %+v", i, v)
		}
	}
}

func TestProseFirstRecoveredMemoryReachesNextFormalGeneration(t *testing.T) {
	s, _, _ := testService(t)
	s.ProseFirst = true
	v := begin(t, s, "memory-account", "opening")
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		out := candidate(c)
		out.Passage = "结构测试夹具：戒指卖给商人，此后需要另找身份凭证。"
		if c.Revision == 1 {
			out.NewFacts = []Fact{{ID: "ring-sold", Kind: "fact", Text: "戒指已经卖出。", Known: true, KnownBy: []string{}, SourceRevision: 2}}
			out.RevealEntityIDs = []string{"nonexistent"}
		} else {
			found := false
			for _, fact := range c.State.Facts {
				if fact.ID == "ring-sold" && fact.SourceRevision == 2 {
					found = true
				}
			}
			if !found {
				t.Error("verified ownership consequence did not reach the next generation")
			}
		}
		return out, nil
	})
	v = advance(t, s, "memory-account", v, "sell", "act")
	v = advance(t, s, "memory-account", v, "prove", "read")
	if v.Revision != 3 || len(v.Pages) != 3 {
		t.Fatalf("formal continuity missing: %+v", v)
	}
}
