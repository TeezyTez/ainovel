//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"testing"

	"elselife/backend/internal/sqlc/pgq"
)

// These synthetic records test immutable source lookup, not a model's summary
// or the credential required to create a new formal memory.
func TestMemoryV2ReadMaterialsValidatesDurableSourcesWithoutExposingThem(t *testing.T) {
	s, admin, _ := testService(t)
	ctx := context.Background()
	account := "memory-v2-selected"
	v := begin(t, s, account, "start")
	v = advance(t, s, account, v, "second", "read")
	q := pgq.New(s.DB)
	readState := func(revision int64) State {
		t.Helper()
		raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{
			AccountID: account, ExperienceID: v.ID, BranchID: v.BranchID, Revision: revision,
		})
		must(t, err)
		var state State
		must(t, json.Unmarshal(raw, &state))
		return state
	}
	first, current := readState(1), readState(2)
	originalFirst := mustJSON(t, first)
	hash, err := memoryFactSHA256(first.Facts[0])
	must(t, err)
	entry := MemoryEntry{
		MemoryChange: MemoryChange{
			ID: "source-memory", Kind: "episode", SubjectIDs: []string{"npc"}, TargetIDs: []string{},
			Cue: "the visit", Summary: "The visitor returned.", Status: "active",
			RetrievalKeys: []string{"visit"}, FactIDs: []string{first.Facts[0].ID},
		},
		EvidenceKind: "source_refs_v2", UpdatedRevision: 2,
		EvidenceRefs: []MemoryEvidenceRef{
			{Kind: "formal_page", Revision: 2, TextSHA256: memoryPageSHA256(v.Pages[1].Text)},
			{Kind: "authority_fact", FactID: first.Facts[0].ID, AsOfRevision: 1, RecordSHA256: hash},
		},
	}
	current.LiteraryMemory = &LiteraryMemory{Version: 2, IndexedThroughRevision: 2, Entries: []MemoryEntry{entry}}
	_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET state=$1
WHERE account_id=$2 AND experience_id=$3 AND branch_id=$4 AND revision=2`,
		mustJSON(t, current), account, v.ID, v.BranchID)
	must(t, err)
	reader := pinRead(t, s, account, v, "inspect", "read")
	got, err := reader.ReadMaterials(ctx, "", nil, []string{entry.ID})
	must(t, err)
	if got.LiteraryMemory == nil || got.LiteraryMemory.Version != 2 ||
		len(got.LiteraryMemory.Entries) != 1 || got.LiteraryMemory.Entries[0].EvidenceKind != "source_refs_v2" {
		t.Fatal("the selected v2 interpretation was rejected or downgraded")
	}
	if len(got.Facts) != 0 || len(got.Entities) != 0 || len(got.Threads) != 0 ||
		reader.reads != 0 || len(reader.seen) != 0 || len(reader.cursors) != 0 {
		t.Fatal("internal source checking became model-visible evidence or consumed a model read")
	}
	audit, err := q.ExperienceReadAudit(ctx, pgq.ExperienceReadAuditParams{AccountID: account, OperationID: "inspect"})
	must(t, err)
	if len(audit) != 0 {
		t.Fatal("internal validation manufactured a model read receipt")
	}
	_, err = reader.ReadMaterials(ctx, "npc", nil, []string{entry.ID})
	code(t, err, "recall_scope_mismatch")

	// SourceRevision remains unchanged: the complete record, including its
	// knowledge edges at the named as-of snapshot, is what must match.
	first.Facts[0].KnownBy = []string{}
	_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET state=$1
WHERE account_id=$2 AND experience_id=$3 AND branch_id=$4 AND revision=1`,
		mustJSON(t, first), account, v.ID, v.BranchID)
	must(t, err)
	_, err = reader.ReadMaterials(ctx, "", nil, []string{entry.ID})
	code(t, err, "recall_revision_unavailable")
	_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET state=$1
WHERE account_id=$2 AND experience_id=$3 AND branch_id=$4 AND revision=1`,
		originalFirst, account, v.ID, v.BranchID)
	must(t, err)
	_, err = reader.ReadMaterials(ctx, "", nil, []string{entry.ID})
	must(t, err)
	_, err = s.Cancel(ctx, account, v.ID, "inspect")
	must(t, err)
	_, err = reader.ReadMaterials(ctx, "", nil, []string{entry.ID})
	code(t, err, "recall_scope_mismatch")
}
