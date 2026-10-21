package experience

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"unicode/utf8"
)

// LiteraryMemory is a private, derived index over immutable formal sources.
// Unlike a prompt notebook, its lifetime and size are not a context-window
// budget. Stage compilation chooses a bounded subset without deleting entries.
// It is committed atomically in the same branch snapshot as its source page.
type LiteraryMemory struct {
	Version                int           `json:"version"`
	IndexedThroughRevision int64         `json:"indexed_through_revision"`
	Entries                []MemoryEntry `json:"entries"`
}

// MemoryChange carries only an interpretation and a quote from the candidate's
// adopted passage. It has no knowledge/audience field and grants no permission.
type MemoryChange struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	SubjectIDs    []string `json:"subject_ids"`
	TargetIDs     []string `json:"target_ids"`
	Cue           string   `json:"cue"`
	Summary       string   `json:"summary"`
	Status        string   `json:"status"`
	RetrievalKeys []string `json:"retrieval_keys"`
	FactIDs       []string `json:"fact_ids"`
	Quote         string   `json:"quote"`
}

// Provenance is assigned by Go, never supplied by the model. SourceSHA256
// identifies the complete source page text, not the model's summary or quote.
type MemoryEntry struct {
	MemoryChange
	SourceRevision  int64               `json:"source_revision"`
	SourceSHA256    string              `json:"source_sha256"`
	UpdatedRevision int64               `json:"updated_revision"`
	PriorSources    []MemorySource      `json:"prior_sources,omitempty"`
	EvidenceKind    string              `json:"evidence_kind,omitempty"`
	EvidenceRefs    []MemoryEvidenceRef `json:"evidence_refs,omitempty"`
	LocatorQuote    *string             `json:"locator_quote,omitempty"`
	LegacyEntry     *MemoryEntry        `json:"legacy_entry,omitempty"`
}

// MemorySource keeps original evidence when an entry evolves. A later page
// fulfilling a promise cannot replace the page that specified its conditions.
// Only Go can extend this chain; candidate interpretations cannot author it.
type MemorySource struct {
	Revision int64  `json:"revision"`
	SHA256   string `json:"sha256"`
	Quote    string `json:"quote"`
}

// Preserve the difference between absent (legacy extraction) and [] (this
// formal page was inspected and produced no literary change) across hashing,
// review and archive round trips. A plain omitempty slice would erase [].
func (c Candidate) MarshalJSON() ([]byte, error) {
	if c.MemoryDelta != nil && c.MemoryChanges != nil {
		return nil, fail("invalid_literary_memory")
	}
	type wireCandidate Candidate
	var changes *[]MemoryChange
	if c.MemoryChanges != nil {
		changes = &c.MemoryChanges
	}
	return json.Marshal(struct {
		wireCandidate
		MemoryChanges *[]MemoryChange `json:"memory_changes,omitempty"`
	}{wireCandidate: wireCandidate(c), MemoryChanges: changes})
}

func memoryPageSHA256(passage string) string {
	sum := sha256.Sum256([]byte(passage))
	return hex.EncodeToString(sum[:])
}

func validMemorySource(source MemorySource) bool {
	digest, err := hex.DecodeString(source.SHA256)
	return source.Revision >= 1 && textOK(source.Quote) && utf8.RuneCountInString(source.Quote) <= 2048 &&
		err == nil && len(digest) == sha256.Size && hex.EncodeToString(digest) == source.SHA256
}

type memoryReferenceIndex struct {
	objects map[string]bool
	facts   map[string]Fact
}

func memoryReferences(state State) memoryReferenceIndex {
	out := memoryReferenceIndex{objects: map[string]bool{}, facts: map[string]Fact{}}
	for _, entity := range state.Entities {
		out.objects[entity.ID] = true
	}
	for _, thread := range state.Threads {
		out.objects[thread.ID] = true
	}
	for _, fact := range state.Facts {
		out.facts[fact.ID] = fact
	}
	return out
}

func (refs memoryReferenceIndex) valid(change MemoryChange, revision int64) bool {
	return refs.validInterpretation(change, revision) && textOK(change.Quote) && utf8.RuneCountInString(change.Quote) <= 2048
}

