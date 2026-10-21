package schema

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
)

//go:embed migrations/00159_experience_narrative.sql
var narrativeSQL string

// ApplyNarrative adds ephemeral preparation and operation metadata. It never
// rewrites an existing page/state, and rejects partially applied schemas.
func ApplyNarrative(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(159284619)`); err != nil {
		return err
	}
	var present bool
	var columns int
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass('experience_narrative_preparations') IS NOT NULL`).Scan(&present); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='experience_operations' AND column_name IN ('reading_request','progress_phase','progress_seq','narrative_approval')`).Scan(&columns); err != nil {
		return err
	}
	if present && columns == 4 {
		return tx.Commit()
	}
	if present || columns != 0 {
		return errors.New("partial narrative schema; manual review required")
	}
	if _, err = tx.ExecContext(ctx, narrativeSQL); err != nil {
		return err
	}
	return tx.Commit()
}
