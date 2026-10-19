package devhttp

import (
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/experience"
	"net/http"
)

func (h Handler) registerPortalRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/experiences/{id}/assist", h.wrap(func(w http.ResponseWriter, r *http.Request, a string) error {
		var req experience.AssistRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		result, err := h.Service.Assist(r.Context(), a, r.PathValue("id"), req, h.Feedback)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, result)
		return nil
	}))

	mux.HandleFunc("GET /v1/model-status", h.wrap(func(w http.ResponseWriter, r *http.Request, _ string) error {
		available := h.Feedback != nil && h.Feedback.Model != nil && h.Feedback.ModelName != ""
		provider, name := "", ""
		if available {
			name = h.Feedback.ModelName
			provider = "模型服务"
			if _, ok := h.Feedback.Model.(*model.CodexCLI); ok {
				provider = "Codex 本机授权"
			}
		}
		writeJSON(w, r, 200, map[string]any{"available": available, "provider": provider, "model": name, "checked": "configuration"})
		return nil
	}))
	mux.HandleFunc("POST /v1/world-drafts/generate", h.wrap(func(w http.ResponseWriter, r *http.Request, _ string) error {
		var req experience.WorldDraftRequest
		if err := decode(w, r, &req); err != nil {
			return err
		}
		draft, err := h.Feedback.GenerateWorld(r.Context(), req)
		if err != nil {
			return err
		}
		writeJSON(w, r, 200, map[string]any{"world": draft})
		return nil
	}))
}
