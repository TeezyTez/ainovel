package experience

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// MemoryInterpretation is model-written meaning, never source authority.
// LocatorQuote, if present, locates text in this adopted page only.
type MemoryInterpretation struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	SubjectIDs    []string `json:"subject_ids"`
	TargetIDs     []string `json:"target_ids"`
	Cue           string   `json:"cue"`
	Summary       string   `json:"summary"`
	Status        string   `json:"status"`
	RetrievalKeys []string `json:"retrieval_keys"`
	FactIDs       []string `json:"fact_ids"`
	LocatorQuote  *string  `json:"locator_quote,omitempty"`
}

type MemoryDelta struct {
	Version int                    `json:"version"`
	Entries []MemoryInterpretation `json:"entries"`
}

// MemoryEvidenceRef is a Go-resolved durable dependency. It never contains a
// model's operation-local source ID. The two alternatives are closed on wire.
type MemoryEvidenceRef struct {
	Kind         string `json:"kind"`
	Revision     int64  `json:"revision,omitempty"`
	TextSHA256   string `json:"text_sha256,omitempty"`
	FactID       string `json:"fact_id,omitempty"`
	AsOfRevision int64  `json:"as_of_revision,omitempty"`
	RecordSHA256 string `json:"record_sha256,omitempty"`
}

func (m *MemoryInterpretation) UnmarshalJSON(raw []byte) error {
	if validateContract(raw, "memory_interpretation") != nil {
		return fail("invalid_literary_memory")
	}
	type wire MemoryInterpretation
	var value wire
	if err := StrictJSON(raw, &value); err != nil {
		return err
	}
	*m = MemoryInterpretation(value)
	return nil
}

func (m *MemoryDelta) UnmarshalJSON(raw []byte) error {
	if validateContract(raw, "memory_delta") != nil {
		return fail("invalid_literary_memory")
	}
	type wire MemoryDelta
	var value wire
	if err := StrictJSON(raw, &value); err != nil {
		return err
	}
	*m = MemoryDelta(value)
	return nil
}

func (r *MemoryEvidenceRef) UnmarshalJSON(raw []byte) error {
	if validateContract(raw, "memory_evidence_ref") != nil {
		return fail("invalid_literary_memory")
	}
	type wire MemoryEvidenceRef
	var value wire
	if err := StrictJSON(raw, &value); err != nil {
		return err
	}
	*r = MemoryEvidenceRef(value)
	return nil
}

// Direct typed decoding must preserve the same presence rules as the shared
// schema. In particular [] + empty delta is not a harmless combination.
func (c *Candidate) UnmarshalJSON(raw []byte) error {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return fail("invalid_json")
	}
	old, oldPresent := object["memory_changes"]
	next, nextPresent := object["memory_delta"]
	if oldPresent && nextPresent ||
		oldPresent && bytes.Equal(bytes.TrimSpace(old), []byte("null")) ||
		nextPresent && bytes.Equal(bytes.TrimSpace(next), []byte("null")) {
		return fail("invalid_literary_memory")
	}
	type wire Candidate
	var value wire
	if err := StrictJSON(raw, &value); err != nil {
		return err
	}
	*c = Candidate(value)
	return nil
}

type legacyMemoryEntryWire struct {
	MemoryChange
	SourceRevision  int64          `json:"source_revision"`
	SourceSHA256    string         `json:"source_sha256"`
	UpdatedRevision int64          `json:"updated_revision"`
	PriorSources    []MemorySource `json:"prior_sources,omitempty"`
	EvidenceKind    string         `json:"evidence_kind,omitempty"`
}

// The alias has no UnmarshalJSON method, so embedding cannot consume the outer
// entry and accidentally hide its provenance fields.
type memoryInterpretationWire MemoryInterpretation

type sourcedMemoryEntryWire struct {
	memoryInterpretationWire
	EvidenceKind    string              `json:"evidence_kind"`
	UpdatedRevision int64               `json:"updated_revision"`
	EvidenceRefs    []MemoryEvidenceRef `json:"evidence_refs"`
	LegacyEntry     *MemoryEntry        `json:"legacy_entry,omitempty"`
}

