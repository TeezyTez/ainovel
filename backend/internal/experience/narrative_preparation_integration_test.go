//go:build integration

package experience

import (
	"context"
	"elselife/backend/internal/platform/database"
	"elselife/backend/internal/platform/testpostgres"
	"elselife/backend/internal/sqlc/pgq"
	"elselife/backend/schema"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Deliberately synthetic generation verifies persistence/fences, not story quality.
func approvedSynthetic(c Context) Candidate {
	v := candidate(c)
	if c.Mode != "ask" {
		v.NarrativeUpdate = notebookFixture(c.Revision + 1)
	}
	v.Review = &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(v), Result: NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}}}
	return v
}

func TestNarrativePreparationReadyTTLRestartAndScope(t *testing.T) {
	for _, kind := range []string{"ready_ttl", "expired", "restart", "config", "branch"} {
		t.Run(kind, func(t *testing.T) {
			s, db, _ := testService(t)
			s.NarrativeEngine = true
			s.LeaseSeconds = 3
			s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return approvedSynthetic(c), nil })
			v := begin(t, s, "account", "begin")
			ctx := context.Background()
			must(t, s.PrepareNext(ctx, "account", v.ID, v.BranchID, v.Revision))
			p, err := pgq.New(db).ExperiencePreparationGet(ctx, pgq.ExperiencePreparationGetParams{AccountID: "account", ExperienceID: v.ID, BranchID: v.BranchID, BaseRevision: v.Revision})
			must(t, err)
			if kind == "ready_ttl" {
				if time.Until(p.LeaseUntil) < 10*time.Minute {
					t.Fatal("ready candidate retained only short generation lease")
				}
				return
			}
			if kind == "expired" {
				_, err = db.ExecContext(ctx, `UPDATE experience_narrative_preparations SET lease_until=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2`, "account", p.ID)
				must(t, err)
			}
			if kind == "restart" {
				must(t, s.InvalidatePreparationsOnRestart(ctx))
			}
			if kind == "config" {
				s.MaxContextBytes = 12345
			}
			if kind == "branch" {
				fork, err := s.Fork(ctx, "account", v.ID, ForkRequest{RequestID: "fork", FromBranchID: v.BranchID, FromRevision: 1, Name: "other"})
				must(t, err)
				v.BranchID = fork.BranchID
			}
			status, err := s.Preparation(ctx, "account", v.ID, v.BranchID, v.Revision)
			must(t, err)
			if status.Status != "unavailable" {
				t.Fatalf("invalid scope still ready: %+v", status)
			}
		})
	}
}

func TestNarrativeNotebookHistoricalForkAndArchiveRoundTrip(t *testing.T) {
	s, _, _ := testService(t)
	s.NarrativeEngine = true
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return approvedSynthetic(c), nil })
	v := begin(t, s, "account", "begin")
	v = advance(t, s, "account", v, "act", "act")
	ctx := context.Background()
	fork, err := s.Fork(ctx, "account", v.ID, ForkRequest{RequestID: "fork", FromBranchID: v.BranchID, FromRevision: 1, Name: "past"})
	must(t, err)
	archive, err := s.ExportArchive(ctx, "account")
	must(t, err)
	found := false
	for _, b := range archive.Experiences[0].Branches {
		if b.ID == fork.BranchID {
			found = true
			if b.State.Narrative.ThroughRevision != 1 {
				t.Fatal("future notebook crossed history fork")
			}
		}
	}
	if !found {
		t.Fatal("fork absent")
	}
	if err := validateArchive(archive); err != nil {
		t.Fatal(err)
	}
	archive.Experiences[0].Branches[0].State.Narrative.Style.Voice = strings.Repeat("x", 2049)
	if validateArchive(archive) == nil {
		t.Fatal("archive accepted contract-invalid notebook")
	}
}

