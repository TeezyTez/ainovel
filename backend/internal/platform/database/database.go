// Package database opens development PostgreSQL pools; never applies legacy bootstrap.
package database

import (
	"context"
	"database/sql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"time"
)

func Open(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	return configurePool(ctx, db)
}

// OpenServing preserves the original per-physical-connection recovery gate.
func OpenServing(ctx context.Context, dsn string) (*sql.DB, error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	db := stdlib.OpenDB(*cfg, stdlib.OptionAfterConnect(func(ctx context.Context, conn *pgx.Conn) error {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		_, err := conn.Exec(ctx, "SELECT acquire_serving_gate()")
		if err != nil {
			return servingGateError(err)
		}
		return nil
	}))
	return configurePool(ctx, db)
}
func configurePool(ctx context.Context, db *sql.DB) (*sql.DB, error) {
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(20)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
