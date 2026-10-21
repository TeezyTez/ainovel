package experience

import (
	"context"
	"database/sql"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type PreparationStatus struct {
	ExperienceID string `json:"experience_id"`
	BranchID     string `json:"branch_id"`
	BaseRevision int64  `json:"base_revision"`
	Status       string `json:"status"`
}
type preparationRun struct {
	revision int64
	id       string
	cancel   context.CancelFunc
	stopped  <-chan struct{}
	done     chan struct{}
}

func preparationKey(a, e, b string) string { return a + "\x00" + e + "\x00" + b }
func (s *Service) cancelPreparation(a, e, b string) {
	s.preparationsMu.Lock()
	defer s.preparationsMu.Unlock()
	key := preparationKey(a, e, b)
	if run := s.preparations[key]; run != nil {
		run.cancel()
		delete(s.preparations, key)
	}
}

func (s *Service) cancelPreparationID(a, e, b, id string) {
	s.preparationsMu.Lock()
	defer s.preparationsMu.Unlock()
	key := preparationKey(a, e, b)
	if run := s.preparations[key]; run != nil && run.id == id {
		run.cancel()
		delete(s.preparations, key)
	}
}

func (s *Service) preparationOwner(p pgq.ExperienceNarrativePreparation) *preparationRun {
	s.preparationsMu.Lock()
	defer s.preparationsMu.Unlock()
	run := s.preparations[preparationKey(p.AccountID, p.ExperienceID, p.BranchID)]
	if run == nil || run.revision != p.BaseRevision || run.id != p.ID {
		return nil
	}
	return run
}
func (s *Service) cancelAccountPreparations(a string) {
	s.preparationsMu.Lock()
	defer s.preparationsMu.Unlock()
	for key, run := range s.preparations {
		if strings.HasPrefix(key, a+"\x00") {
			run.cancel()
			delete(s.preparations, key)
		}
	}
}

func (s *Service) preparationConfig() any {
	common := map[string]any{"engine": narrativeEngineVersion, "generator": fmt.Sprintf("%T", s.Generator), "recent": s.RecentRevisions, "capacity": s.capacity(), "read_limits": s.ReadLimits}
	if a, ok := s.Generator.(*Algorithm); ok {
		common["model"] = a.ModelName
		common["provider"] = fmt.Sprintf("%T:%p", a.Model, a.Model)
		common["model_context"] = a.ModelContextTokens
		common["output_tokens"] = a.outputTokens()
		common["input_bytes"] = a.MaxModelInputBytes
		common["output_bytes"] = a.MaxOutputBytes
		common["calls"] = a.MaxModelCalls
		common["verified"] = a.ModelByteTokenBoundVerified
		common["timeout"] = a.Timeout
		if cli, ok := a.Model.(*model.CodexCLI); ok {
			common["reasoning_effort"] = cli.ReasoningEffort
			common["cli_model"] = cli.Model
			common["cli_path"] = cli.Path
		}
	}
	return common
}

// All content/config inputs that can affect a prepared read are pinned. Fence
// and revision are separate SQL columns, so a claimed read can use its new fence.
func (s *Service) preparationPin(ctx context.Context, q *pgq.Queries, a, e, b string, state json.RawMessage) (string, error) {
	world, err := branchAuthorWorld(ctx, q, a, e, b)
	if err != nil {
		return "", err
	}
	prefs, err := q.ExperiencePreferences(ctx, a)
	if err != nil {
		return "", err
	}
	experience, err := q.ExperienceGet(ctx, pgq.ExperienceGetParams{AccountID: a, ID: e})
	if err != nil {
		return "", err
	}
	seed, err := branchSeed(ctx, q, a, e, b, experience.Seed)
	if err != nil {
		return "", err
	}
	canonical, err := canonicalRawJSON(state)
	if err != nil {
		return "", err
	}
	return digest("preparation", e+":"+b, struct {
		State       json.RawMessage
		Preferences []PreferenceSnapshot
		World       *WorldDraft
		Seed        string
		Config      any
	}{canonical, preferenceSnapshots(prefs), world, seed, s.preparationConfig()}), nil
}

func (s *Service) claimablePreparation(ctx context.Context, q *pgq.Queries, a, e string, b pgq.ExperienceBranch, r AdvanceRequest) (*pgq.ExperienceNarrativePreparation, error) {
	if !s.NarrativeEngine || r.Mode != "read" || r.Input != "" || r.ReadingRequest != "" || b.Revision == 0 {
		return nil, nil
	}
	p, err := q.ExperiencePreparationGet(ctx, pgq.ExperiencePreparationGetParams{AccountID: a, ExperienceID: e, BranchID: b.ID, BaseRevision: b.Revision})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	now, err := q.ExperienceDatabaseTime(ctx)
	if err != nil {
		return nil, err
	}
	if p.Status != "ready" && p.Status != "preparing" || p.ClaimedRequestID.Valid || p.BaseFence != b.Fence || p.EngineVersion != narrativeEngineVersion || !p.LeaseUntil.After(now) {
		return nil, nil
	}
	if p.Status == "preparing" {
		owner := s.preparationOwner(p)
		if owner == nil {
			return nil, nil
		}
		select {
		case <-owner.stopped:
			return nil, nil
		default:
		}
	}
	pin, err := s.preparationPin(ctx, q, a, e, b.ID, b.State)
	if err != nil {
		return nil, err
	}
	if pin != p.Pin {
		return nil, nil
	}
	return &p, nil
}

func (s *Service) consumePreparation(ctx context.Context, o pgq.ExperienceOperation, authority Context) (*Candidate, error) {
	if !s.NarrativeEngine {
		return nil, nil
	}
	for {
		var c *Candidate
		var waiting *preparationRun
		err := s.transaction(ctx, func(q *pgq.Queries) error {
			b, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, ID: o.BranchID})
			if err != nil {
				return err
			}
			p, err := q.ExperiencePreparationClaimed(ctx, pgq.ExperiencePreparationClaimedParams{AccountID: o.AccountID, ClaimedRequestID: ns(o.RequestID)})
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			pin, err := s.preparationPin(ctx, q, o.AccountID, o.ExperienceID, o.BranchID, b.State)
			if err != nil {
				return err
			}
			// A changed preference after acceptance cannot silently switch a candidate
			// under the reader. Fail the accepted operation; never use a stale cache.
			if o.Mode != "read" || o.Input != "" || o.ReadingRequest != "" || p.BaseRevision != o.BaseRevision || p.BaseFence+1 != o.Fence || b.Revision != o.BaseRevision || b.Fence != o.Fence || p.Pin != pin {
				return fail("preparation_conflict")
			}
			if p.Status == "preparing" {
				if err := s.checkPreparation(ctx, q, p); err != nil {
					return err
				}
				waiting = s.preparationOwner(p)
				if waiting == nil {
					return fail("preparation_conflict")
				}
				select {
				case <-waiting.stopped:
					return fail("preparation_conflict")
				default:
				}
				return nil
			}
			if p.Status != "claimed" {
				return fail("preparation_conflict")
			}
			if err := s.checkPreparationClaim(ctx, q, p, b); err != nil {
				return err
			}
			var candidate Candidate
			var approval NarrativeApproval
			if StrictJSON(p.Candidate, &candidate) != nil || StrictJSON(p.Approval, &approval) != nil {
				return fail("preparation_invalid")
			}
			if err := verifyNarrativeApproval(candidate, &approval); err != nil {
				return err
			}
			candidate.Review = &approval
			if err := verifyPreparationMemoryOrigin(p, candidate); err != nil {
				return err
			}
			if _, err := Apply(authority, candidate); err != nil {
				return err
			}
			c = &candidate
			return nil
		})
		if err != nil || waiting == nil {
			return c, err
		}
		// The accepted operation already owns its normal lease and heartbeat.
		// Release all database locks before waiting for the original worker.
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-waiting.done:
		case <-waiting.stopped:
		}
		// Read even failed/stale claims again: they must never fall back to a
		// fresh generation, and a simultaneous successful finish wins naturally.
	}
}

