package experience

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"elselife/backend/internal/sqlc/pgq"
)

type Generator interface {
	Generate(context.Context, Context, string) (Candidate, error)
}

// Service is the single authority; no task scheduler or automatic generation retry exists.
type Service struct {
	NarrativeEngine bool
	PrepareDispatch func(account, experience, branch string, revision int64)
	preparationsMu  sync.Mutex
	preparations    map[string]*preparationRun
	ProseFirst      bool
	Artifacts       *ArtifactRuntime
	DB              *sql.DB
	Generator       Generator
	LeaseSeconds    int32
	MaxContextBytes int
	RecentRevisions int
	ReadLimits      ReadBudget
}

func (s *Service) lease() int32 {
	if s.LeaseSeconds > 0 {
		return s.LeaseSeconds
	}
	return 60
}
func (s *Service) capacity() int {
	if s.MaxContextBytes > 0 {
		return s.MaxContextBytes
	}
	return 256 << 10
}
func newID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b[:])
}
func digest(kind, path string, v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(append([]byte(kind+":"+path+":"), raw...))
	return hex.EncodeToString(sum[:])
}
func ns(v string) sql.NullString { return sql.NullString{String: v, Valid: v != ""} }
func operation(o pgq.ExperienceOperation) Operation {
	v := Operation{RequestID: o.RequestID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Status: o.Status, BaseRevision: o.BaseRevision}
	if o.ProgressPhase != "" {
		v.Progress = &NarrativeProgress{Seq: o.ProgressSeq, Phase: o.ProgressPhase}
	}
	if o.CommittedRevision.Valid {
		v.CommittedRevision = &o.CommittedRevision.Int64
	}
	if o.ErrorCode.Valid {
		v.ErrorCode = &o.ErrorCode.String
	}
	return v
}
func branch(b pgq.ExperienceBranch) Branch {
	v := Branch{ID: b.ID, Name: b.Name, Revision: b.Revision}
	if b.ParentBranchID.Valid {
		v.ParentBranchID = &b.ParentBranchID.String
	}
	if b.ParentRevision.Valid {
		v.ParentRevision = &b.ParentRevision.Int64
	}
	return v
}
func (s *Service) transaction(ctx context.Context, fn func(*pgq.Queries) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = fn(pgq.New(tx)); err != nil {
		return err
	}
	return tx.Commit()
}
func requestLock(ctx context.Context, q *pgq.Queries, a, r string) error {
	return q.ExperienceRequestLock(ctx, pgq.ExperienceRequestLockParams{AccountID: a, RequestID: r})
}
func prior(ctx context.Context, q *pgq.Queries, a, r, d string) (*pgq.ExperienceOperation, error) {
	return priorWithLegacy(ctx, q, a, r, d, "")
}
func priorWithLegacy(ctx context.Context, q *pgq.Queries, a, r, d, legacy string) (*pgq.ExperienceOperation, error) {
	o, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: a, RequestID: r})
	if err == nil {
		if !requestDigestMatches(o.Digest, d, legacy) {
			return nil, fail("request_id_conflict")
		}
		return &o, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	_, err = q.ExperienceForkGet(ctx, pgq.ExperienceForkGetParams{AccountID: a, RequestID: r})
	if err == nil {
		return nil, fail("request_id_conflict")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return nil, nil
}
func (s *Service) Create(ctx context.Context, a string, r CreateRequest) (View, bool, error) {
	changes := BranchChanges{WorldVersion: r.WorldVersion, AuthorWorld: r.AuthorWorld}
	if err := changes.validate(); err != nil {
		return View{}, false, err
	}
	if r.WorldVersion != nil && r.WorldVersion.PublicSeed != r.Seed {
		return View{}, false, fail("invalid_input")
	}

	if !keyOK(r.RequestID) || !textOK(r.Seed) || len(r.Seed) > 32<<10 {
		return View{}, false, fail("invalid_input")
	}
	var o pgq.ExperienceOperation
	fresh := false
	d := digest("create", "", r)
	legacy := r.legacyDigest()
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		p, err := priorWithLegacy(ctx, q, a, r.RequestID, d, legacy)
		if err != nil {
			return err
		}
		if p != nil {
			o = *p
			return nil
		}
		e, b := newID("exp_"), newID("branch_")
		if err = q.ExperienceCreate(ctx, pgq.ExperienceCreateParams{AccountID: a, ID: e, Seed: r.Seed, ActiveBranchID: b}); err != nil {
			return err
		}
		initialTitle := r.Seed
		if r.WorldVersion != nil {
			initialTitle = r.WorldVersion.Title
		}
		state, _ := json.Marshal(EmptyState())
		if err = q.ExperienceBranchCreate(ctx, pgq.ExperienceBranchCreateParams{AccountID: a, ExperienceID: e, ID: b, Name: "主分支", Title: initialTitle, State: state}); err != nil {
			return err
		}
		if changes.count() > 0 {
			raw, _ := json.Marshal(changes)
			if err = q.ExperienceForkCreate(ctx, pgq.ExperienceForkCreateParams{AccountID: a, RequestID: newID("world-metadata_"), ExperienceID: e, BranchID: b, Digest: digest("initial-world", b, changes), Edit: raw}); err != nil {
				return err
			}
		}
		o, err = q.ExperienceOperationCreate(ctx, pgq.ExperienceOperationCreateParams{AccountID: a, RequestID: r.RequestID, ExperienceID: e, BranchID: b, Digest: d, Mode: "begin", Input: r.Seed, Fence: 0, LeaseSeconds: s.lease()})
		fresh = err == nil
		return err
	})
	if err != nil {
		return View{}, false, err
	}
	v, err := s.Get(ctx, a, o.ExperienceID, o.BranchID)
	return v, fresh, err
}
func (s *Service) Advance(ctx context.Context, a, e string, r AdvanceRequest) (Operation, bool, error) {
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || r.ExpectedRevision < 0 || len(r.Input) > 32<<10 || !utf8String(r.Input) || len(r.ReadingRequest) > 4096 || !utf8String(r.ReadingRequest) {
		return Operation{}, false, fail("invalid_input")
	}
	switch r.Mode {
	case "read":
	case "act", "ask":
		if !textOK(r.Input) {
			return Operation{}, false, fail("invalid_input")
		}
	default:
		return Operation{}, false, fail("invalid_mode")
	}
	var o pgq.ExperienceOperation
	fresh := false
	joinedPreparation := false
	d := digest("advance", e, r)
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		p, err := prior(ctx, q, a, r.RequestID, d)
		if err != nil {
			return err
		}
		if p != nil {
			o = *p
			return nil
		}
		b, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: a, ExperienceID: e, ID: r.BranchID})
		if err != nil {
			return err
		}
		if b.Revision != r.ExpectedRevision {
			return fail("revision_conflict")
		}
		mode := r.Mode
		if b.Revision == 0 {
			// An explicit read after a failed/canceled opening starts its first page.
			// No automatic retry or second story is created; the original seed stays authoritative.
			if mode != "read" {
				return fail("invalid_mode")
			}
			mode = "begin"
		}
		active, err := q.ExperienceActive(ctx, pgq.ExperienceActiveParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID})
		if err != nil {
			return err
		}
		if len(active) > 0 {
			return fail("branch_busy")
		}
		prepared, err := s.claimablePreparation(ctx, q, a, e, b, r)
		if err != nil {
			return err
		}
		f, err := q.ExperienceBranchFence(ctx, pgq.ExperienceBranchFenceParams{AccountID: a, ExperienceID: e, ID: r.BranchID})
		if err != nil {
			return err
		}
		o, err = q.ExperienceOperationCreate(ctx, pgq.ExperienceOperationCreateParams{AccountID: a, RequestID: r.RequestID, ExperienceID: e, BranchID: r.BranchID, Digest: d, Mode: mode, Input: r.Input, BaseRevision: b.Revision, Fence: f, LeaseSeconds: s.lease()})
		if err != nil {
			return err
		}
		if r.ReadingRequest != "" {
			if _, err = q.ExperienceReadingRequest(ctx, pgq.ExperienceReadingRequestParams{AccountID: a, RequestID: r.RequestID, ReadingRequest: r.ReadingRequest}); err != nil {
				return err
			}
			o.ReadingRequest = r.ReadingRequest
		}
		if prepared != nil {
			n, claimErr := q.ExperiencePreparationClaim(ctx, pgq.ExperiencePreparationClaimParams{AccountID: a, ID: prepared.ID, ClaimedRequestID: ns(r.RequestID)})
			if claimErr != nil {
				return claimErr
			}
			if n != 1 {
				return fail("preparation_conflict")
			}
			joinedPreparation = prepared.Status == "preparing"
		}
		if s.NarrativeEngine {
			if err = q.ExperiencePreparationInvalidateExceptClaim(ctx, pgq.ExperiencePreparationInvalidateExceptClaimParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, KeepRequestID: r.RequestID}); err != nil {
				return err
			}
		}
		fresh = err == nil
		return err
	})
	if err == nil && fresh && !joinedPreparation {
		s.cancelPreparation(a, e, r.BranchID)
	}
	return operation(o), fresh, err
}
func utf8String(s string) bool {
	raw, _ := json.Marshal(s)
	var v string
	_ = json.Unmarshal(raw, &v)
	return v == s
}
func (s *Service) GetOperation(ctx context.Context, a, e, r string) (Operation, error) {
	o, err := pgq.New(s.DB).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: a, RequestID: r})
	if err == nil && o.ExperienceID != e {
		err = sql.ErrNoRows
	}
	return operation(o), err
}
func (s *Service) Get(ctx context.Context, a, e, b string) (View, error) {
	var view View
	// Repeatable-read prevents mixing a new revision with the old page/state snapshot.
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return view, err
	}
	defer tx.Rollback()
	q := pgq.New(tx)
	x, err := q.ExperienceGet(ctx, pgq.ExperienceGetParams{AccountID: a, ID: e})
	if err != nil {
		return view, err
	}
	if b == "" {
		b = x.ActiveBranchID
	}
	branches, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: a, ExperienceID: e})
	if err != nil {
		return view, err
	}
	var selected *pgq.ExperienceBranch
	view = View{UpdatedAt: x.CreatedAt, ID: e, Seed: x.Seed, ActiveBranchID: x.ActiveBranchID, BranchID: b, Branches: []Branch{}, Pages: []Page{}, Information: []Information{}}
	for i := range branches {
		if branches[i].CreatedAt.After(view.UpdatedAt) {
			view.UpdatedAt = branches[i].CreatedAt
		}
		view.Branches = append(view.Branches, branch(branches[i]))
		if branches[i].ID == b {
			selected = &branches[i]
		}
	}
	if selected == nil {
		return view, sql.ErrNoRows
	}
	view.Title = selected.Title
	view.Revision = selected.Revision
	var state State
	if err = json.Unmarshal(selected.State, &state); err != nil {
		return view, fail("history_unavailable")
	}
	view.Information = Project(state)
	view.Reader = ProjectReader(state, view.Revision)
	view.Gameplay = state.Gameplay
	pages, err := q.ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: a, ExperienceID: e, BranchID: b, ThroughRevision: selected.Revision})
	if err != nil {
		return view, err
	}
	for _, p := range pages {
		var page Page
		if err = json.Unmarshal(p.Page, &page); err != nil {
			return view, fail("history_unavailable")
		}
		var snapshot State
		if err = json.Unmarshal(p.State, &snapshot); err != nil {
			return view, fail("history_unavailable")
		}
		page.Reader = ProjectReader(snapshot, page.Revision)
		view.Pages = append(view.Pages, page)
		if page.CreatedAt.After(view.UpdatedAt) {
			view.UpdatedAt = page.CreatedAt
		}
	}
	projectArtifactSnapshots(view.Pages)
	ops, err := q.ExperienceLatestOperation(ctx, pgq.ExperienceLatestOperationParams{AccountID: a, ExperienceID: e, BranchID: b})
	if err != nil {
		return view, err
	}
	if len(ops) > 0 {
		if ops[0].UpdatedAt.After(view.UpdatedAt) {
			view.UpdatedAt = ops[0].UpdatedAt
		}
		v := operation(ops[0])
		view.Operation = &v
	}
	return view, tx.Commit()
}
func (s *Service) List(ctx context.Context, a string) ([]View, error) {
	rows, err := pgq.New(s.DB).ExperienceList(ctx, a)
	if err != nil {
		return nil, err
	}
	out := []View{}
	for _, r := range rows {
		v, err := s.Get(ctx, a, r.ID, "")
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// Cancel fences only uncommitted work. A committed operation is honestly returned.
func (s *Service) Cancel(ctx context.Context, a, e, r string) (Operation, error) {
	var out pgq.ExperienceOperation
	var preparationID string
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		o, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: a, RequestID: r})
		if err != nil {
			return err
		}
		if o.ExperienceID != e {
			return sql.ErrNoRows
		}
		_, err = q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: a, ExperienceID: e, ID: o.BranchID})
		if err != nil {
			return err
		}
		o, err = q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: a, RequestID: r})
		if err != nil {
			return err
		}
		if o.Status == "pending" || o.Status == "generating" {
			if s.NarrativeEngine {
				p, prepErr := q.ExperiencePreparationClaimed(ctx, pgq.ExperiencePreparationClaimedParams{AccountID: a, ClaimedRequestID: ns(r)})
				if prepErr != nil && !errors.Is(prepErr, sql.ErrNoRows) {
					return prepErr
				}
				if prepErr == nil && p.ExperienceID == e && p.BranchID == o.BranchID {
					preparationID = p.ID
					if err = q.ExperiencePreparationInvalidate(ctx, pgq.ExperiencePreparationInvalidateParams{AccountID: a, ExperienceID: e, BranchID: o.BranchID}); err != nil {
						return err
					}
				}
			}
			if _, err = q.ExperienceBranchFence(ctx, pgq.ExperienceBranchFenceParams{AccountID: a, ExperienceID: e, ID: o.BranchID}); err != nil {
				return err
			}
			if _, err = q.ExperienceFinish(ctx, pgq.ExperienceFinishParams{AccountID: a, RequestID: r, Fence: o.Fence, Status: "cancelled"}); err != nil {
				return err
			}
			o.Status = "cancelled"
		}
		out = o
		return nil
	})
	if err == nil && preparationID != "" {
		s.cancelPreparationID(a, e, out.BranchID, preparationID)
	}
	return operation(out), err
}

