//go:build integration

package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// These benchmark regressions use deliberately fixed model candidates and an
// isolated PostgreSQL database. They verify authority/projection boundaries,
// not the benchmark's semantic prose or human reading requirements.
// SYS-017 S01/S02, H1: all public information surfaces must apply the same
// visibility projection before serializing, counting, or linking objects.
func TestBenchmarkSYS017HiddenSubjectCannotBypassReaderProjection(t *testing.T) {
	s, db, _ := testService(t)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		v := candidate(c)
		v.NewEntities = []Entity{
			{ID: "public-person", Kind: "person", Name: "阿乌", Known: true, RelatedIDs: []string{"hidden-belief"}},
			{ID: "hidden-person", Kind: "person", Name: "乌柏", Known: false, RelatedIDs: []string{}},
		}
		v.NewFacts = []Fact{
			{ID: "weather", Kind: "fact", Text: "乌港天气晴朗", Known: true, KnownBy: []string{}, SourceRevision: 1},
			{ID: "hidden-belief", Kind: "belief", Text: "乌柏相信秘密联盟已经成立", SubjectID: "hidden-person", Known: true, KnownBy: []string{"hidden-person"}, SourceRevision: 1},
		}
		return v, nil
	})
	v := begin(t, s, "benchmark-017", "begin")
	ctx := context.Background()
	var beforeRaw []byte
	must(t, db.QueryRowContext(ctx, `SELECT state FROM experience_branches WHERE account_id=$1 AND experience_id=$2 AND id=$3`, "benchmark-017", v.ID, v.BranchID).Scan(&beforeRaw))
	if !strings.Contains(string(beforeRaw), "秘密联盟") {
		t.Fatal("fixture did not establish hidden authority data")
	}
	views, err := s.List(ctx, "benchmark-017")
	must(t, err)
	for _, public := range append(views, v) {
		if !reflect.DeepEqual(public.Information, public.Reader.Information) {
			t.Fatalf("SYS-017-H1: legacy information differs from canonical reader projection: information=%s reader=%s", narrativeJSON(public.Information), narrativeJSON(public.Reader.Information))
		}
		raw := string(narrativeJSON(public))
		for _, secret := range []string{"hidden-person", "hidden-belief", "乌柏", "秘密联盟"} {
			if strings.Contains(raw, secret) {
				t.Fatalf("SYS-017-H1 public surface leaked %q", secret)
			}
		}
		if !strings.Contains(raw, "乌港天气晴朗") || !strings.Contains(raw, "阿乌") {
			t.Fatal("positive control: legitimate public information was removed")
		}
	}
	// Read-only display must preserve the original formal state exactly.
	var afterRaw []byte
	must(t, db.QueryRowContext(ctx, `SELECT state FROM experience_branches WHERE account_id=$1 AND experience_id=$2 AND id=$3`, "benchmark-017", v.ID, v.BranchID).Scan(&afterRaw))
	var beforeState, afterState State
	must(t, json.Unmarshal(beforeRaw, &beforeState))
	must(t, json.Unmarshal(afterRaw, &afterState))
	if !reflect.DeepEqual(beforeState, afterState) {
		t.Fatal("read-only projection mutated authority")
	}
}

// SYS-017 S04/S05, H2/H3: revealing a fact changes only the current branch;
// historical pages and a fork at the old revision retain the old audience.
func TestBenchmarkSYS017ReaderExportPreservesHistoricalRevealBoundaries(t *testing.T) {
	s, _, _ := testService(t)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		if c.Revision == 0 {
			v := initial(c)
			v.NarrativeUpdate = notebookFixture(1)
			v.NarrativeUpdate.Style.Voice = "PRIVATE_NOTEBOOK_SENTINEL"
			return v, nil
		}
		v := candidate(c)
		v.RevealFactIDs = []string{"hidden"}
		return v, nil
	})
	v := begin(t, s, "benchmark-export", "begin")
	ctx := context.Background()
	before, err := s.ExportReader(ctx, "benchmark-export")
	must(t, err)
	if strings.Contains(string(narrativeJSON(before)), "门后有暗井") {
		t.Fatal("SYS-017-H1 reader export exposed undiscovered fact")
	}
	v = advance(t, s, "benchmark-export", v, "discover", "act")
	fork, err := s.Fork(ctx, "benchmark-export", v.ID, ForkRequest{RequestID: "fork-old", FromBranchID: v.BranchID, FromRevision: 1, Name: "发现前"})
	must(t, err)
	after, err := s.ExportReader(ctx, "benchmark-export")
	must(t, err)
	if after.Format != "elselife-reader-export" || after.Version != 1 {
		t.Fatal("reader export has no distinct versioned identity")
	}
	for _, b := range after.Experiences[0].Branches {
		if strings.Contains(string(narrativeJSON(b.Pages[0])), "门后有暗井") {
			t.Fatal("SYS-017-H3 current revelation crossed into old page")
		}
		if b.ID == fork.BranchID && strings.Contains(string(narrativeJSON(b)), "门后有暗井") {
			t.Fatal("SYS-017-H3 current revelation crossed into past fork")
		}
		if b.ID == v.BranchID && !strings.Contains(string(narrativeJSON(b.Reader)), "门后有暗井") {
			t.Fatal("positive control: legitimately revealed information not exported")
		}
	}
	raw := string(narrativeJSON(after))
	for _, private := range []string{"PRIVATE_NOTEBOOK_SENTINEL", `"state":`, `"input":`, `"seed":`, `"narrative":`} {
		if strings.Contains(raw, private) {
			t.Fatalf("SYS-017-H1 private export field %s", private)
		}
	}
	backup, err := s.ExportArchive(ctx, "benchmark-export")
	must(t, err)
	if !strings.Contains(string(narrativeJSON(backup)), "PRIVATE_NOTEBOOK_SENTINEL") {
		t.Fatal("explicit full backup lost private restore state")
	}
	other, err := s.ExportReader(ctx, "benchmark-other")
	must(t, err)
	if len(other.Experiences) != 0 {
		t.Fatal("SYS-017-H3 reader export crossed workspace scope")
	}
}

