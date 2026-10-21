//go:build integration && codexlive

package experience

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type deepGateCitation struct {
	EventSeq int    `json:"event_seq"`
	StepID   string `json:"step_id"`
	Revision int64  `json:"revision"`
	Kind     string `json:"kind"`
	Pointer  string `json:"pointer,omitempty"`
	Quote    string `json:"quote"`
}
type deepGateDecision struct {
	Version    int                `json:"version"`
	SourceRoot string             `json:"source_root"`
	CaseID     string             `json:"case_id"`
	StepID     string             `json:"step_id"`
	GateID     string             `json:"gate_id"`
	Decision   string             `json:"decision"`
	Reviewer   string             `json:"reviewer"`
	Method     string             `json:"method"`
	Note       string             `json:"note"`
	Citations  []deepGateCitation `json:"citations"`
}

func deepPointerText(raw json.RawMessage, pointer string) (string, error) {
	var value any
	if !strings.HasPrefix(pointer, "/") || json.Unmarshal(raw, &value) != nil {
		return "", fmt.Errorf("invalid snapshot JSON pointer")
	}
	for _, token := range strings.Split(pointer[1:], "/") {
		for i := 0; i < len(token); i++ {
			if token[i] == '~' {
				if i+1 == len(token) || (token[i+1] != '0' && token[i+1] != '1') {
					return "", fmt.Errorf("invalid JSON pointer escape")
				}
				i++
			}
		}
		token = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
		switch container := value.(type) {
		case map[string]any:
			var exists bool
			value, exists = container[token]
			if !exists {
				return "", fmt.Errorf("snapshot pointer key missing")
			}
		case []any:
			index, err := strconv.Atoi(token)
			if err != nil || strconv.Itoa(index) != token || index < 0 || index >= len(container) {
				return "", fmt.Errorf("snapshot pointer index missing")
			}
			value = container[index]
		default:
			return "", fmt.Errorf("snapshot pointer traverses a scalar")
		}
	}
	text, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("snapshot citation must address a text field")
	}
	return text, nil
}

// This validates provenance and exact citations, not the semantic correctness
// of an independent reviewer's permission judgment or a narrative PASS.
func parseDeepGate(raw, source []byte, fixture deepFixture, step deepStep, replay *deepReplay) (deepGateDecision, error) {
	var decision deepGateDecision
	if len(raw) > 64<<10 || StrictJSON(raw, &decision) != nil || replay == nil || step.EvidenceGate == "" {
		return decision, fmt.Errorf("gate decision requires strict JSON and a restored source")
	}
	if decision.Version != 1 || decision.SourceRoot != replay.SourceRoot || decision.CaseID != fixture.ID || decision.StepID != step.ID || decision.GateID != step.EvidenceGate ||
		(decision.Decision != "allow" && decision.Decision != "deny") || decision.Method != "model_review" || strings.TrimSpace(decision.Reviewer) == "" || strings.TrimSpace(decision.Note) == "" {
		return decision, fmt.Errorf("gate decision identity/method differs from the restored source")
	}
	if fmt.Sprintf("%x", sha256.Sum256(source)) != replay.EventsSHA256 {
		return decision, fmt.Errorf("gate source bytes differ")
	}
	if _, err := decodeDeepReplay(source, decision.SourceRoot, fixture); err != nil {
		return decision, err
	}
	if len(decision.Citations) < 2 || len(decision.Citations) > 16 {
		return decision, fmt.Errorf("gate requires prose and snapshot citations")
	}
	lines := bytes.Split(bytes.TrimSuffix(source, []byte{'\n'}), []byte{'\n'})
	paired := map[int]map[string]bool{}
	for _, citation := range decision.Citations {
		if citation.EventSeq < 1 || citation.EventSeq > len(lines) || strings.TrimSpace(citation.Quote) == "" {
			return decision, fmt.Errorf("invalid gate citation location/quote")
		}
		var event struct {
			Kind string `json:"kind"`
			Step string `json:"step"`
			Data struct {
				View     View            `json:"public_view"`
				Snapshot json.RawMessage `json:"snapshot"`
			} `json:"data"`
		}
		if json.Unmarshal(lines[citation.EventSeq-1], &event) != nil || event.Kind != "operation_committed" || event.Step != citation.StepID || event.Data.View.Revision != citation.Revision || len(event.Data.View.Pages) == 0 {
			return decision, fmt.Errorf("gate citation is not a committed source revision")
		}
		dependency := false
		for _, prior := range step.RequiresSteps {
			if prior == event.Step {
				dependency = true
			}
		}
		if !dependency {
			return decision, fmt.Errorf("gate citation does not address a registered prerequisite")
		}
		text := ""
		switch citation.Kind {
		case "prose":
			if citation.Pointer != "" {
				return decision, fmt.Errorf("prose citation cannot supply a snapshot pointer")
			}
			text = event.Data.View.Pages[len(event.Data.View.Pages)-1].Text
		case "snapshot":
			var err error
			text, err = deepPointerText(event.Data.Snapshot, citation.Pointer)
			if err != nil {
				return decision, err
			}
		default:
			return decision, fmt.Errorf("unsupported gate citation kind")
		}
		if !strings.Contains(text, citation.Quote) {
			return decision, fmt.Errorf("gate citation quote absent from exact source")
		}
		if paired[citation.EventSeq] == nil {
			paired[citation.EventSeq] = map[string]bool{}
		}
		paired[citation.EventSeq][citation.Kind] = true
	}
	for _, kinds := range paired {
		if kinds["prose"] && kinds["snapshot"] {
			return decision, nil
		}
	}
	return decision, fmt.Errorf("gate citations lack prose and snapshot from the same committed prerequisite")
}

