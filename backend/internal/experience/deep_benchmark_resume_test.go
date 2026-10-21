//go:build integration && codexlive

package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"elselife/backend/internal/sqlc/pgq"
)

func TestDeepBenchmarkStepPolicyRequiresActualCompletion(t *testing.T) {
	step := deepStep{ID: "S05", RequiresSteps: []string{"S04"}}
	if deepStepBlockedReason(step, map[string]bool{}) == "" {
		t.Fatal("missing or unsupported prerequisite must block dependent step")
	}
	if deepStepBlockedReason(step, map[string]bool{"S04": false}) == "" {
		t.Fatal("a blocked prerequisite is not completed")
	}
	if reason := deepStepBlockedReason(step, map[string]bool{"S04": true}); reason != "" {
		t.Fatal(reason)
	}
	step.EvidenceGate = "search-approval"
	if deepStepBlockedReason(step, map[string]bool{"S04": true}) == "" {
		t.Fatal("prior operation completion does not prove semantic permission")
	}
}

func TestDeepBenchmarkLegacyStepsKeepOriginalJSONShape(t *testing.T) {
	raw, err := json.Marshal(deepStep{ID: "S01", Mode: "ask", Input: "where"})
	must(t, err)
	if string(raw) != `{"id":"S01","mode":"ask","input":"where"}` {
		t.Fatalf("new evaluator policy changed legacy fixture identity: %s", raw)
	}
}

func TestDeepBenchmarkEndingPermitsQueriesWithoutForcedContinuation(t *testing.T) {
	if deepLatestStoryOutcome([]Page{{HistoryPage: HistoryPage{Mode: "read"}, Outcome: "ending"}, {HistoryPage: HistoryPage{Mode: "ask"}, Outcome: "continues"}}) != "ending" {
		t.Fatal("ask page reset the underlying story ending")
	}
	for _, mode := range []string{"ask", "observe", "harness"} {
		if deepEndingBlocks("ending", deepStep{Mode: mode}) {
			t.Fatalf("ending blocked nonadvancing %s", mode)
		}
	}
	for _, mode := range []string{"act", "player", "read", "continue"} {
		if !deepEndingBlocks("ending", deepStep{Mode: mode}) {
			t.Fatalf("ending allowed unrequested continuation %s", mode)
		}
		if deepEndingBlocks("ending", deepStep{Mode: mode, Epilogue: true}) {
			t.Fatalf("ending blocked explicit epilogue %s", mode)
		}
		if deepEndingBlocks("continues", deepStep{Mode: mode}) {
			t.Fatal("premature stop")
		}
	}
}

func TestDeepBenchmarkCanaryDistinguishesHiddenFromLawfullyKnown(t *testing.T) {
	state := EmptyState()
	state.Facts = []Fact{{ID: "secret", Kind: "secret", Text: "Code: canary", Known: false, KnownBy: []string{}, SourceRevision: 1}}
	if !deepCanaryPrivate(state, "canary") {
		t.Fatal("hidden canary exempted")
	}
	state.Facts = append(state.Facts, Fact{ID: "disclosure", Kind: "fact", Text: "Code: canary", Known: true, KnownBy: []string{}, SourceRevision: 2})
	if deepCanaryPrivate(state, "canary") {
		t.Fatal("lawful knowledge counted as private disclosure")
	}
}

func TestDeepBenchmarkRestoredHistoryReadbackChecksEveryRevision(t *testing.T) {
	// Synthetic history verifies restoration provenance, not narrative quality.
	s, _, _ := testService(t)
	f := deepFixture{ID: "readback", Seed: "room", Opening: "A quiet room.", State: EmptyState()}
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, Suggestions: []string{}, Outcome: "continues"}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: "Where?", Text: "In the room."}, Suggestions: []string{}, Outcome: "continues"}
	p1.Reader, p2.Reader = ProjectReader(f.State, 1), ProjectReader(f.State, 2)
	replay := &deepReplay{Pages: []deepReplayPage{{Page: p1, State: f.State}, {Step: "S01", Page: p2, State: f.State}}}
	ctx := context.Background()
	view, err := seedDeepFixture(ctx, s, f, "readback", replay)
	must(t, err)
	readback, err := readDeepRestored(ctx, s, "readback", view, replay)
	must(t, err)
	if len(readback.Snapshots) != 2 || !reflect.DeepEqual(readback.View.Pages, []Page{p1, p2}) {
		t.Fatal("did not read back complete restored history")
	}
	for i, snapshot := range readback.Snapshots {
		if snapshot.Revision != int64(i+1) || !reflect.DeepEqual(snapshot.State, replay.Pages[i].State) {
			t.Fatal("snapshot not independently bound to its revision")
		}
	}
	replay.Pages[0].State.StoryTime = "rewritten older snapshot"
	if _, err := readDeepRestored(ctx, s, "readback", view, replay); err == nil {
		t.Fatal("accepted drift in an older restored snapshot")
	}
	replay.Pages[0].State = f.State
	replay.Pages[0].Page.Text = "rewritten older prose"
	if _, err := readDeepRestored(ctx, s, "readback", view, replay); err == nil {
		t.Fatal("accepted drift in an older restored page")
	}
}

