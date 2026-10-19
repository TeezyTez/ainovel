//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"elselife/backend/internal/sqlc/pgq"
)

func pinRead(t *testing.T, s *Service, account string, v View, id, mode string) *sourceReader {
	t.Helper()
	ctx := context.Background()
	_, fresh, err := s.Advance(ctx, account, v.ID, AdvanceRequest{RequestID: id, BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: mode, Input: "继续"})
	must(t, err)
	if !fresh {
		t.Fatal("not fresh")
	}
	q := pgq.New(s.DB)
	op, err := q.ExperienceClaim(ctx, pgq.ExperienceClaimParams{AccountID: account, RequestID: id})
	must(t, err)
	full, err := s.buildContext(ctx, op)
	must(t, err)
	g, err := s.buildGeneration(ctx, op, full)
	must(t, err)
	n, err := q.ExperienceFreezeContext(ctx, pgq.ExperienceFreezeContextParams{AccountID: account, RequestID: id, Fence: op.Fence, Context: mustJSON(t, g)})
	must(t, err)
	if n != 1 {
		t.Fatal("not frozen")
	}
	return newSourceReader(s, op, g)
}
func readObjects(t *testing.T, r *sourceReader, id string, targets ...ReadTarget) ReadReply {
	t.Helper()
	reply, err := r.Read(context.Background(), ReadRequest{RequestID: id, SourceHandle: r.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "objects", Objects: targets}, MaxReplyBytes: 8192})
	must(t, err)
	return reply
}
func TestIsolatedPGSourceBranchAccountHistoricalReaderFenceAndRawPage(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "reader-a", "start")
	fork, err := s.Fork(ctx, "reader-a", v.ID, ForkRequest{RequestID: "fork", FromBranchID: v.BranchID, FromRevision: 1, Name: "纠错分支", Edit: &Edit{FactID: "known", Text: "分支纠错  原字\n另一句。"}})
	must(t, err)
	original := pinRead(t, s, "reader-a", v, "orig", "read")
	branch := pinRead(t, s, "reader-a", fork, "fork-read", "read")
	a := readObjects(t, original, "old", ReadTarget{Type: "fact", ID: "known"})
	b := readObjects(t, branch, "new", ReadTarget{Type: "fact", ID: "known"})
	var f1, f2 Fact
	must(t, json.Unmarshal(a.Objects[0].Body, &f1))
	must(t, json.Unmarshal(b.Objects[0].Body, &f2))
	if f1.Text == f2.Text || f2.Text != "分支纠错  原字\n另一句。" || a.BranchID == b.BranchID {
		t.Fatal("fork source overlaid", f1, f2)
	}
	_, err = branch.Read(ctx, ReadRequest{RequestID: "forged", SourceHandle: original.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: "known"}}}, MaxReplyBytes: 8192})
	code(t, err, "recall_scope_mismatch")
	// Account B has identical stable object IDs, but no shared source capability.
	vB := begin(t, s, "reader-b", "start")
	other := pinRead(t, s, "reader-b", vB, "other", "read")
	_, err = other.Read(ctx, ReadRequest{RequestID: "forged-account", SourceHandle: original.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: "known"}}}, MaxReplyBytes: 8192})
	code(t, err, "recall_scope_mismatch")
	one := int64(1)
	page, err := original.Read(ctx, ReadRequest{RequestID: "raw-page", SourceHandle: original.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "pages", FromRevision: &one, ToRevision: &one}, MaxReplyBytes: 8192})
	must(t, err)
	if len(page.Pages) != 1 || page.Pages[0].Text != v.Pages[0].Text || !page.Complete {
		t.Fatal("raw formal source changed")
	}
	queryHash, err := receiptHash(ReadRequest{RequestID: "raw-page", SourceHandle: original.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "pages", FromRevision: &one, ToRevision: &one}, MaxReplyBytes: 8192})
	must(t, err)
	bodyHash, err := replyBodyHash(page)
	must(t, err)
	if queryHash != page.Receipt.QuerySHA256 || bodyHash != page.Receipt.BodySHA256 {
		t.Fatal("receipt recipe mismatch")
	}
	_, err = s.Cancel(ctx, "reader-a", v.ID, "orig")
	must(t, err)
	_, err = original.Read(ctx, ReadRequest{RequestID: "late", SourceHandle: original.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "pages", FromRevision: &one, ToRevision: &one}, MaxReplyBytes: 8192})
	code(t, err, "recall_scope_mismatch")
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		v := candidate(c)
		v.RevealFactIDs = []string{"hidden"}
		return v, nil
	})
	v = advance(t, s, "reader-a", v, "reveal", "read")
	reader := pinRead(t, s, "reader-a", v, "ask", "ask")
	if reader.generation.StateCoverage.Total.Facts != 2 || reader.generation.StateCoverage.Audience != "reader" {
		t.Fatal("reader leaked author counts")
	}
	past := readObjects(t, reader, "past-hidden", ReadTarget{Type: "fact", ID: "hidden", AtRevision: &one})
	absent := readObjects(t, reader, "absent", ReadTarget{Type: "fact", ID: "never-existed", AtRevision: &one})
	now := readObjects(t, reader, "now-known", ReadTarget{Type: "fact", ID: "hidden"})
	if len(past.Objects) != 0 || len(absent.Objects) != 0 || len(now.Objects) != 1 || !past.Complete || !absent.Complete {
		t.Fatal("current knowledge crossed into historical reader source")
	}
	if strings.Contains(string(mustJSON(t, past)), "门后有暗井") {
		t.Fatal("hidden raw body leaked")
	}
}
func TestIsolatedPGLiteralPaginationBudgetAndOmittedIdentityRemainBinding(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	var err error
	v := bootstrapOldState(t, s, "pagination")
	s.MaxContextBytes = 9000
	s.RecentRevisions = 2
	s.ReadLimits = ReadBudget{MaxReads: 64, MaxReplyBytes: 8192, MaxTotalReplyBytes: 200000}
	r := pinRead(t, s, "pagination", v, "pages", "read")
	if r.generation.StateCoverage.Omitted.Facts != 80 {
		t.Fatal("fixture is not heldout partialstate")
	}
	cursor := ""
	seen := []string{}
	for seq := 1; seq <= 64; seq++ {
		one := int64(1)
		req := ReadRequest{RequestID: fmt.Sprintf("enumerate-%d", seq), SourceHandle: r.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "enumerate", Type: "fact", FactKind: "fact", Terms: []string{"中文", "早期承诺"}, Match: "all", FromSourceRevision: &one, ToSourceRevision: &one, Cursor: cursor}, MaxReplyBytes: 6500}
		got, err := r.Read(ctx, req)
		must(t, err)
		for _, obj := range got.Objects {
			seen = append(seen, objectID(obj))
		}
		if got.Complete {
			if got.NextCursor != nil {
				t.Fatal("complete but cursor")
			}
			break
		}
		if got.NextCursor == nil || len(got.Objects) == 0 {
			t.Fatal("incomplete without literal continuation")
		}
		cursor = *got.NextCursor
	}
	if len(seen) != 80 {
		t.Fatal("literal predicate was not completely enumerated", len(seen))
	}
	for i, id := range seen {
		if id != fmt.Sprintf("old-%03d", i) {
			t.Fatal("unstable typed-ID order", i, id)
		}
	}
	_, err = r.Read(ctx, ReadRequest{RequestID: "cursor-wrong-query", SourceHandle: r.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "enumerate", Type: "entity", Cursor: cursor}, MaxReplyBytes: 8192})
	code(t, err, "recall_scope_mismatch")
	_, err = r.Read(ctx, ReadRequest{RequestID: "tiny", SourceHandle: r.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: "old-000"}}}, MaxReplyBytes: 400})
	code(t, err, "recall_item_capacity")
	_, err = s.Cancel(ctx, "pagination", v.ID, "pages")
	must(t, err)
	// A candidate may NOT overwrite an omitted identity merely because the
	// generator's finite view did not contain its body. Apply uses full authority.
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		if len(c.State.Facts) != 0 {
			t.Fatal("not exercising omitted ID")
		}
		result := candidate(c)
		result.NewFacts = []Fact{{ID: "old-079", Kind: "fact", Text: "冒充新事实", Known: true, KnownBy: []string{}, SourceRevision: c.Revision + 1}}
		return result, nil
	})
	_, _, err = s.Advance(ctx, "pagination", v.ID, AdvanceRequest{RequestID: "collision", BranchID: v.BranchID, ExpectedRevision: 20, Mode: "read", Input: "继续"})
	must(t, err)
	must(t, s.GenerateAccepted(ctx, "pagination", "collision"))
	op, err := s.GetOperation(ctx, "pagination", v.ID, "collision")
	must(t, err)
	if op.Status != "failed" || op.ErrorCode == nil || *op.ErrorCode != "invalid_candidate" {
		t.Fatal("omitted ID was reused", op)
	}
	after, err := s.Get(ctx, "pagination", v.ID, v.BranchID)
	must(t, err)
	if after.Revision != 20 || len(after.Pages) != 20 {
		t.Fatal("rejected partial candidate became history")
	}
	fork, err := s.Fork(ctx, "pagination", v.ID, ForkRequest{RequestID: "edit-old", FromBranchID: v.BranchID, FromRevision: 20, Name: "旧事实刚纠错", Edit: &Edit{FactID: "old-079", Text: "B是当前分支纠错  原字。"}})
	must(t, err)
	edited := pinRead(t, s, "pagination", fork, "edited-no-name", "read")
	if len(edited.generation.State.Facts) != 1 || edited.generation.State.Facts[0].ID != "old-079" || edited.generation.State.Facts[0].Text != "B是当前分支纠错  原字。" || edited.generation.State.Facts[0].SourceRevision != 1 {
		t.Fatal("new branch edit of old-source fact omitted without literal input", edited.generation.State.Facts)
	}
}
