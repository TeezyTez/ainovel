//go:build integration

package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"sync"
	"testing"
	"time"

	"elselife/backend/internal/platform/database"
	"elselife/backend/internal/sqlc/pgq"
)

// The real Go evidence compiler forms a synthetic v2 approval before this
// fixture pauses its original preparation worker. The pause schedules faults;
// it neither edits the candidate nor creates an approval from test JSON.
// No provider/model is called and no narrative quality is assessed here.
type memoryPreparationFaultFixture struct {
	service     *Service
	db          *sql.DB
	dsn         string
	view        View
	before      Archive
	generator   *memoryLifecycleGenerator
	preparation pgq.ExperienceNarrativePreparation
	release     chan struct{}
	prepared    chan error
	finished    chan struct{}
	unblock     sync.Once
}

func newMemoryPreparationFaultFixture(t *testing.T) *memoryPreparationFaultFixture {
	t.Helper()
	s, db, dsn := testService(t)
	ctx := context.Background()
	f := &memoryPreparationFaultFixture{
		service: s, db: db, dsn: dsn, release: make(chan struct{}),
		prepared: make(chan error, 1), finished: make(chan struct{}),
	}
	f.view = begin(t, s, "memory-preparation", "begin")
	var err error
	f.before, err = s.ExportArchive(ctx, "memory-preparation")
	must(t, err)
	started := make(chan struct{})
	f.generator = &memoryLifecycleGenerator{}
	f.generator.edit = func(*Candidate) {
		if f.generator.calls.Load() == 1 {
			close(started)
			// Deliberately return the original late result after cancellation.
			// The service must reject its stale authority independently.
			<-f.release
		}
	}
	s.NarrativeEngine, s.Generator, s.LeaseSeconds = true, f.generator, 30
	run, cancel := context.WithCancel(ctx)
	t.Cleanup(func() {
		cancel()
		f.unblock.Do(func() { close(f.release) })
		select {
		case <-f.finished:
		case <-time.After(5 * time.Second):
			t.Error("synthetic preparation worker did not exit during cleanup")
		}
	})
	go func() {
		f.prepared <- s.PrepareNext(run, "memory-preparation", f.view.ID, f.view.BranchID, f.view.Revision)
		close(f.finished)
	}()
	select {
	case <-started:
	case err := <-f.prepared:
		t.Fatalf("precondition: v2 approval failed before the fault scheduling point: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("synthetic v2 preparation did not reach the scheduling point")
	}
	f.preparation, err = pgq.New(db).ExperiencePreparationGet(ctx, pgq.ExperiencePreparationGetParams{
		AccountID: "memory-preparation", ExperienceID: f.view.ID, BranchID: f.view.BranchID, BaseRevision: f.view.Revision,
	})
	must(t, err)
	if f.preparation.Status != "preparing" || f.preparation.ClaimedRequestID.Valid {
		t.Fatal("fixture is not an unclaimed in-progress preparation")
	}
	return f
}

func (f *memoryPreparationFaultFixture) claim(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	_, fresh, err := f.service.Advance(ctx, "memory-preparation", f.view.ID, AdvanceRequest{
		RequestID: "consume", BranchID: f.view.BranchID, ExpectedRevision: f.view.Revision, Mode: "read",
	})
	must(t, err)
	if !fresh {
		t.Fatal("in-progress preparation did not receive a fresh accepted operation")
	}
	p, err := pgq.New(f.db).ExperiencePreparationClaimed(ctx, pgq.ExperiencePreparationClaimedParams{
		AccountID: "memory-preparation", ClaimedRequestID: ns("consume"),
	})
	must(t, err)
	if p.ID != f.preparation.ID || p.Status != "preparing" {
		t.Fatal("acceptance did not claim the original in-progress preparation")
	}
}

func (f *memoryPreparationFaultFixture) generate(s *Service) <-chan error {
	done := make(chan error, 1)
	go func() { done <- s.GenerateAccepted(context.Background(), "memory-preparation", "consume") }()
	return done
}

func (f *memoryPreparationFaultFixture) waitForConsumer(t *testing.T, done <-chan error) {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		o, err := f.service.GetOperation(context.Background(), "memory-preparation", f.view.ID, "consume")
		must(t, err)
		if o.Status == "generating" {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("consumer exited before waiting on the original preparation: %v", err)
		case <-deadline.C:
			t.Fatal("consumer did not start")
		case <-tick.C:
		}
	}
	select {
	case err := <-done:
		t.Fatalf("consumer did not wait for the original preparation: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if f.generator.calls.Load() != 1 {
		t.Fatal("waiting for an existing preparation started replacement generation")
	}
}

func memoryPreparationResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("preparation handoff did not terminate")
		return nil
	}
}

