package schema

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
)

//go:embed migrations/00157_experience_artifacts.sql
var artifactSQL string

// ApplyArtifacts adds only presentation tables. Existing story data is untouched.
func ApplyArtifacts(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(157284619)`); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('experience_artifact_heads','experience_artifact_versions','experience_artifact_receipts') AND c.relkind='r'`).Scan(&count); err != nil {
		return err
	}
	if count == 3 {
		return tx.Commit()
	}
	if count != 0 {
		return errors.New("partial artifact schema; manual review required")
	}
	if _, err = tx.ExecContext(ctx, artifactSQL); err != nil {
		return err
	}
	return tx.Commit()
}