func (m MemoryEntry) MarshalJSON() ([]byte, error) {
	switch m.EvidenceKind {
	case "", "legacy_v1":
		if m.EvidenceRefs != nil || m.LocatorQuote != nil || m.LegacyEntry != nil {
			return nil, fail("invalid_literary_memory")
		}
		return json.Marshal(legacyMemoryEntryWire{
			MemoryChange: m.MemoryChange, SourceRevision: m.SourceRevision,
			SourceSHA256: m.SourceSHA256, UpdatedRevision: m.UpdatedRevision,
			PriorSources: m.PriorSources, EvidenceKind: m.EvidenceKind,
		})
	case "source_refs_v2":
		if m.Quote != "" || m.SourceRevision != 0 || m.SourceSHA256 != "" || m.PriorSources != nil {
			return nil, fail("invalid_literary_memory")
		}
		if m.LegacyEntry != nil && m.LegacyEntry.EvidenceKind != "" {
			return nil, fail("invalid_literary_memory")
		}
		return json.Marshal(sourcedMemoryEntryWire{
			memoryInterpretationWire: memoryInterpretationWire(interpretationFromEntry(m)),
			EvidenceKind:             m.EvidenceKind, UpdatedRevision: m.UpdatedRevision,
			EvidenceRefs: m.EvidenceRefs, LegacyEntry: m.LegacyEntry,
		})
	default:
		return nil, fail("invalid_literary_memory")
	}
}

func (m *MemoryEntry) UnmarshalJSON(raw []byte) error {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return fail("invalid_literary_memory")
	}
	var kind string
	kindRaw, hasKind := object["evidence_kind"]
	if hasKind && json.Unmarshal(kindRaw, &kind) != nil {
		return fail("invalid_literary_memory")
	}
	// Preserve the old decoder's field behavior; v1 state/source validators
	// remain responsible for its semantic validity. New tagged forms are closed
	// here, including a complete v1 legacy_entry within a sourced entry.
	if hasKind && validateContract(raw, "memory_entry_v2") != nil {
		return fail("invalid_literary_memory")
	}
	if kind == "" || kind == "legacy_v1" {
		var value legacyMemoryEntryWire
		if err := StrictJSON(raw, &value); err != nil {
			return err
		}
		*m = MemoryEntry{
			MemoryChange: value.MemoryChange, SourceRevision: value.SourceRevision,
			SourceSHA256: value.SourceSHA256, UpdatedRevision: value.UpdatedRevision,
			PriorSources: value.PriorSources, EvidenceKind: value.EvidenceKind,
		}
		return nil
	}
	var value sourcedMemoryEntryWire
	if err := StrictJSON(raw, &value); err != nil {
		return err
	}
	interpretation := MemoryInterpretation(value.memoryInterpretationWire)
	*m = MemoryEntry{
		MemoryChange: interpretationChange(interpretation), EvidenceKind: value.EvidenceKind,
		UpdatedRevision: value.UpdatedRevision, EvidenceRefs: value.EvidenceRefs,
		LocatorQuote: interpretation.LocatorQuote, LegacyEntry: value.LegacyEntry,
	}
	return nil
}

func interpretationChange(m MemoryInterpretation) MemoryChange {
	return MemoryChange{ID: m.ID, Kind: m.Kind, SubjectIDs: m.SubjectIDs,
		TargetIDs: m.TargetIDs, Cue: m.Cue, Summary: m.Summary, Status: m.Status,
		RetrievalKeys: m.RetrievalKeys, FactIDs: m.FactIDs}
}

func interpretationFromEntry(m MemoryEntry) MemoryInterpretation {
	return MemoryInterpretation{ID: m.ID, Kind: m.Kind, SubjectIDs: m.SubjectIDs,
		TargetIDs: m.TargetIDs, Cue: m.Cue, Summary: m.Summary, Status: m.Status,
		RetrievalKeys: m.RetrievalKeys, FactIDs: m.FactIDs, LocatorQuote: m.LocatorQuote}
}

func latestMemoryRevision(entry MemoryEntry) int64 {
	if entry.EvidenceKind == "source_refs_v2" {
		return entry.UpdatedRevision
	}
	return entry.SourceRevision
}

func validMemoryDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func memoryEvidenceIdentity(ref MemoryEvidenceRef) (string, bool) {
	switch ref.Kind {
	case "formal_page":
		if ref.Revision < 1 || !validMemoryDigest(ref.TextSHA256) ||
			ref.FactID != "" || ref.AsOfRevision != 0 || ref.RecordSHA256 != "" {
			return "", false
		}
		return "page/" + strconv.FormatInt(ref.Revision, 10), true
	case "authority_fact":
		if !keyOK(ref.FactID) || ref.AsOfRevision < 1 || !validMemoryDigest(ref.RecordSHA256) ||
			ref.Revision != 0 || ref.TextSHA256 != "" {
			return "", false
		}
		return "fact/" + ref.FactID + "/" + strconv.FormatInt(ref.AsOfRevision, 10), true
	default:
		return "", false
	}
}

func normalizeMemoryDependencies(refs []MemoryEvidenceRef) ([]MemoryEvidenceRef, error) {
	byIdentity := map[string]MemoryEvidenceRef{}
	for _, ref := range refs {
		identity, valid := memoryEvidenceIdentity(ref)
		if !valid {
			return nil, fail("invalid_literary_memory")
		}
		if previous, exists := byIdentity[identity]; exists && previous != ref {
			return nil, fail("invalid_literary_memory")
		}
		byIdentity[identity] = ref
	}
	keys := make([]string, 0, len(byIdentity))
	for key := range byIdentity {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]MemoryEvidenceRef, 0, len(keys))
	for _, key := range keys {
		result = append(result, byIdentity[key])
	}
	return result, nil
}

// memoryEntryDependencies returns durable provenance only, never the sources
// actually loaded or selected by the current review. Legacy fact_ids remain
// lookup hints: only the old page chain can be converted to references.
func memoryEntryDependencies(entry MemoryEntry) ([]MemoryEvidenceRef, error) {
	var refs []MemoryEvidenceRef
	switch entry.EvidenceKind {
	case "", "legacy_v1":
		if entry.EvidenceRefs != nil || entry.LegacyEntry != nil || entry.LocatorQuote != nil {
			return nil, fail("invalid_literary_memory")
		}
		sources := append([]MemorySource{}, entry.PriorSources...)
		sources = append(sources, MemorySource{entry.SourceRevision, entry.SourceSHA256, entry.Quote})
		for _, source := range sources {
			if !validMemorySource(source) {
				return nil, fail("invalid_literary_memory")
			}
			refs = append(refs, MemoryEvidenceRef{
				Kind: "formal_page", Revision: source.Revision, TextSHA256: source.SHA256,
			})
		}
	case "source_refs_v2":
		if len(entry.EvidenceRefs) == 0 || entry.Quote != "" || entry.SourceRevision != 0 ||
			entry.SourceSHA256 != "" || entry.PriorSources != nil {
			return nil, fail("invalid_literary_memory")
		}
		refs = append(refs, entry.EvidenceRefs...)
		if entry.LegacyEntry != nil {
			if entry.LegacyEntry.EvidenceKind != "" {
				return nil, fail("invalid_literary_memory")
			}
			legacy, err := memoryEntryDependencies(*entry.LegacyEntry)
			if err != nil {
				return nil, err
			}
			refs = append(refs, legacy...)
		}
	default:
		return nil, fail("invalid_literary_memory")
	}
	return normalizeMemoryDependencies(refs)
}