// Resuming is a controlled-history regression, not a fresh full trajectory.
// Only a sealed, exact-fixture prefix of committed pages can be restored.
type deepReplayPage struct {
	Step            string `json:"step"`
	Page            Page   `json:"page"`
	State           State  `json:"state"`
	Title           string `json:"title,omitempty"`
	TitleProvenance string `json:"title_provenance,omitempty"`
}

const deepSyntheticInitialTitle = "合成世界初始记录"
const deepTitleBinding = "source_public_view_title_v1"

func deepReplayTitle(page deepReplayPage) string {
	if page.Title != "" {
		return page.Title
	}
	// In-memory synthetic plumbing controls predate title capture. A parsed
	// source must bind every committed title before it reaches this helper.
	return deepSyntheticInitialTitle
}

func deepSourceTitle(title string, revision int64, version int) (string, string, error) {
	if textOK(title) {
		return title, "source_public_view_title", nil
	}
	if revision == 1 && version < 4 {
		return deepSyntheticInitialTitle, "legacy_initial_title_unrecorded", nil
	}
	return "", "", fmt.Errorf("source title missing at revision %d", revision)
}

func TestDeepBenchmarkSourceTitleRequiresCommittedEvidenceAndLabelsLegacyInitial(t *testing.T) {
	title, provenance, err := deepSourceTitle("", 1, 3)
	must(t, err)
	if title != deepSyntheticInitialTitle || provenance != "legacy_initial_title_unrecorded" {
		t.Fatal("legacy initial title falsely verified")
	}
	for _, revision := range []int64{1, 2} {
		if _, _, err := deepSourceTitle("", revision, 4); err == nil {
			t.Fatal("v4 source omitted title")
		}
	}
	if _, _, err := deepSourceTitle("", 2, 3); err == nil {
		t.Fatal("committed title inferred without source")
	}
	title, provenance, err = deepSourceTitle("Original source title", 2, 3)
	must(t, err)
	if title != "Original source title" || provenance != "source_public_view_title" {
		t.Fatal("original title changed")
	}
}

func TestDeepBenchmarkRestoredTitlesPreserveEverySQLRevision(t *testing.T) {
	s, admin, _ := testService(t)
	f := deepFixture{ID: "titles", Seed: "room", Opening: "A room.", State: EmptyState()}
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, Reader: ProjectReader(f.State, 1), Suggestions: []string{}, Outcome: "continues"}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: "Where?", Text: "Here."}, Reader: ProjectReader(f.State, 2), Suggestions: []string{}, Outcome: "continues"}
	replay := &deepReplay{Pages: []deepReplayPage{{Page: p1, State: f.State, Title: "Original title", TitleProvenance: "source_public_view_title"}, {Step: "S01", Page: p2, State: f.State, Title: "Question title", TitleProvenance: "source_public_view_title"}}}
	ctx := context.Background()
	view, err := seedDeepFixture(ctx, s, f, "titles", replay)
	must(t, err)
	if view.Title != "Question title" {
		t.Fatalf("latest title replaced: %q", view.Title)
	}
	_, err = readDeepRestored(ctx, s, "titles", view, replay)
	must(t, err)
	_, initial, err := readDeepInitial(ctx, s, "titles", view)
	must(t, err)
	var wire map[string]any
	must(t, json.Unmarshal(narrativeJSON(initial), &wire))
	if wire["title"] != "Original title" {
		t.Fatal("initial title was not independently read at revision one")
	}
	_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET title='rewritten title' WHERE account_id='titles' AND revision=1`)
	must(t, err)
	if _, err = readDeepRestored(ctx, s, "titles", view, replay); err == nil {
		t.Fatal("old SQL page title drift accepted")
	}
	_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET title='Original title' WHERE account_id='titles' AND revision=1`)
	must(t, err)
	_, err = admin.ExecContext(ctx, `UPDATE experience_branches SET title='wrong latest title' WHERE account_id='titles'`)
	must(t, err)
	if _, err = readDeepRestored(ctx, s, "titles", view, replay); err == nil {
		t.Fatal("branch title drift accepted")
	}
}

