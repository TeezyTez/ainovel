package devhttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestArchiveImportRejectsMalformedDocumentsBeforeDatabaseAccess(t *testing.T) {
	api := Handler{}.Routes()
	for _, body := range []string{`{}`, `{"version":1,"format":"elselife-experience-archive","experiences":null}`, `{"version":1,"format":"elselife-experience-archive","experiences":[],"operations":[]}`, `{"version":1,"version":2,"format":"elselife-experience-archive","experiences":[]}`} {
		request := httptest.NewRequest(http.MethodPost, "/v1/archive", strings.NewReader(body))
		response := httptest.NewRecorder()
		api.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	}
}
