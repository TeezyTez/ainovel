//go:build integration

package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestArchiveRestorePreservesBranchesRawHistoryAndHiddenState(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	original := begin(t, s, "archive-source", "begin")
	original = advance(t, s, "archive-source", original, "ask", "ask")
	fork, err := s.Fork(ctx, "archive-source", original.ID, ForkRequest{RequestID: "fork", FromBranchID: original.BranchID, FromRevision: original.Revision, Name: "另一种选择", Edit: &Edit{FactID: "known", Text: "修订分支事实"}})
	must(t, err)
	_, _, err = s.Advance(ctx, "archive-source", fork.ID, AdvanceRequest{RequestID: "pending", BranchID: fork.BranchID, ExpectedRevision: fork.Revision, Mode: "read"})
	must(t, err)
	archive, err := s.ExportArchive(ctx, "archive-source")
	must(t, err)
	raw, _ := json.Marshal(archive)
	decoded, err := DecodeArchive(raw)
	must(t, err)
	imported, err := s.ImportArchive(ctx, "archive-destination", decoded)
	must(t, err)
	if len(imported.Imported) != 1 || len(imported.Skipped) != 0 {
		t.Fatal(imported)
	}
	restored, err := s.ExportArchive(ctx, "archive-destination")
	must(t, err)
	if !reflect.DeepEqual(archive, restored) {
		t.Fatal("archive changed formal history or hidden authority")
	}
	view, err := s.Get(ctx, "archive-destination", fork.ID, fork.BranchID)
	must(t, err)
	if view.Operation != nil {
		t.Fatal("pending operation was restored")
	}
	decoded.Experiences[0].Seed = "existing must survive"
	imported, err = s.ImportArchive(ctx, "archive-destination", decoded)
	must(t, err)
	if len(imported.Imported) != 0 || len(imported.Skipped) != 1 {
		t.Fatal(imported)
	}
	unchanged, err := s.ExportArchive(ctx, "archive-destination")
	must(t, err)
	if unchanged.Experiences[0].Seed != archive.Experiences[0].Seed {
		t.Fatal("existing history overwritten")
	}
	must(t, s.DeleteExperience(ctx, "archive-destination", fork.ID))
	_, err = s.Get(ctx, "archive-destination", fork.ID, "")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted experience=%v", err)
	}
	_, err = s.Get(ctx, "archive-source", fork.ID, "")
	must(t, err)
	must(t, s.DeleteExperience(ctx, "archive-destination", fork.ID))
	imported, err = s.ImportArchive(ctx, "archive-destination", archive)
	must(t, err)
	if len(imported.Imported) != 1 {
		t.Fatal("deleted experience not restored")
	}
}
func TestDeleteFencesInFlightGenerationAndRemovesPendingGraph(t *testing.T) {
	s, db, _ := testService(t)
	ctx := context.Background()
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		close(started)
		<-release
		return initial(c), nil
	})
	v, _, err := s.Create(ctx, "delete-account", CreateRequest{RequestID: "pending", Seed: "测试种子"})
	must(t, err)
	go func() { done <- s.GenerateAccepted(ctx, "delete-account", "pending") }()
	<-started
	must(t, s.DeleteExperience(ctx, "delete-account", v.ID))
	close(release)
	if err = <-done; err == nil {
		t.Fatal("generation committed after delete")
	}
	for _, table := range []string{"experiences", "experience_branches", "experience_pages", "experience_operations", "experience_forks", "experience_reads", "experience_model_inputs"} {
		var n int
		must(t, db.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE account_id=$1", "delete-account").Scan(&n))
		if n != 0 {
			t.Fatalf("%s remains", table)
		}
	}
}
