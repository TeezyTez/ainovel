package experience

import "testing"

func TestLiteraryEditInvalidatesAnEarlierSourceInRevisionChain(t *testing.T) {
	state := State{LiteraryMemory: &LiteraryMemory{Version: 1, IndexedThroughRevision: 8, Entries: []MemoryEntry{
		{MemoryChange: MemoryChange{ID: "promise"}, SourceRevision: 8, PriorSources: []MemorySource{{Revision: 1, Quote: "original condition"}}},
		{MemoryChange: MemoryChange{ID: "unrelated"}, SourceRevision: 3},
	}}}
	parent := state.LiteraryMemory
	invalidateLiteraryForEdit(&state, 1, false)
	if state.LiteraryMemory.IndexedThroughRevision != 0 || len(state.LiteraryMemory.Entries) != 1 || state.LiteraryMemory.Entries[0].ID != "unrelated" {
		t.Fatal("editing the original promise left a derived fulfilment interpretation")
	}
	if len(parent.Entries) != 2 || parent.IndexedThroughRevision != 8 {
		t.Fatal("invalidation modified the parent snapshot")
	}
}
