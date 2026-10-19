package devhttp

import (
	"elselife/backend/internal/experience"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestArtifactRoutesRequireExplicitCASFieldsAndRejectUnknownAuthority(t *testing.T) {
	for _, tc := range []struct{ path, body string }{
		{"prepare", `{"request_id":"r","branch_id":"b"}`},
		{"input", `{"request_id":"r","branch_id":"b","expected_revision":1}`},
		{"input", `{"request_id":"r","branch_id":"b","expected_revision":1,"input":"x","candidate":{}}`},
		{"prepare", `{"request_id":"r","branch_id":"b","expected_revision":1,"author_world":{}}`},
		{"import", `{"request_id":"r","branch_id":"b","expected_revision":1,"definition":{},"state":{},"game":{}}`},
		{"a/state", `{"request_id":"r","branch_id":"b","expected_revision":1,"revision_id":"v","state":{}}`},
		{"a/restore", `{"request_id":"r","branch_id":"b","expected_revision":1,"revision_id":"v","expected_state_revision":0}`},
	} {
		w := httptest.NewRecorder()
		Handler{Service: &experience.Service{}}.Routes().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/experiences/e/artifacts/"+tc.path, strings.NewReader(tc.body)))
		if w.Code != 400 {
			t.Fatalf("%s status=%d", tc.path, w.Code)
		}
	}
}
