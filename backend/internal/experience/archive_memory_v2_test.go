package experience

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"
)

// This is a synthetic archive round trip, not a historical approval receipt.
// Both page texts and the complete legacy evidence chain must survive even
// when the outer archive uses the new format version.
func archiveMemoryLegacyFixture() Archive {
	archive := archiveFixture()
	branch := &archive.Experiences[0].Branches[0]
	first := branch.Pages[0]
	second := first
	second.Page.Revision = 2
	second.Page.Mode = "read"
	second.Page.Input = ""
	second.Page.Text = "The old visitor returned.\n  These spaces stay."
	entry := MemoryEntry{
		MemoryChange: MemoryChange{
			ID: "visitor-return", Kind: "episode",
			SubjectIDs: []string{"npc"}, TargetIDs: []string{},
			Cue: "the return", Summary: "The old visitor returned.",
			Status: "resolved", RetrievalKeys: []string{"visitor"},
			FactIDs: []string{"secret"}, Quote: "The old visitor returned.",
		},
		SourceRevision: 2, UpdatedRevision: 2,
		SourceSHA256: memoryPageSHA256(second.Page.Text),
		PriorSources: []MemorySource{{
			Revision: 1, SHA256: memoryPageSHA256(first.Page.Text),
			Quote: first.Page.Text,
		}},
	}
	second.State.LiteraryMemory = &LiteraryMemory{
		Version: 1, IndexedThroughRevision: 2, Entries: []MemoryEntry{entry},
	}
	branch.Revision = 2
	branch.State = second.State
	branch.Pages = []ArchivePage{first, second}
	return archive
}

func TestArchiveMemoryV2EnvelopePreservesLegacySources(t *testing.T) {
	for _, version := range []int{1, 2} {
		t.Run(map[int]string{1: "v1", 2: "v2"}[version], func(t *testing.T) {
			original := archiveMemoryLegacyFixture()
			original.Version = version
			raw, err := json.Marshal(original)
			if err != nil {
				t.Fatal(err)
			}
			got, err := DecodeArchive(raw)
			if err != nil {
				t.Fatalf("archive version %d rejected before source round trip: %v", version, err)
			}
			if !reflect.DeepEqual(original, got) {
				t.Fatal("archive changed legacy interpretation, source chain, hidden fact, or prose")
			}
			reencoded, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			if string(reencoded) != string(raw) {
				t.Fatal("canonical round trip changed archive bytes")
			}
		})
	}
}

// Imported source refs prove only source identity inside this archive. This
// synthetic persisted fixture deliberately contains no live review approval.
func archiveMemorySourceRefsFixture(t *testing.T) Archive {
	t.Helper()
	archive := archiveMemoryLegacyFixture()
	archive.Version = 2
	branch := &archive.Experiences[0].Branches[0]
	second := &branch.Pages[1]
	second.State.Facts = append([]Fact{}, second.State.Facts...)
	second.State.Facts[0].Known = true
	third := *second
	third.Page.Revision = 3
	third.Page.Text = "The visitor kept the earlier account.\n  The source remains private."
	legacy := second.State.LiteraryMemory.Entries[0]
	factRaw, err := CanonicalReceiptJSON(branch.Pages[0].State.Facts[0])
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(factRaw)
	locator := "kept the earlier account"
	entry := MemoryEntry{
		MemoryChange: MemoryChange{
			ID: legacy.ID, Kind: legacy.Kind,
			SubjectIDs: legacy.SubjectIDs, TargetIDs: legacy.TargetIDs,
			Cue: "the retained account", Summary: "The visitor retained the earlier account.",
			Status: "resolved", RetrievalKeys: []string{"visitor", "account"},
			FactIDs: []string{"secret"},
		},
		EvidenceKind: "source_refs_v2", UpdatedRevision: 3,
		EvidenceRefs: []MemoryEvidenceRef{
			{Kind: "authority_fact", FactID: "secret", AsOfRevision: 1, RecordSHA256: hex.EncodeToString(digest[:])},
			{Kind: "formal_page", Revision: 3, TextSHA256: memoryPageSHA256(third.Page.Text)},
		},
		LocatorQuote: &locator, LegacyEntry: &legacy,
	}
	third.State.LiteraryMemory = &LiteraryMemory{
		Version: 2, IndexedThroughRevision: 3, Entries: []MemoryEntry{entry},
	}
	branch.Pages = append(branch.Pages, third)
	branch.Revision = 3
	branch.State = third.State
	return archive
}