type deepReplayObservation struct {
	Step     string          `json:"step"`
	EventSeq int             `json:"event_seq"`
	Data     json.RawMessage `json:"data"`
}
type deepReplayEditorial struct {
	Step            string          `json:"step"`
	SourceRoot      string          `json:"source_root"`
	RequestEventSeq int             `json:"source_request_event_seq"`
	ResultEventSeq  int             `json:"source_result_event_seq"`
	RequestData     json.RawMessage `json:"request_data"`
	ResultData      json.RawMessage `json:"result_data"`
}
type deepReplay struct {
	SourceRoot   string                  `json:"source_root"`
	EventsSHA256 string                  `json:"events_sha256"`
	Pages        []deepReplayPage        `json:"pages"`
	Observations []deepReplayObservation `json:"observations,omitempty"`
	Editorials   []deepReplayEditorial   `json:"editorials,omitempty"`
	sourceFiles  map[string][]byte
}

type deepRestoredSnapshot struct {
	Revision int64 `json:"revision"`
	State    State `json:"state"`
}
type deepRestoredTitle struct {
	Revision int64  `json:"revision"`
	Title    string `json:"title"`
}
type deepRestoredReadback struct {
	View                View                   `json:"public_view"`
	Snapshots           []deepRestoredSnapshot `json:"snapshots"`
	StoredPages         []Page                 `json:"stored_pages"`
	ProjectionMigration string                 `json:"projection_migration"`
	StoredTitles        []deepRestoredTitle    `json:"stored_titles,omitempty"`
	TitleBinding        string                 `json:"title_binding,omitempty"`
	BranchTitle         string                 `json:"branch_title,omitempty"`
}

func readDeepRestored(ctx context.Context, s *Service, account string, scope View, replay *deepReplay) (deepRestoredReadback, error) {
	var result deepRestoredReadback
	if replay == nil || len(replay.Pages) < 2 {
		return result, fmt.Errorf("missing restored history")
	}
	view, err := s.Get(ctx, account, scope.ID, scope.BranchID)
	if err != nil {
		return result, err
	}
	if view.Revision != int64(len(replay.Pages)) || len(view.Pages) != len(replay.Pages) {
		return result, fmt.Errorf("restored history length differs")
	}
	result.View = view
	result.ProjectionMigration = deepProjectionMigration
	result.TitleBinding = deepTitleBinding
	latestTitle := deepReplayTitle(replay.Pages[len(replay.Pages)-1])
	if view.Title != latestTitle {
		return result, fmt.Errorf("restored latest view title differs")
	}
	branches, err := pgq.New(s.DB).ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: account, ExperienceID: scope.ID})
	if err != nil {
		return result, err
	}
	for _, branch := range branches {
		if branch.ID == scope.BranchID {
			result.BranchTitle = branch.Title
			if branch.Revision != view.Revision {
				return result, fmt.Errorf("restored branch revision differs")
			}
		}
	}
	if result.BranchTitle != latestTitle {
		return result, fmt.Errorf("restored SQL branch title differs")
	}
	stored, err := pgq.New(s.DB).ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: account, ExperienceID: scope.ID, BranchID: scope.BranchID, ThroughRevision: view.Revision})
	if err != nil {
		return result, err
	}
	if len(stored) != len(replay.Pages) {
		return result, fmt.Errorf("stored source history length differs")
	}
	for i, prior := range replay.Pages {
		if stored[i].Title != deepReplayTitle(prior) {
			return result, fmt.Errorf("restored SQL title %d differs", i+1)
		}
		result.StoredTitles = append(result.StoredTitles, deepRestoredTitle{Revision: prior.Page.Revision, Title: stored[i].Title})
		var original Page
		if err := StrictJSON(stored[i].Page, &original); err != nil {
			return result, err
		}
		result.StoredPages = append(result.StoredPages, original)
		if !reflect.DeepEqual(original, prior.Page) {
			return result, fmt.Errorf("stored original page %d differs", i+1)
		}
		expected, err := deepMigrateInformationPage(prior.Page, prior.State)
		if err != nil {
			return result, err
		}
		if prior.Page.Revision != int64(i+1) || !reflect.DeepEqual(view.Pages[i], expected) {
			return result, fmt.Errorf("restored page %d differs", i+1)
		}
		atRevision := view
		atRevision.Revision = prior.Page.Revision
		state, err := deepSnapshot(ctx, s, account, atRevision)
		if err != nil {
			return result, err
		}
		if !reflect.DeepEqual(state, prior.State) {
			return result, fmt.Errorf("restored snapshot %d differs", prior.Page.Revision)
		}
		result.Snapshots = append(result.Snapshots, deepRestoredSnapshot{Revision: prior.Page.Revision, State: state})
	}
	last := view.Pages[len(view.Pages)-1]
	if last.Reader == nil || !reflect.DeepEqual(view.Reader, last.Reader) || !reflect.DeepEqual(view.Information, last.Reader.Information) {
		return result, fmt.Errorf("restored top-level projection differs from latest migrated page")
	}
	return result, nil
}