func recordDeepGate(caseDir string, evidence *deepEvidence, fixture deepFixture, step deepStep, replay *deepReplay) (bool, error) {
	directory := os.Getenv("ELSELIFE_DEEP_GATE_DECISIONS")
	if step.EvidenceGate == "" || directory == "" {
		return false, nil
	}
	raw, err := os.ReadFile(filepath.Join(directory, fixture.ID+"-"+step.ID+".json"))
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if replay == nil {
		return false, fmt.Errorf("gate decisions are only accepted on a restored source")
	}
	source, err := os.ReadFile(filepath.Join(caseDir, "source-events.jsonl"))
	if err != nil {
		return false, err
	}
	decision, err := parseDeepGate(raw, source, fixture, step, replay)
	if err != nil {
		return false, err
	}
	name := "gate-" + step.ID + ".json"
	file, err := os.OpenFile(filepath.Join(caseDir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return false, err
	}
	_, err = file.Write(raw)
	closeErr := file.Close()
	if err != nil {
		return false, err
	}
	if closeErr != nil {
		return false, closeErr
	}
	if err := evidence.append("gate_decision", map[string]any{"file": name, "decision_sha256": fmt.Sprintf("%x", sha256.Sum256(raw)), "decision": decision}); err != nil {
		return false, err
	}
	return decision.Decision == "allow", nil
}

func TestDeepBenchmarkGateRequiresBoundIndependentDecision(t *testing.T) {
	// Synthetic permission probes only; no model/human narrative acceptance.
	f := deepFixture{ID: "probe", Seed: "room", Opening: "Closed cabinet.", State: EmptyState(), Steps: []deepStep{
		{ID: "09", Mode: "act", Input: "Request a search."},
		{ID: "10", Mode: "act", Input: "Search as permitted.", RequiresSteps: []string{"09"}, EvidenceGate: "search-approval"},
	}}
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "act", Input: f.Steps[0].Input, Text: "The supervisor says: Open the tube in my presence."}}
	after := EmptyState()
	after.Facts = []Fact{{ID: "permission", Kind: "fact", Text: "Supervisor permits witnessed search.", Known: true, KnownBy: []string{}, SourceRevision: 2}}
	var source []byte
	root := ""
	for i, item := range []struct {
		kind, step string
		data       any
	}{
		{"manifest", "", map[string]any{"fixture": f}},
		{"initial_readback", "", map[string]any{"snapshot": f.State, "public_view": View{Revision: 1, Pages: []Page{p1}}}},
		{"operation_request", "09", map[string]any{"request": AdvanceRequest{Mode: "act", Input: f.Steps[0].Input, ExpectedRevision: 1}}},
		{"operation_committed", "09", map[string]any{"snapshot": after, "public_view": View{Title: "Synthetic second title", Revision: 2, Pages: []Page{p1, p2}}}},
		{"blocked_step", "10", map[string]any{"reason": "permission review pending"}},
		{"run_end", "10", map[string]any{"status": "REVIEW"}},
	} {
		raw, err := json.Marshal(map[string]any{"seq": i + 1, "previous_sha256": root, "kind": item.kind, "step": item.step, "data": item.data})
		must(t, err)
		root = fmt.Sprintf("%x", sha256.Sum256(raw))
		source = append(source, append(raw, '\n')...)
	}
	replay, err := decodeDeepReplay(source, root, f)
	must(t, err)
	decision := deepGateDecision{Version: 1, SourceRoot: root, CaseID: f.ID, StepID: "10", GateID: "search-approval", Decision: "allow", Reviewer: "independent-test-reviewer", Method: "model_review", Note: "Both formal sources record limited permission.", Citations: []deepGateCitation{
		{EventSeq: 4, StepID: "09", Revision: 2, Kind: "prose", Quote: "Open the tube in my presence."},
		{EventSeq: 4, StepID: "09", Revision: 2, Kind: "snapshot", Pointer: "/facts/0/text", Quote: "Supervisor permits witnessed search."},
	}}
	for _, mutation := range []string{"valid", "deny", "root", "case", "step", "gate", "method", "reviewer", "quote", "pointer", "missing_snapshot", "event", "revision", "fresh", "source"} {
		t.Run(mutation, func(t *testing.T) {
			data := decision
			data.Citations = append([]deepGateCitation{}, decision.Citations...)
			bound, sourceBytes := replay, source
			switch mutation {
			case "deny":
				data.Decision = "deny"
			case "root":
				data.SourceRoot = "wrong"
			case "case":
				data.CaseID = "other"
			case "step":
				data.StepID = "11"
			case "gate":
				data.GateID = "other"
			case "method":
				data.Method = "deterministic"
			case "reviewer":
				data.Reviewer = ""
			case "quote":
				data.Citations[0].Quote = "invented approval"
			case "pointer":
				data.Citations[1].Pointer = "/facts/7/text"
			case "missing_snapshot":
				data.Citations = data.Citations[:1]
			case "event":
				data.Citations[0].EventSeq = 2
			case "revision":
				data.Citations[0].Revision = 1
			case "fresh":
				bound = nil
			case "source":
				sourceBytes = append(append([]byte{}, source...), '\n')
			}
			raw, err := json.Marshal(data)
			must(t, err)
			parsed, err := parseDeepGate(raw, sourceBytes, f, f.Steps[1], bound)
			if mutation == "valid" || mutation == "deny" {
				must(t, err)
				if parsed.Decision != data.Decision {
					t.Fatal("decision changed")
				}
				directory := t.TempDir()
				t.Setenv("ELSELIFE_DEEP_GATE_DECISIONS", directory)
				must(t, os.WriteFile(filepath.Join(directory, f.ID+"-10.json"), raw, 0600))
				must(t, os.WriteFile(filepath.Join(directory, "source-events.jsonl"), source, 0600))
				file, err := os.Create(filepath.Join(directory, "events.jsonl"))
				must(t, err)
				evidence := &deepEvidence{file: file, step: "10"}
				allowed, err := recordDeepGate(directory, evidence, f, f.Steps[1], replay)
				must(t, err)
				must(t, file.Close())
				if allowed != (data.Decision == "allow") {
					t.Fatal("recording changed gate judgment")
				}
				preserved, err := os.ReadFile(filepath.Join(directory, "gate-10.json"))
				must(t, err)
				if !bytes.Equal(raw, preserved) {
					t.Fatal("decision bytes were not preserved")
				}
				events, err := os.ReadFile(filepath.Join(directory, "events.jsonl"))
				must(t, err)
				var event struct {
					Kind string `json:"kind"`
					Data struct {
						SHA      string           `json:"decision_sha256"`
						Decision deepGateDecision `json:"decision"`
					} `json:"data"`
				}
				must(t, json.Unmarshal(bytes.TrimSpace(events), &event))
				if event.Kind != "gate_decision" || event.Data.SHA != fmt.Sprintf("%x", sha256.Sum256(raw)) || event.Data.Decision.Decision != data.Decision {
					t.Fatal("gate evidence is not bound to raw decision")
				}
			} else if err == nil {
				t.Fatal("accepted unbound or unsupported approval evidence")
			}
		})
	}
}