func benchmarkBranchState(t *testing.T, db *sql.DB, account string, v View) []byte {
	t.Helper()
	var raw []byte
	must(t, db.QueryRow(`SELECT state FROM experience_branches WHERE account_id=$1 AND experience_id=$2 AND id=$3`, account, v.ID, v.BranchID).Scan(&raw))
	return raw
}

// SYS-018 S02-S05/H1-H3. Concurrency and direct receipt replay are real; the
// supplier's prose and money effects are fixed fixtures, not economy testing.
// This does not claim the separate proxy-disconnect/UI checks in S01/S06.
func TestBenchmarkSYS018BusinessIdentityCommitsOnceWithoutRollingBackReceipt(t *testing.T) {
	s, db, _ := testService(t)
	v := begin(t, s, "benchmark-idempotency", "begin")
	ctx := context.Background()
	var calls atomic.Int32
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		calls.Add(1)
		v := candidate(c)
		v.Passage = fmt.Sprintf("第%d次购买完成，一份纸交到你手中。", c.Revision)
		v.NewFacts = []Fact{{ID: fmt.Sprintf("purchase-%d", c.Revision), Kind: "fact", Text: v.Passage, Known: true, KnownBy: []string{}, SourceRevision: c.Revision + 1}}
		return v, nil
	})
	r := AdvanceRequest{RequestID: "business-K", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "act", Input: "购买1份纸，4枚"}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 3 {
		wg.Go(func() {
			_, fresh, err := s.Advance(ctx, "benchmark-idempotency", v.ID, r)
			if err != nil {
				t.Error(err)
				return
			}
			if fresh {
				accepted.Add(1)
			}
		})
	}
	wg.Wait()
	for range 3 {
		wg.Go(func() {
			if err := s.GenerateAccepted(ctx, "benchmark-idempotency", r.RequestID); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if accepted.Load() != 1 || calls.Load() != 1 {
		t.Fatalf("same business action accepted=%d generator_calls=%d", accepted.Load(), calls.Load())
	}
	first, err := s.GetOperation(ctx, "benchmark-idempotency", v.ID, r.RequestID)
	must(t, err)
	if first.Status != "committed" || first.CommittedRevision == nil || *first.CommittedRevision != 2 {
		t.Fatalf("not committed once: %+v", first)
	}
	conflict := r
	conflict.Input = "购买2份纸，8枚"
	_, _, err = s.Advance(ctx, "benchmark-idempotency", v.ID, conflict)
	code(t, err, "request_id_conflict")
	second := r
	second.RequestID, second.ExpectedRevision = "business-K2", 2
	_, fresh, err := s.Advance(ctx, "benchmark-idempotency", v.ID, second)
	must(t, err)
	if !fresh {
		t.Fatal("new business identity was deduplicated by identical words")
	}
	must(t, s.GenerateAccepted(ctx, "benchmark-idempotency", second.RequestID))
	beforeReplay := benchmarkBranchState(t, db, "benchmark-idempotency", v)
	old, fresh, err := s.Advance(ctx, "benchmark-idempotency", v.ID, r)
	must(t, err)
	if fresh || !reflect.DeepEqual(old, first) {
		t.Fatalf("old receipt changed: %+v vs %+v", old, first)
	}
	if string(beforeReplay) != string(benchmarkBranchState(t, db, "benchmark-idempotency", v)) {
		t.Fatal("old receipt rolled current world back")
	}
	var pages, commits int
	must(t, db.QueryRow(`SELECT count(*) FROM experience_pages WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3`, "benchmark-idempotency", v.ID, v.BranchID).Scan(&pages))
	must(t, db.QueryRow(`SELECT count(*) FROM experience_operations WHERE account_id=$1 AND experience_id=$2 AND status='committed'`, "benchmark-idempotency", v.ID).Scan(&commits))
	if pages != 3 || commits != 3 || calls.Load() != 2 {
		t.Fatalf("formal evidence: pages=%d commits=%d generator_calls=%d", pages, commits, calls.Load())
	}
}
