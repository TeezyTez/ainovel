package experience

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// Fixed source records test bounded retrieval and provenance, not prose quality.
func sourceWindowEntry(count int) MemoryEntry {
	entry := MemoryEntry{MemoryChange: MemoryChange{
		ID: "shared-agreement", Kind: "commitment", SubjectIDs: []string{"speaker"}, TargetIDs: []string{"listener"},
		Cue: "商量过的约定", Summary: "约定保留双方同意这一条件，尚待履行。", Status: "active",
		RetrievalKeys: []string{"修伞"}, FactIDs: []string{}, Quote: "现在仍要先商量，不能替对方答应。",
	}, SourceRevision: int64(count + 1), UpdatedRevision: int64(count + 1), SourceSHA256: strings.Repeat("a", 64)}
	for i := 1; i <= count; i++ {
		quote := strings.Repeat("这是完整旧原句，约定只在双方同意时成立。", 40)
		if i == count/2 {
			quote = "谈到修伞时，他特意补充了条件。" + quote
		}
		entry.PriorSources = append(entry.PriorSources, MemorySource{
			Revision: int64(i), SHA256: strings.Repeat("b", 64), Quote: quote,
		})
	}
	return entry
}

func sourceWindowMetadata(t *testing.T, material MemoryMaterial) (int, []int64) {
	t.Helper()
	var metadata struct {
		Count     int     `json:"prior_source_count"`
		Revisions []int64 `json:"prior_source_revisions"`
	}
	if err := json.Unmarshal(narrativeMarshal(material), &metadata); err != nil {
		t.Fatal(err)
	}
	return metadata.Count, metadata.Revisions
}

func TestSourceWindowCompressedMaterialsRetainOriginalPageLocators(t *testing.T) {
	entry := sourceWindowEntry(2)
	for _, granularity := range []string{"cue", "summary"} {
		t.Run(granularity, func(t *testing.T) {
			material := memoryMaterial(entry, granularity)
			count, revisions := sourceWindowMetadata(t, material)
			if count != 2 || len(revisions) != 2 || revisions[0] != 1 || revisions[1] != 2 {
				t.Fatal("compression lost the original pages needed for a targeted read", count, revisions)
			}
			if !material.RequiresSource || material.Quote != "" || len(material.PriorSources) != 0 {
				t.Fatal("compressed material falsely supplied original evidence")
			}
		})
	}
}

func TestSourceWindowBoundsLargeDirectoryWithoutDroppingStoredHistory(t *testing.T) {
	entry := sourceWindowEntry(72)
	state := EmptyState()
	state.LiteraryMemory = &LiteraryMemory{Version: 1, IndexedThroughRevision: 73, Entries: []MemoryEntry{entry}}
	run := newNarrativeRun(Context{Mode: "read", Revision: 73, State: state, AuthorityState: &state})
	before := narrativeMarshal(state)
	const budget = 4096
	bundle, err := run.prepareMaterials("write", "", ContextNeeds{
		ParticipantIDs: []string{"speaker", "listener"}, Topics: []string{"修伞"},
	}, budget)
	if err != nil {
		t.Fatal("a growing source chain made a bounded current reading impossible", err)
	}
	if len(narrativeMarshal(bundle)) > budget || len(bundle.Memories) != 1 {
		t.Fatal("material exceeded its finite budget or lost the selected agreement")
	}
	material := bundle.Memories[0]
	count, revisions := sourceWindowMetadata(t, material)
	if count != 72 || len(revisions) > 32 || len(revisions) == 0 {
		t.Fatal("directory was unbounded or pretended complete", count, revisions)
	}
	locators := map[int64]bool{}
	for _, revision := range revisions {
		if locators[revision] {
			t.Fatal("repeated source locator")
		}
		locators[revision] = true
	}
	if !locators[1] || !locators[72] || !locators[36] {
		t.Fatal("lost original, recent, or directly relevant source location", revisions)
	}
	if material.Granularity != "source" || material.Quote != entry.Quote || !material.RequiresSource {
		t.Fatal("current source was weakened or partial history declared complete", material)
	}
	for _, selected := range material.PriorSources {
		if !locators[selected.Revision] || selected.Revision < 1 || selected.Revision > 72 ||
			!bytes.Equal(narrativeMarshal(selected), narrativeMarshal(entry.PriorSources[selected.Revision-1])) {
			t.Fatal("selected original was truncated, rewritten, or lost its locator")
		}
	}
	if len(material.PriorSources) >= count || !bytes.Equal(before, narrativeMarshal(state)) {
		t.Fatal("selection duplicated the full trail or mutated persistent history")
	}
}

