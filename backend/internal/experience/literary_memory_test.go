package experience

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// Synthetic candidates exercise persistence and provenance, not prose quality.
func TestMemoryChangesContractSupportsIncrementalWithoutNotebook(t *testing.T) {
	raw := []byte(`{"title":"A reply","passage":"I will come tomorrow.","story_time":"","outcome":"continues","suggestions":[],"new_facts":[],"new_entities":[{"id":"lin","kind":"person","name":"Lin","description":"","known":true,"related_ids":[]}],"new_threads":[],"reveal_entity_ids":[],"reveal_thread_ids":[],"reveal_fact_ids":[],"resolve_thread_ids":[],"knowledge_changes":[],"memory_changes":[{"id":"promise","kind":"commitment","subject_ids":["lin"],"target_ids":[],"cue":"tomorrow","summary":"Lin promised to come tomorrow.","status":"active","retrieval_keys":["return"],"fact_ids":[],"quote":"I will come tomorrow."}]}`)
	candidate, err := DecodeCandidate(raw)
	if err != nil {
		t.Fatalf("incremental memory contract rejected: %v", err)
	}
	state, err := Apply(Context{Revision: 0, Mode: "begin", State: EmptyState(), Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}, candidate)
	if err != nil {
		t.Fatalf("incremental memory requires a full rewritten notebook: %v", err)
	}
	encoded, _ := json.Marshal(state)
	var persisted map[string]json.RawMessage
	_ = json.Unmarshal(encoded, &persisted)
	if persisted["literary_memory"] == nil {
		t.Fatal("committed memory disappeared from durable state")
	}
}

