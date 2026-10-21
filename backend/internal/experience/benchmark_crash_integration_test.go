//go:build integration

package experience

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/platform/database"
)

const benchmarkDeliveryText = "你把封口信交给收信人，他收下了信，尚未拆开。"

func benchmarkDelivery(c Context) Candidate {
	v := candidate(c)
	v.Passage = benchmarkDeliveryText
	v.NewFacts = []Fact{{ID: "delivered", Kind: "fact", Text: benchmarkDeliveryText, Known: true, KnownBy: []string{"recipient"}, SourceRevision: c.Revision + 1, Reader: &ReaderRecord{Kind: "item", EntityID: "letter", TargetID: "recipient", Label: "封口信", Status: "已收到，未拆读"}}}
	v.NarrativeUpdate = notebookFixture(c.Revision + 1)
	v.Review = &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(v), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{{FactID: "delivered", Quote: benchmarkDeliveryText}}, KnowledgeSupports: []NarrativeKnowledgeSupport{{SubjectID: "recipient", FactID: "delivered", Quote: benchmarkDeliveryText}}}}
	return v
}

// Subprocess-only fixture. The parent kills this process at a controlled real
// transaction boundary; no prompt asks a model to pretend a crash occurred.
func TestBenchmarkSYS020CrashProcessHelper(t *testing.T) {
	if os.Getenv("ELSELIFE_BENCHMARK_CRASH_HELPER") != "1" {
		t.Skip("subprocess helper; exercised by TestBenchmarkSYS020RealProcessDeathPreservesAtomicDelivery")
	}
	ctx := context.Background()
	db, err := database.OpenServing(ctx, os.Getenv("ELSELIFE_BENCHMARK_CRASH_DSN"))
	must(t, err)
	defer db.Close()
	s := &Service{DB: db, NarrativeEngine: true, Generator: generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		must(t, os.WriteFile(os.Getenv("ELSELIFE_BENCHMARK_CRASH_CALL"), []byte("one fixed-candidate generation\n"), 0600))
		return benchmarkDelivery(c), nil
	})}
	s.PrepareDispatch = func(_, _, _ string, _ int64) {
		must(t, os.WriteFile(os.Getenv("ELSELIFE_BENCHMARK_CRASH_COMMITTED"), []byte("commit completed before optional preparation dispatch\n"), 0600))
		select {}
	}
	must(t, s.GenerateAccepted(ctx, "benchmark-crash", "deliver"))
	t.Fatal("child unexpectedly returned before its injected process death")
}

func benchmarkEventually(t *testing.T, what string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for " + what)
}