func TestSourceWindowReviewUpdatesRemainPossibleAfterManyRevisions(t *testing.T) {
	for _, stage := range []string{"review", "repair_review"} {
		t.Run(stage, func(t *testing.T) {
			run, call, candidate := reviewContextFixture(t)
			entry := sourceWindowEntry(72)
			run.context.Revision = 73
			run.context.AuthorityState.LiteraryMemory = &LiteraryMemory{
				Version: 1, IndexedThroughRevision: 73, Entries: []MemoryEntry{entry},
			}
			change := entry.MemoryChange
			change.Quote = candidate.Passage
			candidate.MemoryChanges = []MemoryChange{change}
			run.extracted, _ = canonicalCandidate(candidate)
			if stage == "repair_review" {
				run.last, run.reviewQuoteInvalid = "review", true
				call.NarrativeStage = stage
			}
			call.Messages[1].Content = string(narrativeMarshal(map[string]any{
				"context": reviewHydrationWireContext(run.context, run.context.State), "candidate": candidate,
			}))
			run.materialBudget, run.stageInputBudget = 4500, 16<<10
			before := narrativeMarshal(run.context.AuthorityState)
			if _, err := run.before(call); err != nil {
				t.Fatal("review permanently failed because the stored old source trail grew", err)
			}
			var body struct {
				Candidate Candidate     `json:"candidate"`
				Materials ContextBundle `json:"context_materials"`
			}
			if err := json.Unmarshal([]byte(call.Messages[1].Content), &body); err != nil {
				t.Fatal(err)
			}
			if len(body.Materials.Memories) != 1 || body.Materials.Memories[0].Quote != entry.Quote ||
				!body.Materials.Memories[0].RequiresSource || narrativeCallBytes(call) > run.stageInputBudget {
				t.Fatal("review lost its old current source, exceeded budget, or claimed complete history")
			}
			got, _ := canonicalCandidate(body.Candidate)
			want, _ := canonicalCandidate(candidate)
			if !bytes.Equal(got, want) || !bytes.Equal(before, narrativeMarshal(run.context.AuthorityState)) {
				t.Fatal("bounded review changed the frozen candidate or persistent source trail")
			}
		})
	}
}

func TestSourceWindowOptionalCommitmentsDoNotBecomeUnboundedRequirements(t *testing.T) {
	state := EmptyState()
	state.LiteraryMemory = &LiteraryMemory{Version: 1, IndexedThroughRevision: 1}
	for i := 0; i < 40; i++ {
		entry := sourceWindowEntry(0)
		entry.ID = fmt.Sprintf("agreement-%d", i)
		state.LiteraryMemory.Entries = append(state.LiteraryMemory.Entries, entry)
	}
	run := newNarrativeRun(Context{Mode: "read", Revision: 1, State: state, AuthorityState: &state})
	const budget = 1800
	bundle, err := run.prepareMaterials("write", "", ContextNeeds{ParticipantIDs: []string{"speaker"}}, budget)
	if err != nil {
		t.Fatal("sharing a participant made all old active agreements mandatory", err)
	}
	if len(bundle.Memories) == 0 || bundle.Coverage.BudgetOmitted == 0 ||
		bundle.Coverage.HistoryComplete || len(narrativeMarshal(bundle)) > budget {
		t.Fatal("optional selection lost all evidence or hid its finite coverage")
	}
	// Explicitly required evidence keeps the stricter rule: a current source
	// that cannot fit must fail rather than quietly becoming an omitted cue.
	state.LiteraryMemory.Entries[0].Quote = strings.Repeat("必须同时到场才履行。", 150)
	_, err = run.prepareMaterials("review", "", ContextNeeds{
		ParticipantIDs: []string{"speaker"}, requiredMemoryIDs: []string{"agreement-0"},
	}, budget)
	if err == nil || err.Error() != "context_budget_exceeded" {
		t.Fatal("explicitly required source was silently omitted", err)
	}
}