func validateLiteraryMemoryV2(memory *LiteraryMemory, state State, revision int64) error {
	bad := func() error { return fail("invalid_literary_memory") }
	if memory.Version != 2 || memory.Entries == nil || memory.IndexedThroughRevision < 0 ||
		memory.IndexedThroughRevision > revision {
		return bad()
	}
	identities := map[string]bool{}
	refs := memoryReferences(state)
	for _, entry := range memory.Entries {
		if identities[entry.ID] {
			return bad()
		}
		identities[entry.ID] = true
		switch entry.EvidenceKind {
		case "legacy_v1":
			legacy := entry
			legacy.EvidenceKind = ""
			if err := validateLiteraryMemoryState(
				&LiteraryMemory{Version: 1, Entries: []MemoryEntry{legacy}}, state, revision,
			); err != nil {
				return err
			}
		case "source_refs_v2":
			if entry.UpdatedRevision < 1 || entry.UpdatedRevision > revision ||
				!refs.validInterpretation(entry.MemoryChange, entry.UpdatedRevision) ||
				entry.Quote != "" || entry.SourceRevision != 0 || entry.SourceSHA256 != "" ||
				entry.PriorSources != nil || len(entry.EvidenceRefs) == 0 {
				return bad()
			}
			if entry.LocatorQuote != nil && (!textOK(*entry.LocatorQuote) ||
				utf8.RuneCountInString(*entry.LocatorQuote) > 2048) {
				return bad()
			}
			current, seen := false, map[string]bool{}
			for _, ref := range entry.EvidenceRefs {
				identity, valid := memoryEvidenceIdentity(ref)
				if !valid || seen[identity] {
					return bad()
				}
				seen[identity] = true
				if ref.Kind == "formal_page" {
					if ref.Revision > entry.UpdatedRevision {
						return bad()
					}
					current = current || ref.Revision == entry.UpdatedRevision
				} else if ref.AsOfRevision >= entry.UpdatedRevision {
					// A newly proposed fact belongs to candidate evidence,
					// never to a pre-existing authority-fact record.
					return bad()
				}
			}
			if !current {
				return bad()
			}
			if entry.LegacyEntry != nil {
				legacy := *entry.LegacyEntry
				if legacy.EvidenceKind != "" || legacy.SourceRevision >= entry.UpdatedRevision ||
					!sameMemoryIdentity(legacy.MemoryChange, entry.MemoryChange) {
					return bad()
				}
				if err := validateLiteraryMemoryState(
					&LiteraryMemory{Version: 1, Entries: []MemoryEntry{legacy}}, state, entry.UpdatedRevision,
				); err != nil {
					return err
				}
			}
		default:
			return bad()
		}
		if _, err := memoryEntryDependencies(entry); err != nil {
			return err
		}
	}
	return nil
}

func applyLiteraryMemoryV2(ctx Context, candidate Candidate, state *State) error {
	bad := func() error { return fail("invalid_literary_memory") }
	delta := candidate.MemoryDelta
	if delta == nil || delta.Version != 2 || delta.Entries == nil || len(delta.Entries) > 12 {
		return bad()
	}
	// This resolver belongs to the private approval lifecycle. There is no
	// quote-based or caller-supplied-map fallback, including for an empty delta.
	resolved, err := verifyMemoryDeltaApproval(ctx, candidate)
	if err != nil {
		return err
	}
	if len(resolved) != len(delta.Entries) {
		return bad()
	}
	if err := validateLiteraryMemoryState(state.LiteraryMemory, *state, ctx.Revision); err != nil {
		return err
	}
	next := LiteraryMemory{Version: 2, Entries: []MemoryEntry{}}
	if state.LiteraryMemory != nil {
		// Deep-copy legacy trails and locators; a new revision must not mutate
		// retained old snapshots through backing slices or pointers.
		raw, err := json.Marshal(state.LiteraryMemory)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &next); err != nil {
			return err
		}
		next.Version = 2
		for i := range next.Entries {
			if next.Entries[i].EvidenceKind == "" {
				next.Entries[i].EvidenceKind = "legacy_v1"
			}
		}
	}
	index := map[string]int{}
	for i, entry := range next.Entries {
		index[entry.ID] = i
	}
	seen := map[string]bool{}
	current := MemoryEvidenceRef{Kind: "formal_page", Revision: ctx.Revision + 1,
		TextSHA256: memoryPageSHA256(candidate.Passage)}
	refs := memoryReferences(*state)
	for _, change := range delta.Entries {
		interpretation := interpretationChange(change)
		if seen[change.ID] || !refs.validInterpretation(interpretation, current.Revision) ||
			change.LocatorQuote != nil && (!textOK(*change.LocatorQuote) ||
				utf8.RuneCountInString(*change.LocatorQuote) > 2048 ||
				!strings.Contains(candidate.Passage, *change.LocatorQuote)) {
			return bad()
		}
		seen[change.ID] = true
		selected, exists := resolved[change.ID]
		if !exists || len(selected) == 0 {
			return bad()
		}
		hasCandidate := false
		for _, ref := range selected {
			if _, valid := memoryEvidenceIdentity(ref); !valid {
				return bad()
			}
			hasCandidate = hasCandidate || ref == current
			if ref.Kind == "formal_page" && ref.Revision > ctx.Revision && ref != current ||
				ref.Kind == "authority_fact" && ref.AsOfRevision > ctx.Revision {
				return bad()
			}
		}
		if !hasCandidate {
			return bad()
		}
		entry := MemoryEntry{MemoryChange: interpretation, EvidenceKind: "source_refs_v2",
			UpdatedRevision: current.Revision, LocatorQuote: change.LocatorQuote}
		dependencies := append([]MemoryEvidenceRef{}, selected...)
		if at, exists := index[change.ID]; exists {
			old := next.Entries[at]
			if !sameMemoryIdentity(old.MemoryChange, interpretation) {
				return bad()
			}
			older, err := memoryEntryDependencies(old)
			if err != nil {
				return err
			}
			dependencies = append(dependencies, older...)
			if old.EvidenceKind == "legacy_v1" {
				legacy := old
				legacy.EvidenceKind = ""
				entry.LegacyEntry = &legacy
			} else {
				entry.LegacyEntry = old.LegacyEntry
			}
		}
		entry.EvidenceRefs, err = normalizeMemoryDependencies(dependencies)
		if err != nil {
			return err
		}
		if at, exists := index[change.ID]; exists {
			next.Entries[at] = entry
		} else {
			index[change.ID] = len(next.Entries)
			next.Entries = append(next.Entries, entry)
		}
	}
	if next.IndexedThroughRevision == ctx.Revision {
		next.IndexedThroughRevision = current.Revision
	}
	if err := validateLiteraryMemoryV2(&next, *state, current.Revision); err != nil {
		return err
	}
	state.LiteraryMemory = &next
	return nil
}

