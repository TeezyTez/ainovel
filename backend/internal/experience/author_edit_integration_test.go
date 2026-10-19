//go:build integration

package experience

import (
	"context"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"reflect"
	"testing"
)

type reviewFixture struct {
	Generator
	calls int
}

func (r *reviewFixture) ReviewCandidate(_ context.Context, c Context, v Candidate) error {
	r.calls++
	_, err := Apply(c, v)
	return err
}
func TestAuthorChangesKeepOldLineAndRestoreWorldSeed(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "author", "begin")
	v = advance(t, s, "author", v, "read", "read")
	rev := v.Revision
	polish := ForkRequest{RequestID: "polish", FromBranchID: v.BranchID, FromRevision: rev, ExpectedRevision: &rev, Name: "润色", Polish: &PolishChange{Text: "雨点沿着檐角落下。"}}
	polished, err := s.Fork(ctx, "author", v.ID, polish)
	must(t, err)
	if polished.Pages[rev-1].Text != polish.Polish.Text || polished.Revision != rev {
		t.Fatal("polish did not replace last expression")
	}
	original, err := s.Get(ctx, "author", v.ID, v.BranchID)
	must(t, err)
	if !reflect.DeepEqual(original.Pages, v.Pages) {
		t.Fatal("old line changed")
	}
	before, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "author", ExperienceID: v.ID, BranchID: v.BranchID, Revision: rev})
	must(t, err)
	after, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "author", ExperienceID: v.ID, BranchID: polished.BranchID, Revision: rev})
	must(t, err)
	var a, b any
	json.Unmarshal(before, &a)
	json.Unmarshal(after, &b)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("polish changed formal facts")
	}
	version := ForkRequest{RequestID: "version", FromBranchID: polished.BranchID, FromRevision: rev, ExpectedRevision: &rev, Name: "新版规则", WorldVersion: &WorldVersionChange{ID: "world-test", Version: 2, Title: "不同展示名", PublicSeed: "世界规则：今后的信纸为蓝色。此前历史保持不变。"}}
	branched, err := s.Fork(ctx, "author", v.ID, version)
	must(t, err)
	if branched.Title != polished.Title || !reflect.DeepEqual(branched.Pages, polished.Pages) {
		t.Fatal("world version rewrote history")
	}
	seed, err := branchSeed(ctx, pgq.New(s.DB), "author", v.ID, branched.BranchID, v.Seed)
	must(t, err)
	if seed != version.WorldVersion.PublicSeed {
		t.Fatal("new branch seed absent")
	}
	oldSeed, err := branchSeed(ctx, pgq.New(s.DB), "author", v.ID, v.BranchID, v.Seed)
	must(t, err)
	if oldSeed != v.Seed {
		t.Fatal("old seed changed")
	}
	archive, err := s.ExportArchive(ctx, "author")
	must(t, err)
	raw, _ := json.Marshal(archive)
	restored, err := DecodeArchive(raw)
	must(t, err)
	_, err = s.ImportArchive(ctx, "restored-author", restored)
	must(t, err)
	restoredSeed, err := branchSeed(ctx, pgq.New(s.DB), "restored-author", v.ID, branched.BranchID, v.Seed)
	must(t, err)
	if restoredSeed != seed {
		t.Fatal("archive lost branch world")
	}
	newer := advance(t, s, "author", v, "advance-original", "read")
	retry, err := s.Fork(ctx, "author", v.ID, polish)
	must(t, err)
	if retry.BranchID != polished.BranchID {
		t.Fatal("retry duplicated branch")
	}
	stale := polish
	stale.RequestID = "stale"
	_, err = s.Fork(ctx, "author", v.ID, stale)
	code(t, err, "revision_conflict")
	if newer.Revision != rev+1 {
		t.Fatal("fixture")
	}
}
func TestAuthorRepairRequiresReviewAndReplacesOnlyLastPage(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "repair", "begin")
	rev := v.Revision
	authority, _, err := s.authorContext(ctx, "repair", v.ID, v.BranchID, rev)
	must(t, err)
	fix := initial(authority)
	fix.Passage = "修复后的开场。"
	request := ForkRequest{RequestID: "repair", FromBranchID: v.BranchID, FromRevision: rev, ExpectedRevision: &rev, Name: "修复", Repair: &RepairChange{Candidate: fix}}
	_, err = s.Fork(ctx, "repair", v.ID, request)
	code(t, err, "algorithm_unavailable")
	reviewer := &reviewFixture{Generator: s.Generator}
	s.Generator = reviewer
	result, err := s.Fork(ctx, "repair", v.ID, request)
	must(t, err)
	if reviewer.calls != 1 || result.Pages[0].Text != fix.Passage {
		t.Fatal("repair not reviewed")
	}
	archive, err := s.ExportArchive(ctx, "repair")
	must(t, err)
	raw, _ := json.Marshal(archive)
	_, err = DecodeArchive(raw)
	must(t, err)
	invalid := request
	invalid.RequestID = "invalid"
	invalid.Repair = &RepairChange{Candidate: fix}
	invalid.Repair.Candidate.NewFacts[0].SourceRevision = 9
	_, err = s.Fork(ctx, "repair", v.ID, invalid)
	code(t, err, "invalid_candidate")
}
func TestAuthorAssistHasNoWritesAndRejectsStaleResult(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "assist", "begin")
	m := &structuredOnlyModel{newtestsFeedbackModel: newtestsFeedbackModel{text: `{"text":"雨水落在门前。"}`}}
	req := AssistRequest{RequestID: "assist", BranchID: v.BranchID, ExpectedRevision: v.Revision, Kind: "polish", Request: "保持事实，只改文字"}
	result, err := s.Assist(ctx, "assist", v.ID, req, newtestsInterpreter(m))
	must(t, err)
	if result.Text == "" || m.calls != 1 {
		t.Fatal("missing proposal")
	}
	after, err := s.Get(ctx, "assist", v.ID, v.BranchID)
	must(t, err)
	if !reflect.DeepEqual(after.Pages, v.Pages) || len(after.Branches) != 1 {
		t.Fatal("assist wrote formal history")
	}
	advance(t, s, "assist", v, "advance", "read")
	_, err = s.Assist(ctx, "assist", v.ID, req, newtestsInterpreter(m))
	code(t, err, "revision_conflict")
	if m.calls != 1 {
		t.Fatal("stale assist called model")
	}
}
