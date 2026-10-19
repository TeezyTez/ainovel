// Package devhttp is a plain-JSON, fixed-workspace development adapter. Not authentication.
package devhttp

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"elselife/backend/internal/experience"
)

const Workspace = "local-workspace"

type Handler struct {
	Service  *experience.Service
	Dispatch func(string, string)
	Feedback *experience.FeedbackInterpreter
}

func (h Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	h.registerPortalRoutes(mux)
	h.registerArchiveRoutes(mux)
	h.registerArtifactRoutes(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, 200, map[string]string{"service": "elselife-product-dev", "status": "ok"})
	})
	mux.HandleFunc("GET /v1/time", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, 200, map[string]any{"unix": time.Now().Unix(), "skewWindowSeconds": 30})
	})
	mux.HandleFunc("GET /v1/meta", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, 200, map[string]any{"name": "ElseLife", "slug": "elselife", "experience_contract": experience.ContractSHA256})
	})
	mux.HandleFunc("GET /v1/experiences", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		list, err := h.Service.List(r.Context(), a)
		if err != nil {
			return err
		}
		summaries := []experience.Summary{}
		for _, v := range list {
			summaries = append(summaries, experience.Summary{ID: v.ID, Title: v.Title, Seed: v.Seed, ActiveBranchID: v.ActiveBranchID, UpdatedAt: v.UpdatedAt})
		}
		writeJSON(w, r, 200, map[string]any{"experiences": summaries})
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.CreateRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		v, fresh, err := h.Service.Create(r.Context(), a, req)
		if err != nil {
			return err
		}
		if fresh && h.Dispatch != nil {
			h.Dispatch(a, req.RequestID)
		}
		writeJSON(w, r, 202, v)
		return nil
	}))
	mux.HandleFunc("GET /v1/experience-requests/{request_id}", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		v, err := h.Service.Receipt(r.Context(), a, r.PathValue("request_id"))
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, v)
		return nil
	}))
	mux.HandleFunc("GET /v1/experiences/{id}", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		v, err := h.Service.Get(r.Context(), a, r.PathValue("id"), r.URL.Query().Get("branch_id"))
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, v)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/operations", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.AdvanceRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		v, fresh, err := h.Service.Advance(r.Context(), a, r.PathValue("id"), req)
		if err != nil {
			return err
		}
		if fresh && h.Dispatch != nil {
			h.Dispatch(a, req.RequestID)
		}
		writeJSON(w, r, 202, v)
		return nil
	}))
	mux.HandleFunc("GET /v1/experiences/{id}/operations/{request_id}", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		v, err := h.Service.GetOperation(r.Context(), a, r.PathValue("id"), r.PathValue("request_id"))
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, v)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/operations/{request_id}/cancel", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		v, err := h.Service.Cancel(r.Context(), a, r.PathValue("id"), r.PathValue("request_id"))
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, v)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/branches", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ForkRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		v, err := h.Service.Fork(r.Context(), a, r.PathValue("id"), req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 201, v)
		return nil
	}))
	mux.HandleFunc("GET /v1/experience-preferences", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		v, err := h.Service.PreferenceSnapshots(r.Context(), a)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, map[string]any{"preferences": v})
		return nil
	}))
	mux.HandleFunc("PUT /v1/experience-preferences", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.PreferenceChange
		if err := decode(w, r, &req); err != nil {
			return err
		}
		v, err := h.Service.ChangePreference(r.Context(), a, req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, map[string]any{"preferences": v})
		return nil
	}))
	mux.HandleFunc("POST /v1/experience-preferences/interpret", h.wrap(func(w http.ResponseWriter, r *http.Request, _ string) error {
		var req experience.FeedbackRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		v, err := h.Feedback.Interpret(r.Context(), req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, v)
		return nil
	}))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { writeErrorJSON(w, r, 404, "not_found", "Not found.") })
	return mux
}
func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	limit := int64(64 << 10)
	switch dst.(type) {
	case *experience.CreateRequest, *experience.ForkRequest, *experience.ArtifactImportRequest:
		limit = 2 << 20
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return &experience.Error{Code: "invalid_json"}
	}
	fields := []string{}
	switch dst.(type) {
	case *experience.PreferenceChange:
		// expected/value must be present; explicit null is meaningful here.
		var object map[string]json.RawMessage
		if json.Unmarshal(raw, &object) != nil || object == nil {
			return &experience.Error{Code: "invalid_json"}
		}
		for _, key := range []string{"expected", "value"} {
			if _, ok := object[key]; !ok {
				return &experience.Error{Code: "invalid_json"}
			}
		}
		fields = []string{"dimension"}
	case *experience.ArtifactInputRequest:
		fields = []string{"request_id", "branch_id", "expected_revision", "input"}
	case *experience.ArtifactExecuteRequest:
		fields = []string{"request_id", "branch_id", "expected_revision", "revision_id", "definition_digest", "kind", "reference"}
	case *experience.ArtifactPrepareRequest:
		fields = []string{"request_id", "branch_id", "expected_revision"}
	case *experience.ArtifactImportRequest:
		fields = []string{"request_id", "branch_id", "expected_revision", "definition", "state"}
	case *experience.ArtifactStateRequest:
		fields = []string{"request_id", "branch_id", "expected_revision", "revision_id", "expected_state_revision", "state"}
	case *experience.ArtifactRestoreRequest:
		fields = []string{"request_id", "branch_id", "expected_revision", "revision_id", "expected_state_revision", "expected_head"}
	case *experience.FeedbackRequest:
		fields = []string{"text"}
	case *experience.CreateRequest:
		fields = []string{"request_id", "seed"}
	case *experience.AdvanceRequest:
		fields = []string{"request_id", "branch_id", "expected_revision", "mode", "input"}
	case *experience.ForkRequest:
		fields = []string{"request_id", "from_branch_id", "from_revision", "name"}
	}
	switch dst.(type) {
	case *experience.CreateRequest, *experience.ForkRequest:
		var object map[string]json.RawMessage
		if json.Unmarshal(raw, &object) != nil {
			return &experience.Error{Code: "invalid_json"}
		}
		if author, ok := object["author_world"]; ok {
			if err := experience.ValidateAuthorWorldJSON(author); err != nil {
				return err
			}
		}
	}
	if err := experience.RequiredJSON(raw, fields...); err != nil {
		return err
	}
	return experience.StrictJSON(raw, dst)
}
func (h Handler) wrap(fn func(http.ResponseWriter, *http.Request, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r, Workspace); err != nil {
			writeError(w, r, err)
		}
	}
}
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code := 503, "unavailable"
	var domain *experience.Error
	switch {
	case errors.Is(err, sql.ErrNoRows):
		status, code = 404, "not_found"
	case errors.As(err, &domain):
		code = domain.Code
		switch code {
		case "archive_too_large", "artifact_capacity":
			status = 413
		case "artifact_conflict", "artifact_target_conflict", "request_id_conflict", "revision_conflict", "preference_conflict", "branch_busy", "superseded":
			status = 409
		case "invalid_gameplay", "invalid_intent", "action_not_authorized", "invalid_artifact", "invalid_archive", "invalid_json", "invalid_input", "invalid_mode", "invalid_preferences", "fact_not_known":
			status = 400
		}
	}
	writeErrorJSON(w, r, status, code, "请求未能完成，请按状态查询或修改后重试。")
}
