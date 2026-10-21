//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"

	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"elselife/backend/internal/sqlc/pgq"
	"google.golang.org/protobuf/proto"
)

// Synthetic generator using the actual Go evidence compiler/private binding.
// It is not a model, a semantic review, or a live benchmark.
type memoryLifecycleGenerator struct {
	calls atomic.Int64
	edit  func(*Candidate)
}

func (g *memoryLifecycleGenerator) Generate(context.Context, Context, string) (Candidate, error) {
	return Candidate{}, fail("test_requires_source_reader")
}
func (g *memoryLifecycleGenerator) GenerateWithReads(ctx context.Context, c Context, _ string, reader Reader) (Candidate, error) {
	g.calls.Add(1)
	source, ok := reader.(interface {
		MemoryEvidenceOrigin(context.Context) (narrativeEvidenceOrigin, error)
	})
	if !ok {
		return Candidate{}, fail("test_requires_source_reader")
	}
	origin, err := source.MemoryEvidenceOrigin(ctx)
	if err != nil {
		return Candidate{}, err
	}
	v := candidate(c)
	v.Passage = "The visitor returned the borrowed book."
	id := fmt.Sprintf("return-%d", c.Revision+1)
	v.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{{
		ID: id, Kind: "episode", SubjectIDs: []string{"npc"}, TargetIDs: []string{}, Cue: "returned book",
		Summary: v.Passage, Status: "resolved", RetrievalKeys: []string{"book"}, FactIDs: []string{},
	}}}
	p := newNarrativeRun(c)
	p.evidenceV2, p.evidenceOrigin = true, &origin
	p.last = "extract"
	p.extracted, _ = canonicalCandidate(v)
	p.materialBudget, p.stageInputBudget = 12<<10, 64<<10
	call := &pb.ModelCallRequest{NarrativeStage: "review", Model: "fixed", SchemaJson: `{"type":"object"}`, MaxOutputBytes: 8192,
		Messages: []*pb.ModelMessage{{Role: "system", Content: "Synthetic protocol reviewer."}, {Role: "user", Content: string(narrativeMarshal(map[string]any{
			"context": reviewHydrationWireContext(c, c.State), "candidate": v,
		}))}}}
	if _, err = p.before(call); err != nil {
		return Candidate{}, err
	}
	request := model.Request{Model: "fixed", Schema: json.RawMessage(call.SchemaJson), MaxOutputTokens: 8192}
	for _, message := range call.Messages {
		request.Messages = append(request.Messages, model.Message{Role: message.Role, Content: message.Content})
	}
	raw, _ := proto.Marshal(call)
	if err = p.bindMemoryEvidenceRequest(7, raw, request); err != nil {
		return Candidate{}, err
	}
	review := NarrativeReview{Approved: true, RepairScope: "none", Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{},
		KnowledgeSupports: []NarrativeKnowledgeSupport{}, MemorySupports: []NarrativeMemorySupport{{MemoryID: id, SourceIDs: []string{"s1"}}}}
	if err = p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": review}))}); err != nil {
		return Candidate{}, err
	}
	v, err = p.finish(v)
	if err == nil && g.edit != nil {
		g.edit(&v)
	}
	return v, err
}

func TestMemoryEvidenceLifecycleNormalOriginAndCommitRollback(t *testing.T) {
	for _, kind := range []string{"valid", "wrong-request", "wrong-fence", "wrong-input-pin", "wrong-provider-hash", "wrong-source"} {
		t.Run(kind, func(t *testing.T) {
			s, db, _ := testService(t)
			v := begin(t, s, "a", "begin")
			g := &memoryLifecycleGenerator{}
			g.edit = func(c *Candidate) {
				switch kind {
				case "wrong-request":
					c.Review.Evidence.Origin.ID = "different-request"
				case "wrong-fence":
					c.Review.Evidence.Origin.BaseFence++
				case "wrong-input-pin":
					c.Review.Evidence.Origin.Pin = memoryPageSHA256("different-input")
				case "wrong-provider-hash":
					c.Review.Evidence.ProviderRequestSHA256 = memoryPageSHA256("different-request")
				case "wrong-source":
					c.Review.Evidence.Registry.Sources[0].TextSHA256 = memoryPageSHA256("different-page")
				}
			}
			s.NarrativeEngine, s.Generator = true, g
			ctx := context.Background()
			_, _, err := s.Advance(ctx, "a", v.ID, AdvanceRequest{RequestID: "next", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "read"})
			must(t, err)
			_ = s.GenerateAccepted(ctx, "a", "next")
			now, err := s.Get(ctx, "a", v.ID, v.BranchID)
			must(t, err)
			if kind == "valid" {
				if now.Revision != v.Revision+1 {
					t.Fatal("valid private review was not committed", now.Operation)
				}
				row, err := pgq.New(db).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: "a", RequestID: "next"})
				must(t, err)
				var approval NarrativeApproval
				must(t, StrictJSON(row.NarrativeApproval, &approval))
				if approval.Evidence == nil || approval.Evidence.Origin.ID != "next" || approval.Evidence.Origin.Kind != "operation" {
					t.Fatal("origin lost at commit")
				}
			} else if now.Revision != v.Revision {
				t.Fatal("foreign or changed credential committed", kind)
			}
		})
	}
}

