//go:build integration

package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"elselife/backend/internal/sqlc/pgq"
)

// This replays committed, synthetic SYS-006 evidence into isolated PostgreSQL.
// It exercises real Get/ExportReader/Fork projections without a generator.
// It is an engineering regression, not a new model run or literary acceptance.
func TestRecordedSYS006ReaderHistoryKeepsAuthorityAndRevealBoundaries(t *testing.T) {
	f := loadSYS006Readback(t)
	s, db, _ := testService(t)
	s.Generator = generateFunc(func(context.Context, Context, string) (Candidate, error) {
		t.Error("readback regression unexpectedly generated new prose")
		return Candidate{}, fmt.Errorf("no model in recorded readback regression")
	})
	ctx := context.Background()
	const account = "recorded-synthetic-sys006"
	last := f.Pages[len(f.Pages)-1]
	must(t, s.transaction(ctx, func(q *pgq.Queries) error {
		if err := q.ExperienceCreate(ctx, pgq.ExperienceCreateParams{AccountID: account, ID: f.ExperienceID, Seed: f.Seed, ActiveBranchID: f.BranchID}); err != nil {
			return err
		}
		if err := q.ExperienceBranchCreate(ctx, pgq.ExperienceBranchCreateParams{AccountID: account, ExperienceID: f.ExperienceID, ID: f.BranchID, Name: "recorded synthetic history", Title: last.Title, Revision: last.Revision, State: []byte(last.StateJSON)}); err != nil {
			return err
		}
		for _, p := range f.Pages {
			if err := q.ExperiencePageCreate(ctx, pgq.ExperiencePageCreateParams{AccountID: account, ExperienceID: f.ExperienceID, BranchID: f.BranchID, Revision: p.Revision, Page: []byte(p.PageJSON), State: []byte(p.StateJSON), Title: p.Title}); err != nil {
				return err
			}
		}
		return nil
	}))

	// PostgreSQL jsonb canonicalizes JSON on insertion. Capture its actual bytes
	// before any API reads, then require those same bytes after reads and forks.
	before := sys006StoredBytes(t, db, account, f.ExperienceID, f.BranchID)
	view, err := s.Get(ctx, account, f.ExperienceID, f.BranchID)
	must(t, err)
	assertSYS006View(t, view, f.Pages)
	assertSYS006Record(t, view.Information, "letter-content", 1, "信使携来的信记载林澈的出发日期为霜月6日；信尚未交到玩家手中，玩家尚未阅读。")
	assertSYS006Record(t, view.Information, "current-story-date", 1, "当前故事日期为霜月10日。")
	assertSYS006Record(t, view.Information, "current-story-date-rev5", 5, "当前故事时间为霜月12日清晨。")
	if view.Reader.StoryTime != "霜月12日清晨" {
		t.Fatal("historical date label replaced current story time")
	}

	// A normal historical fork is legal with recorded formal pages/snapshots;
	// it requires neither invented source operations nor a new model candidate.
	forks := map[string]int{f.BranchID: 5}
	for _, revision := range []int64{1, 3} {
		fork, err := s.Fork(ctx, account, f.ExperienceID, ForkRequest{RequestID: fmt.Sprintf("recorded-fork-%d", revision), FromBranchID: f.BranchID, FromRevision: revision, Name: fmt.Sprintf("recorded revision %d", revision)})
		must(t, err)
		assertSYS006View(t, fork, f.Pages[:revision])
		forks[fork.BranchID] = int(revision)
		// Fork keeps the original stored public page bytes. State on the last
		// copied page may be JSON-marshaled by Fork, but its data must be exact.
		stored := sys006StoredBytes(t, db, account, f.ExperienceID, fork.BranchID)
		for i := 0; i < int(revision); i++ {
			if !bytes.Equal(stored.Pages[i].Page, before.Pages[i].Page) {
				t.Fatalf("fork rewrote original page bytes at r%d", i+1)
			}
			if !bytes.Equal(stored.Pages[i].State, before.Pages[i].State) {
				t.Fatalf("fork changed original snapshot bytes at r%d", i+1)
			}
		}
		if !bytes.Equal(stored.State, before.Pages[revision-1].State) {
			t.Fatal("historical fork state is not the original snapshot")
		}
	}

	exported, err := s.ExportReader(ctx, account)
	must(t, err)
	if len(exported.Experiences) != 1 || len(exported.Experiences[0].Branches) != len(forks) {
		t.Fatal("reader export omitted a real historical branch")
	}
	for _, branch := range exported.Experiences[0].Branches {
		n, ok := forks[branch.ID]
		if !ok || len(branch.Pages) != n || branch.Revision != int64(n) {
			t.Fatal("reader export mixed branch history")
		}
		assertSYS006Reader(t, branch.Reader, int64(n))
		for i, page := range branch.Pages {
			original := f.Pages[i].Page
			if page.Text != original.Text || page.StoryTime != original.StoryTime || page.Mode != original.Mode || page.Outcome != original.Outcome || !reflect.DeepEqual(page.Suggestions, original.Suggestions) {
				t.Fatalf("export changed original page content at r%d", i+1)
			}
			assertSYS006Reader(t, page.Reader, int64(i+1))
		}
	}
	public := string(narrativeJSON(exported))
	for _, private := range []string{`"known_by"`, `"state"`, `"narrative"`, `"seed"`, `"input"`, `"fact:departure-event"`} {
		if strings.Contains(public, private) {
			t.Fatalf("reader export disclosed private authority field %s", private)
		}
	}
	other, err := s.ExportReader(ctx, "another-workspace")
	must(t, err)
	if len(other.Experiences) != 0 {
		t.Fatal("recorded history crossed account scope")
	}
	_, err = s.Get(ctx, account, f.ExperienceID, f.BranchID)
	must(t, err)
	after := sys006StoredBytes(t, db, account, f.ExperienceID, f.BranchID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("Get, ExportReader or historical Fork wrote original formal page/state bytes")
	}
}

