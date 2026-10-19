package devhttp

import (
	"elselife/backend/internal/experience"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func request(h http.Handler, method, path, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:18081"+path, nil)
	r.RemoteAddr = "127.0.0.1:9999"
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestBoundary(t *testing.T) {
	for _, s := range []string{"0.0.0.0:18081", ":18081", "example.com:80", "192.168.1.1:80", "localhost:18081"} {
		if LoopbackAddress(s) {
			t.Fatalf("unsafe bind %q", s)
		}
	}
	for _, s := range []string{"127.0.0.1:18081", "[::1]:18081"} {
		if !LoopbackAddress(s) {
			t.Fatal(s)
		}
	}
	h := Boundary(Handler{}.Routes(), "")
	for _, origin := range []string{"", "http://127.0.0.1:18080", "http://localhost:18080", "http://127.0.0.1:18081"} {
		if w := request(h, "GET", "/healthz", origin); w.Code != 200 {
			t.Fatal(origin, w.Code, w.Body.String())
		}
	}
	if w := request(h, "GET", "/healthz", "https://evil.example"); w.Code != 403 || !strings.Contains(w.Body.String(), `"error":{"code":"origin_rejected"`) {
		t.Fatal(w)
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:18081/healthz", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Authorization", "Bearer invented")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal(w)
	}
	r.Header.Del("Authorization")
	r.Host = "evil.example:18081"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w)
	}
	w = request(h, "POST", "/v1/cipher", "")
	if w.Code != 404 {
		t.Fatal(w)
	}
	w = request(h, "OPTIONS", "/v1/experiences", "http://localhost:18080")
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:18080" {
		t.Fatal(w)
	}
}
func TestJSONAndStatic(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, httptest.NewRequest("GET", "/", nil), &experience.Error{Code: "revision_conflict"})
	var v struct {
		Error struct{ Code, Message string }
	}
	if json.Unmarshal(w.Body.Bytes(), &v) != nil || w.Code != 409 || v.Error.Code != "revision_conflict" || v.Error.Message == "" {
		t.Fatal(w)
	}
	w = httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"dimension":"x"}`))
	if decode(w, r, &experience.PreferenceChange{}) == nil {
		t.Fatal("missing expected/value accepted")
	}
	d := t.TempDir()
	if err := os.WriteFile(filepath.Join(d, "index.html"), []byte("<html>product</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "main.js"), []byte("product();"), 0600); err != nil {
		t.Fatal(err)
	}
	h := Boundary(Handler{}.Routes(), d)
	for _, p := range []string{"/", "/route"} {
		w = request(h, "GET", p, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), "<html>product</html>") {
			t.Fatal(p, w)
		}
	}
	w = request(h, "GET", "/main.js", "")
	if w.Code != 200 || w.Body.String() != "product();" {
		t.Fatal(w)
	}
}
