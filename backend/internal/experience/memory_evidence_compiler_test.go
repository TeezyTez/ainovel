package experience

import (
	"encoding/json"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Fixed protocol fixtures: these prove source availability and scope, not
// whether a model correctly understands the remembered event.
func memoryEvidenceCallFixture(t *testing.T) (*narrativeRun, *pb.ModelCallRequest) {
	t.Helper()
	p, call, c := reviewContextFixture(t)
	c.KnowledgeChanges = []KnowledgeChange{}
	c.Passage = "The book was returned."
	fields := map[string]json.RawMessage{}
	_ = json.Unmarshal(narrativeMarshal(c), &fields)
	fields["memory_delta"] = json.RawMessage(`{"version":2,"entries":[{"id":"returned","kind":"episode","subject_ids":["speaker"],"target_ids":[],"cue":"returned book","summary":"The book was returned.","status":"resolved","retrieval_keys":["book"],"fact_ids":[]}]}`)
	raw := narrativeMarshal(fields)
	p.extracted, _ = canonicalRawJSON(raw)
	p.materialBudget, p.stageInputBudget = 12<<10, 60<<10
	call.Messages[1].Content = string(narrativeMarshal(map[string]any{
		"context":   reviewHydrationWireContext(p.context, p.context.State),
		"candidate": json.RawMessage(raw),
	}))
	return p, call
}

func memoryEvidenceWire(t *testing.T, call *pb.ModelCallRequest) map[string]json.RawMessage {
	t.Helper()
	var body map[string]json.RawMessage
	if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestMemoryEvidenceCompilerRegistersActualCandidate(t *testing.T) {
	p, call := memoryEvidenceCallFixture(t)
	if _, err := p.before(call); err != nil {
		t.Fatalf("valid v2 candidate did not reach the evidence compiler: %v", err)
	}
	var registry struct {
		Version int `json:"version"`
		Sources []struct {
			ID       string `json:"id"`
			Kind     string `json:"kind"`
			Location string `json:"location"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(memoryEvidenceWire(t, call)["memory_evidence"], &registry); err != nil {
		t.Fatalf("actual review has no source registry: %v", err)
	}
	count := 0
	for _, source := range registry.Sources {
		if source.Kind == "candidate" {
			count++
			if source.ID == "" || source.Location != "/candidate/passage" {
				t.Fatal("candidate source does not point to the existing passage")
			}
		}
	}
	if registry.Version != 2 || count != 1 ||
		strings.Count(call.Messages[1].Content, `"passage":"The book was returned."`) != 1 {
		t.Fatal("candidate is absent or duplicated as purported evidence")
	}
}

func TestMemoryEvidenceCompilerRejectsInjectedRegistry(t *testing.T) {
	for _, field := range []string{"memory_evidence", "evidence_pages", "evidence_facts"} {
		t.Run(field, func(t *testing.T) {
			p, call := memoryEvidenceCallFixture(t)
			body := memoryEvidenceWire(t, call)
			body[field] = json.RawMessage(`[]`)
			call.Messages[1].Content = string(narrativeMarshal(body))
			if _, err := p.before(call); err == nil {
				t.Fatal("algorithm supplied Go-owned evidence")
			}
		})
	}
}

func TestMemoryEvidenceCompilerPageRevisionIdentityAndDedup(t *testing.T) {
	p, call := memoryEvidenceCallFixture(t)
	first := HistoryPage{Revision: 1, Mode: "read", Input: "", Text: "Same original words."}
	second := first
	second.Revision = 2
	p.context.History = []HistoryPage{first, second}
	body := memoryEvidenceWire(t, call)
	body["context"] = narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State))
	call.Messages[1].Content = string(narrativeMarshal(body))
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	var registry struct {
		Sources []struct {
			Kind     string `json:"kind"`
			Revision int64  `json:"revision"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(memoryEvidenceWire(t, call)["memory_evidence"], &registry); err != nil {
		t.Fatal(err)
	}
	seen := map[int64]int{}
	for _, source := range registry.Sources {
		if source.Kind == "formal_page" {
			seen[source.Revision]++
		}
	}
	if seen[1] != 1 || seen[2] != 1 {
		t.Fatal("identical text collapsed distinct formal revisions", seen)
	}
}

func TestMemoryEvidenceCompilerMissingRequiredAllowsFirstReview(t *testing.T) {
	p, call := memoryEvidenceCallFixture(t)
	p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{{
		MemoryChange: MemoryChange{ID: "returned", Kind: "episode", SubjectIDs: []string{"speaker"},
			TargetIDs: []string{}, Cue: "previous return", Summary: "Earlier return.", Status: "active",
			RetrievalKeys: []string{"book"}, FactIDs: []string{}, Quote: "Earlier return."},
		SourceRevision: 1, UpdatedRevision: 1, SourceSHA256: memoryPageSHA256("Earlier return."),
	}}}
	if _, err := p.before(call); err != nil {
		t.Fatalf("missing required page was rejected before a first read opportunity: %v", err)
	}
	var registry struct {
		Required []struct {
			MemoryID string `json:"memory_id"`
			Revision int64  `json:"revision"`
			Loaded   bool   `json:"loaded"`
		} `json:"required_pages"`
	}
	if err := json.Unmarshal(memoryEvidenceWire(t, call)["memory_evidence"], &registry); err != nil {
		t.Fatal(err)
	}
	if len(registry.Required) != 1 || registry.Required[0].MemoryID != "returned" ||
		registry.Required[0].Revision != 1 || registry.Required[0].Loaded {
		t.Fatal("missing old page was not disclosed as a required gap", registry)
	}
}
