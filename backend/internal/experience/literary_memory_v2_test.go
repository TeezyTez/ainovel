package experience

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"elselife/backend/internal/capability/model"
	"google.golang.org/protobuf/proto"
)

// Synthetic JSON tests exercise the canonical boundary and source identity.
// They do not certify summaries or substitute for a live approval.
func memoryV2InterpretationJSON() map[string]any {
	return map[string]any{
		"id": "promise", "kind": "commitment", "subject_ids": []string{"lin"},
		"target_ids": []string{"chen"}, "cue": "the promised visit",
		"summary": "Lin fulfilled the earlier promise.", "status": "resolved",
		"retrieval_keys": []string{"visit"}, "fact_ids": []string{},
	}
}

func memoryV2CandidateJSON(t *testing.T, entries []any) []byte {
	t.Helper()
	base, err := json.Marshal(memoryCandidate(t))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(base, &value); err != nil {
		t.Fatal(err)
	}
	delete(value, "memory_changes")
	value["memory_delta"] = map[string]any{"version": 2, "entries": entries}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func memoryV2EntryJSON() map[string]any {
	value := memoryV2InterpretationJSON()
	value["evidence_kind"] = "source_refs_v2"
	value["updated_revision"] = int64(4)
	value["evidence_refs"] = []any{
		map[string]any{"kind": "formal_page", "revision": 4, "text_sha256": strings.Repeat("a", 64)},
		map[string]any{"kind": "formal_page", "revision": 1, "text_sha256": strings.Repeat("b", 64)},
		map[string]any{"kind": "authority_fact", "fact_id": "private", "as_of_revision": 2, "record_sha256": strings.Repeat("c", 64)},
	}
	return value
}

func decodeMemoryV2Entry(t *testing.T, value map[string]any) MemoryEntry {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var entry MemoryEntry
	if err := StrictJSON(raw, &entry); err != nil {
		t.Fatalf("valid source-ref entry rejected: %v", err)
	}
	return entry
}

func TestMemoryV2CandidateCanonicalRoundTripPreservesEmptyAndAbsent(t *testing.T) {
	for _, entries := range [][]any{{}, {memoryV2InterpretationJSON()}} {
		raw := memoryV2CandidateJSON(t, entries)
		candidate, err := DecodeCandidate(raw)
		if err != nil {
			t.Fatalf("valid memory delta rejected: %v", err)
		}
		encoded, err := json.Marshal(candidate)
		if err != nil {
			t.Fatal(err)
		}
		var before, after map[string]any
		_ = json.Unmarshal(raw, &before)
		_ = json.Unmarshal(encoded, &after)
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("canonical round trip changed presence: before=%s after=%s", raw, encoded)
		}
		if _, err := DecodeCandidate(encoded); err != nil {
			t.Fatal(err)
		}
	}
	legacy := memoryCandidate(t)
	legacy.MemoryChanges = nil
	raw, _ := json.Marshal(legacy)
	if strings.Contains(string(raw), "memory_delta") || strings.Contains(string(raw), "memory_changes") {
		t.Fatal("absent legacy extraction gained a memory inspection claim")
	}
}

func TestMemoryV2CandidateRejectsNullMixedAndModelAuthority(t *testing.T) {
	var base map[string]any
	_ = json.Unmarshal(memoryV2CandidateJSON(t, []any{}), &base)
	for name, mutate := range map[string]func(map[string]any){
		"null_delta":        func(v map[string]any) { v["memory_delta"] = nil },
		"empty_old_present": func(v map[string]any) { v["memory_changes"] = []any{} },
		"null_old_present":  func(v map[string]any) { v["memory_changes"] = nil },
		"unknown_version":   func(v map[string]any) { v["memory_delta"].(map[string]any)["version"] = 3 },
		"null_entries":      func(v map[string]any) { v["memory_delta"].(map[string]any)["entries"] = nil },
		"null_locator": func(v map[string]any) {
			entry := memoryV2InterpretationJSON()
			entry["locator_quote"] = nil
			v["memory_delta"].(map[string]any)["entries"] = []any{entry}
		},
		"forged_hash": func(v map[string]any) {
			entry := memoryV2InterpretationJSON()
			entry["source_sha256"] = strings.Repeat("a", 64)
			v["memory_delta"].(map[string]any)["entries"] = []any{entry}
		},
		"forged_audience": func(v map[string]any) {
			entry := memoryV2InterpretationJSON()
			entry["known_by"] = []string{"chen"}
			v["memory_delta"].(map[string]any)["entries"] = []any{entry}
		},
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(base)
			var value map[string]any
			_ = json.Unmarshal(raw, &value)
			mutate(value)
			raw, _ = json.Marshal(value)
			if _, err := DecodeCandidate(raw); err == nil {
				t.Fatal("invalid memory delta accepted")
			}
		})
	}
	raw := memoryV2CandidateJSON(t, []any{})
	raw = []byte(strings.Replace(string(raw), `"version":2`, `"version":2,"version":2`, 1))
	if _, err := DecodeCandidate(raw); err == nil {
		t.Fatal("duplicate version accepted")
	}
}

