package experience

import (
	"encoding/json"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// The model returns a structured object once. These synthetic byte-boundary
// controls do not assess narrative quality or repair malformed recorded output.
func TestNarrativeObjectExtractionPreservesDraftBytes(t *testing.T) {
	for _, passage := range []string{"首段。\n\n次段。", `字面\n与"引号"、反斜杠\保留。`, "<tag>🙂\t表意字符。"} {
		t.Run(passage, func(t *testing.T) {
			p, candidate := extractionObjectRun(passage)
			raw := narrativeMarshal(map[string]any{"result": map[string]any{"candidate": candidate}})
			if err := p.after(&pb.ModelCallResult{Text: string(raw)}); err != nil {
				t.Fatal(err)
			}
			var got Candidate
			if err := json.Unmarshal(p.extracted, &got); err != nil || got.Passage != passage || p.repairs != 0 || p.extractionInvalid {
				t.Fatalf("object extraction changed content or spent repair: %v / %+v", err, p)
			}
			if _, err := p.finish(got); err == nil {
				t.Fatal("structure alone bypassed independent review")
			}
		})
	}
}

func TestNarrativeObjectExtractionRejectsAmbiguousOrLegacyWire(t *testing.T) {
	p, candidate := extractionObjectRun("原字。")
	rawCandidate := string(narrativeMarshal(candidate))
	for _, raw := range []string{
		`{"result":{"candidate_json":` + string(narrativeMarshal(rawCandidate)) + `}}`,
		`{"result":{"candidate":null}}`,
		`{"result":{"candidate":` + string(narrativeMarshal(rawCandidate)) + `}}`,
		`{"result":{"candidate":` + strings.Replace(rawCandidate, `"title":`, `"title":"ambiguous","title":`, 1) + `}}`,
		`{"result":{"candidate":` + strings.Replace(rawCandidate, `"passage":"原字。"`, "\"passage\":\"原\n字。\"", 1) + `}}`,
	} {
		p, _ = extractionObjectRun("原字。")
		if err := p.after(&pb.ModelCallResult{Text: raw}); err == nil || p.extracted != nil {
			t.Fatal("invalid object extraction accepted")
		}
	}
}

func extractionObjectRun(passage string) (*narrativeRun, Candidate) {
	context := Context{Mode: "read", State: EmptyState(), Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 0}}
	p := newNarrativeRun(context)
	p.last = "extract"
	p.draft = &narrativeDraft{Title: "t", Passage: passage, Outcome: "continues", Suggestions: []string{}}
	c := Candidate{Title: "t", Passage: passage, Outcome: "continues", Suggestions: []string{}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{}, ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{}, NarrativeUpdate: notebookFixture(1)}
	return p, c
}
