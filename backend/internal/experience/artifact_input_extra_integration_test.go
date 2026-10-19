//go:build integration

package experience

import (
	"context"
	"elselife/backend/internal/capability/model"
	"encoding/json"
	"testing"
)

type artifactInputSequence struct {
	newtestsFeedbackModel
	answers []string
}

func (m *artifactInputSequence) Generate(ctx context.Context, r model.Request) (model.Result, error) {
	if m.calls >= len(m.answers) {
		return model.Result{}, fail("unexpected_model_retry")
	}
	m.text = m.answers[m.calls]
	return m.newtestsFeedbackModel.Generate(ctx, r)
}
func TestArtifactInputComposeBoundedAndNoImplicitExecution(t *testing.T) {
	s, v, _ := setupGameplay(t)
	ctx := context.Background()
	output, _ := json.Marshal(artifactFixture())
	envelope, _ := json.Marshal(map[string]string{"payload": string(output)})
	m := &artifactInputSequence{answers: []string{inputModelDecision("compose", nil).text, string(envelope), inputModelDecision("compose", nil).text}}
	req := ArtifactInputRequest{RequestID: "compose-once", BranchID: v.BranchID, ExpectedRevision: 1, Input: "依据已知规则整理另一个操作"}
	out, err := s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if out.InputDecision.Kind != "attempt" || out.InputDecision.Execute != nil || m.calls != 3 {
		t.Fatal("compose loop or unapproved execution")
	}
	_, err = s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if m.calls != 3 {
		t.Fatal("replay repeated bounded composition")
	}
	after, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
	must(t, err)
	if after.Revision != 1 {
		t.Fatal("composition committed a formal story")
	}
}
func TestArtifactInputRejectsUnknownParamsAndLateRevision(t *testing.T) {
	s, v, a := setupGameplay(t)
	ctx := context.Background()
	var p map[string]any
	must(t, StrictJSON(a.Artifact.Payload, &p))
	def := p["definition"].(map[string]any)
	m := inputModelDecision("execute", map[string]any{"interactionId": def["id"], "definitionDigest": p["definitionDigest"], "actionId": "buy", "params": map[string]any{"unapproved": 9}})
	req := ArtifactInputRequest{RequestID: "bad-params", BranchID: v.BranchID, ExpectedRevision: 1, Input: "按价格买一杯"}
	_, err := s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(m))
	code(t, err, "action_not_authorized")
	hook := &artifactHookModel{newtestsFeedbackModel: *inputModelDecision("attempt", nil), hook: func() {
		_, _, err := s.Advance(ctx, "gameplay", v.ID, AdvanceRequest{RequestID: "advance", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read"})
		must(t, err)
		must(t, s.GenerateAccepted(ctx, "gameplay", "advance"))
	}}
	req.RequestID = "late-input"
	_, err = s.InterpretArtifactInput(ctx, "gameplay", v.ID, req, artifactInterpreter(hook))
	code(t, err, "revision_conflict")
}
