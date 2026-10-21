package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"elselife/backend/internal/sqlc/pgq"
)

type Receipt struct {
	RequestID    string     `json:"request_id"`
	Kind         string     `json:"kind"`
	ExperienceID string     `json:"experience_id"`
	BranchID     string     `json:"branch_id"`
	Operation    *Operation `json:"operation,omitempty"`
}

func (s *Service) Receipt(ctx context.Context, a, r string) (Receipt, error) {
	q := pgq.New(s.DB)
	o, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: a, RequestID: r})
	if err == nil {
		op := operation(o)
		kind := "operation"
		if o.Mode == "begin" {
			kind = "create"
		}
		return Receipt{RequestID: r, Kind: kind, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Operation: &op}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Receipt{}, err
	}
	f, err := q.ExperienceForkGet(ctx, pgq.ExperienceForkGetParams{AccountID: a, RequestID: r})
	return Receipt{RequestID: r, Kind: "branch", ExperienceID: f.ExperienceID, BranchID: f.BranchID}, err
}
func (s *Service) Fork(ctx context.Context, a, e string, r ForkRequest) (View, error) {
	if !keyOK(r.RequestID) || !keyOK(r.FromBranchID) || r.FromRevision < 0 || !textOK(r.Name) || len(r.Name) > 512 {
		return View{}, fail("invalid_input")
	}
	if r.Edit != nil && (!textOK(r.Edit.Text) || len(r.Edit.Text) > 32<<10) {
		return View{}, fail("invalid_input")
	}
	if r.AuthorWorld != nil && r.WorldVersion == nil {
		return View{}, fail("invalid_input")
	}
	changes := r.changes()
	if err := changes.validate(); err != nil {
		return View{}, err
	}
	if changes.count() > 0 && (r.Edit != nil || r.ExpectedRevision == nil || *r.ExpectedRevision != r.FromRevision) {
		return View{}, fail("invalid_input")
	}
	if (r.Polish != nil || r.Repair != nil) && r.FromRevision < 1 {
		return View{}, fail("invalid_input")
	}
	d := digest("fork", e, r)
	legacy := r.legacyDigest(e)
	// Return the original receipt on a retry even when its source has advanced.
	if prior, err := pgq.New(s.DB).ExperienceForkGet(ctx, pgq.ExperienceForkGetParams{AccountID: a, RequestID: r.RequestID}); err == nil {
		if !requestDigestMatches(prior.Digest, d, legacy) {
			return View{}, fail("request_id_conflict")
		}
		return s.Get(ctx, a, e, prior.BranchID)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return View{}, err
	}
	var repaired State
	var replacement *Page
	if r.Polish != nil || r.Repair != nil {
		authority, last, err := s.authorContext(ctx, a, e, r.FromBranchID, r.FromRevision)
		if err != nil {
			return View{}, err
		}
		replacement = &last
		if r.Polish != nil {
			replacement.Text = r.Polish.Text
		} else {
			reviewer, ok := s.Generator.(interface {
				ReviewCandidate(context.Context, Context, Candidate) error
			})
			if !ok {
				return View{}, fail("algorithm_unavailable")
			}
			raw, _ := json.Marshal(r.Repair.Candidate)
			if validateContract(raw, "candidate") != nil {
				return View{}, fail("invalid_candidate")
			}
			if err = reviewer.ReviewCandidate(ctx, authority, r.Repair.Candidate); err != nil {
				return View{}, err
			}
			repaired, err = Apply(authority, r.Repair.Candidate)
			if err != nil {
				return View{}, err
			}
			// An author repair is a separately validated branch, not the original execution.
			replacement.GameplayReceipt = nil
			replacement.Text = r.Repair.Candidate.Passage
			replacement.StoryTime = repaired.StoryTime
			replacement.Suggestions = r.Repair.Candidate.Suggestions
			replacement.Outcome = r.Repair.Candidate.Outcome
		}
	}

	var id string
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		_, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: a, RequestID: r.RequestID})
		if err == nil {
			return fail("request_id_conflict")
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		f, err := q.ExperienceForkGet(ctx, pgq.ExperienceForkGetParams{AccountID: a, RequestID: r.RequestID})
		if err == nil {
			if !requestDigestMatches(f.Digest, d, legacy) {
				return fail("request_id_conflict")
			}
			id = f.BranchID
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		b, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: a, ExperienceID: e, ID: r.FromBranchID})
		if err != nil {
			return err
		}
		if r.FromRevision > b.Revision || (r.ExpectedRevision != nil && *r.ExpectedRevision != b.Revision) {
			return fail("revision_conflict")
		}
		if changes.count() > 0 {
			active, err := q.ExperienceActive(ctx, pgq.ExperienceActiveParams{AccountID: a, ExperienceID: e, BranchID: b.ID})
			if err != nil {
				return err
			}
			if len(active) > 0 {
				return fail("branch_busy")
			}
		}
		state := EmptyState()
		title := b.Title
		if r.FromRevision == b.Revision {
			if err = json.Unmarshal(b.State, &state); err != nil {
				return fail("history_unavailable")
			}
		} else if r.FromRevision > 0 {
			pages, err := q.ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: a, ExperienceID: e, BranchID: b.ID, ThroughRevision: r.FromRevision})
			if err != nil {
				return err
			}
			if len(pages) == 0 || pages[len(pages)-1].Revision != r.FromRevision {
				return fail("history_unavailable")
			}
			p := pages[len(pages)-1]
			title = p.Title
			if err = json.Unmarshal(p.State, &state); err != nil {
				return fail("history_unavailable")
			}
		}
		if r.Edit != nil {
			factID := strings.TrimPrefix(r.Edit.FactID, "fact:")
			found := false
			for i := range state.Facts {
				if state.Facts[i].ID == factID && state.Facts[i].Known {
					state.Facts[i].Text = r.Edit.Text
					found = true
				}
			}
			if !found {
				return fail("fact_not_known")
			}
			invalidateLiteraryForEdit(&state, r.FromRevision, true)
		}
		if r.Polish != nil {
			invalidateLiteraryForEdit(&state, r.FromRevision, false)
		}
		if r.Repair != nil {
			state = repaired
			title = r.Repair.Candidate.Title
		}
		parentRevision := r.FromRevision
		if replacement != nil {
			parentRevision--
		}
		id = newID("branch_")
		raw, _ := json.Marshal(state)
		if err = q.ExperienceBranchCreate(ctx, pgq.ExperienceBranchCreateParams{AccountID: a, ExperienceID: e, ID: id, Name: r.Name, Title: title, Revision: r.FromRevision, ParentBranchID: ns(b.ID), ParentRevision: sql.NullInt64{Int64: parentRevision, Valid: true}, State: raw}); err != nil {
			return err
		}
		if err = q.ExperiencePagesCopy(ctx, pgq.ExperiencePagesCopyParams{AccountID: a, ExperienceID: e, NewBranchID: id, FromBranchID: b.ID, ThroughRevision: r.FromRevision, ForkState: raw}); err != nil {
			return err
		}
		if r.FromRevision > 0 {
			snapshot, err := captureArtifactSnapshot(ctx, q, a, e, b.ID, r.FromRevision)
			if err != nil {
				return err
			}
			if snapshot != nil && r.Repair == nil {
				if replacement == nil {
					rows, err := q.ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: a, ExperienceID: e, BranchID: b.ID, ThroughRevision: r.FromRevision})
					if err != nil {
						return err
					}
					var last Page
					if len(rows) == 0 || json.Unmarshal(rows[len(rows)-1].Page, &last) != nil {
						return fail("history_unavailable")
					}
					replacement = &last
				}
				replacement.InteractionSnapshot = snapshot
			}
		}
		if r.Repair != nil {
			replacement.InteractionSnapshot = nil
		}
		if replacement != nil {
			replacement.Reader = ProjectReader(state, r.FromRevision)
			page, _ := json.Marshal(replacement)
			if err = q.ExperienceForkPageReplace(ctx, pgq.ExperienceForkPageReplaceParams{AccountID: a, ExperienceID: e, BranchID: id, Revision: r.FromRevision, Page: page, State: raw, Title: title}); err != nil {
				return err
			}
		}
		var edit []byte
		if r.Edit != nil {
			edit, _ = json.Marshal(r.Edit)
		}
		if changes.count() > 0 {
			edit, _ = json.Marshal(changes)
		}
		return q.ExperienceForkCreate(ctx, pgq.ExperienceForkCreateParams{AccountID: a, RequestID: r.RequestID, ExperienceID: e, BranchID: id, Digest: d, Edit: edit})
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, a, e, id)
}
func (s *Service) Preferences(ctx context.Context, a string) ([]Preference, error) {
	rows, err := pgq.New(s.DB).ExperiencePreferences(ctx, a)
	if err != nil {
		return nil, err
	}
	out := []Preference{}
	for _, p := range rows {
		out = append(out, Preference{Dimension: p.Dimension, Value: p.Value, Source: p.Source, Evidence: p.Evidence})
	}
	return out, nil
}