type sys006Readback struct {
	Format        string               `json:"format"`
	Purpose       string               `json:"purpose"`
	SourceRun     string               `json:"source_run"`
	SourceRoot    string               `json:"source_root"`
	EventsSHA256  string               `json:"events_sha256"`
	FixtureSHA256 string               `json:"fixture_sha256"`
	Engine        string               `json:"engine"`
	ExperienceID  string               `json:"experience_id"`
	BranchID      string               `json:"branch_id"`
	Seed          string               `json:"seed"`
	Pages         []sys006ReadbackPage `json:"pages"`
}

type sys006ReadbackPage struct {
	EventSeq    int    `json:"event_seq"`
	EventSHA256 string `json:"event_sha256"`
	Step        string `json:"step"`
	Revision    int64  `json:"revision"`
	Title       string `json:"title"`
	StateJSON   string `json:"state_json"`
	StateSHA256 string `json:"state_sha256"`
	PageJSON    string `json:"page_json"`
	PageSHA256  string `json:"page_sha256"`
	TextSHA256  string `json:"text_sha256"`
	Page        Page   `json:"-"`
	State       State  `json:"-"`
}

func loadSYS006Readback(t *testing.T) sys006Readback {
	t.Helper()
	raw, err := os.ReadFile("testdata/benchmark-sys006-public-readback.json")
	must(t, err)
	if fmt.Sprintf("%x", sha256.Sum256(raw)) != "eeccf5cd364beb605afd5cdb7da9d4c684f6d95df000d8cd546f021aa129212d" {
		t.Fatal("recorded regression fixture bytes changed; preserve source provenance")
	}
	var f sys006Readback
	must(t, StrictJSON(raw, &f))
	if f.Format != "elselife-synthetic-readback-regression.v1" || f.SourceRoot != "63d1d3a8183a9cf2a507b964e8acc1df283163212150a9d41386ae68dbc0ea83" || f.EventsSHA256 != "624a7d2a07f70ed1d9389c59de6274ba1384e1cc0d32ab4c132a4d542a26ec38" || len(f.Pages) != 5 {
		t.Fatal("fixture is not the sealed SYS-006 trajectory")
	}
	seqs := []int{2, 10, 34, 42, 65}
	steps := []string{"", "S01", "S02", "S03", "S06"}
	for i := range f.Pages {
		p := &f.Pages[i]
		must(t, StrictJSON([]byte(p.PageJSON), &p.Page))
		must(t, StrictJSON([]byte(p.StateJSON), &p.State))
		must(t, validateArchiveState(p.State, p.Revision))
		if p.Revision != int64(i+1) || p.Page.Revision != p.Revision || p.EventSeq != seqs[i] || p.Step != steps[i] || len(p.EventSHA256) != 64 || p.Page.StoryTime != p.State.StoryTime {
			t.Fatal("recorded page and snapshot identities differ")
		}
		for _, pair := range [][2]string{{p.PageJSON, p.PageSHA256}, {p.StateJSON, p.StateSHA256}, {p.Page.Text, p.TextSHA256}} {
			if fmt.Sprintf("%x", sha256.Sum256([]byte(pair[0]))) != pair[1] {
				t.Fatalf("recorded original bytes differ at r%d", p.Revision)
			}
		}
		if strings.Contains(p.PageJSON, `"recorded_revision"`) {
			t.Fatal("fixture was rewritten with new metadata instead of preserving original evidence")
		}
	}
	return f
}