func TestMemoryV2StateRoundTripDoesNotInventLegacyFields(t *testing.T) {
	raw, _ := json.Marshal(memoryV2EntryJSON())
	entry := decodeMemoryV2Entry(t, memoryV2EntryJSON())
	encoded, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	var before, after map[string]any
	_ = json.Unmarshal(raw, &before)
	_ = json.Unmarshal(encoded, &after)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("source refs gained old quote/hash fields: before=%s after=%s", raw, encoded)
	}
	memory := &LiteraryMemory{Version: 2, IndexedThroughRevision: 4, Entries: []MemoryEntry{entry}}
	if err := validateLiteraryMemoryState(memory, memoryFixture(), 4); err != nil {
		t.Fatal("valid v2 stored state rejected", err)
	}
}

func TestMemoryV2LegacyVariantRetainsWholeOriginalEntry(t *testing.T) {
	old := MemoryEntry{
		MemoryChange: memoryChange(), SourceRevision: 3,
		SourceSHA256: strings.Repeat("a", 64), UpdatedRevision: 3,
		PriorSources: []MemorySource{{Revision: 1, SHA256: strings.Repeat("b", 64), Quote: "The old condition."}},
	}
	old.FactIDs = []string{"private"}
	raw, _ := json.Marshal(old)
	var legacy map[string]any
	_ = json.Unmarshal(raw, &legacy)
	legacy["evidence_kind"] = "legacy_v1"
	entry := decodeMemoryV2Entry(t, legacy)
	encoded, _ := json.Marshal(entry)
	var actual map[string]any
	_ = json.Unmarshal(encoded, &actual)
	delete(actual, "evidence_kind")
	var expected map[string]any
	_ = json.Unmarshal(raw, &expected)
	if !reflect.DeepEqual(expected, actual) {
		t.Fatal("legacy conversion replaced original fields or invented fact evidence")
	}
	if err := validateLiteraryMemoryState(
		&LiteraryMemory{Version: 2, IndexedThroughRevision: 3, Entries: []MemoryEntry{entry}},
		memoryFixture(), 3,
	); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryV2InvalidStoredReferencesFailClosed(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"candidate_ref": func(v map[string]any) { v["evidence_refs"].([]any)[0].(map[string]any)["kind"] = "candidate" },
		"mixed_ref":     func(v map[string]any) { v["evidence_refs"].([]any)[0].(map[string]any)["fact_id"] = "private" },
		"future_fact":   func(v map[string]any) { v["evidence_refs"].([]any)[2].(map[string]any)["as_of_revision"] = 5 },
		"no_current_page": func(v map[string]any) {
			v["evidence_refs"] = v["evidence_refs"].([]any)[1:]
		},
		"duplicate_identity_wrong_hash": func(v map[string]any) {
			v["evidence_refs"] = append(v["evidence_refs"].([]any),
				map[string]any{"kind": "formal_page", "revision": 4, "text_sha256": strings.Repeat("d", 64)})
		},
		"null_locator": func(v map[string]any) { v["locator_quote"] = nil },
		"old_quote":    func(v map[string]any) { v["quote"] = "not a v2 field" },
		"recursive_legacy": func(v map[string]any) {
			v["legacy_entry"] = memoryV2EntryJSON()
		},
	} {
		t.Run(name, func(t *testing.T) {
			value := memoryV2EntryJSON()
			mutate(value)
			raw, _ := json.Marshal(value)
			var entry MemoryEntry
			if err := StrictJSON(raw, &entry); err != nil {
				return
			}
			memory := &LiteraryMemory{Version: 2, IndexedThroughRevision: 4, Entries: []MemoryEntry{entry}}
			if validateLiteraryMemoryState(memory, memoryFixture(), 4) == nil {
				t.Fatal("invalid v2 source identity survived both decoding and state validation")
			}
		})
	}
}

