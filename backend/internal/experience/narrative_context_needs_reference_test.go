package experience

import (
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"testing"
)

// These are boundary validation tests with fixed model responses, not a measure
// of whether a live model chooses the right scene participants.
func TestNarrativeMemoryNeedsValidateEntityReferencesAgainstAuthority(t *testing.T) {
	for _, field := range []string{"participant_ids", "relationship_targets"} {
		t.Run(field, func(t *testing.T) {
			for _, tc := range []struct {
				name      string
				id        string
				pruned    bool
				wantError bool
			}{
				{name: "unknown_id", id: "missing_person", wantError: true},
				{name: "relationship_description", id: "与林晚尚未释怀的旧关系", wantError: true},
				{name: "fact_id_is_wrong_type", id: "hidden_fact", wantError: true},
				{name: "omitted_entity_remains_valid", id: "lin_wan", pruned: true},
				{name: "complete_view_entity_is_valid", id: "lin_wan"},
				{name: "entry_only_entity_is_not_authority", id: "entry_only", wantError: true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					authority := EmptyState()
					authority.Entities = []Entity{{ID: "lin_wan", Kind: "character", Name: "林晚", RelatedIDs: []string{}}}
					authority.Facts = []Fact{{ID: "hidden_fact", Kind: "secret", Text: "林晚不知道的信件去向", SubjectID: "lin_wan", KnownBy: []string{}, SourceRevision: 1}}
					entry := authority
					entry.Entities = append([]Entity{}, authority.Entities...)
					if tc.pruned {
						entry.Entities = []Entity{}
					}
					entry.Entities = append(entry.Entities, Entity{ID: "entry_only", Kind: "character", Name: "陈旧入口人物", RelatedIDs: []string{}})
					run := newNarrativeRun(Context{Mode: "read", Revision: 1, State: entry, AuthorityState: &authority, Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}})
					run.last = "memory"
					needs := map[string]any{"participant_ids": []string{}, "relationship_targets": []string{}, "topics": []string{}, "open_questions": []string{}, "fact_ids": []string{}}
					needs[field] = []string{tc.id}
					result := &pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": map[string]any{"actors": []narrativeTrigger{}, "relevant_fact_ids": []string{}, "objective": "让对话继续", "context_needs": needs}}))}
					err := run.after(result)
					if tc.wantError {
						if err == nil || err.Error() != "narrative_material_reference_invalid" {
							t.Fatalf("non-entity reference accepted or wrong failure: %v", err)
						}
						return
					}
					if err != nil {
						t.Fatalf("pinned authoritative entity rejected: %v", err)
					}
					if _, err := run.actorProjection(narrativeTrigger{ActorID: "lin_wan", FactIDs: []string{"hidden_fact"}}); err == nil || err.Error() != "narrative_actor_invalid" {
						t.Fatalf("valid author retrieval reference granted actor knowledge: %v", err)
					}
				})
			}
		})
	}
}
