package schema

import (
	"context"
	"database/sql"
	_ "embed"
)

//go:embed migrations/00158_experience_gameplay.sql
var gameplaySQL string

func ApplyGameplay(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(158284619)`); err != nil {
		return err
	}
	var present bool
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass('experience_gameplay_operations') IS NOT NULL`).Scan(&present); err != nil {
		return err
	}
	if !present {
		if _, err = tx.ExecContext(ctx, gameplaySQL); err != nil {
			return err
		}
	}
	return tx.Commit()
}