// RecoverExpired never replays generation. It converts orphaned accepted work to
// interrupted, preserving all formal pages and allowing explicit user takeover.
func (s *Service) RecoverExpired(ctx context.Context) error {
	rows, err := pgq.New(s.DB).ExperienceExpired(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		err = s.transaction(ctx, func(q *pgq.Queries) error {
			_, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: row.AccountID, ExperienceID: row.ExperienceID, ID: row.BranchID})
			if err != nil {
				return err
			}
			o, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: row.AccountID, RequestID: row.RequestID})
			if err != nil {
				return err
			}
			now, err := q.ExperienceDatabaseTime(ctx)
			if err != nil {
				return err
			}
			if (o.Status != "pending" && o.Status != "generating") || o.LeaseUntil.After(now) {
				return nil
			}
			if _, err = q.ExperienceBranchFence(ctx, pgq.ExperienceBranchFenceParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, ID: o.BranchID}); err != nil {
				return err
			}
			_, err = q.ExperienceFinish(ctx, pgq.ExperienceFinishParams{AccountID: o.AccountID, RequestID: o.RequestID, Fence: o.Fence, Status: "interrupted", ErrorCode: ns("generation_interrupted")})
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) buildContext(ctx context.Context, o pgq.ExperienceOperation) (Context, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return Context{}, err
	}
	defer tx.Rollback()
	q := pgq.New(tx)
	e, err := q.ExperienceGet(ctx, pgq.ExperienceGetParams{AccountID: o.AccountID, ID: o.ExperienceID})
	if err != nil {
		return Context{}, err
	}
	bs, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID})
	if err != nil {
		return Context{}, err
	}
	seed, err := branchSeed(ctx, q, o.AccountID, o.ExperienceID, o.BranchID, e.Seed)
	if err != nil {
		return Context{}, err
	}
	c := Context{Version: 2, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: o.BaseRevision, Mode: o.Mode, Input: o.Input, Seed: seed, History: []HistoryPage{}, Preferences: []Preference{}, HistoryComplete: true, Recalls: []ReadReply{}}
	c.ReadingRequest = o.ReadingRequest
	if s.NarrativeEngine {
		c.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}
	}
	c.GameplayRuntime = s.Artifacts
	c.GameplayContext = ctx
	c.AuthorWorld, err = branchAuthorWorld(ctx, q, o.AccountID, o.ExperienceID, o.BranchID)
	if err != nil {
		return c, err
	}
	found := false
	for _, b := range bs {
		if b.ID == o.BranchID {
			if b.Revision != o.BaseRevision || b.Fence != o.Fence {
				return c, fail("superseded")
			}
			if err = json.Unmarshal(b.State, &c.State); err != nil {
				return c, fail("history_unavailable")
			}
			found = true
		}
	}
	if !found {
		return c, sql.ErrNoRows
	}
	pages, err := q.ExperienceRawPageRange(ctx, pgq.ExperienceRawPageRangeParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, FromRevision: 1, ToRevision: o.BaseRevision})
	if err != nil {
		return c, err
	}
	for _, p := range pages {
		var page Page
		if err = json.Unmarshal(p.Page, &page); err != nil {
			return c, fail("history_unavailable")
		}
		c.History = append(c.History, page.HistoryPage)
	}
	ps, err := q.ExperiencePreferences(ctx, o.AccountID)
	if err != nil {
		return c, err
	}
	for _, p := range ps {
		c.Preferences = append(c.Preferences, Preference{Dimension: p.Dimension, Value: p.Value, Source: p.Source, Evidence: p.Evidence})
	}
	if err = s.loadGameplayContext(ctx, q, o, &c); err != nil {
		return c, err
	}
	return c, tx.Commit()
}

