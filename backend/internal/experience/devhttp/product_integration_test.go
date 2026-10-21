//go:build integration

package devhttp

import (
	"context"
	"elselife/backend/internal/experience"
	"elselife/backend/internal/platform/database"
	"elselife/backend/internal/platform/testpostgres"
	"elselife/backend/schema"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProductSchemaAndPlainJSONWorkspace(t *testing.T) {
	ctx := context.Background()
	dsn := testpostgres.New(t).DSN()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = schema.ApplyEmpty(ctx, db); err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `DO $$ BEGIN IF (SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='public') <> 'experience_artifact_heads,experience_artifact_receipts,experience_artifact_versions,experience_branches,experience_forks,experience_gameplay_operations,experience_model_inputs,experience_narrative_preparations,experience_operations,experience_pages,experience_preferences,experience_reads,experiences,recovery_gate' THEN RAISE EXCEPTION 'unexpected product schema inventory'; END IF; END $$;`)
	if err != nil {
		t.Fatal(err)
	}
	serving, err := database.OpenServing(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer serving.Close()
	s := &experience.Service{DB: serving, Generator: &experience.Algorithm{}}
	api := Handler{Service: s, Dispatch: func(a, r string) {
		if a != Workspace {
			t.Fatal(a)
		}
		_ = s.GenerateAccepted(ctx, a, r)
	}}.Routes()
	h := Boundary(api, "")
	w := request(h, "GET", "/v1/experiences", "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"experiences":[]}` {
		t.Fatal(w)
	}
	r := httptest.NewRequest("POST", "http://127.0.0.1:18081/v1/experiences", strings.NewReader(`{"request_id":"local-1","seed":"真实设定，不是账号模拟"}`))
	r.RemoteAddr = "127.0.0.1:1234"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 202 {
		t.Fatal(w)
	}
	// Missing model fails explicitly; no fabricated page is committed.
	op, err := s.Receipt(ctx, Workspace, "local-1")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(op)
	if !strings.Contains(string(raw), "model_unavailable") {
		t.Fatalf("missing model not explicit: %s", raw)
	}
	other, err := s.List(ctx, "not-the-workspace")
	if err != nil || len(other) != 0 {
		t.Fatal(other, err)
	}
	w = request(h, "GET", "/v1/experience-requests/local-1", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "model_unavailable") {
		t.Fatal(w)
	}
}