func (refs memoryReferenceIndex) validInterpretation(change MemoryChange, revision int64) bool {
	kindOK := map[string]bool{"disposition": true, "goal": true, "relationship": true, "episode": true, "commitment": true, "expression": true, "object": true, "thread": true}
	statusOK := change.Status == "active" || change.Status == "resolved" || change.Status == "revised"
	text := func(value string, limit int) bool {
		return textOK(value) && utf8.RuneCountInString(value) <= limit
	}
	if !keyOK(change.ID) || !kindOK[change.Kind] || !statusOK || !text(change.Cue, 256) || !text(change.Summary, 2048) {
		return false
	}
	ids := func(values []string, min, max int, present func(string) bool) bool {
		if values == nil || len(values) < min || len(values) > max {
			return false
		}
		seen := map[string]bool{}
		for _, value := range values {
			if !keyOK(value) || seen[value] || !present(value) {
				return false
			}
			seen[value] = true
		}
		return true
	}
	if !ids(change.SubjectIDs, 1, 8, func(id string) bool { return refs.objects[id] }) ||
		!ids(change.TargetIDs, 0, 8, func(id string) bool { return refs.objects[id] }) ||
		!ids(change.FactIDs, 0, 64, func(id string) bool {
			fact, ok := refs.facts[id]
			return ok && fact.SourceRevision <= revision
		}) {
		return false
	}
	if change.RetrievalKeys == nil || len(change.RetrievalKeys) > 12 {
		return false
	}
	seenKeys := map[string]bool{}
	for _, key := range change.RetrievalKeys {
		if !text(key, 128) || seenKeys[key] {
			return false
		}
		seenKeys[key] = true
	}
	return true
}

func validateLiteraryMemoryState(memory *LiteraryMemory, state State, revision int64) error {
	if memory == nil {
		return nil
	}
	if memory.Version == 2 {
		return validateLiteraryMemoryV2(memory, state, revision)
	}
	bad := func() error { return fail("invalid_literary_memory") }
	if memory.Version != 1 || memory.IndexedThroughRevision < 0 || memory.IndexedThroughRevision > revision || memory.Entries == nil {
		return bad()
	}
	ids := map[string]bool{}
	refs := memoryReferences(state)
	for _, entry := range memory.Entries {
		if entry.EvidenceKind != "" || entry.EvidenceRefs != nil || entry.LocatorQuote != nil || entry.LegacyEntry != nil ||
			ids[entry.ID] || !refs.valid(entry.MemoryChange, entry.SourceRevision) ||
			entry.SourceRevision < 1 || entry.SourceRevision > revision ||
			entry.UpdatedRevision != entry.SourceRevision {
			return bad()
		}
		if !validMemorySource(MemorySource{entry.SourceRevision, entry.SourceSHA256, entry.Quote}) {
			return bad()
		}
		previous := int64(0)
		for _, source := range entry.PriorSources {
			if !validMemorySource(source) || source.Revision <= previous || source.Revision >= entry.SourceRevision {
				return bad()
			}
			previous = source.Revision
		}
		ids[entry.ID] = true
	}
	return nil
}

func sameMemoryIdentity(old, next MemoryChange) bool {
	sameIDs := func(a, b []string) bool {
		a, b = append([]string{}, a...), append([]string{}, b...)
		sort.Strings(a)
		sort.Strings(b)
		return reflect.DeepEqual(a, b)
	}
	return old.Kind == next.Kind && sameIDs(old.SubjectIDs, next.SubjectIDs) && sameIDs(old.TargetIDs, next.TargetIDs)
}

