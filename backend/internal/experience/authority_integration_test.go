//go:build integration

package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"elselife/backend/internal/platform/database"
	"elselife/backend/internal/platform/testpostgres"
	"elselife/backend/internal/sqlc/pgq"
	"elselife/backend/schema"
)

type generateFunc func(context.Context, Context, string) (Candidate, error)

func (f generateFunc) Generate(ctx context.Context, c Context, id string) (Candidate, error) {
	return f(ctx, c, id)
}
func candidate(c Context) Candidate {
	return Candidate{Title: "雨中的旧城", Passage: "雨落在青石上。\n「别走。」她说。\n\n  原字空格…", StoryTime: c.State.StoryTime, Outcome: "awaits_player", Suggestions: []string{"走近看看"}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{}, ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{}}
}
func initial(c Context) Candidate {
	v := candidate(c)
	v.StoryTime = "暮色"
	v.NewEntities = []Entity{{ID: "npc", Kind: "person", Name: "阿禾", Description: "守门人", Known: true, RelatedIDs: []string{"hidden"}}}
	v.NewFacts = []Fact{{ID: "known", Kind: "statement", Text: "她声称门外安全", SubjectID: "npc", Known: true, KnownBy: []string{"npc"}, SourceRevision: 1}, {ID: "hidden", Kind: "secret", Text: "门后有暗井", SubjectID: "", Known: false, KnownBy: []string{"npc"}, SourceRevision: 1}}
	return v
}
func testService(t *testing.T) (*Service, *sql.DB, string) {
	t.Helper()
	ctx := context.Background()
	dsn := testpostgres.New(t).DSN()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	if err = schema.ApplyEmpty(ctx, admin); err != nil {
		t.Fatal(err)
	}
	db, err := database.OpenServing(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return &Service{DB: db, Generator: generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		if c.Revision == 0 {
			return initial(c), nil
		}
		return candidate(c), nil
	})}, admin, dsn
}
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != want {
		t.Fatalf("error=%v want=%s", err, want)
	}
}
func begin(t *testing.T, s *Service, a, r string) View {
	t.Helper()
	v, f, err := s.Create(context.Background(), a, CreateRequest{RequestID: r, Seed: "连续的中文世界\n原始设定"})
	must(t, err)
	if !f {
		t.Fatal("not fresh")
	}
	must(t, s.GenerateAccepted(context.Background(), a, r))
	v, err = s.Get(context.Background(), a, v.ID, v.BranchID)
	must(t, err)
	return v
}
func advance(t *testing.T, s *Service, a string, v View, r, mode string) View {
	t.Helper()
	_, f, err := s.Advance(context.Background(), a, v.ID, AdvanceRequest{RequestID: r, BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: mode, Input: "我想弄清这件事。\n不省略。"})
	must(t, err)
	if !f {
		t.Fatal("not fresh")
	}
	must(t, s.GenerateAccepted(context.Background(), a, r))
	v, err = s.Get(context.Background(), a, v.ID, v.BranchID)
	must(t, err)
	return v
}
func TestAuthorityConcurrentIdempotencyIsolationAndFormalText(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	var accepted, calls atomic.Int32
	var id string
	var lock sync.Mutex
	var wg sync.WaitGroup
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { calls.Add(1); return initial(c), nil })
	for i := 0; i < 12; i++ {
		wg.Go(func() {
			v, f, err := s.Create(ctx, "account-a", CreateRequest{RequestID: "same", Seed: "中文，原字\n"})
			if err != nil {
				t.Error(err)
				return
			}
			if f {
				accepted.Add(1)
			}
			lock.Lock()
			defer lock.Unlock()
			if id != "" && v.ID != id {
				t.Error("different experience")
			}
			id = v.ID
		})
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatal(accepted.Load())
	}
	for i := 0; i < 12; i++ {
		wg.Go(func() {
			if err := s.GenerateAccepted(ctx, "account-a", "same"); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("generator ran %d", calls.Load())
	}
	v, err := s.Get(ctx, "account-a", id, "")
	must(t, err)
	if v.Revision != 1 || len(v.Pages) != 1 || v.Pages[0].Text != candidate(Context{}).Passage || v.Operation.Status != "committed" {
		t.Fatalf("formal page lost: %+v", v)
	}
	raw, _ := json.Marshal(v)
	if strings.Contains(string(raw), "门后有暗井") || strings.Contains(string(raw), "entity:hidden") || strings.Contains(string(raw), "fact:hidden") {
		t.Fatal("hidden world leaked")
	}
	_, _, err = s.Create(ctx, "account-a", CreateRequest{RequestID: "same", Seed: "不同"})
	code(t, err, "request_id_conflict")
	_, err = s.Get(ctx, "account-b", id, "")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	other, f, err := s.Create(ctx, "account-b", CreateRequest{RequestID: "same", Seed: "中文，原字\n"})
	must(t, err)
	if !f || other.ID == id {
		t.Fatal("account isolation")
	}
	_, _, err = s.Advance(ctx, "account-a", id, AdvanceRequest{RequestID: "stale", BranchID: v.BranchID, ExpectedRevision: 0, Mode: "read", Input: ""})
	code(t, err, "revision_conflict")
}
func TestAuthorityCancelFencesLateResultAndExplicitTakeover(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "a", "begin")
	started := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan error, 1)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		close(started)
		<-release
		return candidate(c), nil
	})
	op, _, err := s.Advance(ctx, "a", v.ID, AdvanceRequest{RequestID: "slow", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "act", Input: "开门"})
	must(t, err)
	go func() { finished <- s.GenerateAccepted(ctx, "a", "slow") }()
	<-started
	cancelled, err := s.Cancel(ctx, "a", v.ID, op.RequestID)
	must(t, err)
	if cancelled.Status != "cancelled" {
		t.Fatal(cancelled)
	}
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return candidate(c), nil })
	next := advance(t, s, "a", v, "takeover", "read")
	close(release)
	code(t, <-finished, "superseded")
	v, err = s.Get(ctx, "a", v.ID, v.BranchID)
	must(t, err)
	if v.Revision != 2 || len(v.Pages) != 2 || next.Revision != 2 {
		t.Fatal(v)
	}
	cancelled, err = s.GetOperation(ctx, "a", v.ID, "slow")
	must(t, err)
	if cancelled.Status != "cancelled" {
		t.Fatal(cancelled)
	}
}
func TestAuthorityExpiredLeaseRestartNoReplayAndRestoreMutex(t *testing.T) {
	s, admin, dsn := testService(t)
	ctx := context.Background()
	v := begin(t, s, "a", "begin")
	_, _, err := s.Advance(ctx, "a", v.ID, AdvanceRequest{RequestID: "orphan", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read", Input: ""})
	must(t, err)
	_, err = admin.ExecContext(ctx, "UPDATE experience_operations SET status='generating',lease_until=clock_timestamp()-interval '1 second' WHERE request_id='orphan'")
	must(t, err)
	var calls atomic.Int32
	restarted := &Service{DB: s.DB, Generator: generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		calls.Add(1)
		return candidate(c), nil
	})}
	must(t, restarted.RecoverExpired(ctx))
	must(t, restarted.GenerateAccepted(ctx, "a", "orphan"))
	if calls.Load() != 0 {
		t.Fatal("replayed accepted generation")
	}
	op, err := s.GetOperation(ctx, "a", v.ID, "orphan")
	must(t, err)
	if op.Status != "interrupted" {
		t.Fatal(op)
	}
	if gate, err := database.AcquireRestore(ctx, admin); !errors.Is(err, database.ErrRecoveryBlocked) {
		if gate != nil {
			gate.Release()
		}
		t.Fatalf("restore unprotected %v", err)
	}
	must(t, s.DB.Close())
	db, err := database.OpenServing(ctx, dsn)
	must(t, err)
	defer db.Close()
	restarted.DB = db
	got, err := restarted.Get(ctx, "a", v.ID, v.BranchID)
	must(t, err)
	if got.Revision != 1 || got.Pages[0].Text != v.Pages[0].Text || got.Operation.Status != "interrupted" {
		t.Fatal("recovery changed formal history")
	}
	_ = advance(t, restarted, "a", got, "explicit", "read")
}
func TestAuthorityAskCannotChangeWorldAndForkCorrectionsStayOnNewBranch(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "a", "begin")
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		v := candidate(c)
		v.StoryTime = "次日"
		return v, nil
	})
	failed := advance(t, s, "a", v, "ask-bad", "ask")
	if failed.Revision != 1 || failed.Operation.Status != "failed" || *failed.Operation.ErrorCode != "ask_mutation" {
		t.Fatal(failed)
	}
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return candidate(c), nil })
	asked := advance(t, s, "a", failed, "ask-good", "ask")
	if asked.Revision != 2 || asked.Pages[1].StoryTime != "暮色" {
		t.Fatal(asked)
	}
	fork, err := s.Fork(ctx, "a", v.ID, ForkRequest{RequestID: "fork", FromBranchID: v.BranchID, FromRevision: 1, Name: "纠错分支", Edit: &Edit{FactID: "fact:known", Text: "她声称门外危险"}})
	must(t, err)
	if fork.BranchID == v.BranchID || fork.Pages[0].Text != v.Pages[0].Text {
		t.Fatal(fork)
	}
	fork = advance(t, s, "a", fork, "fork-read", "read")
	child, err := s.Fork(ctx, "a", v.ID, ForkRequest{RequestID: "fork-of-fork", FromBranchID: fork.BranchID, FromRevision: 1, Name: "重读纠错后"})
	must(t, err)
	var corrected bool
	for _, i := range child.Information {
		if i.ID == "fact:known" && i.Text == "她声称门外危险" {
			corrected = true
		}
	}
	if !corrected {
		t.Fatal("historical fork snapshot lost correction")
	}
	original, err := s.Get(ctx, "a", v.ID, v.BranchID)
	must(t, err)
	for _, i := range original.Information {
		if i.ID == "fact:known" && i.Text != "她声称门外安全" {
			t.Fatal("old branch changed")
		}
	}
	_, err = s.Fork(ctx, "a", v.ID, ForkRequest{RequestID: "hidden-edit", FromBranchID: v.BranchID, FromRevision: 1, Name: "不允许", Edit: &Edit{FactID: "hidden", Text: "泄漏"}})
	code(t, err, "fact_not_known")
}
func TestAuthorityBoundedContextUnavailableAndAtomicRollback(t *testing.T) {
	s, admin, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "a", "begin")
	s.MaxContextBytes = 1
	failed := advance(t, s, "a", v, "capacity", "read")
	if failed.Operation.Status != "failed" || *failed.Operation.ErrorCode != "context_capacity" || failed.Revision != 1 {
		t.Fatal(failed)
	}
	s.MaxContextBytes = 0
	s.Generator = nil
	failed = advance(t, s, "a", failed, "unavailable", "read")
	if *failed.Operation.ErrorCode != "model_unavailable" || failed.Revision != 1 {
		t.Fatal(failed)
	}
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return candidate(c), nil })
	// A DB failure after page/state CAS but before operation commit must roll back all three.
	_, err := admin.ExecContext(ctx, `CREATE FUNCTION test_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='committed' AND NEW.request_id='rollback' THEN RAISE EXCEPTION 'fault injection'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_commit_failure BEFORE UPDATE ON experience_operations FOR EACH ROW EXECUTE FUNCTION test_commit_failure();`)
	must(t, err)
	_, _, err = s.Advance(ctx, "a", v.ID, AdvanceRequest{RequestID: "rollback", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "act", Input: "开门"})
	must(t, err)
	if err = s.GenerateAccepted(ctx, "a", "rollback"); err == nil {
		t.Fatal("expected failure")
	}
	got, err := s.Get(ctx, "a", v.ID, v.BranchID)
	must(t, err)
	if got.Revision != 1 || len(got.Pages) != 1 || got.Operation.Status != "generating" {
		t.Fatal("non-atomic commit")
	}
	rows, err := pgq.New(s.DB).ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: "a", ExperienceID: v.ID, BranchID: v.BranchID, ThroughRevision: 99})
	must(t, err)
	if len(rows) != 1 {
		t.Fatal("partial formal page")
	}
}
func TestIndependentAccountPreferencesAreExplicitAndFullReplacement(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	quiet := "安静"
	got, err := s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "氛围", Value: &quiet, Expression: "安静", Confirmation: "direct_expression"})
	must(t, err)
	if len(got) != 1 || got[0].Value != "安静" || got[0].Source != "explicit" || got[0].Version == "" {
		t.Fatal(got)
	}
	other, err := s.PreferenceSnapshots(ctx, "b")
	must(t, err)
	if len(other) != 0 {
		t.Fatal(other)
	}
	// A key change with a stale expected state cannot silently overwrite a newer one.
	stale := got[0]
	stale.Version = "1970-01-01T00:00:00Z"
	loud := "喧闹"
	_, err = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "氛围", Expected: &stale, Value: &loud, Expression: "喧闹", Confirmation: "direct_expression"})
	code(t, err, "preference_conflict")
	after, err := s.PreferenceSnapshots(ctx, "a")
	must(t, err)
	if len(after) != 1 || after[0] != got[0] {
		t.Fatalf("conflict changed a row: %+v", after)
	}
	// value=null deletes exactly the named dimension.
	after, err = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "氛围", Expected: &got[0], Value: nil})
	must(t, err)
	if len(after) != 0 {
		t.Fatal(after)
	}
}
