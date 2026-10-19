package channel

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestQueueDeadlineAndInvalidFramePreserveOtherWaiters(t *testing.T) {
	addr, stop := startServerWithStreamHook(t, ServerOptions{Handler: slowHandler{}, Authorizer: allowAllAuthorizer{}}, nil)
	defer stop()
	link := newLinkTo(t, addr)
	w, err := link.Subscribe("good")
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	// A cancelled root waiting for the write permit must not invalidate peers.
	link.sendSem <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := link.Send(ctx, requestFrame("cancelled", "cancelled")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("%v", err)
	}
	<-link.sendSem
	bad := requestFrame("bad", "bad")
	bad.ContentType = "bad"
	if err := link.Send(context.Background(), bad); err == nil {
		t.Fatal("accepted invalid frame")
	}
	if err := w.Send(context.Background(), requestFrame("good", "cnv_ok")); err != nil {
		t.Fatal(err)
	}
	limit, stopWait := context.WithTimeout(context.Background(), time.Second)
	defer stopWait()
	if _, err := w.Next(limit); err != nil {
		t.Fatalf("local rejection poisoned another root: %v", err)
	}
}

func TestCallbackCannotRedialAnOldRoot(t *testing.T) {
	var streams atomic.Int32
	addr, stop := startServerWithStreamHook(t, ServerOptions{Handler: slowHandler{}, Authorizer: allowAllAuthorizer{}}, func() { streams.Add(1) })
	defer stop()
	link := newLinkTo(t, addr)
	w, err := link.Subscribe("old")
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if err := w.Send(context.Background(), requestFrame("old", "cnv_ok")); err != nil {
		t.Fatal(err)
	}
	limit, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := w.Next(limit); err != nil {
		t.Fatal(err)
	}
	link.Drop(errors.New("actual stream death"))
	if err := w.Send(context.Background(), requestFrame("old", "cnv_ok")); err == nil {
		t.Fatal("dead-stream callback reattached")
	}
	if streams.Load() != 1 {
		t.Fatalf("old callback redialed: %d", streams.Load())
	}
	fresh, err := link.Subscribe("fresh")
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	if err := fresh.Send(context.Background(), requestFrame("fresh", "cnv_ok")); err != nil {
		t.Fatal(err)
	}
	if _, err := fresh.Next(limit); err != nil {
		t.Fatal(err)
	}
	if streams.Load() != 2 {
		t.Fatalf("new accepted request should redial: %d", streams.Load())
	}
}
