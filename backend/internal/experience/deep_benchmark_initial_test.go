//go:build integration && codexlive

package experience

import (
	"context"
	"elselife/backend/internal/sqlc/pgq"
	"fmt"
	"reflect"
	"testing"
)

// Initial evidence is a historical projection, not the current branch View.
// In particular, current branch metadata and operations have no historical
// meaning and must not be relabelled as revision one.
type deepInitialView struct {
	Title       string            `json:"title"`
	Revision    int64             `json:"revision"`
	Pages       []Page            `json:"pages"`
	Reader      *ReaderProjection `json:"reader"`
	Information []Information     `json:"information"`
}

func readDeepInitial(ctx context.Context, s *Service, account string, scope View) (State, deepInitialView, error) {
	if len(scope.Pages) == 0 || scope.Pages[0].Revision != 1 {
		return State{}, deepInitialView{}, fmt.Errorf("initial formal page missing")
	}
	atRevision := scope
	atRevision.Revision = 1
	state, err := deepSnapshot(ctx, s, account, atRevision)
	if err != nil {
		return State{}, deepInitialView{}, err
	}
	rows, err := pgq.New(s.DB).ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: account, ExperienceID: scope.ID, BranchID: scope.BranchID, ThroughRevision: 1})
	if err != nil {
		return State{}, deepInitialView{}, err
	}
	if len(rows) != 1 || rows[0].Revision != 1 || !textOK(rows[0].Title) {
		return State{}, deepInitialView{}, fmt.Errorf("initial SQL title missing")
	}
	page := scope.Pages[0]
	page.Reader = ProjectReader(state, 1)
	return state, deepInitialView{Title: rows[0].Title, Revision: 1, Pages: []Page{page}, Reader: ProjectReader(state, 1), Information: Project(state)}, nil
}

func TestDeepBenchmarkInitialReadbackDoesNotRelabelFutureProjection(t *testing.T) {
	// Two different synthetic snapshots reproduce a mixed-version evidence bug.
	// They test historical provenance, not model narrative quality.
	s, _, _ := testService(t)
	initial := EmptyState()
	initial.StoryTime = "first morning"
	latest := EmptyState()
	latest.StoryTime = "later evening"
	latest.Facts = append(latest.Facts, Fact{ID: "later-observation", Kind: "observation", Text: "The door opened later.", Known: true, KnownBy: []string{}, SourceRevision: 2})
	f := deepFixture{ID: "initial-readback", Seed: "room", Opening: "A closed door.", State: initial}
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, StoryTime: initial.StoryTime, Suggestions: []string{}, Outcome: "continues", Reader: ProjectReader(initial, 1)}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "read", Text: "The door opened later."}, StoryTime: latest.StoryTime, Suggestions: []string{}, Outcome: "continues", Reader: ProjectReader(latest, 2)}
	replay := &deepReplay{Pages: []deepReplayPage{{Page: p1, State: initial}, {Step: "S01", Page: p2, State: latest}}}
	ctx := context.Background()
	view, err := seedDeepFixture(ctx, s, f, "initial-readback", replay)
	must(t, err)
	state, readback, err := readDeepInitial(ctx, s, "initial-readback", view)
	must(t, err)
	if !reflect.DeepEqual(state, initial) || !reflect.DeepEqual(readback.Pages, []Page{p1}) {
		t.Fatal("initial authority readback differs")
	}
	if !reflect.DeepEqual(readback.Reader, ProjectReader(initial, 1)) || !reflect.DeepEqual(readback.Information, Project(initial)) {
		t.Fatal("initial readback leaked the latest public projection")
	}
	if view.Revision != 2 || view.Reader.StoryTime != latest.StoryTime || len(view.Pages) != 2 {
		t.Fatal("reading initial history changed current view")
	}
}
