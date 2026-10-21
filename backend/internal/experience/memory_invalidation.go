package experience

// An author fork retains the original sources in the parent branch. Derived
// interpretations must not silently acquire the authority of edited sources.
// Editing a fact can change implicit dependencies in a summary, so invalidate
// that branch's derived index. A prose-only replacement invalidates entries
// sourced in that page and rewinds coverage; older sources remain usable.
func invalidateLiteraryForEdit(state *State, revision int64, factChanged bool) {
	state.Narrative = nil
	if state.LiteraryMemory == nil {
		return
	}
	if factChanged {
		state.LiteraryMemory = nil
		return
	}
	index := *state.LiteraryMemory
	index.Entries = []MemoryEntry{}
	for _, entry := range state.LiteraryMemory.Entries {
		affected := entry.SourceRevision == revision
		if state.LiteraryMemory.Version == 2 {
			references, err := memoryEntryDependencies(entry)
			// Invalid provenance cannot justify retaining a derived index.
			affected = err != nil
			for _, source := range references {
				affected = affected ||
					source.Kind == "formal_page" && source.Revision == revision ||
					source.Kind == "authority_fact" && source.AsOfRevision == revision
			}
		}
		for _, source := range entry.PriorSources {
			affected = affected || source.Revision == revision
		}
		if !affected {
			index.Entries = append(index.Entries, entry)
		}
	}
	index.IndexedThroughRevision = min(index.IndexedThroughRevision, max(int64(0), revision-1))
	state.LiteraryMemory = &index
}
