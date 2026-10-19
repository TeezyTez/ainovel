//go:build integration

package experience

import (
	"context"
	"testing"
)

func TestCreateUsesWorldTitleWhileOpeningAndPreservesSeed(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	const seed = "完整的公开世界设定与开场身份，不能作为等待中的书名"
	world := &WorldVersionChange{ID: "world-title", Version: 1, Title: "港口之夜", PublicSeed: seed}
	v, _, err := s.Create(ctx, "title-workspace", CreateRequest{RequestID: "world-opening", Seed: seed, WorldVersion: world})
	must(t, err)
	if v.Title != world.Title || v.Seed != seed || v.Revision != 0 {
		t.Fatalf("initial title/seed/revision changed: title=%q revision=%d", v.Title, v.Revision)
	}
	must(t, s.GenerateAccepted(ctx, "title-workspace", "world-opening"))
	v, err = s.Get(ctx, "title-workspace", v.ID, v.BranchID)
	must(t, err)
	if v.Title != "雨中的旧城" {
		t.Fatal("committed candidate did not replace initial title")
	}
	fallback, _, err := s.Create(ctx, "title-workspace", CreateRequest{RequestID: "plain-opening", Seed: seed})
	must(t, err)
	if fallback.Title != seed {
		t.Fatal("plain seed fallback changed")
	}
}

func TestExplicitReadRecoversFailedOpeningAsBegin(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	calls := 0
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		calls++
		return Candidate{}, fail("model_unavailable")
	})
	v, _, err := s.Create(ctx, "opening-recovery", CreateRequest{RequestID: "initial", Seed: "原始公开设定"})
	must(t, err)
	must(t, s.GenerateAccepted(ctx, "opening-recovery", "initial"))
	if calls != 1 {
		t.Fatal("opening retried automatically")
	}
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		calls++
		if c.Mode != "begin" || c.Revision != 0 || c.Seed != "原始公开设定" {
			t.Fatalf("explicit recovery is not a valid opening: mode=%s revision=%d", c.Mode, c.Revision)
		}
		return initial(c), nil
	})
	req := AdvanceRequest{RequestID: "explicit-recovery", BranchID: v.BranchID, ExpectedRevision: 0, Mode: "read"}
	op, fresh, err := s.Advance(ctx, "opening-recovery", v.ID, req)
	must(t, err)
	if !fresh || op.BaseRevision != 0 {
		t.Fatal("explicit recovery was not accepted")
	}
	must(t, s.GenerateAccepted(ctx, "opening-recovery", req.RequestID))
	v, err = s.Get(ctx, "opening-recovery", v.ID, v.BranchID)
	must(t, err)
	if v.Revision != 1 || len(v.Pages) != 1 || v.Pages[0].Mode != "begin" || calls != 2 {
		t.Fatal("recovery lost opening semantics")
	}
	retry, fresh, err := s.Advance(ctx, "opening-recovery", v.ID, req)
	must(t, err)
	if fresh || retry.RequestID != req.RequestID || retry.Status != "committed" {
		t.Fatal("same recovery request was not idempotent")
	}
	archive, err := s.ExportArchive(ctx, "opening-recovery")
	must(t, err)
	if len(archive.Experiences) != 1 {
		t.Fatal("recovery created another story")
	}
}
