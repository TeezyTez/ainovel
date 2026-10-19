package model

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGenerateCancellationSanitizesURL(t *testing.T) {
	for _, mode := range []string{"cancel", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			entered := make(chan struct{})
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				close(entered)
				<-r.Context().Done()
			}))
			defer srv.Close()
			c, err := NewOpenAI(srv.URL+"/private-path?secret=hidden", "private-token", "test")
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			want := context.Canceled
			if mode == "deadline" {
				ctx, cancel = context.WithTimeout(context.Background(), 300*time.Millisecond)
				defer cancel()
				want = context.DeadlineExceeded
			}
			done := make(chan error, 1)
			go func() {
				_, err := c.Generate(ctx, Request{Messages: []Message{{Role: "user", Content: "private-prompt"}}})
				done <- err
			}()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("HTTP not entered")
			}
			if mode == "cancel" {
				cancel()
			}
			select {
			case err := <-done:
				if !errors.Is(err, want) || err.Error() != want.Error() || strings.Contains(err.Error(), "private") {
					t.Fatalf("unsafe or missing cause: %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("HTTP cancellation blocked")
			}
		})
	}
}
