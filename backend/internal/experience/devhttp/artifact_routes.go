package devhttp

import (
	"elselife/backend/internal/experience"
	"net/http"
)

func (h Handler) registerArtifactRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/experiences/{id}/artifacts/input", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ArtifactInputRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		out, err := h.Service.InterpretArtifactInput(r.Context(), a, r.PathValue("id"), req, h.Feedback)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("GET /v1/experiences/{id}/artifacts", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		out, err := h.Service.GetArtifact(r.Context(), a, r.PathValue("id"), r.URL.Query().Get("branch_id"), "", "")
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("GET /v1/experiences/{id}/artifacts/{artifact}", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		out, err := h.Service.GetArtifact(r.Context(), a, r.PathValue("id"), r.URL.Query().Get("branch_id"), r.PathValue("artifact"), r.URL.Query().Get("revision_id"))
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/artifacts/prepare", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ArtifactPrepareRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		out, err := h.Service.PrepareArtifact(r.Context(), a, r.PathValue("id"), req, h.Feedback)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/artifacts/import", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ArtifactImportRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		out, err := h.Service.ImportArtifact(r.Context(), a, r.PathValue("id"), req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/artifacts/{artifact}/state", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ArtifactStateRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		out, err := h.Service.SaveArtifactState(r.Context(), a, r.PathValue("id"), r.PathValue("artifact"), req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/artifacts/{artifact}/restore", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ArtifactRestoreRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		out, err := h.Service.RestoreArtifact(r.Context(), a, r.PathValue("id"), r.PathValue("artifact"), req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, out)
		return nil
	}))
	mux.HandleFunc("POST /v1/experiences/{id}/artifacts/{artifact}/execute", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.ArtifactExecuteRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		out, fresh, err := h.Service.ExecuteArtifact(r.Context(), a, r.PathValue("id"), r.PathValue("artifact"), req, h.Feedback)
		if err != nil {
			return err
		}
		if fresh && h.Dispatch != nil {
			h.Dispatch(a, req.RequestID)
		}
		writeJSON(w, r, 202, out)
		return nil
	}))
}
