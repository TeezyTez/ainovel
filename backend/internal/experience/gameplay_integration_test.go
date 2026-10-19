//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

const gameplayProse = "你随身有铜币5枚。买一杯茶花费2枚铜币。"

func gameUpdateFixture() json.RawMessage {
	return json.RawMessage(`{"entities":[{"id":"coins","kind":"meter","name":"铜币","detail":"随身零钱","status":"可用","value":5,"max":null,"unit":"枚","quote":"你随身有铜币5枚。"}],"surfaces":[{"id":"tea","kind":"interaction","title":"买茶","description":"明示价格","entityIds":["coins"],"links":[],"actions":[{"id":"buy","label":"买茶","input":"买一杯茶","mode":"apply","effects":[{"entityId":"coins","delta":-2,"status":null}],"destination":null,"disabledReason":""}],"quote":"买一杯茶花费2枚铜币。"}],"spatial":null,"journeys":null}`)
}
func setupGameplay(t *testing.T) (*Service, View, ArtifactResponse) {
	t.Helper()
	s, _, _ := testService(t)
	s.Artifacts = artifactRuntimeForTest(t)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		x := candidate(c)
		if c.Revision == 0 {
			x = initial(c)
			x.Passage = gameplayProse
			x.NewFacts = append(x.NewFacts, Fact{ID: "price", Kind: "fact", Text: gameplayProse, Known: true, KnownBy: []string{}, SourceRevision: 1})
			x.GameplayUpdate = &GameplayUpdate{SchemaVersion: 1, Game: gameUpdateFixture(), Experience: json.RawMessage(`null`), Events: []GameplayEvent{}}
		} else {
			x.Passage = "你付出了2枚铜币，收到了那杯茶。"
		}
		return x, nil
	})
	v := begin(t, s, "gameplay", "begin")
	if v.Gameplay == nil {
		t.Fatal("initial source ledger missing")
	}
	def := artifactFixture()["definition"].(map[string]any)
	def["fields"] = []any{}
	def["steps"] = []any{}
	def["actions"] = []any{map[string]any{"id": "buy", "label": "买一杯茶", "mode": "rule", "targets": []string{"coins"}, "checks": []any{}, "effects": []any{map[string]any{"entityId": "coins", "kind": "delta", "value": -2}}, "result": "买一杯茶，支付2枚铜币。", "evidence": []string{"买一杯茶花费2枚铜币。"}}}
	raw, _ := json.Marshal(def)
	artifact, err := s.ImportArtifact(context.Background(), "gameplay", v.ID, ArtifactImportRequest{RequestID: "form", BranchID: v.BranchID, ExpectedRevision: 1, Definition: raw, State: json.RawMessage(`{}`)})
	must(t, err)
	return s, v, artifact
}
func executeRequest(t *testing.T, v View, a ArtifactResponse, kind, id string) ArtifactExecuteRequest {
	t.Helper()
	var payload map[string]any
	must(t, StrictJSON(a.Artifact.Payload, &payload))
	definition := payload["definition"].(map[string]any)
	var ref any
	if kind == "dynamic" {
		ref = map[string]any{"interactionId": definition["id"], "revision": definition["revision"], "actionId": "buy", "targets": []string{"coins"}, "scope": definition["scope"]}
	} else {
		ref = map[string]any{"branchId": v.BranchID, "version": v.Revision, "surfaceId": "tea", "actionId": "buy"}
	}
	raw, _ := json.Marshal(ref)
	return ArtifactExecuteRequest{RequestID: id, BranchID: v.BranchID, ExpectedRevision: v.Revision, RevisionID: a.Artifact.RevisionID, DefinitionDigest: payload["definitionDigest"].(string), Kind: kind, Reference: raw, Params: json.RawMessage(`{}`)}
}
func TestGameplayDynamicAndGameExecuteOnceAndReplayAtCommit(t *testing.T) {
	for _, kind := range []string{"dynamic", "game"} {
		t.Run(kind, func(t *testing.T) {
			s, v, a := setupGameplay(t)
			ctx := context.Background()
			review := &newtestsFeedbackModel{text: `{"approved":true}`}
			req := executeRequest(t, v, a, kind, "execute")
			op, fresh, err := s.ExecuteArtifact(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, req, artifactInterpreter(review))
			must(t, err)
			if !fresh || op.Status != "pending" {
				t.Fatal("action not queued")
			}
			_, _, err = s.Advance(ctx, "gameplay", v.ID, AdvanceRequest{RequestID: "overlap", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "act", Input: "再买一杯"})
			code(t, err, "branch_busy")
			must(t, s.GenerateAccepted(ctx, "gameplay", req.RequestID))
			after, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
			must(t, err)
			if after.Revision != 2 {
				t.Fatalf("execution not committed: status=%s error=%v", after.Operation.Status, after.Operation.ErrorCode)
			}
			var ledger map[string]any
			must(t, StrictJSON(after.Gameplay.Game, &ledger))
			if ledger["entities"].([]any)[0].(map[string]any)["value"] != float64(3) {
				t.Fatal("formal ledger did not spend exactly 2")
			}
			receipt := after.Pages[1].GameplayReceipt
			if receipt == nil || receipt.RequestID != req.RequestID || receipt.Revision != 2 || len(receipt.Changes) != 1 {
				t.Fatal("committed receipt missing")
			}
			replay, fresh, err := s.ExecuteArtifact(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, req, artifactInterpreter(review))
			must(t, err)
			if fresh || replay.Status != "committed" || review.calls != 1 {
				t.Fatal("retry spent twice or repeated approval")
			}
			history, err := s.ExportArchive(ctx, "gameplay")
			must(t, err)
			if history.Experiences[0].Branches[0].Pages[0].State.Gameplay == nil || history.Experiences[0].Branches[0].Pages[1].Page.GameplayReceipt == nil {
				t.Fatal("archive omitted gameplay authority")
			}
			restored, err := s.ImportArchive(ctx, "restored", history)
			must(t, err)
			if len(restored.Imported) != 1 {
				t.Fatal("gameplay archive did not restore")
			}
			restoredView, err := s.Get(ctx, "restored", v.ID, v.BranchID)
			must(t, err)
			if !sameGameplay(restoredView.Gameplay, after.Gameplay) || restoredView.Pages[1].GameplayReceipt.RequestID != req.RequestID {
				t.Fatal("gameplay authority or receipt changed on restore")
			}
			again, err := s.ImportArchive(ctx, "restored", history)
			must(t, err)
			if len(again.Skipped) != 1 || len(again.Imported) != 0 {
				t.Fatal("archive retry overwrote existing gameplay")
			}
			history.Experiences[0].Branches[0].Pages[1].Page.GameplayReceipt.Changes[0].After = json.RawMessage(`999`)
			_, err = s.ImportArchive(ctx, "tampered", history)
			code(t, err, "invalid_archive")

		})
	}
}
func TestGameplayRejectsModelOverrideAndDeniedAuthorization(t *testing.T) {
	s, v, a := setupGameplay(t)
	ctx := context.Background()
	req := executeRequest(t, v, a, "dynamic", "denied")
	review := &newtestsFeedbackModel{text: `{"approved":false}`}
	_, _, err := s.ExecuteArtifact(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, req, artifactInterpreter(review))
	code(t, err, "action_not_authorized")
	req.RequestID = "tamper"
	review.text = `{"approved":true}`
	_, _, err = s.ExecuteArtifact(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, req, artifactInterpreter(review))
	must(t, err)
	s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
		x := candidate(c)
		x.Passage = "你随身有铜币999枚。买一杯茶花费2枚铜币。"
		x.GameplayUpdate = &GameplayUpdate{SchemaVersion: 1, Game: json.RawMessage(strings.ReplaceAll(string(gameUpdateFixture()), "5", "999")), Experience: json.RawMessage(`null`), Events: []GameplayEvent{}}
		return x, nil
	})
	must(t, s.GenerateAccepted(ctx, "gameplay", req.RequestID))
	after, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
	must(t, err)
	if after.Revision != 1 || after.Operation.Status != "failed" || len(after.Pages) != 1 {
		t.Fatal("model overwrote authoritative resource")
	}
}
func TestGameplayJourneySettlesQuotedCostTimeAndActualStop(t *testing.T) {
	for _, valid := range []bool{true, false} {
		t.Run(map[bool]string{true: "accepted", false: "overquoted-time"}[valid], func(t *testing.T) {
			s, _, _ := testService(t)
			s.Artifacts = artifactRuntimeForTest(t)
			ctx := context.Background()
			const initialText = "第1日 09:00，你在大厅。你随身有铜币5枚。步行路线从大厅到茶铺耗时10分钟，包括等待，费用2枚铜币。"
			source := map[string]any{}
			must(t, StrictJSON(gameUpdateFixture(), &source))
			source["surfaces"] = []any{}
			entities := source["entities"].([]any)
			for _, p := range []struct{ id, name string }{{"hall", "大厅"}, {"tea-shop", "茶铺"}} {
				entities = append(entities, map[string]any{"id": p.id, "kind": "place", "name": p.name, "detail": "已知地点", "status": "可到达", "value": nil, "max": nil, "unit": "", "quote": "步行路线从大厅到茶铺耗时10分钟，包括等待，费用2枚铜币。"})
			}
			source["entities"] = entities
			source["journeys"] = map[string]any{"routes": []any{map[string]any{"id": "walk", "from": "hall", "to": "tea-shop", "label": "步行路线", "detail": "公开报价", "via": []any{}, "minutesMin": 10, "minutesMax": 10, "costs": []any{map[string]any{"entityId": "coins", "amount": 2}}, "includesWaiting": true, "quote": "步行路线从大厅到茶铺耗时10分钟，包括等待，费用2枚铜币。"}}, "transit": nil}
			sourceRaw, _ := json.Marshal(source)
			expRaw := json.RawMessage(`{"clock":{"label":"第1日 09:00","elapsed":"","precision":"exact","quote":"第1日 09:00"},"objects":[],"stop":null,"folded":[]}`)
			s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
				x := candidate(c)
				if c.Revision == 0 {
					x = initial(c)
					x.Passage = initialText
					x.StoryTime = "第1日 09:00"
					x.GameplayUpdate = &GameplayUpdate{SchemaVersion: 1, Game: sourceRaw, Experience: expRaw, Events: []GameplayEvent{{Type: "location", Value: "大厅", Quote: "你在大厅"}}}
				} else {
					minutes := 10
					clock := "第1日 09:10"
					if !valid {
						minutes = 20
						clock = "第1日 09:20"
					}
					text := "你沿步行路线从大厅来到茶铺，花费10分钟，支付2枚铜币。第1日 09:10。"
					if !valid {
						text = "你沿步行路线从大厅来到茶铺，花费20分钟，支付2枚铜币。第1日 09:20。"
					}
					x.Passage = text
					x.StoryTime = clock
					game, _ := json.Marshal(map[string]any{"entities": []any{}, "surfaces": []any{}, "spatial": nil, "journeys": map[string]any{"routes": []any{}, "transit": map[string]any{"routeId": "walk", "locationId": "tea-shop", "completed": true, "elapsedMinutes": minutes, "paidCosts": []any{map[string]any{"entityId": "coins", "amount": 2}}, "quote": text}}})
					experience, _ := json.Marshal(map[string]any{"clock": map[string]any{"label": clock, "elapsed": map[bool]string{true: "10分钟", false: "20分钟"}[valid], "precision": "exact", "quote": text}, "objects": []any{}, "stop": nil, "folded": []any{}})
					x.GameplayUpdate = &GameplayUpdate{SchemaVersion: 1, Game: game, Experience: experience, Events: []GameplayEvent{{Type: "location", Value: "茶铺", Quote: text}}}
				}
				return x, nil
			})
			v := begin(t, s, "journey", "begin")
			def := artifactFixture()["definition"].(map[string]any)
			def["actions"] = []any{}
			raw, _ := json.Marshal(def)
			a, err := s.ImportArtifact(ctx, "journey", v.ID, ArtifactImportRequest{RequestID: "map", BranchID: v.BranchID, ExpectedRevision: 1, Definition: raw, State: json.RawMessage(`{}`)})
			must(t, err)
			var payload map[string]any
			must(t, StrictJSON(a.Artifact.Payload, &payload))
			ref, _ := json.Marshal(map[string]any{"branchId": v.BranchID, "version": 1, "surfaceId": "$journeys", "actionId": "walk"})
			req := ArtifactExecuteRequest{RequestID: "travel", BranchID: v.BranchID, ExpectedRevision: 1, RevisionID: a.Artifact.RevisionID, DefinitionDigest: payload["definitionDigest"].(string), Kind: "journey", Reference: ref, Params: json.RawMessage(`{}`)}
			_, _, err = s.ExecuteArtifact(ctx, "journey", v.ID, a.Artifact.ArtifactID, req, artifactInterpreter(&newtestsFeedbackModel{text: `{"approved":true}`}))
			must(t, err)
			must(t, s.GenerateAccepted(ctx, "journey", req.RequestID))
			after, err := s.Get(ctx, "journey", v.ID, v.BranchID)
			must(t, err)
			if valid {
				if after.Revision != 2 || after.Gameplay.Location != "茶铺" || after.Pages[1].GameplayReceipt == nil {
					t.Fatalf("journey not committed: %v", after.Operation.ErrorCode)
				}
				var game map[string]any
				must(t, StrictJSON(after.Gameplay.Game, &game))
				if game["entities"].([]any)[0].(map[string]any)["value"] != float64(3) {
					t.Fatal("journey fee not settled")
				}
			} else if after.Revision != 1 || after.Operation.Status != "failed" || after.Gameplay.Location != "大厅" {
				t.Fatal("overquoted journey committed")
			}
		})
	}
}