func memoryCandidate(t *testing.T) Candidate {
	t.Helper()
	c, err := DecodeCandidate([]byte(`{"title":"A reply","passage":"Lin said: I will come tomorrow.","story_time":"","outcome":"continues","suggestions":[],"new_facts":[],"new_entities":[],"new_threads":[],"reveal_entity_ids":[],"reveal_thread_ids":[],"reveal_fact_ids":[],"resolve_thread_ids":[],"knowledge_changes":[],"memory_changes":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func memoryFixture() State {
	state := EmptyState()
	state.Entities = []Entity{
		{ID: "lin", Kind: "person", Name: "Lin", Known: true, RelatedIDs: []string{}},
		{ID: "chen", Kind: "person", Name: "Chen", Known: true, RelatedIDs: []string{}},
	}
	state.Facts = []Fact{{ID: "private", Kind: "secret", Text: "Lin's secret", SubjectID: "lin", KnownBy: []string{"lin"}, SourceRevision: 1}}
	return state
}

func memoryChange() MemoryChange {
	return MemoryChange{ID: "promise", Kind: "commitment", SubjectIDs: []string{"lin"}, TargetIDs: []string{"chen"}, Cue: "a promised visit", Summary: "Lin said he would visit tomorrow.", Status: "active", RetrievalKeys: []string{"return"}, FactIDs: []string{}, Quote: "I will come tomorrow."}
}

func TestMemoryChangesPreserveUntouchedSourcesAndSnapshots(t *testing.T) {
	before := memoryFixture()
	c := memoryCandidate(t)
	c.MemoryChanges = []MemoryChange{memoryChange()}
	first, err := Apply(Context{Revision: 1, Mode: "read", State: before}, c)
	if err != nil {
		t.Fatal(err)
	}
	if before.LiteraryMemory != nil || first.LiteraryMemory.Entries[0].SourceSHA256 != memoryPageSHA256(c.Passage) || first.LiteraryMemory.Entries[0].SourceRevision != 2 {
		t.Fatal("source stamps missing or original snapshot changed")
	}
	saved, _ := json.Marshal(first.LiteraryMemory)
	noop := memoryCandidate(t)
	next, err := Apply(Context{Revision: 2, Mode: "read", State: first}, noop)
	if err != nil {
		t.Fatal(err)
	}
	retained, _ := json.Marshal(next.LiteraryMemory)
	if string(retained) != string(saved) {
		t.Fatal("empty local update rewrote old source")
	}
	update := memoryCandidate(t)
	update.Passage = "Lin came the next morning."
	change := memoryChange()
	change.Status, change.Quote, change.Summary = "resolved", update.Passage, "Lin fulfilled the visit."
	update.MemoryChanges = []MemoryChange{change}
	changed, err := Apply(Context{Revision: 3, Mode: "read", State: next}, update)
	if err != nil {
		t.Fatal(err)
	}
	if len(changed.LiteraryMemory.Entries) != 1 || changed.LiteraryMemory.Entries[0].Status != "resolved" || first.LiteraryMemory.Entries[0].Status != "active" {
		t.Fatal("local update replaced an earlier immutable snapshot")
	}
	encoded, _ := json.Marshal(changed.LiteraryMemory.Entries[0])
	var sources map[string]json.RawMessage
	_ = json.Unmarshal(encoded, &sources)
	if sources["prior_sources"] == nil {
		t.Fatal("fulfilment erased the original promise source; the summary cannot be reconstructed from its current page")
	}
}

func TestMemorySourceValidationRejectsFabricationAndIdentityRebinding(t *testing.T) {
	c := memoryCandidate(t)
	c.MemoryChanges = []MemoryChange{memoryChange()}
	before, err := Apply(Context{Revision: 1, Mode: "read", State: memoryFixture()}, c)
	if err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*MemoryChange){
		"paraphrase_instead_of_quote": func(m *MemoryChange) { m.Quote = "I may come tomorrow." },
		"unknown_subject":             func(m *MemoryChange) { m.SubjectIDs = []string{"absent"} },
		"unknown_target":              func(m *MemoryChange) { m.TargetIDs = []string{"absent"} },
		"missing_fact":                func(m *MemoryChange) { m.FactIDs = []string{"absent"} },
		"null_refs":                   func(m *MemoryChange) { m.FactIDs = nil },
		"duplicate_refs":              func(m *MemoryChange) { m.FactIDs = []string{"private", "private"} },
		"subject_rebound":             func(m *MemoryChange) { m.SubjectIDs = []string{"chen"} },
		"target_rebound":              func(m *MemoryChange) { m.TargetIDs = []string{} },
		"kind_rebound":                func(m *MemoryChange) { m.Kind = "disposition" },
		"empty_cue":                   func(m *MemoryChange) { m.Cue = " " },
		"invalid_status":              func(m *MemoryChange) { m.Status = "deleted" },
		"oversized_summary":           func(m *MemoryChange) { m.Summary = strings.Repeat("界", 2049) },
	} {
		t.Run(name, func(t *testing.T) {
			c := memoryCandidate(t)
			m := memoryChange()
			change(&m)
			c.MemoryChanges = []MemoryChange{m}
			if _, err := Apply(Context{Revision: 2, Mode: "read", State: before}, c); err == nil {
				t.Fatal("invalid change accepted")
			}
		})
	}
	for _, count := range []int{2, 13} {
		c := memoryCandidate(t)
		for i := 0; i < count; i++ {
			c.MemoryChanges = append(c.MemoryChanges, memoryChange())
		}
		if _, err := Apply(Context{Revision: 2, Mode: "read", State: before}, c); err == nil {
			t.Fatal("duplicate or excessive changes accepted")
		}
	}
}

func TestMemoryDoesNotGrantKnowledgeAndAskCannotWrite(t *testing.T) {
	state := memoryFixture()
	beforeKnown := append([]string{}, state.Facts[0].KnownBy...)
	c := memoryCandidate(t)
	m := memoryChange()
	m.FactIDs = []string{"private"}
	c.MemoryChanges = []MemoryChange{m}
	next, err := Apply(Context{Revision: 1, Mode: "read", State: state}, c)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(next.Facts[0].KnownBy, beforeKnown) || ReaderState(next).LiteraryMemory != nil {
		t.Fatal("private interpretation granted audience visibility")
	}
	for _, changes := range [][]MemoryChange{{}, {m}} {
		c.MemoryChanges = changes
		if _, err := Apply(Context{Revision: 2, Mode: "ask", State: next}, c); err == nil {
			t.Fatal("ask wrote an index or advanced its watermark")
		}
	}
	raw, _ := json.Marshal(c)
	var object map[string]any
	_ = json.Unmarshal(raw, &object)
	entry := object["memory_changes"].([]any)[0].(map[string]any)
	for _, field := range []string{"visible_to", "source_revision", "source_sha256", "updated_revision", "prior_sources"} {
		entry[field] = []string{"chen"}
		invalid, _ := json.Marshal(object)
		if _, err := DecodeCandidate(invalid); err == nil {
			t.Fatalf("model-written %s accepted", field)
		}
		delete(entry, field)
	}
}

func TestMemoryEmptyUpdateSurvivesWireRoundTripAndWatermarkIsHonest(t *testing.T) {
	c := memoryCandidate(t)
	encoded, _ := json.Marshal(c)
	if !strings.Contains(string(encoded), `"memory_changes":[]`) {
		t.Fatal("empty extraction was lost")
	}
	decoded, err := DecodeCandidate(encoded)
	if err != nil || decoded.MemoryChanges == nil {
		t.Fatal("empty extraction did not round trip")
	}
	first, err := Apply(Context{Mode: "begin", State: EmptyState()}, decoded)
	if err != nil || first.LiteraryMemory.IndexedThroughRevision != 1 {
		t.Fatal("completed initial extraction did not advance watermark", err)
	}
	legacy := c
	legacy.MemoryChanges = nil
	encoded, _ = json.Marshal(legacy)
	if strings.Contains(string(encoded), "memory_changes") {
		t.Fatal("legacy candidate gained an extraction claim")
	}
	second, err := Apply(Context{Revision: 1, Mode: "read", State: first}, legacy)
	if err != nil || second.LiteraryMemory.IndexedThroughRevision != 1 {
		t.Fatal("legacy writer falsely advanced index watermark", err)
	}
	third, err := Apply(Context{Revision: 2, Mode: "read", State: second}, c)
	if err != nil || third.LiteraryMemory.IndexedThroughRevision != 1 {
		t.Fatal("index advanced across an uninspected historical gap", err)
	}
}

func TestMemoryStorageIsNotLimitedToPromptNotebookCapacity(t *testing.T) {
	state := memoryFixture()
	for revision := int64(1); revision <= 12; revision++ {
		c := memoryCandidate(t)
		m := memoryChange()
		m.ID = fmt.Sprintf("promise-%d", revision)
		m.Summary = strings.Repeat("A conditional event and its consequence. ", 45)
		c.MemoryChanges = []MemoryChange{m}
		var err error
		state, err = Apply(Context{Revision: revision, Mode: "read", State: state}, c)
		if err != nil {
			t.Fatal(err)
		}
	}
	encoded, _ := json.Marshal(state.LiteraryMemory)
	if len(encoded) <= 12<<10 || len(state.LiteraryMemory.Entries) != 12 {
		t.Fatal("fixture did not preserve a long-term memory larger than one prompt budget")
	}
	if err := validateLiteraryMemoryState(state.LiteraryMemory, state, 13); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryArchiveSourceMustBelongToThisBranchAndRevision(t *testing.T) {
	c := memoryCandidate(t)
	c.MemoryChanges = []MemoryChange{memoryChange()}
	state, err := Apply(Context{Revision: 1, Mode: "read", State: memoryFixture()}, c)
	if err != nil {
		t.Fatal(err)
	}
	pages := []ArchivePage{{Page: Page{HistoryPage: HistoryPage{Revision: 1, Text: "Earlier."}}}, {Page: Page{HistoryPage: HistoryPage{Revision: 2, Text: c.Passage}}}}
	if err := validateMemorySources(state.LiteraryMemory, pages); err != nil {
		t.Fatal(err)
	}
	if validateMemorySources(state.LiteraryMemory, pages[:1]) == nil {
		t.Fatal("future source read from an earlier snapshot")
	}
	pages[1].Page.Text = "Lin did not make a promise."
	if validateMemorySources(state.LiteraryMemory, pages) == nil {
		t.Fatal("memory borrowed a source from a different branch")
	}
}

func TestMemoryRepeatedUpdatesRetainOriginalEvidenceChain(t *testing.T) {
	state := memoryFixture()
	pages := []ArchivePage{{Page: Page{HistoryPage: HistoryPage{Revision: 1, Text: "Earlier."}}}}
	passages := []string{
		"Lin said: I will come tomorrow.",
		"Lin called to say the train was delayed.",
		"Lin came the next morning.",
	}
	var snapshots []State
	for i, passage := range passages {
		c := memoryCandidate(t)
		c.Passage = passage
		change := memoryChange()
		change.Quote = passage
		if i == len(passages)-1 {
			change.Status = "resolved"
			change.Summary = "Lin fulfilled the visit promised for tomorrow, after calling about a train delay."
		}
		c.MemoryChanges = []MemoryChange{change}
		var err error
		state, err = Apply(Context{Revision: int64(i + 1), Mode: "read", State: state}, c)
		if err != nil {
			t.Fatal(err)
		}
		snapshots = append(snapshots, state)
		pages = append(pages, ArchivePage{Page: Page{HistoryPage: HistoryPage{Revision: int64(i + 2), Text: passage}}})
	}
	final := state.LiteraryMemory.Entries[0]
	if len(final.PriorSources) != 2 || final.SourceRevision != 4 {
		t.Fatal("updates lost or duplicated original evidence")
	}
	for i, source := range final.PriorSources {
		if source.Revision != int64(i+2) || source.Quote != passages[i] || source.SHA256 != memoryPageSHA256(passages[i]) {
			t.Fatal("prior source was summarized, rebound, or overwritten")
		}
	}
	if len(snapshots[0].LiteraryMemory.Entries[0].PriorSources) != 0 || len(snapshots[1].LiteraryMemory.Entries[0].PriorSources) != 1 {
		t.Fatal("appending source history mutated an older snapshot")
	}
	if err := validateMemorySources(state.LiteraryMemory, pages); err != nil {
		t.Fatal(err)
	}
	for _, index := range []int{1, 2} {
		t.Run(fmt.Sprintf("different-branch-page-%d", index+1), func(t *testing.T) {
			otherBranch := append([]ArchivePage{}, pages...)
			otherBranch[index].Page.Text = "This branch contains a different promise."
			if validateMemorySources(state.LiteraryMemory, otherBranch) == nil {
				t.Fatal("only current source was checked; a prior source belongs to another branch")
			}
		})
	}
	for name, mutate := range map[string]func(*MemoryEntry){
		"wrong-quote": func(e *MemoryEntry) { e.PriorSources[0].Quote = "Lin promised nothing." },
		"wrong-hash":  func(e *MemoryEntry) { e.PriorSources[0].SHA256 = strings.Repeat("0", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(state.LiteraryMemory)
			var changed LiteraryMemory
			_ = json.Unmarshal(raw, &changed)
			mutate(&changed.Entries[0])
			if validateMemorySources(&changed, pages) == nil {
				t.Fatal("tampered prior source was accepted")
			}
		})
	}
	for name, mutate := range map[string]func(*MemoryEntry){
		"duplicate": func(e *MemoryEntry) { e.PriorSources[1] = e.PriorSources[0] },
		"future":    func(e *MemoryEntry) { e.PriorSources[1].Revision = e.SourceRevision },
		"reversed": func(e *MemoryEntry) {
			e.PriorSources[0], e.PriorSources[1] = e.PriorSources[1], e.PriorSources[0]
		},
		"invalid-hash": func(e *MemoryEntry) { e.PriorSources[0].SHA256 = strings.Repeat("G", 64) },
		"empty-quote":  func(e *MemoryEntry) { e.PriorSources[0].Quote = "" },
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(state.LiteraryMemory)
			var changed LiteraryMemory
			_ = json.Unmarshal(raw, &changed)
			mutate(&changed.Entries[0])
			if validateLiteraryMemoryState(&changed, state, 4) == nil {
				t.Fatal("invalid source ordering or shape was accepted")
			}
		})
	}
}
