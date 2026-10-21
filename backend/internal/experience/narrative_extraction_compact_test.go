package experience

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Synthetic transport controls: these exercise frozen-draft composition and
// rejection boundaries, not model latency or narrative quality.
func TestNarrativeCompactExtractionUsesFrozenDraft(t *testing.T) {
	for _, stage := range []string{"extract", "repair_extract"} {
		for _, passage := range []string{"首段。\n\n次段。", `字面\n与"引号"、反斜杠\保留。`, "<tag>🙂\t表意字符。\u2028\u2029"} {
			t.Run(stage+"/"+passage, func(t *testing.T) {
				p, candidate := extractionObjectRun(passage)
				p.last = stage
				p.draft.Title = "含\"引号\"的标题"
				p.draft.StoryTime = "初夏\n傍晚"
				p.draft.Suggestions = []string{"问候🙂", `保留\字符`}
				if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, candidate))}); err != nil {
					t.Fatal(err)
				}
				var got Candidate
				if err := json.Unmarshal(p.extracted, &got); err != nil {
					t.Fatal(err)
				}
				if got.Title != "含\"引号\"的标题" || got.Passage != passage || got.StoryTime != "初夏\n傍晚" || got.Outcome != "continues" ||
					!bytes.Equal(narrativeMarshal(got.Suggestions), []byte(`["问候🙂","保留\\字符"]`)) ||
					p.repairs != 0 || p.extractionInvalid || got.NarrativeUpdate == nil {
					t.Fatalf("frozen draft or state changed: %+v", got)
				}
				if _, err := p.finish(got); err == nil {
					t.Fatal("compact extraction bypassed independent review")
				}
			})
		}
	}
}

func TestNarrativeCompactExtractionRejectsPartialOrChangedDraftWithoutRepair(t *testing.T) {
	for _, field := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
		t.Run("partial_"+field, func(t *testing.T) {
			p, candidate := extractionObjectRun("冻结正文。")
			p.context.Pipeline.MaxRepairs = 1
			raw := compactExtractionState(t, candidate)
			value := `"unexpected"`
			if field == "suggestions" {
				value = `[]`
			}
			raw = append(raw[:len(raw)-1], []byte(`,"`+field+`":`+value+`}`)...)
			err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(raw)})
			if err == nil || err.Error() != "narrative_extraction_mismatch" || p.extracted != nil || p.extractionInvalid {
				t.Fatalf("partial frozen fields must fail without structural retry: %v", err)
			}
		})
	}
	t.Run("missing_draft", func(t *testing.T) {
		p, candidate := extractionObjectRun("冻结正文。")
		p.context.Pipeline.MaxRepairs = 1
		p.draft = nil
		err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, candidate))})
		if err == nil || err.Error() != "narrative_extraction_mismatch" || p.extracted != nil || p.extractionInvalid {
			t.Fatalf("missing draft must fail without structural retry: %v", err)
		}
	})
	t.Run("changed_full_candidate", func(t *testing.T) {
		p, candidate := extractionObjectRun("冻结正文。")
		p.context.Pipeline.MaxRepairs = 1
		candidate.Passage = "模型改写。"
		err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(narrativeMarshal(candidate))})
		if err == nil || err.Error() != "narrative_extraction_mismatch" || p.extracted != nil || p.extractionInvalid {
			t.Fatalf("changed full candidate must fail without structural retry: %v", err)
		}
	})
}

func TestNarrativeCompactExtractionDoesNotEraseMalformedState(t *testing.T) {
	p, candidate := extractionObjectRun("冻结正文。")
	raw := string(compactExtractionState(t, candidate))
	for name, malformed := range map[string]string{
		"duplicate_top":       strings.Replace(raw, `"new_facts":`, `"new_facts":[],"new_facts":`, 1),
		"duplicate_nested":    strings.Replace(raw, `"narrative_update":{`, `"narrative_update":{"version":1,`, 1),
		"duplicate_escaped":   strings.Replace(raw, `"new_facts":`, `"new_\u0066acts":[],"new_facts":`, 1),
		"unknown_state_field": strings.TrimSuffix(raw, "}") + `,"unrecognized":true}`,
		"null":                "null",
		"array":               "[]",
		"string":              `"candidate"`,
	} {
		t.Run(name, func(t *testing.T) {
			p, _ = extractionObjectRun("冻结正文。")
			err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope([]byte(malformed))})
			if err == nil || p.extracted != nil {
				t.Fatalf("malformed state accepted: %s", name)
			}
		})
	}
}