func TestGameplayAuthorRepairClearsOldReceiptAndArchiveRevalidatesLedger(t *testing.T) {
	s, v, a := setupGameplay(t)
	ctx := context.Background()
	req := executeRequest(t, v, a, "dynamic", "execute-before-repair")
	_, _, err := s.ExecuteArtifact(ctx, "gameplay", v.ID, a.Artifact.ArtifactID, req, artifactInterpreter(&newtestsFeedbackModel{text: `{"approved":true}`}))
	must(t, err)
	must(t, s.GenerateAccepted(ctx, "gameplay", req.RequestID))
	old, err := s.Get(ctx, "gameplay", v.ID, v.BranchID)
	must(t, err)
	rev := old.Revision
	authority, _, err := s.authorContext(ctx, "gameplay", v.ID, v.BranchID, rev)
	must(t, err)
	fix := candidate(authority)
	fix.Passage = "你没有购买茶，钱包仍有5枚铜币。"
	s.Generator = &reviewFixture{Generator: s.Generator}
	repaired, err := s.Fork(ctx, "gameplay", v.ID, ForkRequest{RequestID: "repair-gameplay", FromBranchID: v.BranchID, FromRevision: rev, ExpectedRevision: &rev, Name: "修复未购买", Repair: &RepairChange{Candidate: fix}})
	must(t, err)
	if repaired.Pages[rev-1].GameplayReceipt != nil || old.Pages[rev-1].GameplayReceipt == nil {
		t.Fatal("author repair retained the old deterministic receipt or altered original")
	}
	var repairedGame map[string]any
	must(t, StrictJSON(repaired.Gameplay.Game, &repairedGame))
	if repairedGame["entities"].([]any)[0].(map[string]any)["value"] != float64(5) {
		t.Fatal("repair did not replay its own baseline")
	}
	archive, err := s.ExportArchive(ctx, "gameplay")
	must(t, err)
	raw, _ := json.Marshal(archive)
	decoded, err := DecodeArchive(raw)
	must(t, err)
	_, err = s.ImportArchive(ctx, "repair-restored", decoded)
	must(t, err)
	for i := range decoded.Experiences[0].Branches {
		b := &decoded.Experiences[0].Branches[i]
		if b.ID == repaired.BranchID {
			altered := json.RawMessage(strings.ReplaceAll(string(b.State.Gameplay.Game), `"value":5`, `"value":999`))
			b.State.Gameplay.Game = altered
			b.Pages[len(b.Pages)-1].State.Gameplay.Game = altered
		}
	}
	_, err = s.ImportArchive(ctx, "repair-forged", decoded)
	code(t, err, "invalid_archive")
}

func TestArtifactPublicContextUsesOriginalNamedObjectRoots(t *testing.T) {
	v := View{ID: "story", BranchID: "branch", Revision: 1, Gameplay: &GameplayState{SchemaVersion: 1, Game: json.RawMessage(`{"entities":[{"id":"coins","kind":"meter","value":5}]}`), Location: "hall", Inventory: []string{}, Experience: json.RawMessage(`{"objects":[{"id":"machine","kind":"object"}]}`)}}
	c := artifactPublicContext(v, 1)
	objects := c["objects"].(map[string]any)
	if objects["coins"].(map[string]any)["value"] != float64(5) || len(c["knownObjects"].([]any)) != 1 || c["location"] != "hall" {
		t.Fatal("source publicContext roots omitted")
	}
}
