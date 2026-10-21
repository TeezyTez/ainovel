package experience

import (
	"bytes"
	"encoding/json"
	"strings"
)

// ReaderState implements P(snapshot), before counts, matching or serialization.
// This is metadata permission filtering, not narrative text truncation. An
// undisclosed object and a nonexistent object are intentionally indistinguishable.
func ReaderState(in State) State {
	out := EmptyState()
	out.StoryTime = in.StoryTime
	// Gameplay contains only committed public records and stays whole in the
	// reader projection; it is never reconstructed from hidden author facts.
	if in.Gameplay != nil {
		raw, _ := json.Marshal(in.Gameplay)
		_ = json.Unmarshal(raw, &out.Gameplay)
	}
	visible := map[string]bool{}
	for _, e := range in.Entities {
		if e.Known {
			visible[e.ID] = true
		}
	}
	for _, f := range in.Facts {
		if f.Known && (f.SubjectID == "" || visible[f.SubjectID]) {
			visible[f.ID] = true
		}
	}
	for _, t := range in.Threads {
		if t.Known {
			visible[t.ID] = true
		}
	}
	filter := func(ids []string) []string {
		v := []string{}
		for _, id := range ids {
			if visible[id] {
				v = append(v, id)
			}
		}
		return v
	}
	for _, f := range in.Facts {
		if visible[f.ID] {
			// Knowing a proposition does not reveal which other characters
			// learned it privately. Public acquisition/propagation events are
			// ordinary known facts; authority's knowledge edges stay private.
			f.KnownBy = []string{}
			if f.Reader != nil && (!visible[f.Reader.EntityID] || f.Reader.TargetID != "" && !visible[f.Reader.TargetID]) {
				f.Reader = nil
			}
			out.Facts = append(out.Facts, f)
		}
	}
	for _, e := range in.Entities {
		if visible[e.ID] {
			e.RelatedIDs = filter(e.RelatedIDs)
			out.Entities = append(out.Entities, e)
		}
	}
	for _, t := range in.Threads {
		if visible[t.ID] {
			t.RelatedFactIDs = filter(t.RelatedFactIDs)
			out.Threads = append(out.Threads, t)
		}
	}
	return out
}
func counts(s State) StateCounts {
	return StateCounts{Facts: int64(len(s.Facts)), Entities: int64(len(s.Entities)), Threads: int64(len(s.Threads))}
}
func subtract(a, b StateCounts) StateCounts {
	return StateCounts{Facts: a.Facts - b.Facts, Entities: a.Entities - b.Entities, Threads: a.Threads - b.Threads}
}
func objectBodies(s State) map[string][]byte {
	all := map[string][]byte{}
	for _, f := range s.Facts {
		all[f.ID], _ = json.Marshal(f)
	}
	for _, e := range s.Entities {
		all[e.ID], _ = json.Marshal(e)
	}
	for _, t := range s.Threads {
		all[t.ID], _ = json.Marshal(t)
	}
	return all
}