func (s *Service) buildGeneration(ctx context.Context, o pgq.ExperienceOperation, authority Context) (Context, error) {
	recentCount := s.RecentRevisions
	if recentCount <= 0 {
		recentCount = 16
	}
	recent := max(int64(1), o.BaseRevision-int64(recentCount)+1)
	boundary := EmptyState()
	if recent > 1 {
		raw, err := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: recent - 1})
		if err != nil {
			return Context{}, fail("recall_revision_unavailable")
		}
		if json.Unmarshal(raw, &boundary) != nil {
			return Context{}, fail("history_unavailable")
		}
	}
	budget := s.ReadLimits
	if budget.MaxReads <= 0 {
		budget = ReadBudget{MaxReads: 4, MaxReplyBytes: 64 << 10, MaxTotalReplyBytes: 128 << 10}
	}
	capacity := s.capacity()
	if s.ProseFirst || s.NarrativeEngine {
		if algorithm, ok := s.Generator.(*Algorithm); ok {
			var err error
			capacity, err = algorithm.narrativeContextCapacity(authority, capacity)
			if err != nil {
				return Context{}, err
			}
		}
	}
	handle := newID("source_")
	generation, err := compileGeneration(authority, boundary, handle, recent, budget, capacity)
	if err == nil || err.Error() != "context_capacity" || recent >= o.BaseRevision {
		return generation, err
	}
	// RecentRevisions is a preferred evidence window, not an instruction to
	// make sixteen growing pages of facts mandatory in a finite model window.
	// Keep the oldest whole revision boundary that actually fits. The policy,
	// boundary and omitted counts are frozen with this operation; exact deferred
	// objects remain in commit authority and the scoped source reader.
	//
	// First check a lower bound: even with no changed-object roots, rules,
	// secrets, open threads, explicit references, the latest revision's facts,
	// the complete notebook and latest whole page must fit. If they do not,
	// reading every intermediate snapshot cannot make this operation possible.
	if _, minimumErr := compileGeneration(authority, authority.State, handle, o.BaseRevision, budget, capacity); minimumErr != nil {
		return Context{}, minimumErr
	}
	for recent++; recent <= o.BaseRevision; recent++ {
		raw, readErr := pgq.New(s.DB).ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: recent - 1})
		if readErr != nil {
			return Context{}, fail("recall_revision_unavailable")
		}
		if json.Unmarshal(raw, &boundary) != nil {
			return Context{}, fail("history_unavailable")
		}
		generation, err = compileGeneration(authority, boundary, handle, recent, budget, capacity)
		if err == nil || err.Error() != "context_capacity" {
			return generation, err
		}
	}
	return Context{}, err
}

