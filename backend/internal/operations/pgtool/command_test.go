package pgtool

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConnectionOptions(t *testing.T) {
	for _, dsn := range []string{"postgresql://u:p%20word@localhost:5432/db?sslmode=verify-full&sslrootcert=%2Fprivate%2Fca&sslcert=%2Fcert&sslkey=%2Fkey", "host=localhost port=5432 user=u password='p word' dbname=db sslmode=verify-full sslrootcert=/private/ca sslcert=/cert sslkey=/key"} {
		p, err := parameters(dsn)
		if err != nil {
			t.Fatal(err)
		}
		if p["password"] != "p word" || p["sslmode"] != "verify-full" || p["sslrootcert"] != "/private/ca" || p["sslkey"] != "/key" {
			t.Fatal("connection options lost")
		}
	}
	got, err := parameters("postgres://localhost/telos")
	if err != nil || got["dbname"] != "telos" || got["host"] != "localhost" {
		t.Fatalf("postgres scheme: %v %v", got, err)
	}
	for _, dsn := range []string{"postgresql://localhost/db/extra", "postgresql://localhost//db", "postgres://"} {
		if _, err := parameters(dsn); err == nil {
			t.Fatalf("accepted %s", dsn)
		}
	}
	keyword, err := parameters("host=localhost dbname=app password='postgres://not-a-url'")
	if err != nil || keyword["password"] != "postgres://not-a-url" || keyword["dbname"] != "app" {
		t.Fatalf("keyword swallowed a url: %v %v", keyword, err)
	}
}
func TestCommandPrivateServiceNoCredentialsInArgs(t *testing.T) {
	dir := t.TempDir()
	tool := filepath.Join(dir, "check")
	script := "#!/bin/sh\n[ \"$#\" -eq 1 ] || exit 1\n[ \"$1\" = safe ] || exit 2\n[ \"$PGSERVICE\" = operation ] || exit 3\ngrep -q 'sslmode=verify-full' \"$PGSERVICEFILE\" || exit 4\ngrep -q 'password=secret' \"$PGSERVICEFILE\" || exit 5\n"
	if err := os.WriteFile(tool, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), "user=u password=secret sslmode=verify-full", tool, "safe"); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), "host='bad\n[evil]'", tool, "safe"); err == nil || strings.Contains(err.Error(), "evil") {
		t.Fatal("unsafe service injection")
	}
}