func applyLiteraryMemory(ctx Context, candidate Candidate, state *State) error {
	if candidate.MemoryDelta != nil {
		if candidate.MemoryChanges != nil {
			return fail("invalid_literary_memory")
		}
		if ctx.Mode == "ask" {
			return fail("ask_mutation")
		}
		return applyLiteraryMemoryV2(ctx, candidate, state)
	}
	if ctx.Mode == "ask" {
		if candidate.MemoryChanges != nil {
			return fail("ask_mutation")
		}
		return nil
	}
	if candidate.MemoryChanges == nil {
		// A legacy notebook rewrite did not inspect the literary index. Keep its
		// old watermark; absence of an entry does not prove absence of an event.
		return nil
	}
	if len(candidate.MemoryChanges) > 12 {
		return fail("invalid_literary_memory")
	}
	// The compatibility path cannot silently convert a new index back to v1.
	if state.LiteraryMemory != nil && state.LiteraryMemory.Version == 2 {
		return fail("invalid_literary_memory")
	}
	if err := validateLiteraryMemoryState(state.LiteraryMemory, *state, ctx.Revision); err != nil {
		return err
	}
	if state.LiteraryMemory == nil {
		state.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{}}
	}
	index := map[string]int{}
	for i, entry := range state.LiteraryMemory.Entries {
		index[entry.ID] = i
	}
	seen := map[string]bool{}
	refs := memoryReferences(*state)
	sourceSHA256 := memoryPageSHA256(candidate.Passage)
	for _, change := range candidate.MemoryChanges {
		if seen[change.ID] || !refs.valid(change, ctx.Revision+1) || !strings.Contains(candidate.Passage, change.Quote) {
			return fail("invalid_literary_memory")
		}
		seen[change.ID] = true
		entry := MemoryEntry{MemoryChange: change, SourceRevision: ctx.Revision + 1, SourceSHA256: sourceSHA256, UpdatedRevision: ctx.Revision + 1}
		if at, exists := index[change.ID]; exists {
			old := state.LiteraryMemory.Entries[at]
			if !sameMemoryIdentity(old.MemoryChange, change) {
				return fail("invalid_literary_memory")
			}
			// Keep original sources, never a chain of summaries of summaries.
			// Earlier validation guarantees strictly increasing revisions, so
			// the previous current source is not already in PriorSources.
			entry.PriorSources = append([]MemorySource{}, old.PriorSources...)
			entry.PriorSources = append(entry.PriorSources, MemorySource{old.SourceRevision, old.SourceSHA256, old.Quote})
			state.LiteraryMemory.Entries[at] = entry
		} else {
			state.LiteraryMemory.Entries = append(state.LiteraryMemory.Entries, entry)
		}
	}
	// A newly upgraded branch may contain an unindexed historical prefix.
	// Indexing this page must not falsely claim to have inspected that gap.
	if state.LiteraryMemory.IndexedThroughRevision == ctx.Revision {
		state.LiteraryMemory.IndexedThroughRevision = ctx.Revision + 1
	}
	return nil
}

// Archive import has the full branch history and verifies actual source bytes,
// so a fabricated digest or a quote borrowed from another branch is rejected.
func validateMemorySources(memory *LiteraryMemory, pages []ArchivePage) error {
	if memory == nil {
		return nil
	}
	byRevision := make(map[int64]ArchivePage, len(pages))
	for _, page := range pages {
		if _, duplicate := byRevision[page.Page.Revision]; duplicate {
			return fail("invalid_literary_memory")
		}
		byRevision[page.Page.Revision] = page
	}
	return validateMemorySourcesAt(memory, byRevision)
}

// The sparse form lets selected-source reads and atomic commits validate only
// their actual dependency revisions, without allocating up to the highest page.
// Every map value still has to carry the matching formal page revision.
func validateMemorySourcesAt(memory *LiteraryMemory, pages map[int64]ArchivePage) error {
	if memory == nil {
		return nil
	}
	if memory.Version == 2 {
		return validateMemoryV2Sources(memory, pages)
	}
	for _, entry := range memory.Entries {
		sources := append([]MemorySource{}, entry.PriorSources...)
		sources = append(sources, MemorySource{entry.SourceRevision, entry.SourceSHA256, entry.Quote})
		for _, reference := range sources {
			if !validMemorySource(reference) {
				return fail("invalid_literary_memory")
			}
			stored, exists := pages[reference.Revision]
			source := stored.Page
			if !exists || source.Revision != reference.Revision || memoryPageSHA256(source.Text) != reference.SHA256 || !strings.Contains(source.Text, reference.Quote) {
				return fail("invalid_literary_memory")
			}
		}
	}
	return nil
}
