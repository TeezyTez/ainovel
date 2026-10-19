package experience

import (
	"context"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"errors"
	"strings"
	"testing"
)

func TestExplicitCapacityUnknownAndWholeCarrierBudget(t *testing.T) {
	m := &carrierModel{}
	a := &Algorithm{Model: m, ModelName: "world-explicit"}
	call := &pb.ModelCallRequest{Messages: []*pb.ModelMessage{{Role: "user", Content: "中文"}}, SchemaJson: `{"type":"object"}`, MaxOutputBytes: 4096}
	if r := a.modelCall(context.Background(), call); r.ErrorCode != "context_limit_unknown" || m.calls.Load() != 0 {
		t.Fatal("undeclared capacity invoked model", r)
	}
	a.ModelContextTokens = 16384
	a.ModelByteTokenBoundVerified = true
	call.Messages = []*pb.ModelMessage{{Role: "user", Content: strings.Repeat("汉", 3000)}, {Role: "system", Content: "不可丢弃的全量第二消息"}}
	if r := a.modelCall(context.Background(), call); r.ErrorCode != "context_budget_exceeded" || m.calls.Load() != 0 {
		t.Fatal("whole messages were not counted", r)
	}
	call.Messages = []*pb.ModelMessage{{Role: "user", Content: "短"}}
	call.SchemaJson = `{"description":"` + strings.Repeat("x", 5000) + `"}`
	if r := a.modelCall(context.Background(), call); r.ErrorCode != "context_budget_exceeded" || m.calls.Load() != 0 {
		t.Fatal("schema/fallback/output reserve omitted", r)
	}
	call.SchemaJson = `{"type":"object"}`
	if r := a.modelCallWithFrame(context.Background(), call, 9000); r.ErrorCode != "context_budget_exceeded" || m.calls.Load() != 0 {
		t.Fatal("carrier envelope omitted", r)
	}
	if r := a.modelCall(context.Background(), call); r.ErrorCode != "" || m.calls.Load() != 1 {
		t.Fatal("bounded fixture rejected", r)
	}
	_, err := model.VerifyContextBudget(model.Request{Messages: []model.Message{{Role: "user", Content: "保留正文"}}}, 10000, 8192, false)
	if !errors.Is(err, model.ErrContextLimitUnknown) {
		t.Fatal(err)
	}
}
func TestExistingEntityAndThreadRevealOnlyKnownAndNoBranchLeak(t *testing.T) {
	ctx := sampleContext()
	ctx.Mode = "read"
	ctx.Revision = 1
	ctx.State.Entities = []Entity{{ID: "npc", Kind: "person", Name: "渡河人", Description: "原字  不覆盖", Known: false, RelatedIDs: []string{"hidden"}}}
	ctx.State.Threads = []Thread{{ID: "hook", Text: "一封未拆的信。\n原字保留。", Known: false, RelatedFactIDs: []string{"hidden"}}}
	ctx.State.Facts = []Fact{{ID: "hidden", Kind: "secret", Text: "隐藏事实绝不投影", Known: false, KnownBy: []string{}, SourceRevision: 1}}
	c := sampleCandidate()
	c.RevealEntityIDs = []string{"npc"}
	c.RevealThreadIDs = []string{"hook"}
	state, err := Apply(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Entities[0].Known || !state.Threads[0].Known || state.Entities[0].Description != ctx.State.Entities[0].Description || state.Threads[0].Text != ctx.State.Threads[0].Text || ctx.State.Entities[0].Known || ctx.State.Threads[0].Known {
		t.Fatal("reveal rewrote source or leaked into another branch")
	}
	projected := Project(state)
	if len(projected) != 2 {
		t.Fatal(projected)
	}
	for _, info := range projected {
		if len(info.RelatedIDs) != 0 || strings.Contains(info.Text, "隐藏事实") {
			t.Fatal("hidden relation projected")
		}
	}
	for _, mode := range []string{"duplicate", "missing", "wrong-type", "new-not-existing", "ask"} {
		t.Run(mode, func(t *testing.T) {
			testctx := ctx
			bad := sampleCandidate()
			switch mode {
			case "duplicate":
				bad.RevealEntityIDs = []string{"npc", "npc"}
			case "missing":
				bad.RevealThreadIDs = []string{"absent"}
			case "wrong-type":
				bad.RevealEntityIDs = []string{"hook"}
			case "new-not-existing":
				bad.NewEntities = []Entity{{ID: "new", Kind: "person", Name: "新人", RelatedIDs: []string{}}}
				bad.RevealEntityIDs = []string{"new"}
			case "ask":
				testctx.Mode = "ask"
				bad.StoryTime = ctx.State.StoryTime
				bad.RevealThreadIDs = []string{"hook"}
			}
			if _, err := Apply(testctx, bad); err == nil {
				t.Fatal("invalid reveal accepted")
			}
		})
	}
}