// This checks stored source identities, not historical review certification.
// No approval is manufactured and no candidate is applied.
func validateMemoryV2Sources(memory *LiteraryMemory, pages map[int64]ArchivePage) error {
	bad := func() error { return fail("invalid_literary_memory") }
	if memory.Version != 2 {
		return bad()
	}
	for _, entry := range memory.Entries {
		if entry.EvidenceKind == "legacy_v1" {
			legacy := entry
			legacy.EvidenceKind = ""
			if err := validateMemorySourcesAt(&LiteraryMemory{
				Version: 1, Entries: []MemoryEntry{legacy},
			}, pages); err != nil {
				return err
			}
			continue
		}
		if entry.EvidenceKind != "source_refs_v2" {
			return bad()
		}
		refs, err := memoryEntryDependencies(entry)
		if err != nil {
			return err
		}
		current := false
		for _, ref := range refs {
			revision := ref.Revision
			if ref.Kind == "authority_fact" {
				revision = ref.AsOfRevision
			}
			source, exists := pages[revision]
			if revision < 1 || !exists {
				return bad()
			}
			if source.Page.Revision != revision {
				return bad()
			}
			if ref.Kind == "formal_page" {
				if memoryPageSHA256(source.Page.Text) != ref.TextSHA256 {
					return bad()
				}
				if revision == entry.UpdatedRevision {
					current = true
					if entry.LocatorQuote != nil && (!textOK(*entry.LocatorQuote) ||
						!strings.Contains(source.Page.Text, *entry.LocatorQuote)) {
						return bad()
					}
				}
			} else {
				found := false
				for _, fact := range source.State.Facts {
					if fact.ID != ref.FactID {
						continue
					}
					if found {
						return bad()
					}
					found = true
					hash, err := memoryFactSHA256(fact)
					if err != nil || hash != ref.RecordSHA256 || fact.SourceRevision > revision {
						return bad()
					}
				}
				if !found {
					return bad()
				}
			}
		}
		if !current {
			return bad()
		}
		if entry.LegacyEntry != nil {
			if err := validateMemorySourcesAt(&LiteraryMemory{
				Version: 1, Entries: []MemoryEntry{*entry.LegacyEntry},
			}, pages); err != nil {
				return err
			}
		}
	}
	return nil
}
