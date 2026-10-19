//go:build integration

package experience

import (
	"context"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"strings"
	"testing"
)

func TestAuthorWorldStoredPrivatelyAndRestoredWithoutCrossScopeLeak(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	world := completeWorldDraft()
	world.Characters[0].Secret = "PRIVATE_AUTHOR_SENTINEL"
	seen := false
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		if c.AuthorWorld == nil || c.AuthorWorld.Characters[0].Secret != "PRIVATE_AUTHOR_SENTINEL" {
			t.Fatal("begin model lacks author data")
		}
		seen = true
		return initial(c), nil
	})
	v, _, err := s.Create(ctx, "private-source", CreateRequest{RequestID: "begin", Seed: "公开的港口故事", AuthorWorld: &world})
	must(t, err)
	must(t, s.GenerateAccepted(ctx, "private-source", "begin"))
	if !seen {
		t.Fatal("generator not called")
	}
	v, err = s.Get(ctx, "private-source", v.ID, v.BranchID)
	must(t, err)
	raw, _ := json.Marshal(v)
	if strings.Contains(string(raw), "PRIVATE_AUTHOR_SENTINEL") || strings.Contains(v.Seed, "PRIVATE") {
		t.Fatal("private DTO leak")
	}
	list, err := s.List(ctx, "private-source")
	must(t, err)
	raw, _ = json.Marshal(list)
	if strings.Contains(string(raw), "PRIVATE_AUTHOR_SENTINEL") {
		t.Fatal("library leak")
	}
	private, err := branchAuthorWorld(ctx, pgq.New(s.DB), "another-workspace", v.ID, v.BranchID)
	must(t, err)
	if private != nil {
		t.Fatal("cross-scope author data leak")
	}
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		if c.AuthorWorld != nil {
			t.Fatal("ask saw author secrets")
		}
		return candidate(c), nil
	})
	v = advance(t, s, "private-source", v, "ask", "ask")
	archive, err := s.ExportArchive(ctx, "private-source")
	must(t, err)
	raw, _ = json.Marshal(archive)
	if !strings.Contains(string(raw), "PRIVATE_AUTHOR_SENTINEL") {
		t.Fatal("full backup lost author data")
	}
	decoded, err := DecodeArchive(raw)
	must(t, err)
	_, err = s.ImportArchive(ctx, "private-restored", decoded)
	must(t, err)
	restored, err := branchAuthorWorld(ctx, pgq.New(s.DB), "private-restored", v.ID, v.BranchID)
	must(t, err)
	if restored == nil || restored.Characters[0].Secret != "PRIVATE_AUTHOR_SENTINEL" {
		t.Fatal("restore lost private world")
	}
	newWorld := world
	newWorld.Characters = append([]WorldCharacter{}, world.Characters...)
	newWorld.Characters[0].Secret = "SECOND_PRIVATE"
	rev := v.Revision
	branch, err := s.Fork(ctx, "private-source", v.ID, ForkRequest{RequestID: "version", FromBranchID: v.BranchID, FromRevision: rev, ExpectedRevision: &rev, Name: "V2", WorldVersion: &WorldVersionChange{ID: "world-id", Version: 2, Title: "V2", PublicSeed: "新公开设定"}, AuthorWorld: &newWorld})
	must(t, err)
	private, err = branchAuthorWorld(ctx, pgq.New(s.DB), "private-source", v.ID, branch.BranchID)
	must(t, err)
	if private.Characters[0].Secret != "SECOND_PRIVATE" {
		t.Fatal("new branch did not select author version")
	}
	old, err := branchAuthorWorld(ctx, pgq.New(s.DB), "private-source", v.ID, v.BranchID)
	must(t, err)
	if old.Characters[0].Secret != "PRIVATE_AUTHOR_SENTINEL" {
		t.Fatal("old private world overwritten")
	}
	archive, err = s.ExportArchive(ctx, "private-source")
	must(t, err)
	raw, _ = json.Marshal(archive)
	_, err = DecodeArchive(raw)
	must(t, err)
}
