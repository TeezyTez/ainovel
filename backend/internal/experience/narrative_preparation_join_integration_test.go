//go:build integration

package experience

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"elselife/backend/internal/sqlc/pgq"
)

// This blocking synthetic provider verifies reuse, cancellation and commit
// authority. It does not measure model latency or assess narrative quality.
type preparationJoinFixture struct {
	s        *Service
	db       *sql.DB
	view     View
	release  chan struct{}
	done     chan error
	finished chan struct{}
	calls    atomic.Int32
	unblock  sync.Once
}

func newPreparationJoinFixture(t *testing.T, generationError error, ignoreCancellation ...bool) *preparationJoinFixture {
	t.Helper()
	s, db, _ := testService(t)
	s.NarrativeEngine = true
	s.LeaseSeconds = 3
	f := &preparationJoinFixture{s: s, db: db, release: make(chan struct{}), done: make(chan error, 1), finished: make(chan struct{})}
	started := make(chan struct{})
	s.Generator = generateFunc(func(ctx context.Context, c Context, frame string) (Candidate, error) {
		f.calls.Add(1)
		if strings.HasPrefix(frame, "preparation-") {
			close(started)
			if len(ignoreCancellation) > 0 && ignoreCancellation[0] {
				<-f.release
			} else {
				select {
				case <-f.release:
				case <-ctx.Done():
					return Candidate{}, ctx.Err()
				}
			}
			if generationError != nil {
				return Candidate{}, generationError
			}
		}
		v := approvedSynthetic(c)
		if strings.HasPrefix(frame, "preparation-") {
			v.Passage = "原有后台生成的正文。"
			v.Review.Candidate = narrativeJSON(v)
		}
		return v, nil
	})
	f.view = begin(t, s, "account", "begin")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		f.unblock.Do(func() { close(f.release) })
		select {
		case <-f.finished:
		case <-time.After(5 * time.Second):
			t.Error("preparation did not finish during cleanup")
		}
	})
	go func() {
		f.done <- s.PrepareNext(ctx, "account", f.view.ID, f.view.BranchID, f.view.Revision)
		close(f.finished)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("preparation did not start")
	}
	return f
}

func (f *preparationJoinFixture) accept(t *testing.T, id, request string) {
	t.Helper()
	type result struct {
		fresh bool
		err   error
	}
	accepted := make(chan result, 1)
	go func() {
		_, fresh, err := f.s.Advance(context.Background(), "account", f.view.ID, AdvanceRequest{
			RequestID: id, BranchID: f.view.BranchID, ExpectedRevision: f.view.Revision, Mode: "read", ReadingRequest: request,
		})
		accepted <- result{fresh, err}
	}()
	select {
	case got := <-accepted:
		if got.err != nil || !got.fresh {
			t.Fatalf("read not accepted: fresh=%v err=%v", got.fresh, got.err)
		}
	case <-time.After(time.Second):
		t.Fatal("Advance waited for model completion before accepting HTTP work")
	}
}

func (f *preparationJoinFixture) generate() <-chan error {
	done := make(chan error, 1)
	go func() { done <- f.s.GenerateAccepted(context.Background(), "account", "read") }()
	return done
}

func awaitJoinedGeneration(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		must(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("accepted generation did not finish")
	}
}

func TestNarrativePreparingReadJoinsWithoutBlockingAcceptanceOrRegeneration(t *testing.T) {
	f := newPreparationJoinFixture(t, nil)
	f.accept(t, "read", "")
	generated := f.generate()
	select {
	case err := <-generated:
		t.Fatalf("accepted read did not wait for the existing preparation: %v, calls=%d", err, f.calls.Load())
	case <-time.After(120 * time.Millisecond):
	}
	if f.calls.Load() != 2 {
		t.Fatalf("early click launched another model generation: %d", f.calls.Load())
	}
	f.unblock.Do(func() { close(f.release) })
	awaitJoinedGeneration(t, generated)
	must(t, f.s.GenerateAccepted(context.Background(), "account", "read"))
	got, err := f.s.Get(context.Background(), "account", f.view.ID, f.view.BranchID)
	must(t, err)
	if got.Revision != 2 || len(got.Pages) != 2 || got.Pages[1].Text != "原有后台生成的正文。" || f.calls.Load() != 2 {
		t.Fatalf("prepared read did not commit exactly once: revision=%d pages=%d calls=%d", got.Revision, len(got.Pages), f.calls.Load())
	}
}