func TestNarrativeTemporaryRequestSurvivesAcceptedReceiptAndIsIdempotent(t *testing.T) {
	s, db, _ := testService(t)
	s.NarrativeEngine = true
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return approvedSynthetic(c), nil })
	v := begin(t, s, "account", "begin")
	ctx := context.Background()
	r := AdvanceRequest{RequestID: "read", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read", ReadingRequest: "保持克制"}
	_, fresh, err := s.Advance(ctx, "account", v.ID, r)
	must(t, err)
	if !fresh {
		t.Fatal("not accepted")
	}
	_, fresh, err = s.Advance(ctx, "account", v.ID, r)
	must(t, err)
	if fresh {
		t.Fatal("retry accepted twice")
	}
	o, err := pgq.New(db).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: "account", RequestID: "read"})
	must(t, err)
	if o.ReadingRequest != r.ReadingRequest {
		t.Fatal("request not persisted")
	}
	r.ReadingRequest = "改成轻快"
	_, _, err = s.Advance(ctx, "account", v.ID, r)
	code(t, err, "request_id_conflict")
}

func TestNarrativeNewVersionPreparesWhileCancelledOldProviderExits(t *testing.T) {
	s, _, _ := testService(t)
	s.NarrativeEngine = true
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	s.Generator = generateFunc(func(_ context.Context, c Context, frame string) (Candidate, error) {
		if strings.HasPrefix(frame, "preparation-") && c.Revision == 1 {
			close(started)
			<-release
		}
		return approvedSynthetic(c), nil
	})
	v := begin(t, s, "account", "begin")
	ctx := context.Background()
	go func() { done <- s.PrepareNext(ctx, "account", v.ID, v.BranchID, 1) }()
	<-started
	v = advance(t, s, "account", v, "act", "act")
	must(t, s.PrepareNext(ctx, "account", v.ID, v.BranchID, 2))
	status, err := s.Preparation(ctx, "account", v.ID, v.BranchID, 2)
	close(release)
	<-done
	must(t, err)
	if status.Status != "ready" {
		t.Fatalf("new committed revision lost preparation while old canceled provider exited: %+v", status)
	}
}

