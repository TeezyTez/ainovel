//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

// This sentinel observes the author-review boundary only. It never approves a
// proposal and cannot create a narrative memory approval or a formal page.
type authorMemoryReviewBoundary struct {
	Generator
	calls int
}

var errAuthorMemoryReviewReached = errors.New("author memory proposal reached structural review")

func (r *authorMemoryReviewBoundary) ReviewCandidate(context.Context, Context, Candidate) error {
	r.calls++
	return errAuthorMemoryReviewReached
}

func authorCandidateWithMemoryDelta(t *testing.T, original Candidate, nonempty bool) Candidate {
	t.Helper()
	raw, err := json.Marshal(original)
	must(t, err)
	var value map[string]any
	must(t, json.Unmarshal(raw, &value))
	delete(value, "memory_changes")
	entries := []any{}
	if nonempty {
		entries = append(entries, map[string]any{
			"id": "author-memory", "kind": "episode", "subject_ids": []string{"npc"},
			"target_ids": []string{}, "cue": "the last passage",
			"summary": "The guard spoke.", "status": "active",
			"retrieval_keys": []string{"guard"}, "fact_ids": []string{},
		})
	}
	value["memory_delta"] = map[string]any{"version": 2, "entries": entries}
	raw, err = json.Marshal(value)
	must(t, err)
	candidate, err := DecodeCandidate(raw)
	if err != nil {
		t.Fatalf("precondition: canonical v2 candidate must decode before author-boundary test: %v", err)
	}
	return candidate
}

func TestAuthorMemoryV2RepairRejectedBeforeReviewIncludingEmpty(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	const account = "author-memory-boundary"
	view := begin(t, s, account, "begin")
	before, err := s.ExportArchive(ctx, account)
	must(t, err)
	authority, _, err := s.authorContext(ctx, account, view.ID, view.BranchID, view.Revision)
	must(t, err)
	original := initial(authority)
	original.Passage = "The guard spoke."
	guard := &authorMemoryReviewBoundary{Generator: s.Generator}
	s.Generator = guard
	for _, nonempty := range []bool{false, true} {
		name := map[bool]string{false: "empty", true: "nonempty"}[nonempty]
		t.Run(name, func(t *testing.T) {
			proposal := authorCandidateWithMemoryDelta(t, original, nonempty)
			revision := view.Revision
			_, err := s.Fork(ctx, account, view.ID, ForkRequest{
				RequestID: "repair-" + name, FromBranchID: view.BranchID,
				FromRevision: revision, ExpectedRevision: &revision,
				Name: "Rejected memory proposal", Repair: &RepairChange{Candidate: proposal},
			})
			if guard.calls != 0 {
				t.Errorf("memory_delta reached structural reviewer %d times; want rejection before ReviewCandidate", guard.calls)
			}
			code(t, err, "invalid_candidate")
			after, err := s.ExportArchive(ctx, account)
			must(t, err)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected author proposal changed branches, formal pages, or state")
			}
		})
	}
}

func TestAuthorMemoryV2ArchiveRepairReplayRejectedIncludingEmpty(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	const account = "author-memory-archive"
	view := begin(t, s, account, "begin")
	authority, _, err := s.authorContext(ctx, account, view.ID, view.BranchID, view.Revision)
	must(t, err)
	proposal := initial(authority)
	proposal.Passage = "The guard spoke."
	// Preserve the existing author structural-review behavior for ordinary
	// candidates. This fixture supplies no v2 approval or resolved source refs.
	reviewer := &reviewFixture{Generator: s.Generator}
	s.Generator = reviewer
	revision := view.Revision
	_, err = s.Fork(ctx, account, view.ID, ForkRequest{
		RequestID: "repair", FromBranchID: view.BranchID,
		FromRevision: revision, ExpectedRevision: &revision,
		Name: "Ordinary author repair", Repair: &RepairChange{Candidate: proposal},
	})
	must(t, err)
	if reviewer.calls != 1 {
		t.Fatal("ordinary author repair stopped reaching structural review")
	}
	original, err := s.ExportArchive(ctx, account)
	must(t, err)
	raw, err := json.Marshal(original)
	must(t, err)
	if _, err := DecodeArchive(raw); err != nil {
		t.Fatalf("ordinary repair archive is not a valid positive control: %v", err)
	}
	for _, nonempty := range []bool{false, true} {
		name := map[bool]string{false: "empty", true: "nonempty"}[nonempty]
		t.Run(name, func(t *testing.T) {
			var changed Archive
			must(t, StrictJSON(raw, &changed))
			mutated := false
			for i := range changed.Experiences[0].Branches {
				branch := &changed.Experiences[0].Branches[i]
				if branch.Changes == nil || branch.Changes.Repair == nil {
					continue
				}
				branch.Changes.Repair.Candidate = authorCandidateWithMemoryDelta(t, branch.Changes.Repair.Candidate, nonempty)
				mutated = true
			}
			if !mutated {
				t.Fatal("fixture did not contain an author repair to replay")
			}
			encoded, err := json.Marshal(changed)
			must(t, err)
			if _, err := DecodeArchive(encoded); err == nil {
				t.Fatal("archive replay accepted an author memory_delta")
			}
			_, err = s.ImportArchive(ctx, "rejected-"+name, changed)
			code(t, err, "invalid_archive")
			imported, err := s.ExportArchive(ctx, "rejected-"+name)
			must(t, err)
			if len(imported.Experiences) != 0 {
				t.Fatal("invalid author memory replay created imported history")
			}
		})
	}
}

func TestAuthorMemoryV2AssistRejectsReturnedDeltaIncludingEmpty(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	const account = "author-memory-assist"
	view := begin(t, s, account, "begin")
	before, err := s.ExportArchive(ctx, account)
	must(t, err)
	authority, _, err := s.authorContext(ctx, account, view.ID, view.BranchID, view.Revision)
	must(t, err)
	original := initial(authority)
	original.Passage = "The guard spoke."
	for _, nonempty := range []bool{false, true} {
		name := map[bool]string{false: "empty", true: "nonempty"}[nonempty]
		t.Run(name, func(t *testing.T) {
			proposal := authorCandidateWithMemoryDelta(t, original, nonempty)
			calls := 0
			s.Generator = generateFunc(func(context.Context, Context, string) (Candidate, error) {
				calls++
				return proposal, nil
			})
			result, err := s.Assist(ctx, account, view.ID, AssistRequest{
				RequestID: "assist-" + name, BranchID: view.BranchID,
				ExpectedRevision: view.Revision, Kind: "repair",
				Request: "Keep the original facts while revising the last passage.",
			}, nil)
			if calls != 1 {
				t.Fatalf("fixed engineering generator calls=%d, want one", calls)
			}
			if result.Proposal != nil {
				t.Fatal("author assist exposed a delta proposal without narrative approval")
			}
			code(t, err, "invalid_candidate")
			after, err := s.ExportArchive(ctx, account)
			must(t, err)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected assistance altered the formal archive")
			}
		})
	}
}
