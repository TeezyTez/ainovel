//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"testing"

	"elselife/backend/internal/sqlc/pgq"
)

// These fixed-content tests verify source permissions, not literary quality.
func TestLiteraryActorReadsFilterBeforePaginationAndKeepAuthorityPin(t *testing.T) {
	s, _, _ := testService(t)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		v := initial(c)
		v.NewFacts[1].KnownBy = []string{}
		return v, nil
	})
	v := begin(t, s, "memory-source", "start")
	r := pinRead(t, s, "memory-source", v, "read", "read")
	actorReader, ok := any(r).(interface {
		ReadActor(context.Context, ReadRequest, string) (ReadReply, error)
	})
	if !ok {
		t.Fatal("source reader cannot bind a read to the current actor")
	}
	req := ReadRequest{RequestID: "actor-facts", SourceHandle: r.generation.StateCoverage.SourceHandle, Selector: ReadSelector{Kind: "enumerate", Type: "fact"}, MaxReplyBytes: 8192}
	reply, err := actorReader.ReadActor(context.Background(), req, "npc")
	must(t, err)
	if !reply.Complete || reply.NextCursor != nil || len(reply.Objects) != 1 || objectID(reply.Objects[0]) != "known" {
		t.Fatalf("hidden fact affected the actor result or pagination: %+v", reply)
	}
	for i, id := range []string{"hidden", "absent"} {
		req.RequestID = "missing-" + jsonNumber(int64(i))
		req.Selector = ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: id}}}
		reply, err = actorReader.ReadActor(context.Background(), req, "npc")
		must(t, err)
		if len(reply.Objects) != 0 || !reply.Complete {
			t.Fatal("actor learned existence of an unauthorized source")
		}
	}
	one := int64(1)
	req.RequestID = "page"
	req.Selector = ReadSelector{Kind: "pages", FromRevision: &one, ToRevision: &one}
	_, err = actorReader.ReadActor(context.Background(), req, "npc")
	code(t, err, "recall_scope_mismatch")
	req.RequestID = "entity"
	req.Selector = ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "entity", ID: "npc"}}}
	_, err = actorReader.ReadActor(context.Background(), req, "npc")
	code(t, err, "recall_scope_mismatch")
	_, err = s.Cancel(context.Background(), "memory-source", v.ID, "read")
	must(t, err)
	req.RequestID = "late"
	req.Selector = ReadSelector{Kind: "objects", Objects: []ReadTarget{{Type: "fact", ID: "known"}}}
	_, err = actorReader.ReadActor(context.Background(), req, "npc")
	code(t, err, "recall_scope_mismatch")
}

func TestLiteraryMemorySourcesSurviveOrdinaryForkAndInvalidateEditedPage(t *testing.T) {
	s, _, _ := testService(t)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		result := initial(c)
		quote := "「别走。」她说。"
		if c.Revision > 0 {
			result = candidate(c)
			quote = "「晚点再走。」她说。"
			result.Passage = quote
		}
		result.MemoryChanges = []MemoryChange{{
			ID: "door-utterance", Kind: "expression", SubjectIDs: []string{"npc"}, TargetIDs: []string{},
			Cue: "挽留", Summary: "她在门前叫住离开的人，尚未说明原因。", Status: "active",
			RetrievalKeys: []string{"离开"}, FactIDs: []string{}, Quote: quote,
		}}
		return result, nil
	})
	ctx := context.Background()
	v := begin(t, s, "memory-fork", "start")
	v = advance(t, s, "memory-fork", v, "update-memory", "read")
	rev := v.Revision
	fork, err := s.Fork(ctx, "memory-fork", v.ID, ForkRequest{RequestID: "fork", FromBranchID: v.BranchID, FromRevision: rev, Name: "另一条路"})
	must(t, err)
	read := pinRead(t, s, "memory-fork", fork, "fork-read", "read")
	got, err := read.ReadMaterials(ctx, "", nil, []string{"door-utterance"})
	must(t, err)
	if got.LiteraryMemory == nil || len(got.LiteraryMemory.Entries) != 1 ||
		got.LiteraryMemory.Entries[0].Quote != "「晚点再走。」她说。" ||
		len(got.LiteraryMemory.Entries[0].PriorSources) != 1 || got.LiteraryMemory.Entries[0].PriorSources[0].Quote != "「别走。」她说。" {
		t.Fatal("ordinary branch lost its source-bound memory")
	}
	_, err = s.Cancel(ctx, "memory-fork", v.ID, "fork-read")
	must(t, err)
	polished, err := s.Fork(ctx, "memory-fork", v.ID, ForkRequest{RequestID: "polish", FromBranchID: v.BranchID, FromRevision: rev, ExpectedRevision: &rev, Name: "改写", Polish: &PolishChange{Text: "她没有开口，只看着雨。"}})
	must(t, err)
	q := pgq.New(s.DB)
	stateAt := func(branch string) State {
		raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "memory-fork", ExperienceID: v.ID, BranchID: branch, Revision: rev})
		must(t, err)
		var state State
		must(t, json.Unmarshal(raw, &state))
		return state
	}
	before, after := stateAt(v.BranchID), stateAt(polished.BranchID)
	if before.LiteraryMemory == nil || len(before.LiteraryMemory.Entries) != 1 ||
		after.LiteraryMemory == nil || len(after.LiteraryMemory.Entries) != 0 || after.LiteraryMemory.IndexedThroughRevision != rev-1 {
		t.Fatal("edited source kept a stale interpretation or mutated parent")
	}
	exported, err := s.ExportArchive(ctx, "memory-fork")
	must(t, err)
	raw, _ := json.Marshal(exported)
	_, err = DecodeArchive(raw)
	must(t, err)
}

func TestLiterarySelectedSourcesAreLoadedFromPinnedDatabase(t *testing.T) {
	s, _, _ := testService(t)
	v := begin(t, s, "memory-selected", "start")
	r := pinRead(t, s, "memory-selected", v, "read", "read")
	materials, ok := any(r).(interface {
		ReadMaterials(context.Context, string, []string, []string) (State, error)
	})
	if !ok {
		t.Fatal("selected narrative evidence is not reloaded from the pinned database")
	}
	got, err := materials.ReadMaterials(context.Background(), "npc", []string{"known"}, nil)
	must(t, err)
	if len(got.Facts) != 1 || got.Facts[0].Text != "她声称门外安全" || got.Facts[0].SourceRevision != 1 {
		t.Fatal("wrong or missing original fact", got)
	}
	raw, _ := json.Marshal(got)
	if string(raw) == "" || len(got.Entities) != 0 {
		t.Fatal("selected material source returned unrelated character descriptions")
	}
	_, err = materials.ReadMaterials(context.Background(), "npc", nil, []string{"author-only"})
	code(t, err, "recall_scope_mismatch")
}
