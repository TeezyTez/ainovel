package experience

import (
	"context"
	"encoding/json"
	"reflect"
)

// Replay is a Go-only pin to a saved source definition and its exact resolution.
// It is persisted beside the operation, never accepted from a model response.
type GameplayReplay struct {
	Definition json.RawMessage `json:"definition"`
	Reference  json.RawMessage `json:"reference"`
	Receipt    json.RawMessage `json:"receipt"`
}
type GameplayReceipt struct {
	SchemaVersion    int              `json:"schemaVersion"`
	RequestID        string           `json:"request_id"`
	ArtifactID       string           `json:"artifact_id"`
	ArtifactRevision string           `json:"artifact_revision"`
	DefinitionDigest string           `json:"definition_digest"`
	Kind             string           `json:"kind"`
	ActionID         string           `json:"action_id"`
	BaseRevision     int64            `json:"base_revision"`
	Revision         int64            `json:"revision"`
	Result           string           `json:"result"`
	Changes          []GameplayChange `json:"changes"`
	Location         string           `json:"location"`
	Transit          json.RawMessage  `json:"transit,omitempty"`
}

func applyGameplay(c Context, candidate Candidate) (*GameplayState, error) {
	state, _, err := computeGameplay(c, candidate)
	return state, err
}
func computeGameplay(c Context, candidate Candidate) (*GameplayState, json.RawMessage, error) {
	if c.State.Gameplay == nil && candidate.GameplayUpdate == nil && c.GameplayAction == nil {
		return nil, nil, nil
	}
	if c.Mode == "ask" {
		if candidate.GameplayUpdate != nil || c.GameplayAction != nil {
			return nil, nil, fail("invalid_gameplay")
		}
		raw, _ := json.Marshal(c.State.Gameplay)
		var copy *GameplayState
		_ = json.Unmarshal(raw, &copy)
		return copy, nil, nil
	}
	if c.GameplayAction != nil && (c.GameplayAction.Kind == "dynamic" || c.GameplayAction.Kind == "game") {
		if candidate.StoryTime != c.State.StoryTime || len(candidate.NewFacts)+len(candidate.NewEntities)+len(candidate.NewThreads)+len(candidate.RevealEntityIDs)+len(candidate.RevealThreadIDs)+len(candidate.RevealFactIDs)+len(candidate.ResolveThreadIDs)+len(candidate.KnowledgeChanges) > 0 {
			return nil, nil, fail("invalid_gameplay")
		}
	}
	ctx := c.GameplayContext
	if ctx == nil {
		ctx = context.Background()
	}
	facts := []string{}
	for _, f := range c.State.Facts {
		if f.Known {
			facts = append(facts, f.Text)
		}
	}
	raw, err := c.GameplayRuntime.run(ctx, map[string]any{"op": "gameplay-apply", "revision": c.Revision, "before": c.State.Gameplay, "update": candidate.GameplayUpdate, "prose": candidate.Passage, "storyTime": candidate.StoryTime, "mode": c.Mode, "action": c.GameplayAction, "replay": c.GameplayReplay, "branchId": c.BranchID, "facts": facts})
	if err != nil {
		return nil, nil, fail("invalid_gameplay")
	}
	var result struct {
		State   *GameplayState  `json:"state"`
		Receipt json.RawMessage `json:"receipt"`
	}
	if StrictJSON(raw, &result) != nil || result.State == nil || result.State.SchemaVersion != 1 {
		return nil, nil, fail("invalid_gameplay")
	}
	return result.State, result.Receipt, nil
}
func sameGameplay(a, b *GameplayState) bool {
	ar, _ := json.Marshal(a)
	br, _ := json.Marshal(b)
	var av, bv any
	_ = json.Unmarshal(ar, &av)
	_ = json.Unmarshal(br, &bv)
	return reflect.DeepEqual(av, bv)
}
