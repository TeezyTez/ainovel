// Package schema embeds the product-only empty-database schema. No legacy bootstrap.
package schema

import (
	"context"
	"database/sql"
	_ "embed"
)

//go:embed schema.sql
var SQL string

// ApplyEmpty is intentionally not an upgrade/adoption tool. Existing objects fail.
func ApplyEmpty(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, SQL)
	return err
}
