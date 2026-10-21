package experience

import (
	"context"
	"database/sql"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"errors"
	"time"
	"unicode/utf8"
)

type PolishChange struct {
	Text string `json:"text"`
}
type WorldVersionChange struct {
	ID         string `json:"id"`
	Version    int64  `json:"version"`
	Title      string `json:"title"`
	PublicSeed string `json:"public_seed"`
}
type RepairChange struct {
	Candidate Candidate `json:"candidate"`
}
type BranchChanges struct {
	AuthorWorld  *WorldDraft         `json:"author_world,omitempty"`
	Polish       *PolishChange       `json:"polish,omitempty"`
	WorldVersion *WorldVersionChange `json:"world_version,omitempty"`
	Repair       *RepairChange       `json:"repair,omitempty"`
}
type AssistRequest struct {
	RequestID        string `json:"request_id"`
	BranchID         string `json:"branch_id"`
	ExpectedRevision int64  `json:"expected_revision"`
	Kind             string `json:"kind"`
	Request          string `json:"request"`
}
type AssistResult struct {
	Kind         string     `json:"kind"`
	BranchID     string     `json:"branch_id"`
	BaseRevision int64      `json:"base_revision"`
	Text         string     `json:"text"`
	Proposal     *Candidate `json:"proposal,omitempty"`
}

func (r ForkRequest) changes() BranchChanges {
	return BranchChanges{Polish: r.Polish, WorldVersion: r.WorldVersion, Repair: r.Repair, AuthorWorld: r.AuthorWorld}
}
func (c BranchChanges) count() int {
	n := 0
	if c.Polish != nil {
		n++
	}
	if c.WorldVersion != nil || c.AuthorWorld != nil {
		n++
	}
	if c.Repair != nil {
		n++
	}
	return n
}
func (c BranchChanges) validate() error {
	if c.AuthorWorld != nil {
		raw, _ := json.Marshal(c.AuthorWorld)
		if len(raw) > 1<<20 || validateAuthorWorld(*c.AuthorWorld) != nil {
			return fail("invalid_input")
		}
	}
	if c.count() > 1 {
		return fail("invalid_input")
	}
	if c.Polish != nil && (!textOK(c.Polish.Text) || len(c.Polish.Text) > 64<<10) {
		return fail("invalid_input")
	}
	if w := c.WorldVersion; w != nil {
		if !keyOK(w.ID) || w.Version < 1 || !textOK(w.Title) || len(w.Title) > 512 || !textOK(w.PublicSeed) || len(w.PublicSeed) > 32<<10 {
			return fail("invalid_input")
		}
	}
	if c.Repair != nil {
		// Author ReviewCandidate only validates structure. It cannot issue the
		// private narrative approval required even for an empty v2 delta.
		if c.Repair.Candidate.MemoryDelta != nil {
			return fail("invalid_candidate")
		}
		raw, _ := json.Marshal(c.Repair.Candidate)
		if len(raw) > 128<<10 || validateContract(raw, "candidate") != nil {
			return fail("invalid_candidate")
		}
	}
	return nil
}
func branchChanges(ctx context.Context, q *pgq.Queries, a, e, b string) (BranchChanges, error) {
	raw, err := q.ExperienceBranchChangesGet(ctx, pgq.ExperienceBranchChangesGetParams{AccountID: a, ExperienceID: e, BranchID: b})
	if errors.Is(err, sql.ErrNoRows) || len(raw) == 0 {
		return BranchChanges{}, nil
	}
	if err != nil {
		return BranchChanges{}, err
	}
	// Old fact-only forks keep their original metadata shape.
	var probe map[string]json.RawMessage
	if json.Unmarshal(raw, &probe) != nil {
		return BranchChanges{}, fail("history_unavailable")
	}
	if _, old := probe["fact_id"]; old {
		return BranchChanges{}, nil
	}
	var c BranchChanges
	if StrictJSON(raw, &c) != nil || c.validate() != nil {
		return c, fail("history_unavailable")
	}
	return c, nil
}
func branchSeed(ctx context.Context, q *pgq.Queries, a, e, b, fallback string) (string, error) {
	branches, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: a, ExperienceID: e})
	if err != nil {
		return "", err
	}
	parents := map[string]string{}
	for _, row := range branches {
		parents[row.ID] = row.ParentBranchID.String
	}
	seen := map[string]bool{}
	for b != "" {
		if seen[b] {
			return "", fail("history_unavailable")
		}
		seen[b] = true
		c, err := branchChanges(ctx, q, a, e, b)
		if err != nil {
			return "", err
		}
		if c.WorldVersion != nil {
			return c.WorldVersion.PublicSeed, nil
		}
		b = parents[b]
	}
	return fallback, nil
}