func TestNarrativePreparingReadFailureNeverStartsReplacement(t *testing.T) {
	f := newPreparationJoinFixture(t, errors.New("synthetic provider failed"))
	f.accept(t, "read", "")
	generated := f.generate()
	f.unblock.Do(func() { close(f.release) })
	awaitJoinedGeneration(t, generated)
	got, err := f.s.Get(context.Background(), "account", f.view.ID, f.view.BranchID)
	must(t, err)
	if got.Revision != 1 || got.Operation == nil || got.Operation.Status != "failed" || f.calls.Load() != 2 {
		t.Fatalf("failed preparation was replaced or committed: revision=%d op=%+v calls=%d", got.Revision, got.Operation, f.calls.Load())
	}
}

func TestNarrativePreparingReadInvalidationNeverFallsBack(t *testing.T) {
	for _, invalidation := range []string{"cancel", "preference", "restart", "fence", "lost_owner"} {
		t.Run(invalidation, func(t *testing.T) {
			f := newPreparationJoinFixture(t, nil)
			f.accept(t, "read", "")
			ctx := context.Background()
			switch invalidation {
			case "cancel":
				_, err := f.s.Cancel(ctx, "account", f.view.ID, "read")
				must(t, err)
			case "preference":
				value := "安静"
				_, err := f.s.ChangePreference(ctx, "account", PreferenceChange{Dimension: "文风", Value: &value, Expression: value, Confirmation: "direct_expression"})
				must(t, err)
			case "restart":
				must(t, f.s.InvalidatePreparationsOnRestart(ctx))
			case "fence":
				_, err := pgq.New(f.db).ExperienceBranchFence(ctx, pgq.ExperienceBranchFenceParams{AccountID: "account", ExperienceID: f.view.ID, ID: f.view.BranchID})
				must(t, err)
			case "lost_owner":
				// A new process cannot wait on or adopt another process's worker.
				f.s = &Service{DB: f.s.DB, Generator: f.s.Generator, NarrativeEngine: true, LeaseSeconds: 3}
			}
			generated := f.generate()
			if invalidation != "lost_owner" {
				f.unblock.Do(func() { close(f.release) })
			}
			awaitJoinedGeneration(t, generated)
			got, err := f.s.Get(ctx, "account", f.view.ID, f.view.BranchID)
			must(t, err)
			if got.Revision != 1 || f.calls.Load() != 2 {
				t.Fatalf("invalidated claim fell back or committed: revision=%d calls=%d", got.Revision, f.calls.Load())
			}
		})
	}
}

func TestNarrativePreparingExplicitReadingRequestStartsItsOwnGeneration(t *testing.T) {
	f := newPreparationJoinFixture(t, nil)
	f.accept(t, "read", "请换成缓慢的节奏")
	awaitJoinedGeneration(t, f.generate())
	if f.calls.Load() != 3 {
		t.Fatalf("explicit reading request reused the default preparation: calls=%d", f.calls.Load())
	}
}

func TestNarrativePreparingClaimRaceHasOneAcceptedOwner(t *testing.T) {
	f := newPreparationJoinFixture(t, nil)
	ctx := context.Background()
	var accepted atomic.Int32
	var owner string
	var ownerMu sync.Mutex
	var wg sync.WaitGroup
	for _, id := range []string{"read", "other"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			_, fresh, err := f.s.Advance(ctx, "account", f.view.ID, AdvanceRequest{RequestID: id, BranchID: f.view.BranchID, ExpectedRevision: f.view.Revision, Mode: "read"})
			if err == nil && fresh {
				accepted.Add(1)
				ownerMu.Lock()
				owner = id
				ownerMu.Unlock()
			}
		}(id)
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("claim race accepted %d operations", accepted.Load())
	}
	f.unblock.Do(func() { close(f.release) })
	must(t, f.s.GenerateAccepted(ctx, "account", owner))
	if f.calls.Load() != 2 {
		t.Fatalf("claim race discarded preparation: calls=%d", f.calls.Load())
	}
}