func decodeDeepReplay(raw []byte, root string, fixture deepFixture) (*deepReplay, error) {
	return decodeDeepReplayWithSource(raw, root, fixture, nil)
}

func decodeDeepReplayWithSource(raw []byte, root string, fixture deepFixture, source *deepReplay) (*deepReplay, error) {
	if len(raw) == 0 || len(raw) > 32<<20 || raw[len(raw)-1] != '\n' {
		return nil, fmt.Errorf("unsealed replay")
	}
	replay := &deepReplay{SourceRoot: root, EventsSHA256: fmt.Sprintf("%x", sha256.Sum256(raw))}
	previous := ""
	ended, initial := false, false
	sourceVersion := 1
	requests := map[string]AdvanceRequest{}
	completed := map[string]bool{}
	steps := map[string]deepStep{}
	var pendingEditorial *deepEditorialPending
	sourceManifest, sourceReadback := false, false
	sourceReady := func() bool {
		if source == nil {
			return true
		}
		if !sourceManifest || !sourceReadback {
			return false
		}
		for _, page := range source.Pages {
			if page.Step != "" && !completed[page.Step] {
				return false
			}
		}
		for _, observation := range source.Observations {
			if !completed[observation.Step] {
				return false
			}
		}
		for _, editorial := range source.Editorials {
			if !completed[editorial.Step] {
				return false
			}
		}
		return true
	}
	for _, step := range fixture.Steps {
		steps[step.ID] = step
	}
	for index, line := range bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'}) {
		var event struct {
			Seq      int             `json:"seq"`
			Previous string          `json:"previous_sha256"`
			Kind     string          `json:"kind"`
			Step     string          `json:"step"`
			Data     json.RawMessage `json:"data"`
		}
		if json.Unmarshal(line, &event) != nil || event.Seq != index+1 || event.Previous != previous || ended {
			return nil, fmt.Errorf("replay chain invalid")
		}
		previous = fmt.Sprintf("%x", sha256.Sum256(line))
		if index == 0 {
			var m struct {
				Fixture         deepFixture `json:"fixture"`
				EvidenceVersion int         `json:"evidence_version"`
			}
			if event.Kind != "manifest" || json.Unmarshal(event.Data, &m) != nil || !reflect.DeepEqual(m.Fixture, fixture) {
				return nil, fmt.Errorf("replay fixture differs")
			}
			if m.EvidenceVersion > 0 {
				sourceVersion = m.EvidenceVersion
			}
			var rawManifest map[string]json.RawMessage
			if json.Unmarshal(event.Data, &rawManifest) != nil || StrictJSON(rawManifest["fixture"], &m.Fixture) != nil {
				return nil, fmt.Errorf("source fixture contains unsupported fields")
			}
		}
		switch event.Kind {
		case "resume_manifest":
			var stated deepReplay
			if source == nil || sourceManifest || index != 1 || StrictJSON(event.Data, &stated) != nil {
				return nil, fmt.Errorf("resume requires one fully verified original ancestor")
			}
			if !bytes.Equal(narrativeJSON(stated), narrativeJSON(source)) {
				return nil, fmt.Errorf("resume manifest differs from verified ancestor")
			}
			replay.Pages = append([]deepReplayPage(nil), source.Pages...)
			sourceManifest = true
		case "resume_readback":
			if !sourceManifest || sourceReadback || initial {
				return nil, fmt.Errorf("duplicate or misplaced ancestor readback")
			}
			if err := deepValidateSourceReadback(event.Data, source); err != nil {
				return nil, err
			}
			sourceReadback = true
		case "restored_step":
			var prior deepReplayPage
			if !initial || !sourceReadback || completed[event.Step] || StrictJSON(event.Data, &prior) != nil || prior.Step != event.Step {
				return nil, fmt.Errorf("invalid restored original step")
			}
			found := false
			for _, expected := range source.Pages {
				found = found || expected.Step == event.Step && reflect.DeepEqual(prior, expected)
			}
			if !found {
				return nil, fmt.Errorf("restored step differs from verified ancestor")
			}
			completed[event.Step] = true
		case "restored_observation":
			var prior deepReplayObservation
			if !initial || !sourceReadback || completed[event.Step] || StrictJSON(event.Data, &prior) != nil || prior.Step != event.Step {
				return nil, fmt.Errorf("invalid restored original observation")
			}
			found := false
			for _, expected := range source.Observations {
				found = found || reflect.DeepEqual(prior, expected)
			}
			if !found {
				return nil, fmt.Errorf("restored observation differs from verified ancestor")
			}
			replay.Observations = append(replay.Observations, prior)
			completed[event.Step] = true
		case "restored_editorial":
			var prior deepReplayEditorial
			if !initial || !sourceReadback || completed[event.Step] || StrictJSON(event.Data, &prior) != nil || prior.Step != event.Step {
				return nil, fmt.Errorf("invalid restored original editorial")
			}
			found := false
			for _, expected := range source.Editorials {
				found = found || reflect.DeepEqual(prior, expected)
			}
			if !found {
				return nil, fmt.Errorf("restored editorial differs from verified ancestor")
			}
			replay.Editorials = append(replay.Editorials, prior)
			completed[event.Step] = true
		case "control_request", "restore_readback", "cancel_pending", "cancel_pause", "cancel_issued", "cancel_result":
			return nil, fmt.Errorf("restoring noncommitting control artifacts is not supported; cannot rerun a prior cancellation at a different revision")
		case "editorial_request":
			step, exists := steps[event.Step]
			if !initial || !exists || completed[event.Step] || pendingEditorial != nil || requests[event.Step].RequestID != "" || deepStepBlockedReason(step, completed) != "" || !sourceReady() {
				return nil, fmt.Errorf("invalid or repeated editorial source step")
			}
			var err error
			pendingEditorial, err = deepStartEditorialReplay(event.Data, step, event.Seq, root, replay.Pages)
			if err != nil {
				return nil, err
			}
		case "model_request", "model_result":
			if completed[event.Step] {
				return nil, fmt.Errorf("completed source step cannot run another model")
			}
			if pendingEditorial != nil {
				if event.Step != pendingEditorial.entry.Step {
					return nil, fmt.Errorf("editorial model result changed step")
				}
				if err := pendingEditorial.modelEvent(event.Kind, event.Data); err != nil {
					return nil, err
				}
			}
		case "editorial_result":
			if pendingEditorial == nil || pendingEditorial.entry.Step != event.Step || completed[event.Step] {
				return nil, fmt.Errorf("editorial result has no unsettled original request")
			}
			entry, err := pendingEditorial.finish(event.Data, event.Seq, replay.Pages)
			if err != nil {
				return nil, err
			}
			replay.Editorials = append(replay.Editorials, entry)
			completed[event.Step] = true
			pendingEditorial = nil
		case "initial_readback":
			if err := deepStrictSourcePages(event.Data); err != nil {
				return nil, err
			}
			var data struct {
				Snapshot State `json:"snapshot"`
				View     View  `json:"public_view"`
			}
			if initial || json.Unmarshal(event.Data, &data) != nil || !reflect.DeepEqual(data.Snapshot, fixture.State) || data.View.Revision != 1 || len(data.View.Pages) != 1 {
				return nil, fmt.Errorf("invalid original initial readback")
			}
			first := data.View.Pages[0]
			if first.Revision != 1 || first.Mode != "begin" || first.Input != fixture.Seed || first.Text != fixture.Opening {
				return nil, fmt.Errorf("initial replay page differs from fixture")
			}
			title, provenance, titleErr := deepSourceTitle(data.View.Title, 1, sourceVersion)
			if titleErr != nil {
				return nil, titleErr
			}
			if source != nil {
				if !sourceManifest || !sourceReadback || !deepReplayPageMatches(first, source.Pages[0]) || title != deepReplayTitle(source.Pages[0]) {
					return nil, fmt.Errorf("resumed initial page differs from verified ancestor")
				}
			} else {
				replay.Pages = append(replay.Pages, deepReplayPage{Page: data.View.Pages[0], State: data.Snapshot, Title: title, TitleProvenance: provenance})
			}
			initial = true
		case "operation_request":
			var data struct {
				Request AdvanceRequest `json:"request"`
			}
			step, exists := steps[event.Step]
			if !exists || completed[event.Step] || pendingEditorial != nil || !sourceReady() || json.Unmarshal(event.Data, &data) != nil {
				return nil, fmt.Errorf("unknown replay step")
			}
			if reason := deepStepBlockedReason(step, completed); reason != "" {
				return nil, fmt.Errorf("replay bypassed evaluator policy: %s", reason)
			}
			mode, input, reading := step.Mode, step.Input, ""
			if mode == "continue" || mode == "read" {
				mode, input, reading = "read", "", step.Input
			}
			if mode == "player" {
				mode = "act"
			}
			if data.Request.Mode != mode || data.Request.Input != input || data.Request.ReadingRequest != reading {
				return nil, fmt.Errorf("replay operation differs from source step")
			}
			if _, duplicate := requests[event.Step]; duplicate {
				return nil, fmt.Errorf("duplicate replay request")
			}
			requests[event.Step] = data.Request
		case "operation_committed":
			if err := deepStrictSourcePages(event.Data); err != nil {
				return nil, err
			}
			var data struct {
				Snapshot State `json:"snapshot"`
				View     View  `json:"public_view"`
			}
			req, exists := requests[event.Step]
			if !initial || !exists || json.Unmarshal(event.Data, &data) != nil || data.View.Revision != int64(len(replay.Pages)+1) || req.ExpectedRevision != data.View.Revision-1 || len(data.View.Pages) != int(data.View.Revision) {
				return nil, fmt.Errorf("noncontiguous replay")
			}
			page := data.View.Pages[len(data.View.Pages)-1]
			if page.Revision != data.View.Revision || page.Input != req.Input || page.Mode != req.Mode || validateArchiveState(data.Snapshot, data.View.Revision) != nil {
				return nil, fmt.Errorf("invalid replay page/state")
			}
			for n, prior := range replay.Pages {
				matches := reflect.DeepEqual(data.View.Pages[n], prior.Page)
				if source != nil && n < len(source.Pages) {
					matches = deepReplayPageMatches(data.View.Pages[n], prior)
				}
				if !matches {
					return nil, fmt.Errorf("replay rewrote prior page")
				}
			}
			title, provenance, titleErr := deepSourceTitle(data.View.Title, page.Revision, sourceVersion)
			if titleErr != nil {
				return nil, titleErr
			}
			replay.Pages = append(replay.Pages, deepReplayPage{Step: event.Step, Page: page, State: data.Snapshot, Title: title, TitleProvenance: provenance})
			completed[event.Step] = true
		case "observation":
			if err := deepStrictSourcePages(event.Data); err != nil {
				return nil, err
			}
			var data struct {
				Snapshot State `json:"snapshot"`
				View     View  `json:"public_view"`
			}
			step, exists := steps[event.Step]
			if !initial || !exists || completed[event.Step] || pendingEditorial != nil || !sourceReady() || step.Mode != "observe" || deepStepBlockedReason(step, completed) != "" || json.Unmarshal(event.Data, &data) != nil {
				return nil, fmt.Errorf("invalid replay observation")
			}
			last := replay.Pages[len(replay.Pages)-1]
			if data.View.Revision != last.Page.Revision || len(data.View.Pages) != len(replay.Pages) || !reflect.DeepEqual(data.Snapshot, last.State) {
				return nil, fmt.Errorf("replay observation changed current history")
			}
			for i, prior := range replay.Pages {
				matches := reflect.DeepEqual(data.View.Pages[i], prior.Page)
				if source != nil && i < len(source.Pages) {
					matches = deepReplayPageMatches(data.View.Pages[i], prior)
				}
				if !matches {
					return nil, fmt.Errorf("replay observation rewrote prior page")
				}
			}
			completed[event.Step] = true
			replay.Observations = append(replay.Observations, deepReplayObservation{Step: event.Step, EventSeq: event.Seq, Data: append(json.RawMessage(nil), event.Data...)})
		case "run_end":
			ended = true
		default:
			if strings.HasPrefix(event.Kind, "editorial_") || strings.HasPrefix(event.Kind, "control_") ||
				strings.HasPrefix(event.Kind, "cancel_") || strings.HasPrefix(event.Kind, "restored_") ||
				strings.HasPrefix(event.Kind, "resume_") {
				return nil, fmt.Errorf("unsupported control or restoration source event")
			}
		}
	}
	if !ended || !initial || len(replay.Pages) < 2 || previous != root || pendingEditorial != nil || !sourceReady() {
		return nil, fmt.Errorf("unsealed or empty committed replay")
	}
	return replay, nil
}

