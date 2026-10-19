package devhttp

import (
	"context"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/experience"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type portalDraftModel struct {
	text  string
	err   error
	calls int
}

func (m *portalDraftModel) Generate(_ context.Context, req model.Request) (model.Result, error) {
	m.calls++
	if len(req.Schema) == 0 {
		return model.Result{}, errors.New("missing schema")
	}
	return model.Result{Text: m.text}, m.err
}
func (*portalDraftModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return errors.New("unexpected stream")
}

func TestPortalWorldDraftFailuresNeverReturnFabricatedWorldOrProviderDetails(t *testing.T) {
	for _, tc := range []struct {
		name  string
		model *portalDraftModel
		body  string
		code  int
	}{
		{"unconfigured", nil, `{"request_id":"draft","idea":"港口"}`, 503},
		{"upstream failure", &portalDraftModel{err: errors.New("private upstream diagnostic")}, `{"request_id":"draft","idea":"港口"}`, 503},
		{"incomplete output", &portalDraftModel{text: `{"title":"港口"}`}, `{"request_id":"draft","idea":"港口"}`, 503},
		{"bad request", &portalDraftModel{}, `{"request_id":"draft","idea":""}`, 400},
		{"unknown request field", &portalDraftModel{}, `{"request_id":"draft","idea":"港口","secret":"inject"}`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := Handler{}
			if tc.model != nil {
				h.Feedback = &experience.FeedbackInterpreter{Model: tc.model, ModelName: "test-model", ContextTokens: 8192, OutputTokens: 512, MaxInputBytes: 65536, MaxOutputBytes: 65536, Timeout: time.Second, ByteTokenBoundVerified: true}
			}
			response := httptest.NewRecorder()
			h.Routes().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/world-drafts/generate", strings.NewReader(tc.body)))
			if response.Code != tc.code {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			for _, forbidden := range []string{`"world"`, "private upstream diagnostic", `"title"`} {
				if strings.Contains(response.Body.String(), forbidden) {
					t.Fatalf("unsafe response: %s", response.Body.String())
				}
			}
			if tc.model != nil && tc.model.calls > 1 {
				t.Fatal("unexpected retry")
			}
		})
	}
}