func TestNarrativeCompactExtractionKeepsOneStructuralRepair(t *testing.T) {
	p, candidate := extractionObjectRun("冻结正文。")
	p.context.Pipeline.MaxRepairs = 1
	raw := strings.TrimSuffix(string(compactExtractionState(t, candidate)), "}") + `,"unrecognized":true}`
	if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope([]byte(raw))}); err != nil || !p.extractionInvalid || p.extracted != nil {
		t.Fatalf("first malformed extraction should remain repairable: %v", err)
	}
	p.last = "repair_extract"
	p.repairs = 1
	if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope([]byte(raw))}); err == nil || err.Error() != "invalid_candidate" || p.extracted != nil {
		t.Fatalf("second malformed extraction should fail: %v", err)
	}
}

func TestNarrativeCompactExtractionEnforcesComposedCapacity(t *testing.T) {
	p, candidate := extractionObjectRun(strings.Repeat("长", 2500))
	p.context.Pipeline.MaxRepairs = 1
	raw := compactExtractionState(t, candidate)
	raw = append(raw[:len(raw)-1], []byte(strings.Repeat(" ", 18000)+`}`)...)
	if len(raw) >= 24<<10 {
		t.Fatal("test input should fit before frozen draft composition")
	}
	err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(raw)})
	if err == nil || err.Error() != "model_output_capacity" || p.extracted != nil || p.extractionInvalid {
		t.Fatalf("composed candidate capacity must fail without repair: %v", err)
	}
}

func TestNarrativeCompactExtractionDoesNotInflateHTMLCharacters(t *testing.T) {
	passage := strings.Repeat("<", 5000)
	p, candidate := extractionObjectRun(passage)
	if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, candidate))}); err != nil {
		t.Fatalf("valid frozen prose must not exhaust capacity through HTML escaping: %v", err)
	}
	var got Candidate
	if err := json.Unmarshal(p.extracted, &got); err != nil || got.Passage != passage {
		t.Fatalf("frozen HTML characters changed: %v", err)
	}
}

func TestNarrativeCompactExtractionLineSeparatorsUseSharedEncoding(t *testing.T) {
	p, candidate := extractionObjectRun("\u2028\u2029" + `\u2028\u2029` + "<>&")
	raw, err := hydrateNarrativeExtraction(compactExtractionState(t, candidate), p.draft)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"passage":"\u2028\u2029\\u2028\\u2029<>&"`)) {
		t.Fatal("actual separators must be escaped once, literal escapes and HTML must be preserved")
	}
	var got Candidate
	if err := json.Unmarshal(raw, &got); err != nil || got.Passage != "\u2028\u2029"+`\u2028\u2029`+"<>&" {
		t.Fatalf("separator encoding changed frozen prose: %v", err)
	}
}

func TestNarrativeCompactExtractionCapacityCountsEscapedLineSeparators(t *testing.T) {
	p, candidate := extractionObjectRun(strings.Repeat("\u2028", 2500))
	p.context.Pipeline.MaxRepairs = 1
	raw := compactExtractionState(t, candidate)
	raw = append(raw[:len(raw)-1], []byte(strings.Repeat(" ", 10000)+`}`)...)
	if len(raw)+len(p.draft.Passage)+256 >= 24<<10 {
		t.Fatal("test input must fit if separators were incorrectly left unescaped")
	}
	err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(raw)})
	if err == nil || err.Error() != "model_output_capacity" || p.extracted != nil {
		t.Fatalf("escaped separators must count towards the shared byte limit: %v", err)
	}
}

func compactExtractionState(t *testing.T, candidate Candidate) []byte {
	t.Helper()
	var state map[string]json.RawMessage
	if err := json.Unmarshal(narrativeMarshal(candidate), &state); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
		delete(state, field)
	}
	return narrativeMarshal(state)
}

func compactExtractionEnvelope(raw []byte) string {
	return `{"result":{"candidate":` + string(raw) + `}}`
}
