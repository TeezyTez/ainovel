package devhttp

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func writeJSON(w http.ResponseWriter, _ *http.Request, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErrorJSON(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, r, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

// LoopbackAddress requires a literal loopback IP; DNS and wildcard bind are rejected.
func LoopbackAddress(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	return err == nil && net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}

// Boundary is a development-only loopback/Host/origin guard, not authentication.
func Boundary(api http.Handler, staticDir string) http.Handler {
	var files http.Handler
	if staticDir != "" {
		files = http.FileServer(http.Dir(staticDir))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if !strings.Contains(host, ":") {
			host = net.JoinHostPort(host, "80")
		}
		hostname, _, _ := net.SplitHostPort(host)
		remote, _, err := net.SplitHostPort(r.RemoteAddr)
		if !(LoopbackAddress(host) || hostname == "localhost") || err != nil || net.ParseIP(remote) == nil || !net.ParseIP(remote).IsLoopback() {
			writeErrorJSON(w, r, 403, "loopback_only", "Loopback development access only.")
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		origin := r.Header.Get("Origin")
		if origin != "" {
			same := origin == "http://"+r.Host
			allowed := same || origin == "http://127.0.0.1:18080" || origin == "http://localhost:18080"
			if !allowed {
				writeErrorJSON(w, r, 403, "origin_rejected", "Development origin not allowed.")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Account-ID") != "" || r.Header.Get("X-User-ID") != "" {
			writeErrorJSON(w, r, 400, "identity_headers_not_supported", "This development server has one fixed workspace, not user identities.")
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/v1/") || r.URL.Path == "/healthz" {
			api.ServeHTTP(w, r)
			return
		}
		if files != nil && (r.Method == "GET" || r.Method == "HEAD") {
			clean := filepath.Clean("/" + r.URL.Path)
			if st, err := os.Stat(filepath.Join(staticDir, clean)); err == nil && !st.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		writeErrorJSON(w, r, 404, "not_found", "Not found.")
	})
}