func TestMemoryV2ApplyRequiresApprovalIncludingEmptyDeltaAndAsk(t *testing.T) {
	before := memoryFixture()
	original, _ := json.Marshal(before)
	for _, mode := range []string{"read", "ask"} {
		for _, entries := range [][]any{{}, {memoryV2InterpretationJSON()}} {
			candidate, err := DecodeCandidate(memoryV2CandidateJSON(t, entries))
			if err != nil {
				t.Fatalf("valid delta must decode before authority is checked: %v", err)
			}
			if _, err := Apply(Context{Revision: 1, Mode: mode, State: before}, candidate); err == nil {
				t.Fatalf("%s accepted a v2 delta without a Go approval", mode)
			}
		}
	}
	after, _ := json.Marshal(before)
	if string(original) != string(after) {
		t.Fatal("failed v2 apply mutated the original snapshot")
	}
}

func TestMemoryV2EditInvalidatesPageFactVersionAndRetainedLegacySources(t *testing.T) {
	for _, edited := range []int64{1, 2, 4} {
		entry := decodeMemoryV2Entry(t, memoryV2EntryJSON())
		state := memoryFixture()
		state.LiteraryMemory = &LiteraryMemory{Version: 2, IndexedThroughRevision: 4, Entries: []MemoryEntry{entry}}
		retained := state.LiteraryMemory
		parent, _ := json.Marshal(retained)
		invalidateLiteraryForEdit(&state, edited, false)
		if len(state.LiteraryMemory.Entries) != 0 || state.LiteraryMemory.IndexedThroughRevision != edited-1 {
			t.Fatalf("edit at dependency revision %d retained the derived entry", edited)
		}
		after, _ := json.Marshal(retained)
		if string(after) != string(parent) {
			t.Fatal("the parent snapshot was mutated")
		}
	}
	entry := memoryV2EntryJSON()
	old := MemoryEntry{MemoryChange: memoryChange(), SourceRevision: 3,
		SourceSHA256: strings.Repeat("e", 64), UpdatedRevision: 3,
		PriorSources: []MemorySource{{Revision: 1, SHA256: strings.Repeat("b", 64), Quote: "Old condition."}}}
	entry["legacy_entry"] = old
	state := memoryFixture()
	state.LiteraryMemory = &LiteraryMemory{Version: 2, IndexedThroughRevision: 4,
		Entries: []MemoryEntry{decodeMemoryV2Entry(t, entry)}}
	invalidateLiteraryForEdit(&state, 3, false)
	if len(state.LiteraryMemory.Entries) != 0 {
		t.Fatal("a retained legacy source escaped edit invalidation")
	}
}

func TestMemoryV2DependenciesRetainLegacyPagesWithoutCertifyingOldFactIDs(t *testing.T) {
	legacy := MemoryEntry{MemoryChange: memoryChange(), SourceRevision: 3,
		SourceSHA256: strings.Repeat("a", 64), UpdatedRevision: 3,
		PriorSources: []MemorySource{{Revision: 1, SHA256: strings.Repeat("b", 64), Quote: "Original condition."}}}
	legacy.FactIDs = []string{"private"}
	dependencies, err := memoryEntryDependencies(legacy)
	if err != nil || len(dependencies) != 2 {
		t.Fatal("legacy page dependencies were lost", dependencies, err)
	}
	for _, source := range dependencies {
		if source.Kind != "formal_page" {
			t.Fatal("old fact_ids gained a fabricated record version/hash")
		}
	}
	if latestMemoryRevision(legacy) != 3 {
		t.Fatal("legacy update location changed")
	}
	value := memoryV2EntryJSON()
	value["legacy_entry"] = legacy
	entry := decodeMemoryV2Entry(t, value)
	dependencies, err = memoryEntryDependencies(entry)
	if err != nil || len(dependencies) != 4 || latestMemoryRevision(entry) != 4 {
		t.Fatal("v2 cumulative dependency set is incomplete", dependencies, err)
	}
	// The one fact ref was explicitly in the new durable data; the legacy fact
	// ID did not create another (or a differently versioned) record reference.
	facts := 0
	for _, source := range dependencies {
		if source.Kind == "authority_fact" {
			facts++
			if source.FactID != "private" || source.AsOfRevision != 2 {
				t.Fatal("fact dependency was rebound")
			}
		}
	}
	if facts != 1 {
		t.Fatal("legacy fact hints were treated as certified evidence")
	}
}

