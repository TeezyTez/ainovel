package devhttp

import (
	"elselife/backend/internal/experience"
	"io"
	"net/http"
)

func (h Handler) registerArchiveRoutes(mux *http.ServeMux) {
	mux.HandleFunc("DELETE /v1/experiences/{id}", h.wrap(func(w http.ResponseWriter, r *http.Request, account string) error {
		if err := h.Service.DeleteExperience(r.Context(), account, r.PathValue("id")); err != nil {
			return err
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	mux.HandleFunc("GET /v1/archive", h.wrap(func(w http.ResponseWriter, r *http.Request, account string) error {
		archive, err := h.Service.ExportArchive(r.Context(), account)
		if err != nil {
			return err
		}
		w.Header().Set("Content-Disposition", `attachment; filename="elselife-experiences.json"`)
		writeJSON(w, r, http.StatusOK, archive)
		return nil
	}))
	mux.HandleFunc("POST /v1/archive", h.wrap(func(w http.ResponseWriter, r *http.Request, account string) error {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, experience.MaxArchiveBytes))
		if err != nil {
			return &experience.Error{Code: "archive_too_large"}
		}
		archive, err := experience.DecodeArchive(raw)
		if err != nil {
			return err
		}
		result, err := h.Service.ImportArchive(r.Context(), account, archive)
		if err != nil {
			return err
		}
		writeJSON(w, r, http.StatusOK, result)
		return nil
	}))
}