// GenerateAccepted claims once, freezes actual context, renews a lease and commits
// only under the same fence/version/status. HTTP response loss cannot cancel intent.
func (s *Service) GenerateAccepted(ctx context.Context, a, r string) error {
	o, err := pgq.New(s.DB).ExperienceClaim(ctx, pgq.ExperienceClaimParams{AccountID: a, RequestID: r})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if s.NarrativeEngine {
		n, err := pgq.New(s.DB).ExperienceNarrativeProgress(ctx, pgq.ExperienceNarrativeProgressParams{AccountID: a, RequestID: r, Fence: o.Fence, ProgressPhase: "preparing"})
		if err != nil {
			return err
		}
		if n != 1 {
			return nil
		}
	}
	authority, err := s.buildContext(ctx, o)
	if err != nil {
		return s.failOperation(context.WithoutCancel(ctx), o, err)
	}
	c, err := s.buildGeneration(ctx, o, authority)
	if err != nil {
		return s.failOperation(context.WithoutCancel(ctx), o, err)
	}
	raw, _ := json.Marshal(c)
	n, err := pgq.New(s.DB).ExperienceFreezeContext(ctx, pgq.ExperienceFreezeContextParams{AccountID: a, RequestID: r, Fence: o.Fence, Context: raw})
	if err != nil {
		return err
	}
	if n != 1 {
		return nil
	}
	if s.Generator == nil {
		return s.failOperation(ctx, o, fail("model_unavailable"))
	}
	run, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	defer close(done)
	go func() {
		tick := time.NewTicker(time.Duration(s.lease()) * time.Second / 3)
		defer tick.Stop()
		for {
			select {
			case <-done:
				return
			case <-run.Done():
				return
			case <-tick.C:
				n, err := pgq.New(s.DB).ExperienceHeartbeat(run, pgq.ExperienceHeartbeatParams{AccountID: a, RequestID: r, Fence: o.Fence, LeaseSeconds: s.lease()})
				if err != nil || n != 1 {
					cancel()
					return
				}
			}
		}
	}()
	frame := digest("frame", a, []string{o.ExperienceID, o.BranchID, o.RequestID})
	var candidate Candidate
	c.Progress = func(phase string) error {
		n, err := pgq.New(s.DB).ExperienceNarrativeProgress(run, pgq.ExperienceNarrativeProgressParams{AccountID: a, RequestID: r, Fence: o.Fence, ProgressPhase: phase})
		if err != nil {
			return err
		}
		if n != 1 {
			return fail("superseded")
		}
		return nil
	}
	prepared, preparedErr := s.consumePreparation(run, o, authority)
	if preparedErr != nil {
		return s.failOperation(context.WithoutCancel(ctx), o, preparedErr)
	}
	if prepared != nil {
		candidate = *prepared
	} else if generator, ok := s.Generator.(ReadingGenerator); ok {
		candidate, err = generator.GenerateWithReads(run, c, "experience-"+frame, newSourceReader(s, o, c))
	} else {
		candidate, err = s.Generator.Generate(run, c, "experience-"+frame)
	}
	if err != nil {
		return s.failOperation(context.WithoutCancel(ctx), o, err)
	}
	var state State
	if s.NarrativeEngine {
		if err = verifyNarrativeApproval(candidate, candidate.Review); err == nil {
			state, err = Apply(authority, candidate)
		}
	} else if s.ProseFirst {
		candidate, state, err = applyNarrative(authority, candidate)
	} else {
		state, err = Apply(authority, candidate)
	}
	if err != nil {
		return s.failOperation(context.WithoutCancel(ctx), o, err)
	}
	if s.NarrativeEngine {
		if err = c.Progress("committing"); err != nil {
			return s.failOperation(context.WithoutCancel(ctx), o, err)
		}
	}
	err = s.commit(context.WithoutCancel(ctx), o, candidate, state)
	var domain *Error
	if errors.As(err, &domain) && (domain.Code == "invalid_gameplay" ||
		domain.Code == "invalid_literary_memory" || strings.HasPrefix(domain.Code, "narrative_memory_") ||
		domain.Code == "preparation_conflict") {
		return s.failOperation(context.WithoutCancel(ctx), o, err)
	}
	if err == nil && s.NarrativeEngine && s.PrepareDispatch != nil && o.Mode != "ask" && candidate.Outcome != "ending" {
		s.PrepareDispatch(a, o.ExperienceID, o.BranchID, o.BaseRevision+1)
	}
	return err
}
func (s *Service) failOperation(ctx context.Context, o pgq.ExperienceOperation, cause error) error {
	code := "generation_unavailable"
	var domain *Error
	if errors.As(cause, &domain) {
		code = domain.Code
	}
	status := "failed"
	if errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded) {
		status = "interrupted"
		code = "generation_interrupted"
	}
	return s.transaction(ctx, func(q *pgq.Queries) error {
		_, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, ID: o.BranchID})
		if err != nil {
			return err
		}
		_, err = q.ExperienceFinish(ctx, pgq.ExperienceFinishParams{AccountID: o.AccountID, RequestID: o.RequestID, Fence: o.Fence, Status: status, ErrorCode: ns(code)})
		return err
	})
}
func (s *Service) commit(ctx context.Context, o pgq.ExperienceOperation, c Candidate, state State) error {
	return s.transaction(ctx, func(q *pgq.Queries) error {
		b, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, ID: o.BranchID})
		if err != nil {
			return err
		}
		latest, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: o.AccountID, RequestID: o.RequestID})
		if err != nil {
			return err
		}
		now, err := q.ExperienceDatabaseTime(ctx)
		if err != nil {
			return err
		}
		if latest.Status != "generating" || b.Fence != o.Fence || b.Revision != o.BaseRevision || !latest.LeaseUntil.After(now) {
			return fail("superseded")
		}
		if err := s.verifyMemoryCommit(ctx, q, latest, b, c, state); err != nil {
			return err
		}
		rev := o.BaseRevision + 1
		page := Page{HistoryPage: HistoryPage{Revision: rev, Mode: o.Mode, Input: o.Input, Text: c.Passage}, StoryTime: state.StoryTime, CreatedAt: now.UTC(), Suggestions: c.Suggestions, Outcome: c.Outcome}
		receipt, err := s.commitGameplay(ctx, q, o, b, c, state)
		if err != nil {
			return err
		}
		page.PreviousArtifactSnapshot, err = captureArtifactSnapshot(ctx, q, o.AccountID, o.ExperienceID, o.BranchID, o.BaseRevision)
		if err != nil {
			return err
		}
		page.GameplayReceipt = receipt
		page.Reader = ProjectReader(state, rev)
		praw, _ := json.Marshal(page)
		sraw, _ := json.Marshal(state)
		craw, _ := json.Marshal(c)
		if s.NarrativeEngine {
			if err := verifyNarrativeApproval(c, c.Review); err != nil {
				return err
			}
			approval, _ := json.Marshal(c.Review)
			n, err := q.ExperienceNarrativeApproval(ctx, pgq.ExperienceNarrativeApprovalParams{AccountID: o.AccountID, RequestID: o.RequestID, Fence: o.Fence, NarrativeApproval: approval})
			if err != nil {
				return err
			}
			if n != 1 {
				return fail("superseded")
			}
		}
		if err = q.ExperiencePageCreate(ctx, pgq.ExperiencePageCreateParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: rev, Page: praw, State: sraw, Title: c.Title}); err != nil {
			return err
		}
		n, err := q.ExperienceBranchCommit(ctx, pgq.ExperienceBranchCommitParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, ID: o.BranchID, Revision: o.BaseRevision, Fence: o.Fence, Title: c.Title, State: sraw})
		if err != nil {
			return err
		}
		if n != 1 {
			return fail("revision_conflict")
		}
		n, err = q.ExperienceFinish(ctx, pgq.ExperienceFinishParams{AccountID: o.AccountID, RequestID: o.RequestID, Fence: o.Fence, Status: "committed", CommittedRevision: sql.NullInt64{Int64: rev, Valid: true}, Candidate: craw})
		if err != nil {
			return err
		}
		if n != 1 {
			return fail("superseded")
		}
		return nil
	})
}
