package experience

import (
	"context"
	"encoding/json"
	"reflect"
)

func (s *Service) validateArchiveGameplay(ctx context.Context, a Archive) error {
	batch := []map[string]any{}
	size := 0
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		_, err := s.Artifacts.run(ctx, map[string]any{"op": "gameplay-validate-many", "items": batch})
		batch = []map[string]any{}
		size = 0
		if err != nil {
			return fail("invalid_archive")
		}
		return nil
	}
	add := func(state *GameplayState, revision int64) error {
		if state == nil {
			return nil
		}
		raw, _ := json.Marshal(state)
		if len(raw) > 2<<20 {
			return fail("invalid_archive")
		}
		if size+len(raw) > 2<<20 || len(batch) >= 32 {
			if err := flush(); err != nil {
				return err
			}
		}
		batch = append(batch, map[string]any{"state": state, "revision": revision})
		size += len(raw)
		return nil
	}
	for _, e := range a.Experiences {
		for _, b := range e.Branches {
			if b.Changes != nil && b.Changes.Repair != nil {
				// ParentRevision identifies the prefix before the replacement page.
				at := *b.ParentRevision
				before := EmptyState()
				if at > 0 {
					before = b.Pages[at-1].State
				}
				changed := b.Pages[at]
				authority := Context{Revision: at, Mode: changed.Page.Mode, State: before, GameplayRuntime: s.Artifacts, GameplayContext: ctx}
				applied, err := Apply(authority, b.Changes.Repair.Candidate)
				if err != nil || !reflect.DeepEqual(applied, changed.State) {
					return fail("invalid_archive")
				}
			}
			if err := add(b.State.Gameplay, b.Revision); err != nil {
				return err
			}
			for index, p := range b.Pages {
				if err := add(p.State.Gameplay, p.Page.Revision); err != nil {
					return err
				}
				var before *GameplayState
				if index > 0 {
					before = b.Pages[index-1].State.Gameplay
				}
				if err := validateGameplayReceipt(p.Page.GameplayReceipt, before, p.State.Gameplay, p.Page.Revision); err != nil {
					return err
				}
			}
		}
	}
	return flush()
}
func validateGameplayReceipt(r *GameplayReceipt, before, after *GameplayState, revision int64) error {
	if r == nil {
		return nil
	}
	bad := func() error { return fail("invalid_archive") }
	if r.SchemaVersion != 1 || !keyOK(r.RequestID) || !keyOK(r.ArtifactID) || !keyOK(r.ArtifactRevision) || !keyOK(r.ActionID) || r.BaseRevision != revision-1 || r.Revision != revision || !(r.Kind == "dynamic" || r.Kind == "game" || r.Kind == "journey") || r.Changes == nil || len(r.Changes) > 64 || after == nil || r.Location != after.Location {
		return bad()
	}
	decode := func(s *GameplayState) map[string]map[string]any {
		out := map[string]map[string]any{}
		if s == nil {
			return out
		}
		var game struct {
			Entities []map[string]any `json:"entities"`
		}
		_ = json.Unmarshal(s.Game, &game)
		for _, e := range game.Entities {
			if id, ok := e["id"].(string); ok {
				out[id] = e
			}
		}
		return out
	}
	old, next := decode(before), decode(after)
	seen := map[string]bool{}
	for _, c := range r.Changes {
		field := "value"
		if c.Kind == "status" {
			field = "status"
		} else if c.Kind != "delta" {
			return bad()
		}
		key := c.EntityID + ":" + field
		if seen[key] || next[c.EntityID] == nil {
			return bad()
		}
		seen[key] = true
		var pre, post any
		if StrictJSON(c.Before, &pre) != nil || StrictJSON(c.After, &post) != nil {
			return bad()
		}
		if !reflect.DeepEqual(next[c.EntityID][field], post) {
			return bad()
		}
		if old[c.EntityID] != nil && !reflect.DeepEqual(old[c.EntityID][field], pre) {
			return bad()
		}
	}
	return nil
}