func TestNarrativePreparingReadRenewsBothLeasesWhileWaiting(t *testing.T) {
	f := newPreparationJoinFixture(t, nil)
	f.accept(t, "read", "")
	generated := f.generate()
	// The initial leases last three seconds. Crossing that boundary verifies
	// both workers keep their distinct leases, rather than testing a quick handoff.
	select {
	case err := <-generated:
		t.Fatalf("joined generation completed before provider: %v", err)
	case <-time.After(3400 * time.Millisecond):
	}
	ctx := context.Background()
	q := pgq.New(f.db)
	p, err := q.ExperiencePreparationClaimed(ctx, pgq.ExperiencePreparationClaimedParams{AccountID: "account", ClaimedRequestID: ns("read")})
	must(t, err)
	o, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: "account", RequestID: "read"})
	must(t, err)
	now, err := q.ExperienceDatabaseTime(ctx)
	must(t, err)
	if p.Status != "preparing" || o.Status != "generating" || !p.LeaseUntil.After(now) || !o.LeaseUntil.After(now) || f.calls.Load() != 2 {
		t.Fatalf("joined workers lost leases or regenerated: prep=%s op=%s calls=%d", p.Status, o.Status, f.calls.Load())
	}
	f.unblock.Do(func() { close(f.release) })
	awaitJoinedGeneration(t, generated)
	got, err := f.s.Get(ctx, "account", f.view.ID, f.view.BranchID)
	must(t, err)
	if got.Revision != 2 {
		t.Fatalf("renewed preparation did not commit: %d", got.Revision)
	}
}

func TestNarrativePreparingCancelDoesNotWaitForUncooperativeProvider(t *testing.T) {
	f := newPreparationJoinFixture(t, nil, true)
	f.accept(t, "read", "")
	generated := f.generate()
	deadline := time.After(2 * time.Second)
	for {
		o, err := f.s.GetOperation(context.Background(), "account", f.view.ID, "read")
		must(t, err)
		if o.Status == "generating" {
			break
		}
		select {
		case <-deadline:
			t.Fatal("accepted worker did not start")
		case <-time.After(5 * time.Millisecond):
		}
	}
	_, err := f.s.Cancel(context.Background(), "account", f.view.ID, "read")
	must(t, err)
	select {
	case err := <-generated:
		must(t, err)
	case <-time.After(time.Second):
		t.Fatal("cancel waited for provider or normal lease heartbeat")
	}
	f.unblock.Do(func() { close(f.release) })
	select {
	case <-f.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("late provider did not exit")
	}
	got, err := f.s.Get(context.Background(), "account", f.view.ID, f.view.BranchID)
	must(t, err)
	if got.Revision != 1 || got.Operation == nil || got.Operation.Status != "cancelled" || f.calls.Load() != 2 {
		t.Fatalf("late provider crossed cancellation: revision=%d operation=%+v calls=%d", got.Revision, got.Operation, f.calls.Load())
	}
}

func TestNarrativePreparingCancelOldCommittedRequestKeepsNextPreparation(t *testing.T) {
	f := newPreparationJoinFixture(t, nil)
	o, err := f.s.Cancel(context.Background(), "account", f.view.ID, "begin")
	must(t, err)
	if o.Status != "committed" {
		t.Fatalf("old committed status changed: %s", o.Status)
	}
	f.accept(t, "read", "")
	generated := f.generate()
	f.unblock.Do(func() { close(f.release) })
	awaitJoinedGeneration(t, generated)
	got, err := f.s.Get(context.Background(), "account", f.view.ID, f.view.BranchID)
	must(t, err)
	if got.Revision != 2 || f.calls.Load() != 2 {
		t.Fatalf("old cancel discarded the current preparation: revision=%d calls=%d", got.Revision, f.calls.Load())
	}
}