func TestMemoryEvidenceLifecyclePreparationHandoff(t *testing.T) {
	for _, kind := range []string{"ready", "wrong-origin", "changed-registry", "changed-preference", "expired", "restart"} {
		t.Run(kind, func(t *testing.T) {
			s, db, _ := testService(t)
			v := begin(t, s, "a", "begin")
			g := &memoryLifecycleGenerator{}
			s.NarrativeEngine, s.Generator = true, g
			ctx := context.Background()
			must(t, s.PrepareNext(ctx, "a", v.ID, v.BranchID, v.Revision))
			p, err := pgq.New(db).ExperiencePreparationGet(ctx, pgq.ExperiencePreparationGetParams{AccountID: "a", ExperienceID: v.ID, BranchID: v.BranchID, BaseRevision: v.Revision})
			must(t, err)
			if p.Status != "ready" {
				t.Fatal("preparation not ready", p.Status)
			}
			var original NarrativeApproval
			must(t, StrictJSON(p.Approval, &original))
			switch kind {
			case "wrong-origin", "changed-registry":
				tampered := original
				if kind == "wrong-origin" {
					tampered.Evidence.Origin.ID = "other-preparation"
				} else {
					tampered.Evidence.Registry.Sources[0].Location = "/candidate/title"
				}
				raw, _ := json.Marshal(tampered)
				_, err = db.ExecContext(ctx, `UPDATE experience_narrative_preparations SET approval=$1 WHERE account_id=$2 AND id=$3`, raw, "a", p.ID)
				must(t, err)
			case "changed-preference":
				s.MaxContextBytes = 12345
			case "expired":
				_, err = db.ExecContext(ctx, `UPDATE experience_narrative_preparations SET lease_until=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2`, "a", p.ID)
				must(t, err)
			case "restart":
				must(t, s.InvalidatePreparationsOnRestart(ctx))
			}
			_, _, err = s.Advance(ctx, "a", v.ID, AdvanceRequest{RequestID: "consume", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "read"})
			must(t, err)
			generationErr := s.GenerateAccepted(ctx, "a", "consume")
			now, err := s.Get(ctx, "a", v.ID, v.BranchID)
			must(t, err)
			if kind == "ready" {
				if now.Revision != v.Revision+1 || g.calls.Load() != 1 {
					t.Fatalf("valid ready result was not consumed exactly once: operation=%s calls=%d error=%v", narrativeMarshal(now.Operation), g.calls.Load(), generationErr)
				}
				row, err := pgq.New(db).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: "a", RequestID: "consume"})
				must(t, err)
				var adopted NarrativeApproval
				must(t, StrictJSON(row.NarrativeApproval, &adopted))
				if adopted.Evidence.Origin.Kind != "preparation" || adopted.Evidence.Origin.ID != p.ID ||
					adopted.Evidence.Origin.BaseFence != p.BaseFence {
					t.Fatal("handoff rewrote preparation origin")
				}
			} else if kind == "wrong-origin" || kind == "changed-registry" {
				if now.Revision != v.Revision || g.calls.Load() != 1 {
					t.Fatal("bad claimed preparation committed or fell back", g.calls.Load())
				}
			} else {
				// These are invalid before claim: a new accepted operation may
				// generate normally; it must not consume the old preparation.
				if g.calls.Load() != 2 {
					t.Fatal("unclaimable preparation reused", kind, g.calls.Load())
				}
			}
		})
	}
}