// authorContext reads one immutable prefix in a repeatable-read snapshot.
func (s *Service) authorContext(ctx context.Context, a, e, b string, revision int64) (Context, Page, error) {
	var c Context
	var last Page
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return c, last, err
	}
	defer tx.Rollback()
	q := pgq.New(tx)
	x, err := q.ExperienceGet(ctx, pgq.ExperienceGetParams{AccountID: a, ID: e})
	if err != nil {
		return c, last, err
	}
	bs, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: a, ExperienceID: e})
	if err != nil {
		return c, last, err
	}
	found := false
	for _, row := range bs {
		if row.ID == b {
			found = true
			if row.Revision != revision {
				return c, last, fail("revision_conflict")
			}
		}
	}
	if !found {
		return c, last, sql.ErrNoRows
	}
	if revision < 1 {
		return c, last, fail("invalid_input")
	}
	pages, err := q.ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: a, ExperienceID: e, BranchID: b, ThroughRevision: revision})
	if err != nil {
		return c, last, err
	}
	if int64(len(pages)) != revision {
		return c, last, fail("history_unavailable")
	}
	seed, err := branchSeed(ctx, q, a, e, b, x.Seed)
	if err != nil {
		return c, last, err
	}
	c = Context{Version: 2, ExperienceID: e, BranchID: b, Revision: revision - 1, Seed: seed, State: EmptyState(), History: []HistoryPage{}, Preferences: []Preference{}, HistoryComplete: true, Recalls: []ReadReply{}}
	for i, p := range pages {
		var page Page
		if StrictJSON(p.Page, &page) != nil {
			return c, last, fail("history_unavailable")
		}
		if i == len(pages)-1 {
			last = page
			c.Mode = page.Mode
			c.Input = page.Input
		} else {
			c.History = append(c.History, page.HistoryPage)
			if StrictJSON(p.State, &c.State) != nil {
				return c, last, fail("history_unavailable")
			}
		}
	}
	c.GameplayRuntime = s.Artifacts
	c.GameplayContext = ctx
	c.AuthorWorld, err = branchAuthorWorld(ctx, q, a, e, b)
	if err != nil {
		return c, last, err
	}
	if err = tx.Commit(); err != nil {
		return c, last, err
	}
	return c, last, nil
}
func (s *Service) Assist(ctx context.Context, a, e string, r AssistRequest, interpreter *FeedbackInterpreter) (AssistResult, error) {
	out := AssistResult{Kind: r.Kind, BranchID: r.BranchID, BaseRevision: r.ExpectedRevision}
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || !textOK(r.Request) || len(r.Request) > 8000 || (r.Kind != "polish" && r.Kind != "repair") {
		return out, fail("invalid_input")
	}
	authority, last, err := s.authorContext(ctx, a, e, r.BranchID, r.ExpectedRevision)
	if err != nil {
		return out, err
	}
	if r.Kind == "polish" {
		if interpreter == nil || interpreter.Model == nil {
			return out, fail("model_unavailable")
		}
		schema := json.RawMessage(`{"type":"object","additionalProperties":false,"required":["text"],"properties":{"text":{"type":"string","minLength":1,"maxLength":20000}}}`)
		input, _ := json.Marshal(map[string]string{"original": last.Text, "request": r.Request})
		request := model.Request{Model: interpreter.ModelName, Schema: schema, Messages: []model.Message{{Role: "system", Content: polishInstruction}, {Role: "user", Content: string(input)}}}
		request, err = model.VerifyContextBudget(request, interpreter.ContextTokens, interpreter.OutputTokens, interpreter.ByteTokenBoundVerified)
		if err != nil {
			return out, fail("context_budget_exceeded")
		}
		timeout := interpreter.Timeout
		if timeout <= 0 {
			timeout = 2 * time.Minute
		}
		run, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		result, err := interpreter.Model.Generate(run, request)
		if err != nil {
			return out, fail("model_failed")
		}
		var response PolishChange
		if len(result.Text) > 128<<10 || RequiredJSON([]byte(result.Text), "text") != nil || StrictJSON([]byte(result.Text), &response) != nil || !textOK(response.Text) || !utf8.ValidString(response.Text) || len(response.Text) > 64<<10 {
			return out, fail("invalid_model_response")
		}
		out.Text = response.Text
	} else {
		if s.Generator == nil {
			return out, fail("model_unavailable")
		}
		prompt := authority
		prompt.Seed += "\n\n作者请求纠正最后一轮。原线不会改变，只生成审阅提案。保留原行动授权，不编造幕后理由；以下是待纠正原文与要求：\n" + last.Text + "\n要求：" + r.Request
		generation, err := compileGeneration(prompt, EmptyState(), newID("source_"), 1, ReadBudget{}, s.capacity())
		if err != nil {
			return out, err
		}
		candidate, err := s.Generator.Generate(ctx, generation, newID("repair-"))
		if err != nil {
			return out, err
		}
		if candidate.MemoryDelta != nil {
			return out, fail("invalid_candidate")
		}
		if _, err = Apply(authority, candidate); err != nil {
			return out, err
		}
		out.Proposal = &candidate
		out.Text = "请审阅修复正文与状态变更；确认后才建立新分支，原线保留。"
	}
	// A proposal generated against a now-stale branch is never offered for apply.
	if _, _, err = s.authorContext(ctx, a, e, r.BranchID, r.ExpectedRevision); err != nil {
		return AssistResult{}, err
	}
	return out, nil
}

type candidateReviewModel struct {
	candidate Candidate
	called    bool
}

func (m *candidateReviewModel) Generate(_ context.Context, _ model.Request) (model.Result, error) {
	if m.called {
		return model.Result{}, model.ErrRequestFailed
	}
	m.called = true
	raw, _ := json.Marshal(map[string]any{"result": m.candidate})
	return model.Result{Text: string(raw)}, nil
}
func (*candidateReviewModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return model.ErrRequestFailed
}

// ReviewCandidate runs the unchanged Rust validator with a supplied proposal;
// no network model request and no formal writes happen on this path.
func (a *Algorithm) ReviewCandidate(ctx context.Context, c Context, candidate Candidate) error {
	copy := *a
	copy.Model = &candidateReviewModel{candidate: candidate}
	copy.MaxModelCalls = 1
	generation, err := compileGeneration(c, EmptyState(), newID("source_"), 1, ReadBudget{}, 256<<10)
	if err != nil {
		return err
	}
	_, err = copy.Generate(ctx, generation, newID("review-"))
	return err
}
