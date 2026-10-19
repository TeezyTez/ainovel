//go:build integration

package experience

import (
	"context"
	"database/sql"
	"elselife/backend/internal/capability/model"
	"elselife/backend/schema"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func artifactRuntimeForTest(t *testing.T) *ArtifactRuntime {
	t.Helper()
	node := os.Getenv("ELSELIFE_TEST_ARTIFACT_NODE")
	validator := os.Getenv("ELSELIFE_TEST_ARTIFACT_VALIDATOR")
	if node == "" || validator == "" {
		t.Skip("fixed source artifact worker paths required")
	}
	return &ArtifactRuntime{NodePath: node, ValidatorPath: validator, CompilerPath: os.Getenv("ELSELIFE_TEST_ARTIFACT_COMPILER")}
}
func artifactFixture() map[string]any {
	return map[string]any{"definition": map[string]any{"schemaVersion": 1, "id": "public-form", "revision": 1, "title": "公开信息", "summary": "选取一个公开问题", "scope": map[string]any{}, "fields": []any{map[string]any{"id": "question", "type": "text", "label": "想问什么", "default": "门外安全吗"}}, "steps": []any{map[string]any{"id": "first", "title": "问题", "fields": []string{"question"}}}, "view": []any{map[string]any{"type": "text", "text": "她声称门外安全"}}, "actions": []any{map[string]any{"id": "ask", "label": "询问", "mode": "attempt", "targets": []any{}, "checks": []any{}, "effects": []any{}, "evidence": []string{"她声称门外安全"}, "result": map[string]any{"op": "ref", "path": []string{"params", "question"}}}}}, "game": nil, "reason": "公开问题"}
}
func fixtureModel(t *testing.T) *newtestsFeedbackModel {
	t.Helper()
	value, _ := json.Marshal(artifactFixture())
	outer, _ := json.Marshal(map[string]string{"payload": string(value)})
	return &newtestsFeedbackModel{text: string(outer)}
}
func artifactInterpreter(m model.Generator) *FeedbackInterpreter {
	i := newtestsInterpreter(m)
	i.ContextTokens = 65536
	i.OutputTokens = 8192
	i.MaxInputBytes = 512 << 10
	return i
}
func TestArtifactVersionsCASIsolationArchiveAndNoWorldWrite(t *testing.T) {
	s, db, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	ctx := context.Background()
	v := begin(t, s, "artifacts", "begin")
	must(t, schema.ApplyArtifacts(ctx, db)) // The additive upgrade is idempotent on a fresh schema.
	m := fixtureModel(t)
	req := ArtifactPrepareRequest{RequestID: "prepare-1", BranchID: v.BranchID, ExpectedRevision: 1}
	out, err := s.PrepareArtifact(ctx, "artifacts", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if out.Artifact == nil || len(out.Revisions) != 1 || out.Artifact.Stale {
		t.Fatal("missing fresh artifact")
	}
	first := out.Artifact
	input := m.requests[0].Messages[1].Content
	if strings.Contains(input, "门后有暗井") || strings.Contains(input, "连续的中文世界") {
		t.Fatal("non-public facts/seed leaked to presentation model")
	}
	retry, err := s.PrepareArtifact(ctx, "artifacts", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if m.calls != 1 || retry.Artifact.RevisionID != first.RevisionID {
		t.Fatal("prepare replay called model or changed version")
	}
	_, err = s.GetArtifact(ctx, "other-workspace", v.ID, v.BranchID, first.ArtifactID, "")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("cross-workspace read allowed")
	}
	sr := ArtifactStateRequest{RequestID: "state-1", BranchID: v.BranchID, ExpectedRevision: 1, RevisionID: first.RevisionID, ExpectedStateRevision: 0, State: json.RawMessage(`{"question":"问题一"}`)}
	updated, err := s.SaveArtifactState(ctx, "artifacts", v.ID, first.ArtifactID, sr)
	must(t, err)
	if updated.Artifact.StateRevision != 1 {
		t.Fatal("state CAS did not advance")
	}
	_, err = s.SaveArtifactState(ctx, "artifacts", v.ID, first.ArtifactID, sr)
	must(t, err)
	sr.RequestID = "stale-state"
	_, err = s.SaveArtifactState(ctx, "artifacts", v.ID, first.ArtifactID, sr)
	code(t, err, "artifact_conflict")
	sr.State = json.RawMessage(`{"x":1,"x":2}`)
	_, err = s.SaveArtifactState(ctx, "artifacts", v.ID, first.ArtifactID, sr)
	code(t, err, "invalid_input")
	req.RequestID = "prepare-2"
	req.Retry = true
	second, err := s.PrepareArtifact(ctx, "artifacts", v.ID, req, artifactInterpreter(m))
	must(t, err)
	restored, err := s.RestoreArtifact(ctx, "artifacts", v.ID, first.ArtifactID, ArtifactRestoreRequest{RequestID: "restore-1", BranchID: v.BranchID, ExpectedRevision: 1, RevisionID: first.RevisionID, ExpectedHead: second.Artifact.RevisionID, ExpectedStateRevision: 0})
	must(t, err)
	if restored.Artifact.StateRevision != 1 || !strings.Contains(string(restored.Artifact.State), "问题一") {
		t.Fatal("restored version lost local state")
	}
	rawDefinition, _ := json.Marshal(artifactFixture()["definition"])
	imported, err := s.ImportArtifact(ctx, "artifacts", v.ID, ArtifactImportRequest{RequestID: "definition-import", BranchID: v.BranchID, ExpectedRevision: 1, Definition: rawDefinition, State: json.RawMessage(`{"question":"导入"}`)})
	must(t, err)
	if len(imported.Revisions) != 3 {
		t.Fatal("definition import not versioned")
	}
	now, err := s.Get(ctx, "artifacts", v.ID, v.BranchID)
	must(t, err)
	if now.Revision != 1 || len(now.Pages) != 1 {
		t.Fatal("presentation mutation wrote formal history")
	}
	archive, err := s.ExportArchive(ctx, "artifacts")
	must(t, err)
	if len(archive.Experiences[0].Branches[0].Artifacts.Versions) != 3 {
		t.Fatal("backup lost versions")
	}
	encoded, _ := json.Marshal(archive)
	decoded, err := DecodeArchive(encoded)
	must(t, err)
	result, err := s.ImportArchive(ctx, "artifact-restore", decoded)
	must(t, err)
	if len(result.Imported) != 1 {
		t.Fatal("archive import failed")
	}
	again, err := s.ImportArchive(ctx, "artifact-restore", decoded)
	must(t, err)
	if len(again.Skipped) != 1 {
		t.Fatal("archive overwrote existing data")
	}
	recovered, err := s.GetArtifact(ctx, "artifact-restore", v.ID, v.BranchID, first.ArtifactID, first.RevisionID)
	must(t, err)
	if recovered.Artifact.StateRevision != 1 {
		t.Fatal("backup lost state revision")
	}
	// A forged public projection cannot be restored even when JSON is valid.
	forged := decoded
	forged.Experiences[0].Branches[0].Artifacts.Versions[0].Payload = json.RawMessage(strings.Replace(string(forged.Experiences[0].Branches[0].Artifacts.Versions[0].Payload), "公开问题", "篡改说明", 1))
	// Change an actual computed state field rather than model-owned display text.
	var forgedPayload map[string]any
	json.Unmarshal(decoded.Experiences[0].Branches[0].Artifacts.Versions[0].Payload, &forgedPayload)
	forgedPayload["state"].(map[string]any)["location"] = "伪造地点"
	forgedRaw, _ := json.Marshal(forgedPayload)
	forged.Experiences[0].Branches[0].Artifacts.Versions[0].Payload = forgedRaw
	_, err = s.ImportArchive(ctx, "forged", forged)
	code(t, err, "invalid_archive")
	must(t, s.DeleteExperience(ctx, "artifact-restore", v.ID))
	_, err = s.GetArtifact(ctx, "artifact-restore", v.ID, v.BranchID, "", "")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("deleted branch retained attachment")
	}
}

type artifactHookModel struct {
	newtestsFeedbackModel
	hook func()
}

func (m *artifactHookModel) Generate(ctx context.Context, r model.Request) (model.Result, error) {
	m.hook()
	return m.newtestsFeedbackModel.Generate(ctx, r)
}
func TestArtifactLateModelRejectedAndFailedOutputNeverSaved(t *testing.T) {
	s, _, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	ctx := context.Background()
	v := begin(t, s, "artifact-late", "begin")
	m := fixtureModel(t)
	hook := &artifactHookModel{newtestsFeedbackModel: *m, hook: func() {
		_, _, err := s.Advance(ctx, "artifact-late", v.ID, AdvanceRequest{RequestID: "advance", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read"})
		must(t, err)
		must(t, s.GenerateAccepted(ctx, "artifact-late", "advance"))
	}}
	_, err := s.PrepareArtifact(ctx, "artifact-late", v.ID, ArtifactPrepareRequest{RequestID: "late", BranchID: v.BranchID, ExpectedRevision: 1}, artifactInterpreter(hook))
	code(t, err, "revision_conflict")
	empty, err := s.GetArtifact(ctx, "artifact-late", v.ID, v.BranchID, "", "")
	must(t, err)
	if empty.Artifact != nil {
		t.Fatal("late model wrote attachment")
	}
	m.text = `{"payload":"{}"}`
	_, err = s.PrepareArtifact(ctx, "artifact-late", v.ID, ArtifactPrepareRequest{RequestID: "invalid", BranchID: v.BranchID, ExpectedRevision: 2}, artifactInterpreter(m))
	code(t, err, "invalid_artifact")
	m.err = errors.New("deliberate failure")
	_, err = s.PrepareArtifact(ctx, "artifact-late", v.ID, ArtifactPrepareRequest{RequestID: "failed", BranchID: v.BranchID, ExpectedRevision: 2}, artifactInterpreter(m))
	code(t, err, "model_failed")
}
func TestArtifactReactUsesFixedCompilerAndArchiveNeverTrustsBundle(t *testing.T) {
	s, _, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	if s.Artifacts.CompilerPath == "" {
		t.Skip("compiler path required")
	}
	ctx := context.Background()
	v := begin(t, s, "artifact-react", "begin")
	fixture := artifactFixture()
	definition := fixture["definition"].(map[string]any)
	definition["fields"] = []any{}
	definition["steps"] = []any{}
	definition["actions"] = []any{}
	definition["view"] = []any{map[string]any{"type": "react", "title": "计数器", "description": "本机交互状态", "source": "import React from 'react'; export default function App(){const [n,setN]=React.useState(0);return <main><p>计数 {n}</p><button onClick={()=>setN(n+1)}>增加</button></main>}", "css": "", "height": 300}}
	raw, _ := json.Marshal(definition)
	out, err := s.ImportArtifact(ctx, "artifact-react", v.ID, ArtifactImportRequest{RequestID: "react", BranchID: v.BranchID, ExpectedRevision: 1, Definition: raw, State: json.RawMessage(`{}`)})
	must(t, err)
	var payload map[string]any
	must(t, StrictJSON(out.Artifact.Payload, &payload))
	bundles := payload["bundles"].(map[string]any)
	if len(bundles) != 1 {
		t.Fatal("React definition has no trusted build")
	}
	for key, bundle := range bundles {
		if len(key) != 64 || bundle.(map[string]any)["renderer"] != "react-bundle" {
			t.Fatal("invalid build lookup")
		}
	}
	archive, err := s.ExportArchive(ctx, "artifact-react")
	must(t, err)
	for _, bundle := range bundles {
		bundle.(map[string]any)["script"] = "injected_attack()"
	}
	forged, _ := json.Marshal(payload)
	archive.Experiences[0].Branches[0].Artifacts.Versions[0].Payload = forged
	_, err = s.ImportArchive(ctx, "react-restored", archive)
	must(t, err)
	restored, err := s.GetArtifact(ctx, "react-restored", v.ID, v.BranchID, "", "")
	must(t, err)
	if strings.Contains(string(restored.Artifact.Payload), "injected_attack") {
		t.Fatal("untrusted backup bundle executed without rebuilding")
	}
}
func TestArtifactUpgradeOnlyAddsTablesAndRejectsPartialSchema(t *testing.T) {
	s, db, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "migration", "begin")
	_, err := db.ExecContext(ctx, `DROP TABLE experience_artifact_receipts,experience_artifact_versions,experience_artifact_heads`)
	must(t, err)
	must(t, schema.ApplyArtifacts(ctx, db))
	must(t, schema.ApplyArtifacts(ctx, db))
	after, err := s.Get(ctx, "migration", v.ID, v.BranchID)
	must(t, err)
	if after.Revision != v.Revision || after.Pages[0].Text != v.Pages[0].Text {
		t.Fatal("additive migration changed formal history")
	}
	_, err = db.ExecContext(ctx, `DROP TABLE experience_artifact_receipts`)
	must(t, err)
	if schema.ApplyArtifacts(ctx, db) == nil {
		t.Fatal("partial schema silently adopted")
	}
}

func TestArtifactKeepNoneAndPatchRetainParameters(t *testing.T) {
	s, _, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	ctx := context.Background()
	v := begin(t, s, "artifact-keep", "begin")
	m := fixtureModel(t)
	req := ArtifactPrepareRequest{RequestID: "first", BranchID: v.BranchID, ExpectedRevision: 1}
	first, err := s.PrepareArtifact(ctx, "artifact-keep", v.ID, req, artifactInterpreter(m))
	must(t, err)
	req.RequestID = "cached"
	cached, err := s.PrepareArtifact(ctx, "artifact-keep", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if m.calls != 1 || cached.Artifact.RevisionID != first.Artifact.RevisionID {
		t.Fatal("same-context automatic prepare rebuilt artifact")
	}
	_, err = s.SaveArtifactState(ctx, "artifact-keep", v.ID, first.Artifact.ArtifactID, ArtifactStateRequest{RequestID: "state", BranchID: v.BranchID, ExpectedRevision: 1, RevisionID: first.Artifact.RevisionID, State: json.RawMessage(`{"question":"保留此参数"}`)})
	must(t, err)
	m.text = `{"payload":"{\"decision\":\"keep\",\"reason\":\"仍可用\"}"}`
	req.RequestID = "keep"
	req.Retry = true
	kept, err := s.PrepareArtifact(ctx, "artifact-keep", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if kept.Artifact.RevisionID != first.Artifact.RevisionID || kept.Artifact.StateRevision != 1 {
		t.Fatal("keep lost current state/version")
	}
	decision, _ := json.Marshal(map[string]any{"decision": "patch", "baseRevision": kept.Artifact.RevisionID, "baseHash": kept.Artifact.Digest, "changes": []any{map[string]any{"path": []any{"title"}, "value": "调整标题"}}, "stateMigration": map[string]any{"map": map[string]string{"question": "prompt"}}})
	outer, _ := json.Marshal(map[string]string{"payload": string(decision)})
	m.text = string(outer)
	req.RequestID = "patch"
	patched, err := s.PrepareArtifact(ctx, "artifact-keep", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if !strings.Contains(string(patched.Artifact.State), "prompt") || !strings.Contains(string(patched.Artifact.State), "保留此参数") || len(patched.Revisions) != 2 {
		t.Fatal("patch lost parameters or version")
	}
	m.text = `{"payload":"{\"decision\":\"none\",\"reason\":\"无需辅助\"}"}`
	req.RequestID = "none"
	none, err := s.PrepareArtifact(ctx, "artifact-keep", v.ID, req, artifactInterpreter(m))
	must(t, err)
	if !strings.Contains(string(none.Artifact.Payload), `"definition": null`) && !strings.Contains(string(none.Artifact.Payload), `"definition":null`) {
		t.Fatal("none not saved")
	}
	if !strings.Contains(string(none.Artifact.State), "保留此参数") {
		t.Fatal("none destroyed local parameters")
	}
}