func (s *Service) Preparation(ctx context.Context, a, e, b string, revision int64) (PreparationStatus, error) {
	out := PreparationStatus{e, b, revision, "unavailable"}
	if !keyOK(b) || revision < 0 {
		return out, fail("invalid_input")
	}
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		branch, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: a, ExperienceID: e, ID: b})
		if err != nil {
			return err
		}
		if !s.NarrativeEngine || branch.Revision != revision {
			return nil
		}
		p, err := q.ExperiencePreparationGet(ctx, pgq.ExperiencePreparationGetParams{AccountID: a, ExperienceID: e, BranchID: b, BaseRevision: revision})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		now, err := q.ExperienceDatabaseTime(ctx)
		if err != nil {
			return err
		}
		if p.BaseFence != branch.Fence || !p.LeaseUntil.After(now) || p.Status != "preparing" && p.Status != "ready" {
			return nil
		}
		pin, err := s.preparationPin(ctx, q, a, e, b, branch.State)
		if err != nil {
			return err
		}
		if pin == p.Pin {
			out.Status = p.Status
		}
		return nil
	})
	return out, err
}

func (s *Service) checkPreparation(ctx context.Context, q *pgq.Queries, p pgq.ExperienceNarrativePreparation) error {
	b, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: p.AccountID, ExperienceID: p.ExperienceID, ID: p.BranchID})
	if err != nil {
		return err
	}
	current, err := q.ExperiencePreparationByID(ctx, pgq.ExperiencePreparationByIDParams{AccountID: p.AccountID, ID: p.ID})
	if err != nil {
		return err
	}
	now, err := q.ExperienceDatabaseTime(ctx)
	if err != nil {
		return err
	}
	if b.Revision != p.BaseRevision || current.Status != "preparing" || !current.LeaseUntil.After(now) {
		return fail("superseded")
	}
	if current.ClaimedRequestID.Valid {
		if err := s.checkPreparationClaim(ctx, q, current, b); err != nil {
			return err
		}
	} else if b.Fence != p.BaseFence {
		return fail("superseded")
	}
	pin, err := s.preparationPin(ctx, q, p.AccountID, p.ExperienceID, p.BranchID, b.State)
	if err != nil {
		return err
	}
	if pin != p.Pin {
		return fail("superseded")
	}
	return nil
}