func assertSYS006View(t *testing.T, view View, originals []sys006ReadbackPage) {
	t.Helper()
	if view.Revision != int64(len(originals)) || len(view.Pages) != len(originals) || !reflect.DeepEqual(view.Information, view.Reader.Information) {
		t.Fatal("Get mixed revisions or public projections")
	}
	assertSYS006Reader(t, view.Reader, view.Revision)
	for i, page := range view.Pages {
		assertSYS006Reader(t, page.Reader, int64(i+1))
		want := originals[i].Page
		// Reader is derived and legitimately gains metadata; all formal content
		// remains unchanged, including original input, timestamps and whitespace.
		page.Reader, want.Reader = nil, nil
		if !reflect.DeepEqual(page, want) {
			t.Fatalf("Get changed original formal page content at r%d", i+1)
		}
	}
}

func assertSYS006Reader(t *testing.T, reader *ReaderProjection, revision int64) {
	t.Helper()
	if reader == nil || reader.Revision != revision {
		t.Fatal("missing historical reader identity")
	}
	wantTime := "霜月10日"
	if revision == 5 {
		wantTime = "霜月12日清晨"
		assertSYS006Record(t, reader.Information, "current-story-date-rev5", 5, "当前故事时间为霜月12日清晨。")
	}
	if reader.StoryTime != wantTime {
		t.Fatal("historical reader borrowed current story time")
	}
	assertSYS006Record(t, reader.Information, "current-story-date", 1, "当前故事日期为霜月10日。")
	if revision >= 3 {
		assertSYS006Record(t, reader.Information, "letter-content", 1, "信使携来的信记载林澈的出发日期为霜月6日；信尚未交到玩家手中，玩家尚未阅读。")
		assertSYS006Record(t, reader.Information, "letter-received-read", 3, "霜月10日，玩家接过信使递来的信并展开阅读，读到了信中关于林澈于霜月6日离城的记载；该记载尚未经过独立核实，玩家仍未得知林澈如今所在。")
	}
	for _, item := range reader.Information {
		if item.ID == "fact:departure-event" || revision < 3 && (item.ID == "fact:letter-content" || strings.Contains(item.Text, "霜月6日")) {
			t.Fatalf("later knowledge or hidden fact metadata leaked into r%d: %s", revision, narrativeJSON(item))
		}
		if strings.Contains(string(narrativeJSON(item)), `"source_version"`) {
			t.Fatal("record version masquerades as publicly visible source page")
		}
	}
}

func assertSYS006Record(t *testing.T, items []Information, id string, revision int64, text string) {
	t.Helper()
	for _, item := range items {
		if item.ID == "fact:"+id {
			if item.RecordedRevision != revision || item.Text != text {
				t.Fatalf("fact %s lost original text/record version: %s", id, narrativeJSON(item))
			}
			return
		}
	}
	t.Fatalf("missing public fact %s", id)
}

type sys006StoredHistory struct {
	State []byte
	Pages []struct{ Page, State []byte }
}

func sys006StoredBytes(t *testing.T, db *sql.DB, account, experienceID, branchID string) sys006StoredHistory {
	t.Helper()
	var out sys006StoredHistory
	must(t, db.QueryRow(`SELECT state FROM experience_branches WHERE account_id=$1 AND experience_id=$2 AND id=$3`, account, experienceID, branchID).Scan(&out.State))
	rows, err := db.Query(`SELECT page,state FROM experience_pages WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 ORDER BY revision`, account, experienceID, branchID)
	must(t, err)
	defer rows.Close()
	for rows.Next() {
		var p struct{ Page, State []byte }
		must(t, rows.Scan(&p.Page, &p.State))
		out.Pages = append(out.Pages, p)
	}
	must(t, rows.Err())
	return out
}
