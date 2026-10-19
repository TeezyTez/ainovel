package experience

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestBoundedGenerationKeepsAuthorityAndMandatoryForwardClosure(t *testing.T) {
	c := sampleContext()
	c.Revision = 100
	c.State = EmptyState()
	for i := 0; i < 80; i++ {
		c.State.Facts = append(c.State.Facts, Fact{ID: fmt.Sprintf("old-%03d", i), Kind: "fact", Text: strings.Repeat("旧事实原字。", 70), Known: true, KnownBy: []string{}, SourceRevision: 1})
	}
	c.State.Facts = append(c.State.Facts, Fact{ID: "law", Kind: "rule", Text: "规则", Known: true, KnownBy: []string{}, SourceRevision: 1})
	c.State.Facts = append(c.State.Facts, Fact{ID: "secret", Kind: "secret", Text: "秘密", Known: false, KnownBy: []string{}, SourceRevision: 1})
	c.State.Entities = []Entity{{ID: "person", Kind: "person", Name: "阿禾", Description: "守门人", Known: true, RelatedIDs: []string{"old-000"}}}
	c.State.Threads = []Thread{{ID: "promise", Text: "未决承诺", Known: true, RelatedFactIDs: []string{"old-001"}}}
	boundary := c.State
	c.History = []HistoryPage{{Revision: 100, Mode: "read", Input: "", Text: "最近完整原字\n  中文。"}}
	before, _ := json.Marshal(c)
	view, err := compileGeneration(c, boundary, "scope", 90, ReadBudget{MaxReads: 4, MaxReplyBytes: 4096, MaxTotalReplyBytes: 8192}, 9000)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(c)
	if string(before) != string(after) {
		t.Fatal("compiler mutated commit authority")
	}
	if view.StateCoverage.Complete || view.StateCoverage.Omitted.Facts == 0 || view.StateCoverage.Policy != "rules-secrets-open-recent-closure.v1" {
		t.Fatal("pretended complete fullstate", view.StateCoverage)
	}
	found := map[string]bool{}
	for _, f := range view.State.Facts {
		found[f.ID] = true
	}
	if !found["law"] || !found["secret"] || !found["old-001"] {
		t.Fatal("mandatory premise/forward closure omitted")
	}
	if err := validateContract(mustJSON(t, view), "context"); err != nil {
		t.Fatal(err)
	}
	duplicate := sampleCandidate()
	duplicate.NewFacts = []Fact{c.State.Facts[79]}
	duplicate.NewFacts[0].SourceRevision = c.Revision + 1
	if _, err := Apply(c, duplicate); err == nil {
		t.Fatal("omitted ID no longer binding in full authority")
	}
	// Massive required root is not truncated or described as creative blank.
	c.State.Facts[80].Text = strings.Repeat("不可裁规则", 2000)
	if _, err := compileGeneration(c, boundary, "scope", 90, ReadBudget{}, 9000); err == nil {
		t.Fatal("silently erased mandatory root")
	}
}
func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestReaderSnapshotFiltersBeforeCountingMatchingAndSerialization(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "known", Kind: "person", Name: "阿禾", Known: true, RelatedIDs: []string{"hidden", "shown"}}, {ID: "hidden", Kind: "person", Name: "隐藏", Known: false, RelatedIDs: []string{}}}
	s.Facts = []Fact{{ID: "shown", Kind: "statement", Text: "公开原字", Known: true, SubjectID: "known", KnownBy: []string{"known", "hidden"}, SourceRevision: 1}, {ID: "leaky", Kind: "belief", Text: "不能通过subject揭人", Known: true, SubjectID: "hidden", KnownBy: []string{}, SourceRevision: 1}, {ID: "secret", Kind: "secret", Text: "秘密不能揭", Known: false, KnownBy: []string{}, SourceRevision: 1}}
	s.Threads = []Thread{{ID: "thread", Text: "公开线索", Known: true, RelatedFactIDs: []string{"secret", "shown"}}}
	p := ReaderState(s)
	raw := string(mustJSON(t, p))
	if strings.Contains(raw, "hidden") || strings.Contains(raw, "secret") || strings.Contains(raw, "leaky") || len(p.Facts) != 1 || len(p.Entities) != 1 || len(p.Threads) != 1 {
		t.Fatal(raw)
	}
	c := sampleContext()
	c.Mode = "ask"
	c.Revision = 1
	c.State = s
	view, err := compileGeneration(c, EmptyState(), "reader-source", 1, ReadBudget{}, 1<<20)
	if err != nil || view.StateCoverage.Total != counts(p) || view.StateCoverage.Audience != "reader" || view.StateCoverage.OmittedReaderKnown == nil {
		t.Fatal("reader coverage revealed author count", view, err)
	}
	if err := validateContract(mustJSON(t, view), "context"); err != nil {
		t.Fatal(err)
	}
}
func TestReceiptCanonicalIntegersAndEscapes(t *testing.T) {
	raw, err := canonicalRawJSON([]byte(`{"z":9007199254740993,"a":"中文<>&\u2028"}`))
	if err != nil || string(raw) != `{"a":"中文\u003c\u003e\u0026\u2028","z":9007199254740993}` {
		t.Fatalf("canonical: %s %v", raw, err)
	}
}
func TestReadSelectorClosedSemanticConditions(t *testing.T) {
	for _, selector := range []string{`{"kind":"enumerate","type":"entity","fact_kind":"rule"}`, `{"kind":"enumerate","type":"thread","from_source_revision":1}`, `{"kind":"enumerate","type":"fact","terms":["承诺"]}`, `{"kind":"names","type":"fact","names":["x"]}`, `{"kind":"objects","objects":[{"type":"fact","id":"x"}],"account_id":"forged"}`} {
		raw := []byte(`{"request_id":"r","source_handle":"s","max_reply_bytes":1000,"selector":` + selector + `}`)
		if _, err := DecodeReadRequest(raw); err == nil {
			t.Fatal("ambiguous/leaking selector accepted", selector)
		}
	}
}