func TestNarrativePreparingPreferenceWhileWaitingStopsWithoutReplacement(t *testing.T) {
	f := newPreparationJoinFixture(t, nil, true)
	f.accept(t, "read", "")
	generated := f.generate()
	select {
	case err := <-generated:
		t.Fatalf("joined worker did not wait: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	value := "疏朗"
	_, err := f.s.ChangePreference(context.Background(), "account", PreferenceChange{Dimension: "文风", Value: &value, Expression: value, Confirmation: "direct_expression"})
	must(t, err)
	select {
	case err := <-generated:
		must(t, err)
	case <-time.After(time.Second):
		t.Fatal("preference invalidation waited for an uncooperative provider")
	}
	got, err := f.s.Get(context.Background(), "account", f.view.ID, f.view.BranchID)
	must(t, err)
	if got.Revision != 1 || got.Operation == nil || got.Operation.Status != "failed" || f.calls.Load() != 2 {
		t.Fatalf("preference change restarted or committed the claim: revision=%d calls=%d", got.Revision, f.calls.Load())
	}
}

type preparationReaderGenerator struct {
	started chan *sourceReader
	release chan struct{}
}

func (g *preparationReaderGenerator) Generate(_ context.Context, c Context, _ string) (Candidate, error) {
	return approvedSynthetic(c), nil
}

func (g *preparationReaderGenerator) GenerateWithReads(ctx context.Context, c Context, frame string, reader Reader) (Candidate, error) {
	if strings.HasPrefix(frame, "preparation-") {
		g.started <- reader.(*sourceReader)
		<-g.release
	}
	return g.Generate(ctx, c, frame)
}

func TestNarrativePreparingClaimRetainsSourceHandleBudgetAuditAndFence(t *testing.T) {
	s, db, _ := testService(t)
	s.NarrativeEngine = true
	s.LeaseSeconds = 3
	g := &preparationReaderGenerator{started: make(chan *sourceReader, 1), release: make(chan struct{})}
	s.Generator = g
	v := begin(t, s, "account", "begin")
	ctx := context.Background()
	prepared := make(chan error, 1)
	var unblock sync.Once
	go func() { prepared <- s.PrepareNext(ctx, "account", v.ID, v.BranchID, v.Revision) }()
	t.Cleanup(func() {
		unblock.Do(func() { close(g.release) })
		select {
		case <-prepared:
		case <-time.After(5 * time.Second):
			t.Error("reader preparation did not finish")
		}
	})
	var reader *sourceReader
	select {
	case reader = <-g.started:
	case <-time.After(5 * time.Second):
		t.Fatal("reader preparation did not start")
	}
	one := int64(1)
	request := ReadRequest{RequestID: "first", SourceHandle: reader.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "pages", FromRevision: &one, ToRevision: &one}, MaxReplyBytes: 8192}
	_, err := reader.Read(ctx, request)
	must(t, err)
	_, fresh, err := s.Advance(ctx, "account", v.ID, AdvanceRequest{RequestID: "read", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "read"})
	must(t, err)
	if !fresh {
		t.Fatal("read not accepted")
	}
	generated := make(chan error, 1)
	go func() { generated <- s.GenerateAccepted(ctx, "account", "read") }()
	if _, err = reader.Read(ctx, request); err == nil {
		t.Fatal("handoff reset the original reader's request budget")
	}
	request.RequestID = "second"
	reply, err := reader.Read(ctx, request)
	must(t, err)
	if reply.SourceHandle != request.SourceHandle || len(reply.Pages) != 1 || reply.Pages[0].Text != v.Pages[0].Text {
		t.Fatal("handoff changed the source handle or authoritative page")
	}
	must(t, reader.RecordModel(ctx, reader.generation, 1, []byte(`{}`)))
	p, err := pgq.New(db).ExperiencePreparationClaimed(ctx, pgq.ExperiencePreparationClaimedParams{AccountID: "account", ClaimedRequestID: ns("read")})
	must(t, err)
	if !strings.Contains(string(p.Audit), `"kind": "model"`) || !strings.Contains(string(p.Audit), `"second"`) {
		t.Fatal("continued source access lost the original preparation audit")
	}
	_, err = pgq.New(db).ExperienceBranchFence(ctx, pgq.ExperienceBranchFenceParams{AccountID: "account", ExperienceID: v.ID, ID: v.BranchID})
	must(t, err)
	request.RequestID = "late"
	if _, err := reader.Read(ctx, request); err == nil {
		t.Fatal("continued reader crossed an additional fence")
	}
	unblock.Do(func() { close(g.release) })
	awaitJoinedGeneration(t, generated)
	got, err := s.Get(ctx, "account", v.ID, v.BranchID)
	must(t, err)
	if got.Revision != 1 {
		t.Fatal("stale reader preparation committed")
	}
}