// A preparation's original reader and budgets survive handoff. Only this
// explicitly bound live read operation may authorize the single new fence.
func (s *Service) checkPreparationClaim(ctx context.Context, q *pgq.Queries, p pgq.ExperienceNarrativePreparation, b pgq.ExperienceBranch) error {
	if !p.ClaimedRequestID.Valid {
		return fail("preparation_conflict")
	}
	o, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: p.AccountID, RequestID: p.ClaimedRequestID.String})
	if err != nil {
		return err
	}
	now, err := q.ExperienceDatabaseTime(ctx)
	if err != nil {
		return err
	}
	if o.ExperienceID != p.ExperienceID || o.BranchID != p.BranchID || o.Mode != "read" || o.Input != "" || o.ReadingRequest != "" ||
		o.BaseRevision != p.BaseRevision || o.Fence != p.BaseFence+1 || b.Revision != p.BaseRevision || b.Fence != o.Fence ||
		o.Status != "pending" && o.Status != "generating" || !o.LeaseUntil.After(now) || !p.LeaseUntil.After(now) || p.EngineVersion != narrativeEngineVersion {
		return fail("preparation_conflict")
	}
	return nil
}

// PrepareNext performs exactly one background attempt for a committed version.
// It has no authority to append a page, and is independently cancellable.
func (s *Service) PrepareNext(ctx context.Context, a, e, b string, revision int64) error {
	if !s.NarrativeEngine || s.Generator == nil || revision < 1 {
		return nil
	}
	run, cancel := context.WithCancel(ctx)
	defer cancel()
	key := preparationKey(a, e, b)
	entry := &preparationRun{revision: revision, cancel: cancel, stopped: run.Done(), done: make(chan struct{})}
	s.preparationsMu.Lock()
	if s.preparations == nil {
		s.preparations = map[string]*preparationRun{}
	}
	if old := s.preparations[key]; old != nil {
		if old.revision >= revision {
			s.preparationsMu.Unlock()
			return nil
		}
		old.cancel()
	}
	s.preparations[key] = entry
	s.preparationsMu.Unlock()
	defer func() {
		s.preparationsMu.Lock()
		if s.preparations[key] == entry {
			delete(s.preparations, key)
		}
		close(entry.done)
		s.preparationsMu.Unlock()
	}()
	var p pgq.ExperienceNarrativePreparation
	err := s.transaction(run, func(q *pgq.Queries) error {
		branch, err := q.ExperienceBranchLock(run, pgq.ExperienceBranchLockParams{AccountID: a, ExperienceID: e, ID: b})
		if err != nil {
			return err
		}
		if branch.Revision != revision {
			return fail("superseded")
		}
		active, err := q.ExperienceActive(run, pgq.ExperienceActiveParams{AccountID: a, ExperienceID: e, BranchID: b})
		if err != nil {
			return err
		}
		if len(active) != 0 {
			return fail("superseded")
		}
		pin, err := s.preparationPin(run, q, a, e, b, branch.State)
		if err != nil {
			return err
		}
		p, err = q.ExperiencePreparationCreate(run, pgq.ExperiencePreparationCreateParams{AccountID: a, ExperienceID: e, BranchID: b, ID: newID("prep_"), BaseRevision: revision, BaseFence: branch.Fence, Pin: pin, EngineVersion: narrativeEngineVersion, LeaseSeconds: s.lease()})
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer done()
			_, _ = pgq.New(s.DB).ExperiencePreparationFinish(cleanup, pgq.ExperiencePreparationFinishParams{AccountID: a, ID: p.ID, Status: "failed"})
		}
	}()
	done := make(chan struct{})
	defer close(done)
	go func() {
		tick := time.NewTicker(max(time.Second, time.Duration(s.lease())*time.Second/3))
		defer tick.Stop()
		for {
			select {
			case <-done:
				return
			case <-run.Done():
				return
			case <-tick.C:
				err := s.transaction(run, func(q *pgq.Queries) error {
					if err := s.checkPreparation(run, q, p); err != nil {
						return err
					}
					n, err := q.ExperiencePreparationHeartbeat(run, pgq.ExperiencePreparationHeartbeatParams{AccountID: a, ID: p.ID, LeaseSeconds: s.lease()})
					if err != nil {
						return err
					}
					if n != 1 {
						return fail("superseded")
					}
					return nil
				})
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	o := pgq.ExperienceOperation{AccountID: a, RequestID: p.ID, ExperienceID: e, BranchID: b, BaseRevision: revision, Fence: p.BaseFence, Mode: "read"}
	authority, err := s.buildContext(run, o)
	if err != nil {
		return err
	}
	generation, err := s.buildGeneration(run, o, authority)
	if err != nil {
		return err
	}
	reader := newSourceReader(s, o, generation)
	reader.preparationEvidence = &narrativeEvidenceOrigin{Kind: "preparation", ID: p.ID,
		ExperienceID: p.ExperienceID, BranchID: p.BranchID, BaseRevision: p.BaseRevision, BaseFence: p.BaseFence,
		SourceHandle: generation.StateCoverage.SourceHandle, Pin: p.Pin}
	reader.checkOverride = func(ctx context.Context, q *pgq.Queries) error { return s.checkPreparation(ctx, q, p) }
	reader.auditOverride = func(ctx context.Context, q *pgq.Queries, entry any) error {
		raw, _ := json.Marshal([]any{entry})
		n, err := q.ExperiencePreparationAudit(ctx, pgq.ExperiencePreparationAuditParams{AccountID: a, ID: p.ID, Entry: raw})
		if err != nil {
			return err
		}
		if n != 1 {
			return fail("superseded")
		}
		return nil
	}
	generation.Progress = func(phase string) error {
		return s.transaction(run, func(q *pgq.Queries) error {
			if err := s.checkPreparation(run, q, p); err != nil {
				return err
			}
			current, err := q.ExperiencePreparationByID(run, pgq.ExperiencePreparationByIDParams{AccountID: a, ID: p.ID})
			if err != nil || !current.ClaimedRequestID.Valid {
				return err
			}
			_, err = q.ExperienceNarrativeProgress(run, pgq.ExperienceNarrativeProgressParams{AccountID: a, RequestID: current.ClaimedRequestID.String, Fence: p.BaseFence + 1, ProgressPhase: phase})
			return err
		})
	}
	// Context construction still requires the original fence. Publish this
	// worker as claimable only after its frozen context and reader are ready.
	s.preparationsMu.Lock()
	if s.preparations[key] != entry || run.Err() != nil {
		s.preparationsMu.Unlock()
		err = fail("superseded")
		return err
	}
	entry.id = p.ID
	s.preparationsMu.Unlock()
	var c Candidate
	if g, ok := s.Generator.(ReadingGenerator); ok {
		c, err = g.GenerateWithReads(run, generation, "preparation-"+p.ID, reader)
	} else {
		c, err = s.Generator.Generate(run, generation, "preparation-"+p.ID)
	}
	if err != nil {
		return err
	}
	if err = verifyNarrativeApproval(c, c.Review); err != nil {
		return err
	}
	if err = verifyPreparationMemoryOrigin(p, c); err != nil {
		return err
	}
	if _, err = Apply(authority, c); err != nil {
		return err
	}
	err = s.transaction(run, func(q *pgq.Queries) error {
		if err := s.checkPreparation(run, q, p); err != nil {
			return err
		}
		raw, _ := json.Marshal(c)
		approval, _ := json.Marshal(c.Review)
		n, err := q.ExperiencePreparationFinish(run, pgq.ExperiencePreparationFinishParams{AccountID: a, ID: p.ID, Status: "ready", Candidate: raw, Approval: approval})
		if err != nil {
			return err
		}
		if n != 1 {
			return fail("superseded")
		}
		return nil
	})
	return err
}

// Called once during process startup, never by the ordinary expiration ticker.
func (s *Service) InvalidatePreparationsOnRestart(ctx context.Context) error {
	if !s.NarrativeEngine {
		return nil
	}
	return pgq.New(s.DB).ExperiencePreparationRecover(ctx)
}