func TestDeepBenchmarkFixturesEstablishValidPrivateWorlds(t *testing.T) {
	files, err := filepath.Glob("testdata/deep_benchmark/*.json")
	must(t, err)
	for _, path := range files {
		t.Run(filepath.Base(path), func(t *testing.T) {
			raw, err := os.ReadFile(path)
			must(t, err)
			var fixture deepFixture
			must(t, StrictJSON(raw, &fixture))
			must(t, validateArchiveState(fixture.State, 1))
			reader := ReaderState(fixture.State)
			for _, fact := range fixture.State.Facts {
				if fact.Known {
					continue
				}
				for _, public := range reader.Facts {
					if public.ID == fact.ID {
						t.Fatalf("initial hidden world fact leaked in reader projection: %s", fact.ID)
					}
				}
			}
		})
	}
}

func TestDeepBenchmarkReplayPreservesOriginalObservationBeforeLaterCommit(t *testing.T) {
	f := deepFixture{ID: "observation", Seed: "room", Opening: "First room.", State: EmptyState(), Steps: []deepStep{
		{ID: "S01", Mode: "ask", Input: "Where?"}, {ID: "S02", Mode: "observe", Input: "Inspect this checkpoint."}, {ID: "S03", Mode: "read", Input: "Later."},
	}}
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, Reader: ProjectReader(f.State, 1)}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: "Where?", Text: "The room."}, Reader: ProjectReader(f.State, 2)}
	later := f.State
	later.StoryTime = "Later"
	p3 := Page{HistoryPage: HistoryPage{Revision: 3, Mode: "read", Text: "Later room."}, Reader: ProjectReader(later, 3)}
	originalObservation := map[string]any{"step": f.Steps[1], "snapshot": f.State, "public_view": View{Title: "Synthetic second title", Revision: 2, Pages: []Page{p1, p2}}}
	file, err := os.CreateTemp(t.TempDir(), "events-*.jsonl")
	must(t, err)
	defer file.Close()
	evidence := &deepEvidence{file: file}
	must(t, evidence.append("manifest", map[string]any{"fixture": f}))
	must(t, evidence.append("initial_readback", map[string]any{"snapshot": f.State, "public_view": View{Revision: 1, Pages: []Page{p1}}}))
	evidence.step = "S01"
	must(t, evidence.append("operation_request", map[string]any{"request": AdvanceRequest{Mode: "ask", Input: "Where?", ExpectedRevision: 1}}))
	must(t, evidence.append("operation_committed", map[string]any{"snapshot": f.State, "public_view": View{Title: "Synthetic second title", Revision: 2, Pages: []Page{p1, p2}}}))
	evidence.step = "S02"
	must(t, evidence.append("observation", originalObservation))
	evidence.step = "S03"
	must(t, evidence.append("operation_request", map[string]any{"request": AdvanceRequest{Mode: "read", ReadingRequest: "Later.", ExpectedRevision: 2}}))
	must(t, evidence.append("operation_committed", map[string]any{"snapshot": later, "public_view": View{Title: "Synthetic third title", Revision: 3, Pages: []Page{p1, p2, p3}}}))
	must(t, evidence.append("run_end", map[string]any{"status": "REVIEW"}))
	raw, err := os.ReadFile(file.Name())
	must(t, err)
	replay, err := decodeDeepReplay(raw, evidence.previous, f)
	must(t, err)
	if len(replay.Observations) != 1 || replay.Observations[0].Step != "S02" || replay.Observations[0].EventSeq != 5 || !bytes.Equal(replay.Observations[0].Data, narrativeJSON(originalObservation)) {
		t.Fatal("original observation not preserved independently of later current state")
	}
	if len(replay.Pages) != 3 || replay.Pages[2].State.StoryTime != "Later" {
		t.Fatal("observation changed the latest restored state")
	}
}
func readDeepReplay(directory string, fixture deepFixture) (*deepReplay, error) {
	if directory == "" {
		return nil, nil
	}
	if fixture.ID == "" || fixture.ID == "." || filepath.Base(fixture.ID) != fixture.ID || strings.ContainsAny(fixture.ID, `/\`) {
		return nil, fmt.Errorf("invalid replay case ID")
	}
	return deepReadReplayChain(filepath.Join(directory, fixture.ID), "", 0, fixture, map[string]bool{})
}

func TestDeepBenchmarkReplayRejectsUnsealedChangedAndRewrittenHistory(t *testing.T) {
	// The frozen live failure is optional local evidence; portable controls below
	// use a tiny synthetic completed prefix, not a model quality fixture.
	f := deepFixture{ID: "probe", Seed: "a scene", Opening: "A quiet room.", State: EmptyState(), Steps: []deepStep{{ID: "S01", Mode: "ask", Input: "What is known?"}}}
	p1 := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, Suggestions: []string{}, Outcome: "continues"}
	p2 := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: f.Steps[0].Input, Text: "A quiet room."}, Suggestions: []string{}, Outcome: "continues"}
	withArtifact := ""
	makeStream := func(rewrite bool) ([]byte, string) {
		first := p1
		if rewrite {
			first.Text = "A different room."
		}
		data := []struct {
			kind, step string
			value      any
		}{
			{"manifest", "", map[string]any{"fixture": f}},
			{"initial_readback", "", map[string]any{"snapshot": f.State, "public_view": View{Revision: 1, Pages: []Page{p1}}}},
			{"operation_request", "S01", map[string]any{"request": AdvanceRequest{Mode: "ask", Input: f.Steps[0].Input, ExpectedRevision: 1}}},
			{"operation_committed", "S01", map[string]any{"snapshot": f.State, "public_view": View{Title: "Synthetic second title", Revision: 2, Pages: []Page{first, p2}}}},
			{"run_end", "S01", map[string]any{"status": "REVIEW"}},
		}
		if withArtifact != "" {
			data = append(data, data[len(data)-1])
			data[len(data)-2].kind = withArtifact
		}
		var out []byte
		prior := ""
		for i, d := range data {
			raw, _ := json.Marshal(map[string]any{"seq": i + 1, "previous_sha256": prior, "kind": d.kind, "step": d.step, "data": d.value})
			prior = fmt.Sprintf("%x", sha256.Sum256(raw))
			out = append(out, raw...)
			out = append(out, '\n')
		}
		return out, prior
	}
	raw, root := makeStream(false)
	if _, err := decodeDeepReplay(raw, root, f); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeDeepReplay(raw[:len(raw)-1], root, f); err == nil {
		t.Fatal("accepted truncated stream")
	}
	if _, err := decodeDeepReplay(raw, "wrong root", f); err == nil {
		t.Fatal("accepted wrong root")
	}
	changed := f
	changed.Seed = "a different scene"
	if _, err := decodeDeepReplay(raw, root, changed); err == nil {
		t.Fatal("accepted a different fixture")
	}
	raw, root = makeStream(true)
	if _, err := decodeDeepReplay(raw, root, f); err == nil {
		t.Fatal("accepted rewritten prior page")
	}
	for _, field := range []string{"text", "input", "mode", "revision"} {
		t.Run("initial-"+field, func(t *testing.T) {
			original := p1
			defer func() { p1 = original }()
			switch field {
			case "text":
				p1.Text = "Different fixed opening."
			case "input":
				p1.Input = "Different seed."
			case "mode":
				p1.Mode = "ask"
			case "revision":
				p1.Revision = 2
			}
			raw, root := makeStream(false)
			if _, err := decodeDeepReplay(raw, root, f); err == nil {
				t.Fatal("accepted consistent initial page substitution")
			}
		})
	}
	for _, policy := range []string{"dependency", "gate"} {
		t.Run(policy, func(t *testing.T) {
			original := f.Steps[0]
			defer func() { f.Steps[0] = original }()
			if policy == "gate" {
				f.Steps[0].EvidenceGate = "approval"
			} else {
				f.Steps[0].RequiresSteps = []string{"unexecuted"}
			}
			raw, root := makeStream(false)
			if _, err := decodeDeepReplay(raw, root, f); err == nil {
				t.Fatal("resume accepted a step that bypassed evaluator policy")
			}
		})
	}
	for _, kind := range []string{"editorial_request", "control_request", "cancel_result"} {
		withArtifact = kind
		raw, root = makeStream(false)
		if _, err := decodeDeepReplay(raw, root, f); err == nil {
			t.Fatalf("accepted noncommitting %s source that cannot restore its original target", kind)
		}
	}
}