// compileGeneration separates materialized generation evidence from complete
// commit authority. The named policy is structural plumbing, not a claim that
// these roots include every old narrative commitment. Omitted current authority
// remains binding and is available via the pinned read capability.
func compileGeneration(authority Context, boundary State, handle string, recent int64, budget ReadBudget, capacity int) (Context, error) {
	raw, _ := json.Marshal(authority)
	var c Context
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	} // no shared backing slices
	c.AuthorWorld = authority.AuthorWorld
	c.Progress = authority.Progress
	c.AuthorityState = &authority.State
	c.GameplayRuntime = authority.GameplayRuntime
	c.GameplayContext = authority.GameplayContext
	if c.Pipeline != nil {
		// Persistent literary memory is an index, not a mandatory prompt block.
		// Stage compilation selects it from the pinned AuthorityState as needed.
		c.State.Narrative = nil
		c.State.LiteraryMemory = nil
	}
	audience := "author"
	if c.Mode == "ask" {
		c.AuthorWorld = nil
		audience = "reader"
		c.State = ReaderState(c.State)
		boundary = ReaderState(boundary)
	}
	total := counts(c.State)
	c.Recalls = []ReadReply{}
	c.ReadBudget = budget
	c.StateCoverage = StateCoverage{Policy: "full.v1", RecentFromRevision: 0, Total: total, Omitted: StateCounts{}, Complete: true, SourceHandle: handle, Audience: audience}
	if audience == "reader" {
		zero := StateCounts{}
		c.StateCoverage.OmittedReaderKnown = &zero
	}
	if full, err := boundedContext(c, capacity); err == nil {
		return full, nil
	}
	old := objectBodies(boundary)
	now := objectBodies(c.State)
	selected := map[string]bool{}
	// Changed/new objects since a pinned boundary are actual set differences,
	// not guessed creation times derived from entity IDs or presentation pages.
	for id, body := range now {
		if prior, ok := old[id]; !ok || !bytes.Equal(body, prior) {
			selected[id] = true
		}
	}
	for _, f := range c.State.Facts {
		if f.Kind == "rule" || f.Kind == "secret" || f.SourceRevision >= recent {
			selected[f.ID] = true
		}
	}
	for _, t := range c.State.Threads {
		if t.ResolvedAtRevision == nil {
			selected[t.ID] = true
		}
	}
	// Deterministic exact literal identification in the current user request,
	// before generation. This has no relevance-ranking/completeness pretense.
	// Read-mode direction is intentionally separate from world-changing input.
	// It still names evidence the continuation needs, without becoming an act.
	requestedMaterial := c.Input + "\n" + c.ReadingRequest
	if c.Pipeline != nil && len(c.History) > 0 {
		// Continued scenes and pronouns often name nobody in the new input.
		// Keep a small scene entry through the latest whole page's identities.
		requestedMaterial += "\n" + c.History[len(c.History)-1].Text
	}
	explicitEntities := map[string]bool{}
	for _, e := range c.State.Entities {
		if strings.Contains(requestedMaterial, e.ID) || (e.Name != "" && strings.Contains(requestedMaterial, e.Name)) {
			selected[e.ID] = true
			explicitEntities[e.ID] = true
		}
	}
	// Old ownership, location, promises and beliefs can point to an entity
	// without that append-only entity linking back to later facts. Root these
	// relations only for explicit input entities: a knower or dependency reached
	// below must not recursively import every fact the character has ever known.
	for _, f := range c.State.Facts {
		if c.Pipeline == nil && (explicitEntities[f.SubjectID] || f.Reader != nil && (explicitEntities[f.Reader.EntityID] || explicitEntities[f.Reader.TargetID])) {
			selected[f.ID] = true
		}
	}
	for id := range now {
		if strings.Contains(requestedMaterial, id) {
			selected[id] = true
		}
	}
	// Preserve full forward closure: no effect without its loaded premise.
	for changed := true; changed; {
		changed = false
		add := func(id string) {
			if id != "" && !selected[id] {
				if _, ok := now[id]; ok {
					selected[id] = true
					changed = true
				}
			}
		}
		for _, f := range c.State.Facts {
			if selected[f.ID] {
				add(f.SubjectID)
				if f.Reader != nil {
					add(f.Reader.EntityID)
					add(f.Reader.TargetID)
				}
				for _, id := range f.KnownBy {
					add(id)
				}
			}
		}
		for _, e := range c.State.Entities {
			if selected[e.ID] {
				for _, id := range e.RelatedIDs {
					add(id)
				}
			}
		}
		for _, t := range c.State.Threads {
			if selected[t.ID] {
				for _, id := range t.RelatedFactIDs {
					add(id)
				}
			}
		}
	}
	view := EmptyState()
	view.StoryTime = c.State.StoryTime
	view.Gameplay = c.State.Gameplay
	for _, f := range c.State.Facts {
		if selected[f.ID] {
			view.Facts = append(view.Facts, f)
		}
	}
	for _, e := range c.State.Entities {
		if selected[e.ID] {
			view.Entities = append(view.Entities, e)
		}
	}
	for _, t := range c.State.Threads {
		if selected[t.ID] {
			view.Threads = append(view.Threads, t)
		}
	}
	view.Narrative = c.State.Narrative
	c.State = view
	omitted := subtract(total, counts(view))
	c.StateCoverage.Policy = "rules-secrets-open-recent-closure.v1"
	c.StateCoverage.RecentFromRevision = recent
	c.StateCoverage.Omitted = omitted
	c.StateCoverage.Complete = omitted == (StateCounts{})
	if audience == "reader" {
		v := omitted
		c.StateCoverage.OmittedReaderKnown = &v
	}
	return boundedContext(c, capacity) // mandatory closure/latest whole page may still fail
}