func TestArchiveMemoryV2SourcesBindAsOfStateAndCompleteFact(t *testing.T) {
	original := archiveMemorySourceRefsFixture(t)
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeArchive(raw)
	if err != nil {
		t.Fatalf("valid persisted source-ref archive rejected: %v", err)
	}
	if !reflect.DeepEqual(original, decoded) {
		t.Fatal("source archive changed refs, locator, retained legacy entry, or snapshots")
	}
	if original.Experiences[0].Branches[0].Pages[0].State.Facts[0].Known ||
		!original.Experiences[0].Branches[0].Pages[1].State.Facts[0].Known {
		t.Fatal("fixture must distinguish fact creation revision from as-of state")
	}
	for name, mutate := range map[string]func(*ArchiveBranch){
		"same_fact_wrong_as_of": func(b *ArchiveBranch) {
			b.State.LiteraryMemory.Entries[0].EvidenceRefs[0].AsOfRevision = 2
		},
		"hash_of_current_record_at_old_revision": func(b *ArchiveBranch) {
			raw, err := CanonicalReceiptJSON(b.Pages[1].State.Facts[0])
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(raw)
			b.State.LiteraryMemory.Entries[0].EvidenceRefs[0].RecordSHA256 = hex.EncodeToString(hash[:])
		},
		"changed_known_by_only": func(b *ArchiveBranch) {
			b.Pages[0].State.Facts[0].KnownBy = []string{}
		},
		"changed_subject_only": func(b *ArchiveBranch) {
			b.Pages[0].State.Facts[0].SubjectID = "npc"
		},
		"changed_retained_legacy_page": func(b *ArchiveBranch) {
			b.Pages[0].Page.Text += " Changed."
		},
		"locator_from_another_page": func(b *ArchiveBranch) {
			locator := b.Pages[0].Page.Text
			b.State.LiteraryMemory.Entries[0].LocatorQuote = &locator
		},
		"missing_fact": func(b *ArchiveBranch) {
			b.State.LiteraryMemory.Entries[0].EvidenceRefs[0].FactID = "absent"
		},
	} {
		t.Run(name, func(t *testing.T) {
			var changed Archive
			if err := StrictJSON(raw, &changed); err != nil {
				t.Fatal(err)
			}
			branch := &changed.Experiences[0].Branches[0]
			mutate(branch)
			// Keep final State equality intact, so provenance corruption cannot
			// pass merely because another archive-shape invariant fails first.
			branch.Pages[len(branch.Pages)-1].State = branch.State
			encoded, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := DecodeArchive(encoded); err == nil {
				t.Fatal("incorrect source metadata accepted")
			}
		})
	}
}

func TestArchiveMemoryV2ValidInheritedBranchRetainsOwnSources(t *testing.T) {
	original := archiveMemorySourceRefsFixture(t)
	parent := original.Experiences[0].Branches[0]
	child := parent
	child.ID = "inherited"
	child.Name = "Inherited source history"
	parentID, revision := parent.ID, parent.Revision
	child.ParentBranchID, child.ParentRevision = &parentID, &revision
	original.Experiences[0].Branches = append(original.Experiences[0].Branches, child)
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeArchive(raw); err != nil {
		t.Fatalf("unchanged inherited history rejected: %v", err)
	}
}

func TestArchiveMemoryV2CannotHideBehindVersionOneEnvelope(t *testing.T) {
	archive := archiveMemorySourceRefsFixture(t)
	archive.Version = 1
	raw, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeArchive(raw); err == nil {
		t.Fatal("v2 stored source semantics accepted under a v1 archive envelope")
	}
}
