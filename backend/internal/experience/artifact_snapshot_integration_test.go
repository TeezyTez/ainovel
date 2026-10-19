//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestArtifactSnapshotFreezesLocalStateAndForkOrigin(t *testing.T) {
	s, v, a := setupGameplay(t)
	ctx := context.Background()
	saved, err := s.SaveArtifactState(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, ArtifactStateRequest{RequestID: "local-edit", BranchID: v.BranchID, ExpectedRevision: 1, RevisionID: a.Artifact.RevisionID, ExpectedStateRevision: 0, State: json.RawMessage(`{"step":2}`)})
	must(t, err)
	fork, err := s.Fork(ctx, "gameplay", v.ID, ForkRequest{RequestID: "fork-current", FromBranchID: v.BranchID, FromRevision: 1, Name: "副线"})
	must(t, err)
	if fork.Pages[0].InteractionSnapshot == nil || fork.Pages[0].InteractionSnapshot.OriginBranchID != v.BranchID {
		t.Fatal("fork did not pin parent presentation")
	}
	_, err = s.SaveArtifactState(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, ArtifactStateRequest{RequestID: "parent-change", BranchID: v.BranchID, ExpectedRevision: 1, RevisionID: a.Artifact.RevisionID, ExpectedStateRevision: saved.Artifact.StateRevision, State: json.RawMessage(`{"step":3}`)})
	must(t, err)
	for n, b := range []string{v.BranchID, fork.BranchID} {
		id := []string{"parent-next", "child-next"}[n]
		_, _, err = s.Advance(ctx, "gameplay", v.ID, AdvanceRequest{RequestID: id, BranchID: b, ExpectedRevision: 1, Mode: "read"})
		must(t, err)
		must(t, s.GenerateAccepted(ctx, "gameplay", id))
	}
	parent, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
	must(t, err)
	child, err := s.Get(ctx, "gameplay", v.ID, fork.BranchID)
	must(t, err)
	for _, check := range []struct {
		v     View
		state string
	}{{parent, `{"step":3}`}, {child, `{"step":2}`}} {
		snap := check.v.Pages[0].InteractionSnapshot
		if snap == nil || snap.BaseRevision != 1 || snap.OriginBranchID != v.BranchID || !snapshotJSONEqual(snap.State, []byte(check.state)) {
			t.Fatal("historical state followed later presentation edits")
		}
		if check.v.Pages[1].PreviousArtifactSnapshot != nil {
			t.Fatal("storage association leaked as alternate display")
		}
	}
	oldFork, err := s.Fork(ctx, "gameplay", v.ID, ForkRequest{RequestID: "fork-history", FromBranchID: v.BranchID, FromRevision: 1, Name: "旧页副线"})
	must(t, err)
	if !snapshotJSONEqual(oldFork.Pages[0].InteractionSnapshot.State, []byte(`{"step":3}`)) {
		t.Fatal("historical fork lost frozen source")
	}
	backup, err := s.ExportArchive(ctx, "gameplay")
	must(t, err)
	raw, _ := json.Marshal(backup)
	var restored Archive
	must(t, StrictJSON(raw, &restored))
	must(t, validateArchive(restored))
	_, err = s.ImportArchive(ctx, "snapshot-target", restored)
	must(t, err)
	recovered, err := s.Get(ctx, "snapshot-target", v.ID, fork.BranchID)
	must(t, err)
	if !snapshotJSONEqual(recovered.Pages[0].InteractionSnapshot.State, []byte(`{"step":2}`)) {
		t.Fatal("archive lost frozen local state")
	}
	restored.Experiences[0].Branches[0].Pages[0].Page.InteractionSnapshot = &ArtifactSnapshot{ArtifactID: a.Artifact.ArtifactID, RevisionID: a.Artifact.RevisionID, OriginBranchID: "other-story", BaseRevision: 1, State: json.RawMessage(`{}`)}
	code(t, validateArchive(restored), "invalid_archive")
}

func snapshotJSONEqual(a, b []byte) bool {
	var x, y any
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && reflect.DeepEqual(x, y)
}