func TestMemoryV2ArchiveSourcesUseExactFactAsOfAndFullKnownByRecord(t *testing.T) {
	early := memoryFixture()
	later := memoryFixture()
	later.Facts[0].KnownBy = []string{"lin", "chen"}
	hash, err := receiptHash(early.Facts[0])
	if err != nil {
		t.Fatal(err)
	}
	text := "Lin returned after the promised visit."
	value := memoryV2InterpretationJSON()
	value["evidence_kind"] = "source_refs_v2"
	value["updated_revision"] = 3
	value["locator_quote"] = "returned"
	value["evidence_refs"] = []any{
		map[string]any{"kind": "formal_page", "revision": 3, "text_sha256": memoryPageSHA256(text)},
		map[string]any{"kind": "authority_fact", "fact_id": "private", "as_of_revision": 1, "record_sha256": hash},
	}
	entry := decodeMemoryV2Entry(t, value)
	memory := &LiteraryMemory{Version: 2, IndexedThroughRevision: 3, Entries: []MemoryEntry{entry}}
	pages := []ArchivePage{
		{Page: Page{HistoryPage: HistoryPage{Revision: 1, Text: "Earlier."}}, State: early},
		{Page: Page{HistoryPage: HistoryPage{Revision: 2, Text: "Later."}}, State: later},
		{Page: Page{HistoryPage: HistoryPage{Revision: 3, Text: text}}, State: later},
	}
	if err := validateMemorySources(memory, pages); err != nil {
		t.Fatal("exact original fact record rejected", err)
	}
	if err := validateMemorySourcesAt(memory, map[int64]ArchivePage{1: pages[0], 3: pages[2]}); err != nil {
		t.Fatal("sparse exact dependency set was rejected", err)
	}
	if validateMemorySourcesAt(memory, map[int64]ArchivePage{3: pages[2]}) == nil {
		t.Fatal("a missing old as-of snapshot was treated as loaded")
	}
	for name, mutate := range map[string]func(*LiteraryMemory, []ArchivePage){
		"other_as_of_same_source_revision": func(m *LiteraryMemory, p []ArchivePage) {
			m.Entries[0].EvidenceRefs[1].AsOfRevision = 2
		},
		"known_by_changed_in_original_snapshot": func(m *LiteraryMemory, p []ArchivePage) {
			p[0].State.Facts = append([]Fact{}, p[0].State.Facts...)
			p[0].State.Facts[0].KnownBy = []string{"lin", "chen"}
		},
		"other_branch_page": func(m *LiteraryMemory, p []ArchivePage) { p[2].Page.Text = "No visit." },
		"wrong_locator": func(m *LiteraryMemory, p []ArchivePage) {
			quote := "no such action"
			m.Entries[0].LocatorQuote = &quote
		},
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(memory)
			var changed LiteraryMemory
			if err := json.Unmarshal(raw, &changed); err != nil {
				t.Fatal(err)
			}
			copyPages := append([]ArchivePage{}, pages...)
			mutate(&changed, copyPages)
			if validateMemorySources(&changed, copyPages) == nil {
				t.Fatal("rebound page/fact/locator was accepted")
			}
		})
	}
}

// Construct a fixed review through the actual request compiler, private
// credential binder and resolver. This is not a semantic model approval and
// does not skip the checks used by applyLiteraryMemoryV2.
func memoryV2ApprovedLegacyUpdate(t *testing.T, empty bool) (*narrativeRun, Candidate, MemoryEntry) {
	t.Helper()
	p, call := memoryEvidenceCallFixture(t)
	old := MemoryEntry{MemoryChange: MemoryChange{
		ID: "returned", Kind: "episode", SubjectIDs: []string{"speaker"}, TargetIDs: []string{},
		Cue: "old return", Summary: "Earlier return.", Status: "active", RetrievalKeys: []string{"book"},
		FactIDs: []string{"compound"}, Quote: "Previous return.",
	}, SourceRevision: 2, SourceSHA256: memoryPageSHA256("Previous return."), UpdatedRevision: 2,
		PriorSources: []MemorySource{{Revision: 1, SHA256: memoryPageSHA256("First return."), Quote: "First return."}}}
	untouched := old
	untouched.ID = "untouched"
	p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{
		Version: 1, IndexedThroughRevision: 2, Entries: []MemoryEntry{old, untouched},
	}
	p.context.History = []HistoryPage{
		{Revision: 1, Mode: "read", Text: "First return."},
		{Revision: 2, Mode: "read", Text: "Previous return."},
	}
	var c Candidate
	if err := StrictJSON(p.extracted, &c); err != nil {
		t.Fatal(err)
	}
	if empty {
		c.MemoryDelta.Entries = []MemoryInterpretation{}
	}
	p.extracted, _ = canonicalCandidate(c)
	call.Messages[1].Content = string(narrativeMarshal(map[string]any{
		"context": reviewHydrationWireContext(p.context, p.context.State), "candidate": c,
	}))
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	p.evidenceOrigin = &narrativeEvidenceOrigin{Kind: "operation", ID: "request", ExperienceID: p.context.ExperienceID,
		BranchID: p.context.BranchID, BaseRevision: p.context.Revision, BaseFence: 5,
		SourceHandle: p.context.StateCoverage.SourceHandle, Pin: memoryPageSHA256("fixed test configuration")}
	request := model.Request{Model: "fixture", Schema: json.RawMessage(call.SchemaJson), MaxOutputTokens: 8192}
	for _, message := range call.Messages {
		request.Messages = append(request.Messages, model.Message{Role: message.Role, Content: message.Content})
	}
	raw, err := proto.Marshal(call)
	if err != nil {
		t.Fatal(err)
	}
	if err = p.bindMemoryEvidenceRequest(7, raw, request); err != nil {
		t.Fatal(err)
	}
	if err = StrictJSON(p.reviewed, &c); err != nil {
		t.Fatal(err)
	}
	supports := []NarrativeMemorySupport{}
	for _, entry := range c.MemoryDelta.Entries {
		selected := []string{}
		for _, source := range p.evidenceCall.Registry.Sources {
			if source.Kind == "candidate" || source.Kind == "formal_page" && source.Revision == 2 {
				selected = append(selected, source.ID)
			}
		}
		supports = append(supports, NarrativeMemorySupport{MemoryID: entry.ID, SourceIDs: selected})
	}
	c.Review = &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: p.reviewed, Evidence: p.evidenceCall,
		Result: NarrativeReview{Approved: true, RepairScope: "none", Issues: []NarrativeIssue{},
			Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}, MemorySupports: supports}}
	resolved, err := resolveMemoryEvidence(c, c.Review)
	if err != nil {
		t.Fatal(err)
	}
	c.Review.Evidence.Resolved = resolved
	return p, c, old
}

