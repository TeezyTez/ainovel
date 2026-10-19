//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"testing"
)

func TestArtifactContractAttemptValidatesSavedScopeTargetsAndParamsWithoutModel(t *testing.T) {
	s, _, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	ctx := context.Background()
	v := begin(t, s, "attempt", "begin")
	def, _ := json.Marshal(artifactFixture()["definition"])
	a, err := s.ImportArtifact(ctx, "attempt", v.ID, ArtifactImportRequest{RequestID: "prepare", BranchID: v.BranchID, ExpectedRevision: 1, Definition: def, State: json.RawMessage(`{}`)})
	must(t, err)
	var p map[string]any
	must(t, StrictJSON(a.Artifact.Payload, &p))
	d := p["definition"].(map[string]any)
	ref := map[string]any{"definitionDigest": p["definitionDigest"], "scope": d["scope"], "interactionId": d["id"], "revision": d["revision"], "actionId": "ask", "targets": []any{}, "params": map[string]any{"question": "门外安全吗"}}
	raw, _ := json.Marshal(ref)
	r := ArtifactInputRequest{RequestID: "attempt-input", BranchID: v.BranchID, ExpectedRevision: 1, Input: "门外安全吗", DynamicAttempt: raw}
	out, err := s.InterpretArtifactInput(ctx, "attempt", v.ID, r, nil)
	must(t, err)
	if out.InputDecision == nil || out.InputDecision.Kind != "attempt" || out.InputDecision.Execute != nil {
		t.Fatal("attempt granted execution")
	}
	_, err = s.InterpretArtifactInput(ctx, "attempt", v.ID, r, nil)
	must(t, err)
	for _, field := range []string{"targets", "params", "scope", "actionId"} {
		invalid := map[string]any{}
		for k, v := range ref {
			invalid[k] = v
		}
		switch field {
		case "targets":
			invalid[field] = []string{"other"}
		case "params":
			invalid[field] = map[string]any{"unknown": 1}
		case "scope":
			invalid[field] = map[string]any{}
		case "actionId":
			invalid[field] = "other"
		}
		raw, _ = json.Marshal(invalid)
		r.RequestID = "invalid-" + field
		r.DynamicAttempt = raw
		_, err = s.InterpretArtifactInput(ctx, "attempt", v.ID, r, nil)
		code(t, err, "action_not_authorized")
	}
	after, err := s.Get(ctx, "attempt", v.ID, v.BranchID)
	must(t, err)
	if after.Revision != 1 {
		t.Fatal("validation wrote story")
	}
}
func TestArtifactInputAmbiguousSavedRulesRejectWithoutComposition(t *testing.T) {
	s, v, a := setupGameplay(t)
	ctx := context.Background()
	var p map[string]any
	must(t, StrictJSON(a.Artifact.Payload, &p))
	d := p["definition"].(map[string]any)
	d["title"] = "另一个版本"
	raw, _ := json.Marshal(d)
	_, err := s.ImportArtifact(ctx, "gameplay", v.ID, ArtifactImportRequest{RequestID: "same-action-other-rule", BranchID: v.BranchID, ExpectedRevision: 1, Definition: raw, State: json.RawMessage(`{}`)})
	must(t, err)
	m := inputModelDecision("execute", map[string]any{"actionId": "buy"})
	_, err = s.InterpretArtifactInput(ctx, "gameplay", v.ID, ArtifactInputRequest{RequestID: "ambiguous", BranchID: v.BranchID, ExpectedRevision: 1, Input: "按照约定买一杯"}, artifactInterpreter(m))
	code(t, err, "invalid_intent")
	if m.calls != 1 {
		t.Fatal("ambiguous rule triggered composition")
	}
}
