//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestArtifactPreparationFixtureContextUsesSelectedBranchAndTrigger(t *testing.T) {
	t.Log("Fixed model output verifies context provenance and disclosure only, not presentation quality.")
	service, _, _ := testService(t)
	service.Artifacts = artifactRuntimeForTest(t)
	ctx := context.Background()
	view := begin(t, service, "artifact-context", "begin")
	service.Generator = generateFunc(func(_ context.Context, current Context, _ string) (Candidate, error) {
		out := candidate(current)
		out.Passage = "公开回复：" + current.Input
		return out, nil
	})
	_, _, err := service.Advance(ctx, "artifact-context", view.ID, AdvanceRequest{RequestID: "old-table", BranchID: view.BranchID, ExpectedRevision: 1, Mode: "ask", Input: "整理收入表格"})
	must(t, err)
	must(t, service.GenerateAccepted(ctx, "artifact-context", "old-table"))
	fork, err := service.Fork(ctx, "artifact-context", view.ID, ForkRequest{RequestID: "fork", FromBranchID: view.BranchID, FromRevision: 2, Name: "当前分支"})
	must(t, err)
	_, _, err = service.Advance(ctx, "artifact-context", view.ID, AdvanceRequest{RequestID: "current-read", BranchID: fork.BranchID, ExpectedRevision: 2, Mode: "read", Input: "静静听雨"})
	must(t, err)
	must(t, service.GenerateAccepted(ctx, "artifact-context", "current-read"))
	for _, test := range []struct {
		name         string
		intent       string
		inputRouting bool
		trigger      string
	}{
		{name: "automatic", trigger: "automatic"},
		{name: "blank-request", intent: " \n\t", trigger: "automatic"},
		{name: "requested", intent: "画出地点关系", trigger: "requested"},
		{name: "input", intent: "试着推门", inputRouting: true, trigger: "input"},
	} {
		t.Run(test.name, func(t *testing.T) {
			generator := &newtestsFeedbackModel{text: `{"payload":"{\"decision\":\"none\",\"reason\":\"正文足够\"}"}`}
			if test.inputRouting {
				generator = routedArtifactModel("story", nil, nil)
			}
			_, err := service.PrepareArtifact(ctx, "artifact-context", view.ID, ArtifactPrepareRequest{RequestID: test.name, BranchID: fork.BranchID, ExpectedRevision: 3, Intent: test.intent, InputRouting: test.inputRouting, Retry: true}, artifactInterpreter(generator))
			must(t, err)
			if len(generator.requests) != 1 {
				t.Fatalf("expected one context-bearing model request, got %d", len(generator.requests))
			}
			input := generator.requests[0].Messages[1].Content
			var request struct {
				Public struct {
					Scope struct {
						BranchID string `json:"branchId"`
					} `json:"scope"`
					CurrentTurn struct {
						Revision int64  `json:"revision"`
						Mode     string `json:"mode"`
						Input    string `json:"input"`
						Prose    string `json:"prose"`
					} `json:"currentTurn"`
					Preparation struct {
						Trigger string `json:"trigger"`
					} `json:"preparation"`
					Intent string `json:"intent"`
				} `json:"public"`
			}
			must(t, json.Unmarshal([]byte(input), &request))
			current := request.Public.CurrentTurn
			if request.Public.Scope.BranchID != fork.BranchID || current.Revision != 3 || current.Mode != "read" || current.Input != "静静听雨" || current.Prose != "公开回复：静静听雨" {
				t.Fatalf("context used a different branch, historical request, or preparation intent: %+v", request.Public)
			}
			if request.Public.Preparation.Trigger != test.trigger || request.Public.Intent != test.intent {
				t.Fatalf("preparation origin lost: %+v", request.Public)
			}
			if strings.Contains(input, "门后有暗井") || strings.Contains(input, "连续的中文世界") {
				t.Fatal("hidden fact or world seed leaked into preparation")
			}
		})
	}
}