func (f *memoryPreparationFaultFixture) assertNoCommit(t *testing.T, s *Service, cancelled bool) {
	t.Helper()
	ctx := context.Background()
	after, err := s.ExportArchive(ctx, "memory-preparation")
	must(t, err)
	if !reflect.DeepEqual(f.before, after) {
		t.Fatal("invalidated claim changed formal pages, snapshots, or branches")
	}
	if f.generator.calls.Load() != 1 {
		t.Fatalf("invalidated claim launched replacement generation: calls=%d", f.generator.calls.Load())
	}
	o, err := pgq.New(f.db).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{
		AccountID: "memory-preparation", RequestID: "consume",
	})
	must(t, err)
	if o.Status == "committed" || o.CommittedRevision.Valid || len(o.NarrativeApproval) != 0 {
		t.Fatal("invalidated claim retained a commit or durable narrative approval")
	}
	if cancelled && o.Status != "cancelled" {
		t.Fatalf("cancelled claim status=%s", o.Status)
	}
	if !cancelled && o.Status != "failed" && o.Status != "interrupted" {
		t.Fatalf("invalidated claim is not terminal: %s", o.Status)
	}
}

func TestMemoryEvidencePreparingClaimWaitsAndKeepsOriginalOrigin(t *testing.T) {
	f := newMemoryPreparationFaultFixture(t)
	f.claim(t)
	consumed := f.generate(f.service)
	f.waitForConsumer(t, consumed)
	f.unblock.Do(func() { close(f.release) })
	must(t, memoryPreparationResult(t, f.prepared))
	must(t, memoryPreparationResult(t, consumed))
	must(t, f.service.GenerateAccepted(context.Background(), "memory-preparation", "consume"))
	after, err := f.service.ExportArchive(context.Background(), "memory-preparation")
	must(t, err)
	branch := after.Experiences[0].Branches[0]
	if branch.Revision != f.view.Revision+1 || len(branch.Pages) != len(f.view.Pages)+1 ||
		f.generator.calls.Load() != 1 || branch.State.LiteraryMemory == nil || branch.State.LiteraryMemory.Version != 2 {
		t.Fatal("waiting claim did not adopt the original v2 result exactly once")
	}
	o, err := pgq.New(f.db).ExperienceOperationGet(context.Background(), pgq.ExperienceOperationGetParams{
		AccountID: "memory-preparation", RequestID: "consume",
	})
	must(t, err)
	var approval NarrativeApproval
	must(t, json.Unmarshal(o.NarrativeApproval, &approval))
	if o.Status != "committed" || approval.Evidence == nil ||
		approval.Evidence.Origin.Kind != "preparation" || approval.Evidence.Origin.ID != f.preparation.ID ||
		approval.Evidence.Origin.BaseFence != f.preparation.BaseFence {
		t.Fatal("committed handoff relabelled or lost its original preparation origin")
	}
}

func TestMemoryEvidencePreparingClaimFaultsDoNotFallbackOrCommit(t *testing.T) {
	for _, fault := range []string{"cancel", "lease", "fence", "restart", "preference"} {
		t.Run(fault, func(t *testing.T) {
			f := newMemoryPreparationFaultFixture(t)
			f.claim(t)
			ctx := context.Background()
			consumer := f.service
			var consumed <-chan error
			// Cancellation and preference invalidation must wake an already
			// waiting consumer without waiting for the uncooperative provider.
			if fault == "cancel" || fault == "preference" {
				consumed = f.generate(consumer)
				f.waitForConsumer(t, consumed)
			}
			switch fault {
			case "cancel":
				_, err := consumer.Cancel(ctx, "memory-preparation", f.view.ID, "consume")
				must(t, err)
			case "lease":
				_, err := f.db.ExecContext(ctx,
					`UPDATE experience_narrative_preparations SET lease_until=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2`,
					"memory-preparation", f.preparation.ID)
				must(t, err)
			case "fence":
				_, err := pgq.New(f.db).ExperienceBranchFence(ctx, pgq.ExperienceBranchFenceParams{
					AccountID: "memory-preparation", ExperienceID: f.view.ID, ID: f.view.BranchID,
				})
				must(t, err)
			case "restart":
				connection, err := database.OpenServing(ctx, f.dsn)
				must(t, err)
				t.Cleanup(func() { connection.Close() })
				// Fresh Service and DB connection, not an OS process kill.
				consumer = &Service{DB: connection, Generator: f.generator, NarrativeEngine: true, LeaseSeconds: 30}
				must(t, consumer.InvalidatePreparationsOnRestart(ctx))
			case "preference":
				value := "quiet"
				_, err := consumer.ChangePreference(ctx, "memory-preparation", PreferenceChange{
					Dimension: "style", Value: &value, Expression: value, Confirmation: "direct_expression",
				})
				must(t, err)
			}
			if consumed == nil {
				consumed = f.generate(consumer)
			}
			if err := memoryPreparationResult(t, consumed); err != nil {
				t.Logf("invalidated accepted operation returned: %v", err)
			}
			f.unblock.Do(func() { close(f.release) })
			if err := memoryPreparationResult(t, f.prepared); err != nil {
				t.Logf("original late preparation returned: %v", err)
			}
			f.assertNoCommit(t, consumer, fault == "cancel")
		})
	}
}
