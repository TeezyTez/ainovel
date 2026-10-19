package experience

import (
	"context"
	"encoding/json"
	"time"

	"elselife/backend/internal/sqlc/pgq"
)

// PreferenceSnapshot is HTTP-only: canonical generation preferences stay unchanged.
// Version is the actual database updated_at, not a client-generated counter.
type PreferenceSnapshot struct {
	Preference
	Version string `json:"version"`
}

type PreferenceChange struct {
	Dimension    string              `json:"dimension"`
	Expected     *PreferenceSnapshot `json:"expected"`
	Value        *string             `json:"value"` // null explicitly deletes only this dimension
	Expression   string              `json:"expression,omitempty"`
	Confirmation string              `json:"confirmation,omitempty"`
}

func preferenceSnapshots(rows []pgq.ExperiencePreference) []PreferenceSnapshot {
	out := []PreferenceSnapshot{}
	for _, p := range rows {
		out = append(out, PreferenceSnapshot{Preference: Preference{Dimension: p.Dimension, Value: p.Value, Source: p.Source, Evidence: p.Evidence}, Version: p.UpdatedAt.UTC().Format(time.RFC3339Nano)})
	}
	return out
}
func (s *Service) PreferenceSnapshots(ctx context.Context, account string) ([]PreferenceSnapshot, error) {
	rows, err := pgq.New(s.DB).ExperiencePreferences(ctx, account)
	return preferenceSnapshots(rows), err
}

// ChangePreference compares the exact read state while holding the existing
// account-scoped transaction lock. There is no read/check/write race and no
// whole-list writer. Only the named dimension gets SQL or a new source warrant.
func (s *Service) ChangePreference(ctx context.Context, account string, change PreferenceChange) ([]PreferenceSnapshot, error) {
	if !textOK(change.Dimension) || len(change.Dimension) > 128 || change.Expected != nil && (change.Expected.Dimension != change.Dimension || change.Expected.Version == "") {
		return nil, fail("invalid_preferences")
	}
	var evidence string
	if change.Value != nil {
		if !utf8String(*change.Value) || !textOK(change.Expression) || len(*change.Value)+len(change.Expression) > 12<<10 {
			return nil, fail("invalid_preferences")
		}
		switch change.Confirmation {
		case "direct_expression":
			if *change.Value != change.Expression {
				return nil, fail("invalid_preferences")
			}
		case "accepted_model_draft": // a conscious user confirmation, never a model write
		default:
			return nil, fail("invalid_preferences")
		}
		raw, _ := json.Marshal(struct {
			Expression   string `json:"expression"`
			Confirmation string `json:"confirmation"`
		}{change.Expression, change.Confirmation})
		evidence = string(raw)
	}
	var out []PreferenceSnapshot
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, account, "preferences"); err != nil {
			return err
		}
		rows, err := q.ExperiencePreferences(ctx, account)
		if err != nil {
			return err
		}
		var current *PreferenceSnapshot
		for _, row := range preferenceSnapshots(rows) {
			if row.Dimension == change.Dimension {
				v := row
				current = &v
				break
			}
		}
		if (current == nil) != (change.Expected == nil) || current != nil && *current != *change.Expected {
			return fail("preference_conflict")
		}
		if change.Value == nil {
			err = q.ExperiencePreferenceDelete(ctx, pgq.ExperiencePreferenceDeleteParams{AccountID: account, Dimension: change.Dimension})
		} else {
			if current == nil && len(rows) >= 128 {
				return fail("invalid_preferences")
			}
			err = q.ExperiencePreferencePut(ctx, pgq.ExperiencePreferencePutParams{AccountID: account, Dimension: change.Dimension, Value: *change.Value, Evidence: evidence})
		}
		if err != nil {
			return err
		}
		rows, err = q.ExperiencePreferences(ctx, account)
		out = preferenceSnapshots(rows)
		return err
	})
	return out, err
}
