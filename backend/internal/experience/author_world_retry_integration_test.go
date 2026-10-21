//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/sqlc/pgq"
)

func TestCreateReplaysPreUpgradeStyleDigest(t *testing.T) {
	s, admin, _ := testService(t)
	ctx := context.Background()
	var request CreateRequest
	must(t, StrictJSON([]byte(legacyCreateBody), &request))
	original, fresh, err := s.Create(ctx, "legacy", request)
	must(t, err)
	if !fresh {
		t.Fatal("new request was not created")
	}
	var stored string
	must(t, admin.QueryRowContext(ctx, `SELECT digest FROM experience_operations WHERE account_id=$1 AND request_id=$2`, "legacy", request.RequestID).Scan(&stored))
	if stored != digest("create", "", request) || stored == legacyCreateDigest {
		t.Fatal("new operation did not store the canonical style-free digest")
	}
	if oldBodyDigest("create", "", legacyCreateBody) != legacyCreateDigest {
		t.Fatal("pre-upgrade byte fixture changed")
	}
	_, err = admin.ExecContext(ctx, `UPDATE experience_operations SET digest=$1 WHERE account_id=$2 AND request_id=$3`, legacyCreateDigest, "legacy", request.RequestID)
	must(t, err)
	replayed, fresh, err := s.Create(ctx, "legacy", request)
	must(t, err)
	if fresh || replayed.ID != original.ID || replayed.BranchID != original.BranchID {
		t.Fatal("pre-upgrade create did not return its original receipt")
	}
	for name, body := range map[string]string{
		"changed seed":   strings.Replace(legacyCreateBody, `"seed":"Port story"`, `"seed":"Other story"`, 1),
		"changed style":  strings.Replace(legacyCreateBody, `"style":"legacy"`, `"style":"different"`, 1),
		"changed author": strings.Replace(legacyCreateBody, `"identity":"Courier"`, `"identity":"Sailor"`, 1),
		"missing style":  strings.Replace(legacyCreateBody, `"style":"legacy",`, "", 1),
	} {
		t.Run(name, func(t *testing.T) {
			var changed CreateRequest
			must(t, StrictJSON([]byte(body), &changed))
			_, _, err := s.Create(ctx, "legacy", changed)
			code(t, err, "request_id_conflict")
		})
	}
}

func TestForkReplaysPreUpgradeStyleDigestAfterSourceAdvances(t *testing.T) {
	s, admin, _ := testService(t)
	ctx := context.Background()
	source := begin(t, s, "legacy", "source")
	body := legacyForkBody(source.BranchID, "legacy-fork")
	var request ForkRequest
	must(t, StrictJSON([]byte(body), &request))
	original, err := s.Fork(ctx, "legacy", source.ID, request)
	must(t, err)
	var stored string
	must(t, admin.QueryRowContext(ctx, `SELECT digest FROM experience_forks WHERE account_id=$1 AND request_id=$2`, "legacy", request.RequestID).Scan(&stored))
	oldDigest := oldBodyDigest("fork", source.ID, body)
	if stored != digest("fork", source.ID, request) || stored == oldDigest {
		t.Fatal("new fork did not store the canonical style-free digest")
	}
	_, err = admin.ExecContext(ctx, `UPDATE experience_forks SET digest=$1 WHERE account_id=$2 AND request_id=$3`, oldDigest, "legacy", request.RequestID)
	must(t, err)
	advance(t, s, "legacy", source, "advance-source", "read")
	replayed, err := s.Fork(ctx, "legacy", source.ID, request)
	must(t, err)
	if replayed.ID != original.ID || replayed.BranchID != original.BranchID {
		t.Fatal("pre-upgrade fork did not return its original receipt")
	}
	for name, changedBody := range map[string]string{
		"changed seed":   strings.Replace(body, `"public_seed":"Port story"`, `"public_seed":"Other story"`, 1),
		"changed style":  strings.Replace(body, `"style":"legacy"`, `"style":"different"`, 1),
		"changed author": strings.Replace(body, `"identity":"Courier"`, `"identity":"Sailor"`, 1),
		"missing style":  strings.Replace(body, `"style":"legacy",`, "", 1),
	} {
		t.Run(name, func(t *testing.T) {
			var changed ForkRequest
			must(t, StrictJSON([]byte(changedBody), &changed))
			_, err := s.Fork(ctx, "legacy", source.ID, changed)
			code(t, err, "request_id_conflict")
		})
	}
}

func TestForkReplaysPreUpgradeStyleDigestAfterRequestLock(t *testing.T) {
	s, admin, _ := testService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	source := begin(t, s, "legacy", "source")
	var originalRequest ForkRequest
	must(t, StrictJSON([]byte(legacyForkBody(source.BranchID, "original-fork")), &originalRequest))
	original, err := s.Fork(ctx, "legacy", source.ID, originalRequest)
	must(t, err)
	body := legacyForkBody(source.BranchID, "racing-legacy-fork")
	var request ForkRequest
	must(t, StrictJSON([]byte(body), &request))
	tx, err := admin.BeginTx(ctx, nil)
	must(t, err)
	defer tx.Rollback()
	q := pgq.New(tx)
	must(t, requestLock(ctx, q, "legacy", request.RequestID))
	type result struct {
		view View
		err  error
	}
	done := make(chan result, 1)
	go func() {
		view, err := s.Fork(ctx, "legacy", source.ID, request)
		done <- result{view, err}
	}()
	// The retry has passed the optimistic read once it waits on our request
	// lock. Publish the old receipt while still holding that lock.
	for {
		var waiting bool
		must(t, admin.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted)`).Scan(&waiting))
		if waiting {
			break
		}
		select {
		case result := <-done:
			t.Fatalf("retry returned before request lock: %v", result.err)
		case <-ctx.Done():
			t.Fatal("retry never reached request lock")
		case <-time.After(10 * time.Millisecond):
		}
	}
	edit, _ := json.Marshal(request.changes())
	must(t, q.ExperienceForkCreate(ctx, pgq.ExperienceForkCreateParams{AccountID: "legacy", RequestID: request.RequestID, ExperienceID: source.ID, BranchID: original.BranchID, Digest: oldBodyDigest("fork", source.ID, body), Edit: edit}))
	must(t, tx.Commit())
	replayed := <-done
	must(t, replayed.err)
	if replayed.view.BranchID != original.BranchID {
		t.Fatal("locked retry did not return the old fork")
	}
}
