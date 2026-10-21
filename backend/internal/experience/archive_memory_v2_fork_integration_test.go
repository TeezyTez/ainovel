//go:build integration

package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

// This synthetic persisted archive has verifiable sources, not a certificate
// that a historical live reviewer read or approved them.
func TestArchiveMemoryV2ServiceForkPolishInvalidatesOnlyEditedBranch(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	const account = "v2-fork-polish"
	_, err := s.ImportArchive(ctx, account, archiveMemorySourceRefsFixture(t))
	must(t, err)
	before, err := s.ExportArchive(ctx, account)
	must(t, err)
	experience := before.Experiences[0]
	parent := experience.Branches[0]
	inherited, err := s.Fork(ctx, account, experience.ID, ForkRequest{
		RequestID: "inherit", FromBranchID: parent.ID,
		FromRevision: parent.Revision, Name: "Unchanged inherited history",
	})
	must(t, err)
	revision := inherited.Revision
	const replacement = "The visitor closed the ledger without speaking."
	polished, err := s.Fork(ctx, account, experience.ID, ForkRequest{
		RequestID: "polish", FromBranchID: inherited.BranchID,
		FromRevision: revision, ExpectedRevision: &revision, Name: "Edited last expression",
		Polish: &PolishChange{Text: replacement},
	})
	must(t, err)
	after, err := s.ExportArchive(ctx, account)
	must(t, err)
	if after.Version != 2 || len(after.Experiences) != 1 || len(after.Experiences[0].Branches) != 3 {
		t.Fatal("fork/polish changed archive version or lost a branch")
	}
	branches := map[string]ArchiveBranch{}
	for _, branch := range after.Experiences[0].Branches {
		branches[branch.ID] = branch
	}
	for _, id := range []string{parent.ID, inherited.BranchID} {
		branch, exists := branches[id]
		if !exists || branch.Revision != parent.Revision ||
			!reflect.DeepEqual(branch.State, parent.State) || !reflect.DeepEqual(branch.Pages, parent.Pages) {
			t.Fatal("polish changed parent or ordinary inherited history, including old source dependencies")
		}
	}
	edited, exists := branches[polished.BranchID]
	if !exists || edited.Revision != parent.Revision || len(edited.Pages) != len(parent.Pages) {
		t.Fatal("polish changed formal page count or revision")
	}
	last := len(edited.Pages) - 1
	if edited.Pages[last].Page.Text != replacement || !reflect.DeepEqual(edited.Pages[:last], parent.Pages[:last]) {
		t.Fatal("polish failed to replace only the chosen page or rewrote earlier legacy sources")
	}
	expectedState := parent.State
	expectedState.LiteraryMemory = &LiteraryMemory{
		Version: 2, IndexedThroughRevision: parent.Revision - 1, Entries: []MemoryEntry{},
	}
	if !reflect.DeepEqual(edited.State, expectedState) || !reflect.DeepEqual(edited.Pages[last].State, expectedState) {
		t.Fatal("edited branch retained an invalid source-ref entry or changed other world authority")
	}
	raw, err := json.Marshal(after)
	must(t, err)
	decoded, err := DecodeArchive(raw)
	must(t, err)
	encoded, err := json.Marshal(decoded)
	must(t, err)
	if !bytes.Equal(raw, encoded) {
		t.Fatal("export/decode changed the surviving v2 or retained legacy sources")
	}
}
