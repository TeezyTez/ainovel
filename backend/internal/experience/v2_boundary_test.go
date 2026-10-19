package experience

import (
	"encoding/json"
	"testing"
)

// The frozen boundary must accept the exact Context Go materializes.
func TestContextV2CoverageValidatesAgainstFrozenContract(t *testing.T) {
	ctx := sampleContext()
	raw, err := json.Marshal(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateContract(raw, "context"); err != nil {
		t.Fatalf("v2 context rejected by frozen contract: %v (%s)", err, raw)
	}
	// A v1-shaped context (missing coverage/budget/recalls, version 1) must be
	// rejected rather than read as complete.
	if err := validateContract([]byte(`{"version":1}`), "context"); err == nil {
		t.Fatal("v1 context accepted by v2 contract")
	}
}

func TestThreadResolutionIsTombstoneNotDeletion(t *testing.T) {
	ctx := sampleContext()
	ctx.Revision = 1
	ctx.State = EmptyState()
	ctx.State.Threads = []Thread{{ID: "t", Text: "旧约未了", Known: true, RelatedFactIDs: []string{}}}
	closeThread := sampleCandidate()
	closeThread.ResolveThreadIDs = []string{"t"}
	state, err := Apply(ctx, closeThread)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Threads) != 1 || state.Threads[0].ID != "t" || state.Threads[0].ResolvedAtRevision == nil || *state.Threads[0].ResolvedAtRevision != 2 {
		t.Fatalf("resolution deleted or mis-stamped the stable identity: %+v", state.Threads)
	}
	if state.Threads[0].Text != "旧约未了" {
		t.Fatalf("resolution rewrote the record: %q", state.Threads[0].Text)
	}
	// Closing an already-closed thread is not a second formal transition.
	reopen := ctx
	reopen.State = state
	reopen.Revision = 2
	if _, err = Apply(reopen, closeThread); err == nil {
		t.Fatal("re-resolving a closed thread was accepted")
	}
	// A reused ID must collide, not rebind the old relations to a new topic.
	reuse := sampleCandidate()
	reuse.NewThreads = []Thread{{ID: "t", Text: "全新话题", RelatedFactIDs: []string{}}}
	if _, err = Apply(ctx, reuse); err == nil {
		t.Fatal("thread id rebind was accepted")
	}
	// A candidate may not mint its own closure time.
	forged := sampleCandidate()
	forged.NewThreads = []Thread{{ID: "u", Text: "伪造收束", RelatedFactIDs: []string{}, ResolvedAtRevision: ptrInt64(1)}}
	if _, err = Apply(ctx, forged); err == nil {
		t.Fatal("candidate-forged resolved_at_revision was accepted")
	}
}

func ptrInt64(v int64) *int64 { return &v }