// SYS-020 S01-S04, H1/H3/H4: real isolated Go process death during the commit
// transaction and immediately after it. Notebook, world, page and receipt are
// committed synchronously; there is no separate narrative-index consumer to
// exercise S05/S06. Optional next-page preparation is not knowledge authority.
func TestBenchmarkSYS020RealProcessDeathPreservesAtomicDelivery(t *testing.T) {
	for _, point := range []string{"before_commit", "after_commit_before_preparation"} {
		t.Run(point, func(t *testing.T) {
			s, db, dsn := testService(t)
			s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
				v := candidate(c)
				v.NewEntities = []Entity{{ID: "recipient", Kind: "person", Name: "收信人", Known: true, RelatedIDs: []string{}}, {ID: "letter", Kind: "item", Name: "封口信", Known: true, RelatedIDs: []string{}}}
				v.NewFacts = []Fact{{ID: "letter-content", Kind: "secret", Text: "密信内文：货物今晚从西门运走", Known: false, KnownBy: []string{}, SourceRevision: 1}}
				return v, nil
			})
			v := begin(t, s, "benchmark-crash", "begin")
			before := benchmarkBranchState(t, db, "benchmark-crash", v)
			ctx := context.Background()
			s.NarrativeEngine = true
			_, _, err := s.Advance(ctx, "benchmark-crash", v.ID, AdvanceRequest{RequestID: "deliver", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "act", Input: "只把封口信交给收信人，不替他拆开"})
			must(t, err)
			if point == "before_commit" {
				_, err = db.ExecContext(ctx, `CREATE FUNCTION benchmark_commit_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='committed' THEN PERFORM pg_advisory_xact_lock(871020); END IF; RETURN NEW; END $$; CREATE TRIGGER benchmark_commit_pause BEFORE UPDATE ON experience_operations FOR EACH ROW EXECUTE FUNCTION benchmark_commit_pause();`)
				must(t, err)
			}
			lock, err := db.Conn(ctx)
			must(t, err)
			defer lock.Close()
			if point == "before_commit" {
				_, err = lock.ExecContext(ctx, `SELECT pg_advisory_lock(871020)`)
				must(t, err)
				defer lock.ExecContext(ctx, `SELECT pg_advisory_unlock(871020)`)
			}
			dir := t.TempDir()
			callPath, commitPath := filepath.Join(dir, "calls.txt"), filepath.Join(dir, "committed.txt")
			binary, err := os.Executable()
			must(t, err)
			command := exec.Command(binary, "-test.run=^TestBenchmarkSYS020CrashProcessHelper$", "-test.v")
			command.Env = append(os.Environ(), "ELSELIFE_BENCHMARK_CRASH_HELPER=1", "ELSELIFE_BENCHMARK_CRASH_DSN="+dsn, "ELSELIFE_BENCHMARK_CRASH_CALL="+callPath, "ELSELIFE_BENCHMARK_CRASH_COMMITTED="+commitPath)
			logPath := filepath.Join(dir, "child.log")
			log, err := os.Create(logPath)
			must(t, err)
			defer log.Close()
			command.Stdout, command.Stderr = log, log
			must(t, command.Start())
			defer func() { _ = command.Process.Kill(); _ = command.Wait() }()
			benchmarkEventually(t, "fixed supplier invocation", func() bool { _, err := os.Stat(callPath); return err == nil })
			if point == "before_commit" {
				benchmarkEventually(t, "database trigger paused inside uncommitted transaction", func() bool {
					var waiting bool
					must(t, db.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=871020 AND NOT granted)`).Scan(&waiting))
					return waiting
				})
			} else {
				benchmarkEventually(t, "post-commit dispatch boundary", func() bool { _, err := os.Stat(commitPath); return err == nil })
			}
			must(t, command.Process.Kill())
			if err = command.Wait(); err == nil {
				t.Fatal("helper was not terminated")
			}
			t.Logf("actual process killed: pid=%d point=%s", command.Process.Pid, point)
			if point == "before_commit" {
				_, err = lock.ExecContext(ctx, `SELECT pg_advisory_unlock(871020)`)
				must(t, err)
				benchmarkEventually(t, "killed connection transaction release", func() bool {
					var waiting bool
					must(t, db.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=871020)`).Scan(&waiting))
					return !waiting
				})
			}
			var unexpectedCalls int
			restarted := &Service{DB: s.DB, NarrativeEngine: true, Generator: generateFunc(func(context.Context, Context, string) (Candidate, error) {
				unexpectedCalls++
				return Candidate{}, fmt.Errorf("recovery must not regenerate historical prose")
			})}
			if point == "before_commit" {
				if string(benchmarkBranchState(t, db, "benchmark-crash", v)) != string(before) {
					t.Fatal("partial world survived an uncommitted crash")
				}
				_, err = db.Exec(`UPDATE experience_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE account_id='benchmark-crash' AND request_id='deliver'`)
				must(t, err)
				must(t, restarted.RecoverExpired(ctx))
			}
			must(t, restarted.GenerateAccepted(ctx, "benchmark-crash", "deliver"))
			if unexpectedCalls != 0 {
				t.Fatal("recovery regenerated history")
			}
			got, err := restarted.Get(ctx, "benchmark-crash", v.ID, v.BranchID)
			must(t, err)
			wantRevision, wantStatus := int64(1), "interrupted"
			if point != "before_commit" {
				wantRevision, wantStatus = 2, "committed"
			}
			if got.Revision != wantRevision || int64(len(got.Pages)) != wantRevision || got.Operation.Status != wantStatus {
				t.Fatalf("non-atomic recovered result: %+v", got)
			}
			if point != "before_commit" {
				if got.Pages[1].Text != benchmarkDeliveryText {
					t.Fatal("committed prose changed on recovery")
				}
				var state State
				must(t, StrictJSON(benchmarkBranchState(t, db, "benchmark-crash", v), &state))
				if state.Narrative == nil || state.Narrative.ThroughRevision != 2 {
					t.Fatal("synchronously committed notebook lost")
				}
				projection, err := newNarrativeRun(Context{State: state, Revision: 2}).actorProjection(narrativeTrigger{ActorID: "recipient", FactIDs: []string{"delivered"}})
				must(t, err)
				if !strings.Contains(string(projection), "收下了信") || strings.Contains(string(projection), "西门") {
					t.Fatalf("received a sealed letter confused with reading its contents: %s", projection)
				}
				// Positive control: a later separately authorized reading event
				// updates the recipient immediately, without an index refresh.
				restarted.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
					v := candidate(c)
					v.Passage = "收信人当面拆开封口信，读到货物今晚从西门运走。"
					v.KnowledgeChanges = []KnowledgeChange{{SubjectID: "recipient", FactID: "letter-content"}}
					v.RevealFactIDs = []string{"letter-content"}
					v.NarrativeUpdate = notebookFixture(c.Revision + 1)
					v.Review = &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(v), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{{SubjectID: "recipient", FactID: "letter-content", Quote: v.Passage}}, RevealSupports: []NarrativeRevealSupport{{Type: "fact", ID: "letter-content", Quote: v.Passage}}}}
					return v, nil
				})
				_, _, err = restarted.Advance(ctx, "benchmark-crash", v.ID, AdvanceRequest{RequestID: "open-letter", BranchID: v.BranchID, ExpectedRevision: 2, Mode: "act", Input: "请收信人当面拆信阅读"})
				must(t, err)
				must(t, restarted.GenerateAccepted(ctx, "benchmark-crash", "open-letter"))
				must(t, StrictJSON(benchmarkBranchState(t, db, "benchmark-crash", v), &state))
				projection, err = newNarrativeRun(Context{State: state, Revision: 3}).actorProjection(narrativeTrigger{ActorID: "recipient", FactIDs: []string{"letter-content"}})
				must(t, err)
				if !strings.Contains(string(projection), "西门") {
					t.Fatal("actual committed reading failed to update recipient knowledge immediately")
				}
			}
		})
	}
}
