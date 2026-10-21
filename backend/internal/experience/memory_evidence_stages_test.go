package experience

import (
	"encoding/json"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// These fixed requests prove accurate per-stage availability, not semantic
// recall or model behavior. Non-review directories never issue an approval.
func TestMemoryEvidenceAuthorStagesDescribeOnlyActualSources(t *testing.T) {
	for _, stage := range []string{"memory", "plan", "evaluate", "write", "extract", "repair_extract", "revise"} {
		t.Run(stage, func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			p.evidenceV2 = true
			p.needs.Topics = []string{"book"}
			page := HistoryPage{Revision: 1, Mode: "read", Text: "An earlier book was returned."}
			p.context.History = []HistoryPage{page}
			p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
				memoryBoundaryOld("earlier-book", 1, page.Text),
			}}
			var body map[string]json.RawMessage
			if stage == "memory" {
				mustStageJSON(t, narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State)), &body)
			} else {
				body = map[string]json.RawMessage{"context": narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State))}
			}
			hasDraft := stage == "extract" || stage == "repair_extract" || stage == "revise"
			if hasDraft {
				body["draft"] = narrativeMarshal(narrativeDraft{Title: "Book", Passage: "The visitor read it.", StoryTime: "Evening", Outcome: "awaits_player", Suggestions: []string{}})
			}
			call := &pb.ModelCallRequest{NarrativeStage: stage, Model: "fixture", SchemaJson: `{"type":"object"}`,
				MaxOutputBytes: 8192, Messages: []*pb.ModelMessage{
					{Role: "system", Content: "Synthetic author stage."},
					{Role: "user", Content: string(narrativeMarshal(body))},
				}}
			if err := p.compileStageCall(call, stage); err != nil {
				t.Fatal(err)
			}
			result := memoryEvidenceWire(t, call)
			if stage != "memory" && (result["state"] != nil || result["history"] != nil || result["historical_recalls"] != nil) {
				t.Fatal("nested context leaked copies into the outer stage payload")
			}
			if stage != "memory" {
				var nested map[string]json.RawMessage
				mustStageJSON(t, result["context"], &nested)
				if nested["context"] != nil || nested["draft"] != nil || nested["candidate"] != nil {
					t.Fatal("stage envelope was recursively copied into context")
				}
			}
			var registry memoryEvidencePacket
			if err := StrictJSON(result["memory_evidence"], &registry); err != nil {
				t.Fatal("actual author input lacks its promised source directory", err)
			}
			candidates, pages := 0, 0
			for _, source := range registry.Sources {
				if _, err := memoryJSONAt([]byte(call.Messages[1].Content), source.Location); err != nil {
					t.Fatal("directory points outside the actual request", source.Location)
				}
				if source.Kind == "candidate" {
					candidates++
					if source.Location != "/draft/passage" || !hasDraft {
						t.Fatal("draft treated as a formal or different source", source)
					}
				}
				if source.Kind == "formal_page" && source.Revision == 1 {
					pages++
				}
			}
			if pages != 1 || hasDraft && candidates != 1 || !hasDraft && candidates != 0 ||
				len(registry.RequiredPages) != 0 || p.evidencePacket != nil || p.evidenceCall != nil {
				t.Fatal("non-review directory lost data or gained approval/required authority", registry)
			}
			var bundle struct {
				Memories []memoryMaterialV2 `json:"memories"`
			}
			mustStageJSON(t, result["context_materials"], &bundle)
			if len(bundle.Memories) != 1 || len(bundle.Memories[0].SourceDirectory) != 1 ||
				!bundle.Memories[0].SourceDirectory[0].Loaded {
				t.Fatal("present source falsely advertised as unloaded", string(result["context_materials"]))
			}
		})
	}
}

func mustStageJSON(t *testing.T, raw []byte, value any) {
	t.Helper()
	if err := json.Unmarshal(raw, value); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryEvidenceAuthorOriginalSourceRejectedBeforeRebuild(t *testing.T) {
	for _, injected := range []string{"page", "registry"} {
		t.Run(injected, func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			p.evidenceV2, p.last = true, ""
			page := HistoryPage{Revision: 1, Mode: "read", Text: "Original page."}
			p.context.History = []HistoryPage{page}
			var body map[string]json.RawMessage
			mustStageJSON(t, narrativeMarshal(reviewHydrationWireContext(p.context, p.context.State)), &body)
			if injected == "page" {
				page.Text = "Invented original."
				body["history"] = narrativeMarshal([]HistoryPage{page})
			} else {
				body["memory_evidence"] = json.RawMessage(`{"version":2,"sources":[],"required_pages":[]}`)
			}
			call := &pb.ModelCallRequest{NarrativeStage: "memory", SchemaJson: `{"type":"object"}`, Messages: []*pb.ModelMessage{
				{Role: "system", Content: "Synthetic author stage."}, {Role: "user", Content: string(narrativeMarshal(body))},
			}}
			if _, err := p.before(call); err == nil {
				t.Fatal("original forged source/registry was hidden by material rebuilding")
			}
		})
	}
}

func TestMemoryEvidenceRepairStateRegistersActualFrozenCandidate(t *testing.T) {
	p, call := memoryEvidenceCallFixture(t)
	p.evidenceV2 = true
	candidate := memoryBoundaryCandidate(t, p)
	p.draft = &narrativeDraft{Title: candidate.Title, Passage: candidate.Passage,
		StoryTime: candidate.StoryTime, Outcome: candidate.Outcome, Suggestions: candidate.Suggestions}
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	issues := []NarrativeIssue{{Code: "index-interpretation", Detail: "Narrow the remembered interpretation."}}
	rejected := NarrativeReview{Approved: false, RepairScope: "candidate_state", Issues: issues,
		Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{},
		MemorySupports: []NarrativeMemorySupport{}}
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": rejected}))}); err != nil {
		t.Fatal(err)
	}
	rejection := string(narrativeMarshal(p.approval))
	repair := stateRepairCall(p, candidate, issues)
	if _, err := p.before(repair); err != nil {
		t.Fatal(err)
	}
	body := memoryEvidenceWire(t, repair)
	if body["draft"] != nil {
		t.Fatal("control no longer uses the actual candidate-only repair carrier")
	}
	var actual Candidate
	mustStageJSON(t, body["candidate"], &actual)
	if string(narrativeMarshal(actual)) != string(narrativeMarshal(candidate)) {
		t.Fatal("repair changed its frozen candidate")
	}
	packet := memoryBoundaryPacket(t, repair)
	candidates := 0
	for _, source := range packet.Sources {
		if source.Kind == "candidate" {
			candidates++
			if source.Location != "/candidate/passage" || source.TextSHA256 != memoryPageSHA256(candidate.Passage) {
				t.Fatal("repair candidate points to invented or changed bytes")
			}
		}
	}
	if candidates != 1 || len(packet.RequiredPages) != 0 || p.evidencePacket != nil ||
		p.approval == nil || p.approval.Result.Approved || string(narrativeMarshal(p.approval)) != rejection {
		t.Fatal("repair lost its actual candidate source or gained approval/required authority", packet)
	}
}