func TestMemoryV2ApprovedApplyRetainsLegacyAndCumulativeSources(t *testing.T) {
	p, candidate, old := memoryV2ApprovedLegacyUpdate(t, false)
	state := *p.context.AuthorityState
	before, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err = applyLiteraryMemoryV2(p.context, candidate, &state); err != nil {
		t.Fatal("bound approval could not produce a v2 index", err)
	}
	memory := state.LiteraryMemory
	if memory.Version != 2 || memory.IndexedThroughRevision != 3 || len(memory.Entries) != 2 {
		t.Fatal("index shape or contiguous coverage changed incorrectly", memory)
	}
	updated := memory.Entries[0]
	if updated.EvidenceKind != "source_refs_v2" || updated.LegacyEntry == nil ||
		updated.UpdatedRevision != 3 || updated.Quote != "" || updated.SourceSHA256 != "" {
		t.Fatal("updated entry mixed legacy and v2 source authority", updated)
	}
	wantLegacy, _ := json.Marshal(old)
	gotLegacy, _ := json.Marshal(updated.LegacyEntry)
	if string(wantLegacy) != string(gotLegacy) {
		t.Fatal("the original legacy entry was reconstructed or changed")
	}
	refs, err := memoryEntryDependencies(updated)
	if err != nil || len(refs) != 3 {
		t.Fatal("complete cumulative page dependencies were lost", refs, err)
	}
	for _, ref := range refs {
		if ref.Kind != "formal_page" {
			t.Fatal("legacy fact_ids manufactured certified fact sources")
		}
	}
	if memory.Entries[1].EvidenceKind != "legacy_v1" || memory.Entries[1].Quote != old.Quote {
		t.Fatal("untouched legacy entry was silently upgraded")
	}
	after, _ := json.Marshal(p.context.AuthorityState)
	if string(before) != string(after) {
		t.Fatal("v2 application mutated the retained authority snapshot")
	}
}

func TestMemoryV2ApprovedEmptyDeltaPreservesLegacyAndHistoricalGap(t *testing.T) {
	p, candidate, old := memoryV2ApprovedLegacyUpdate(t, true)
	// Coverage is not a source credential; the actual older history remains
	// unchanged and this new inspected page cannot fill an uninspected prefix.
	p.context.AuthorityState.LiteraryMemory.IndexedThroughRevision = 0
	state := *p.context.AuthorityState
	if err := applyLiteraryMemoryV2(p.context, candidate, &state); err != nil {
		t.Fatal(err)
	}
	memory := state.LiteraryMemory
	if memory.Version != 2 || memory.IndexedThroughRevision != 0 || len(memory.Entries) != 2 ||
		memory.Entries[0].EvidenceKind != "legacy_v1" || memory.Entries[0].Quote != old.Quote {
		t.Fatal("empty inspected delta fabricated coverage or re-certified old entries")
	}
}
