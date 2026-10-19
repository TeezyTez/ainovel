//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func routedArtifactModel(kind string, target any, output any) *newtestsFeedbackModel {
	payload, _ := json.Marshal(map[string]any{"intentDecision": map[string]any{"kind": kind, "target": target, "message": "用途确认"}, "output": output})
	envelope, _ := json.Marshal(map[string]string{"payload": string(payload)})
	return &newtestsFeedbackModel{text: string(envelope)}
}
func TestArtifactIntentStoryClarifyMixedPersistReceiptWithoutMutation(t *testing.T) {
	for _, kind := range []string{"story", "mixed", "clarify"} {
		t.Run(kind, func(t *testing.T) {
			s, _, _ := testService(t)
			s.Artifacts = artifactRuntimeForTest(t)
			ctx := context.Background()
			v := begin(t, s, "routing", "begin")
			m := routedArtifactModel(kind, nil, nil)
			req := ArtifactPrepareRequest{RequestID: "route", BranchID: v.BranchID, ExpectedRevision: 1, Intent: "输入用途", InputRouting: true}
			out, err := s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(m))
			must(t, err)
			if out.IntentDecision == nil || out.IntentDecision.Kind != kind || out.RoutingScope == nil || out.RoutingScope.RequestID != req.RequestID || out.Artifact != nil {
				t.Fatal("routing response missing or mutated empty attachment")
			}
			after, err := s.Get(ctx, "routing", v.ID, v.BranchID)
			must(t, err)
			if !reflect.DeepEqual(after.Pages, v.Pages) || after.Revision != 1 {
				t.Fatal("routing submitted story action")
			}
			replay, err := s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(m))
			must(t, err)
			if m.calls != 1 || !reflect.DeepEqual(out, replay) {
				t.Fatal("unknown-response retry lost routing or re-called model")
			}
			req.RequestID = "new-route"
			_, err = s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(m))
			must(t, err)
			if m.calls != 2 {
				t.Fatal("input routing incorrectly reused display cache")
			}
		})
	}
}
func TestArtifactIntentCreateEditOneCallTargetAndLateCAS(t *testing.T) {
	s, _, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	ctx := context.Background()
	v := begin(t, s, "routing", "begin")
	m := routedArtifactModel("create", nil, artifactFixture())
	req := ArtifactPrepareRequest{RequestID: "create-ui", BranchID: v.BranchID, ExpectedRevision: 1, Intent: "整理资料", InputRouting: true}
	first, err := s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if m.calls != 1 || first.Artifact == nil || first.IntentDecision.Kind != "create" {
		t.Fatal("create did not generate in one model call")
	}
	wrong := routedArtifactModel("edit", "another-artifact", artifactFixture())
	req.RequestID = "wrong-target"
	_, err = s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(wrong))
	code(t, err, "artifact_target_conflict")
	same, err := s.GetArtifact(ctx, "routing", v.ID, v.BranchID, "", "")
	must(t, err)
	if same.Artifact.RevisionID != first.Artifact.RevisionID {
		t.Fatal("wrong-target edit wrote a version")
	}
	edit := artifactFixture()
	edit["definition"].(map[string]any)["title"] = "更清晰标题"
	m = routedArtifactModel("edit", first.Artifact.ArtifactID, edit)
	req.RequestID = "edit-current"
	next, err := s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if m.calls != 1 || next.Artifact.RevisionID == first.Artifact.RevisionID || next.IntentDecision.Kind != "edit" || !strings.Contains(m.requests[0].Messages[1].Content, first.Artifact.ArtifactID) {
		t.Fatal("edit target missing or split model calls")
	}
	hook := &artifactHookModel{newtestsFeedbackModel: *routedArtifactModel("story", nil, nil), hook: func() {
		_, _, err := s.Advance(ctx, "routing", v.ID, AdvanceRequest{RequestID: "advance", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read"})
		must(t, err)
		must(t, s.GenerateAccepted(ctx, "routing", "advance"))
	}}
	req.RequestID = "late-routing"
	_, err = s.PrepareArtifact(ctx, "routing", v.ID, req, artifactInterpreter(hook))
	code(t, err, "revision_conflict")
}
func TestArtifactIntentRejectsStoryOutputAndIncompleteEdit(t *testing.T) {
	for _, raw := range []string{`{"intentDecision":{"kind":"story"},"output":{}}`, `{"intentDecision":{"kind":"create"},"output":null}`, `{"intentDecision":{"kind":"act"},"output":null}`, `{"intentDecision":{"kind":"story","execute":true},"output":null}`} {
		_, _, err := parseArtifactIntent(json.RawMessage(raw), ArtifactResponse{})
		code(t, err, "invalid_intent")
	}
}