func TestNarrativeFormalApprovalIsDurableAndPrivate(t *testing.T) {
	s, db, _ := testService(t)
	s.NarrativeEngine = true
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return approvedSynthetic(c), nil })
	v := begin(t, s, "account", "begin")
	var raw []byte
	if err := db.QueryRow(`SELECT narrative_approval FROM experience_operations WHERE account_id='account' AND request_id='begin'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var approval NarrativeApproval
	if json.Unmarshal(raw, &approval) != nil || !approval.Result.Approved {
		t.Fatal("approval receipt not persisted")
	}
	if strings.Contains(string(narrativeJSON(v)), "narrative_approval") || strings.Contains(string(narrativeJSON(v)), "knowledge_supports") {
		t.Fatal("private review leaked")
	}
}

func TestNarrativeAdditiveMigrationKeepsExistingHistory(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, testpostgres.New(t).DSN())
	must(t, err)
	defer db.Close()
	cut := strings.Index(schema.SQL, "ALTER TABLE experience_operations ADD COLUMN reading_request")
	if cut < 0 {
		t.Fatal("migration marker absent")
	}
	_, err = db.ExecContext(ctx, schema.SQL[:cut]+"COMMIT;")
	must(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO experiences(account_id,id,seed,active_branch_id) VALUES('local','e','original','b'); INSERT INTO experience_branches(account_id,experience_id,id,name,title,revision,state) VALUES('local','e','b','main','original',1,'{"story_time":"night","facts":[],"entities":[],"threads":[]}'); INSERT INTO experience_pages(account_id,experience_id,branch_id,revision,page,state,title) VALUES('local','e','b',1,'{"text":"preserve exactly"}','{"story_time":"night","facts":[],"entities":[],"threads":[]}','original');`)
	must(t, err)
	must(t, schema.ApplyNarrative(ctx, db))
	must(t, schema.ApplyNarrative(ctx, db))
	var text string
	must(t, db.QueryRowContext(ctx, `SELECT page->>'text' FROM experience_pages WHERE account_id='local'`).Scan(&text))
	if text != "preserve exactly" {
		t.Fatal("migration changed history")
	}
}
func TestNarrativePreparationReadUsesNewFenceAndPreservesNotebook(t *testing.T) {
	s, _, _ := testService(t)
	s.NarrativeEngine = true
	var calls atomic.Int32
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		calls.Add(1)
		return approvedSynthetic(c), nil
	})
	v := begin(t, s, "account", "begin")
	ctx := context.Background()
	must(t, s.PrepareNext(ctx, "account", v.ID, v.BranchID, v.Revision))
	prep, err := s.Preparation(ctx, "account", v.ID, v.BranchID, v.Revision)
	must(t, err)
	if prep.Status != "ready" {
		t.Fatalf("%+v", prep)
	}
	_, fresh, err := s.Advance(ctx, "account", v.ID, AdvanceRequest{RequestID: "read", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "read", Input: ""})
	must(t, err)
	if !fresh {
		t.Fatal("not accepted")
	}
	must(t, s.GenerateAccepted(ctx, "account", "read"))
	if calls.Load() != 2 {
		t.Fatalf("cached read called model: %d", calls.Load())
	}
	got, err := s.Get(ctx, "account", v.ID, v.BranchID)
	must(t, err)
	if got.Revision != 2 {
		t.Fatalf("revision %d", got.Revision)
	}
	archive, err := s.ExportArchive(ctx, "account")
	must(t, err)
	if archive.Experiences[0].Branches[0].State.Narrative.ThroughRevision != 2 {
		t.Fatal("notebook not durable")
	}
	if got.Reader == nil {
		t.Fatal("reader missing")
	}
}
func TestNarrativePreparationLateResultCannotCrossAction(t *testing.T) {
	s, _, _ := testService(t)
	s.NarrativeEngine = true
	started := make(chan struct{})
	release := make(chan struct{})
	s.Generator = generateFunc(func(_ context.Context, c Context, frame string) (Candidate, error) {
		if strings.HasPrefix(frame, "preparation-") {
			close(started)
			<-release
		}
		return approvedSynthetic(c), nil
	})
	v := begin(t, s, "account", "begin")
	ctx := context.Background()
	done := make(chan error, 1)
	go func() { done <- s.PrepareNext(ctx, "account", v.ID, v.BranchID, v.Revision) }()
	<-started
	_, _, err := s.Advance(ctx, "account", v.ID, AdvanceRequest{RequestID: "act", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "act", Input: "离开"})
	must(t, err)
	close(release)
	<-done
	prep, err := s.Preparation(ctx, "account", v.ID, v.BranchID, v.Revision)
	must(t, err)
	if prep.Status == "ready" {
		t.Fatal("late candidate survived fence change")
	}
	must(t, s.GenerateAccepted(ctx, "account", "act"))
}
func TestNarrativePreparationTemporaryRequestAndPreferenceInvalidate(t *testing.T) {
	for _, kind := range []string{"temporary", "preference"} {
		t.Run(kind, func(t *testing.T) {
			s, _, _ := testService(t)
			s.NarrativeEngine = true
			var calls atomic.Int32
			s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
				calls.Add(1)
				if c.Revision == 1 && kind == "temporary" && calls.Load() == 3 && c.ReadingRequest != "少一点对话" {
					t.Fatal("temporary request lost")
				}
				return approvedSynthetic(c), nil
			})
			v := begin(t, s, "account", "begin")
			ctx := context.Background()
			must(t, s.PrepareNext(ctx, "account", v.ID, v.BranchID, v.Revision))
			request := ""
			if kind == "temporary" {
				request = "少一点对话"
			} else {
				value := "克制"
				_, err := s.ChangePreference(ctx, "account", PreferenceChange{Dimension: "文风", Value: &value, Expression: value, Confirmation: "direct_expression"})
				must(t, err)
			}
			_, _, err := s.Advance(ctx, "account", v.ID, AdvanceRequest{RequestID: "read", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "read", ReadingRequest: request})
			must(t, err)
			must(t, s.GenerateAccepted(ctx, "account", "read"))
			if calls.Load() != 3 {
				t.Fatalf("stale preparation reused, calls %d", calls.Load())
			}
		})
	}
}
