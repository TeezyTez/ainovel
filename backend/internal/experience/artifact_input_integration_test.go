//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func inputModelDecision(kind string, extra map[string]any) *newtestsFeedbackModel {
	d := map[string]any{"kind": kind, "interactionId": nil, "definitionDigest": nil, "actionId": nil, "params": map[string]any{}, "message": ""}
	for k, v := range extra {
		d[k] = v
	}
	raw, _ := json.Marshal(d)
	envelope, _ := json.Marshal(map[string]string{"payload": string(raw)})
	return &newtestsFeedbackModel{text: string(envelope)}
}
func TestArtifactInputExactSourceMatchNoModelAndDurableReplay(t *testing.T) {
	s, v, _ := setupGameplay(t)
	ctx := context.Background()
	req := ArtifactInputRequest{RequestID: "input-exact", BranchID: v.BranchID, ExpectedRevision: 1, Input: "买茶。"}
	out, err := s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, nil)
	must(t, err)
	if out.InputDecision == nil || out.InputDecision.Kind != "execute" || out.InputDecision.Execute["kind"] != "game" {
		t.Fatal("exact source action not resolved")
	}
	replay, err := s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, nil)
	must(t, err)
	outRaw, _ := json.Marshal(out)
	replayRaw, _ := json.Marshal(replay)
	if string(outRaw) != string(replayRaw) {
		t.Fatal("input replay changed plan")
	}
	after, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
	must(t, err)
	if !reflect.DeepEqual(after.Pages, v.Pages) {
		t.Fatal("interpretation wrote formal story")
	}
	plan := map[string]any{}
	for k, v := range out.InputDecision.Execute {
		if k != "artifact_id" {
			plan[k] = v
		}
	}
	plan["request_id"] = "confirmed-exact"
	raw, _ := json.Marshal(plan)
	var execute ArtifactExecuteRequest
	must(t, StrictJSON(raw, &execute))
	_, _, err = s.ExecuteArtifact(ctx, "gameplay", v.ID, out.Artifact.ArtifactID, execute, artifactInterpreter(&newtestsFeedbackModel{text: `{"approved":true}`}))
	must(t, err)
	must(t, s.GenerateAccepted(ctx, "gameplay", execute.RequestID))
	after, err = s.Get(ctx, "gameplay", v.ID, v.BranchID)
	must(t, err)
	if after.Revision != 2 || after.Pages[1].GameplayReceipt == nil {
		t.Fatal("interpreted plan did not commit through authority")
	}
}
func TestArtifactInputNaturalSavedRuleAndStaleHead(t *testing.T) {
	s, v, old := setupGameplay(t)
	ctx := context.Background()
	readonly := artifactFixture()["definition"]
	raw, _ := json.Marshal(readonly)
	current, err := s.ImportArtifact(ctx, "gameplay", v.ID, ArtifactImportRequest{RequestID: "new-layout", BranchID: v.BranchID, ExpectedRevision: 1, Definition: raw, State: json.RawMessage(`{}`)})
	must(t, err)
	var p map[string]any
	must(t, StrictJSON(old.Artifact.Payload, &p))
	def := p["definition"].(map[string]any)
	m := inputModelDecision("execute", map[string]any{"interactionId": def["id"], "definitionDigest": p["definitionDigest"], "actionId": "buy"})
	req := ArtifactInputRequest{RequestID: "natural", BranchID: v.BranchID, ExpectedRevision: 1, Input: "按刚才的价格购买一杯"}
	out, err := s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if m.calls != 1 || out.InputDecision.Execute["revision_id"] != old.Artifact.RevisionID || out.InputDecision.Execute["expected_head"] != current.Artifact.RevisionID {
		t.Fatal("saved rule selection not independently pinned from head")
	}
	execute := executeRequest(t, v, old, "dynamic", "old-rule-confirmed")
	execute.ExpectedHead = current.Artifact.RevisionID
	_, _, err = s.ExecuteArtifact(ctx, "gameplay", v.ID, old.Artifact.ArtifactID, execute, artifactInterpreter(&newtestsFeedbackModel{text: `{"approved":true}`}))
	must(t, err)
	must(t, s.GenerateAccepted(ctx, "gameplay", execute.RequestID))
}
func TestArtifactInputClarifyAttemptAndUnrelatedNeverAct(t *testing.T) {
	for _, kind := range []string{"clarify", "attempt", "unrelated"} {
		t.Run(kind, func(t *testing.T) {
			s, v, _ := setupGameplay(t)
			ctx := context.Background()
			m := inputModelDecision(kind, nil)
			req := ArtifactInputRequest{RequestID: "natural", BranchID: v.BranchID, ExpectedRevision: 1, Input: "我先想一想"}
			out, err := s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(m))
			must(t, err)
			if out.InputDecision.Kind != kind || out.InputDecision.Execute != nil {
				t.Fatal("nonexecuting decision issued execution")
			}
			_, err = s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(m))
			must(t, err)
			if m.calls != 1 {
				t.Fatal("retried semantic interpretation")
			}
			after, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
			must(t, err)
			if after.Revision != v.Revision {
				t.Fatal("interpretation advanced formal world")
			}
		})
	}
}
