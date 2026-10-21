package experience

import (
	"encoding/json"
	"unicode/utf8"
)

func decodeNarrativeCandidate(raw []byte, ctx Context) (Candidate, error) {
	if candidate, err := DecodeCandidate(raw); err == nil {
		return candidate, nil
	}
	var fields map[string]json.RawMessage
	if StrictJSON(raw, &fields) != nil {
		return Candidate{}, fail("invalid_candidate")
	}
	storyTime := ctx.State.StoryTime
	var suppliedTime *string
	if value, ok := fields["story_time"]; ok && StrictJSON(value, &suppliedTime) == nil && suppliedTime != nil {
		storyTime = *suppliedTime // an explicit empty string remains distinct from absence
	}
	c := Candidate{
		Title: narrativeField[string](fields, "title"), Passage: narrativeField[string](fields, "passage"),
		StoryTime: storyTime, Outcome: narrativeField[string](fields, "outcome"),
		Suggestions: narrativeField[[]string](fields, "suggestions"),
	}
	if !textOK(c.Passage) {
		return Candidate{}, fail("invalid_candidate")
	}
	c = normalizeNarrative(c, ctx.State.StoryTime)
	plain, _ := json.Marshal(c)
	var accepted map[string]json.RawMessage
	_ = json.Unmarshal(plain, &accepted)
	// Retain whole independently well-shaped fields. DecodeCandidate still
	// enforces the closed canonical nested schema; absent required metadata is
	// never filled with zero values and granted authority by typed decoding.
	for _, key := range []string{"new_entities", "new_facts", "new_threads", "reveal_fact_ids", "reveal_entity_ids", "reveal_thread_ids", "resolve_thread_ids", "knowledge_changes", "gameplay_update"} {
		value, ok := fields[key]
		if !ok {
			continue
		}
		prior, hadPrior := accepted[key]
		accepted[key] = value
		trial, _ := json.Marshal(accepted)
		if candidate, err := DecodeCandidate(trial); err == nil {
			c = candidate
		} else if hadPrior {
			accepted[key] = prior
		} else {
			delete(accepted, key)
		}
	}
	if !narrativeUpdates(c) {
		c.StoryTime = ctx.State.StoryTime
		c.NarrativeOnly = true
	}
	// This ctx can be a bounded generation view. Relation/ID validation belongs
	// to applyNarrative at the service boundary with the complete authority;
	// an omitted entity is not evidence that a recovered reference is invalid.
	return c, nil
}

func narrativeField[T any](fields map[string]json.RawMessage, key string) T {
	var value T
	if raw, ok := fields[key]; ok && StrictJSON(raw, &value) == nil {
		return value
	}
	var empty T
	return empty
}

func normalizeNarrative(c Candidate, storyTime string) Candidate {
	if !textOK(c.Title) {
		c.Title = "故事继续"
	}
	if !utf8.ValidString(c.StoryTime) {
		c.StoryTime = storyTime
	}
	if c.Outcome != "continues" && c.Outcome != "awaits_player" && c.Outcome != "ending" {
		c.Outcome = "continues"
	}
	suggestions := []string{}
	for _, suggestion := range c.Suggestions {
		if textOK(suggestion) {
			suggestions = append(suggestions, suggestion)
		}
	}
	c.Suggestions = suggestions
	if c.NewFacts == nil {
		c.NewFacts = []Fact{}
	}
	if c.NewEntities == nil {
		c.NewEntities = []Entity{}
	}
	if c.NewThreads == nil {
		c.NewThreads = []Thread{}
	}
	if c.RevealFactIDs == nil {
		c.RevealFactIDs = []string{}
	}
	if c.RevealEntityIDs == nil {
		c.RevealEntityIDs = []string{}
	}
	if c.RevealThreadIDs == nil {
		c.RevealThreadIDs = []string{}
	}
	if c.ResolveThreadIDs == nil {
		c.ResolveThreadIDs = []string{}
	}
	if c.KnowledgeChanges == nil {
		c.KnowledgeChanges = []KnowledgeChange{}
	}
	return c
}

func narrativeUpdates(c Candidate) bool {
	return c.GameplayUpdate != nil || len(c.NewFacts)+len(c.NewEntities)+len(c.NewThreads)+len(c.RevealFactIDs)+len(c.RevealEntityIDs)+len(c.RevealThreadIDs)+len(c.ResolveThreadIDs)+len(c.KnowledgeChanges) > 0
}

// applyNarrative preserves prose and independently valid metadata groups. Every
// recovered cumulative proposal passes the same full-authority Apply; no record
// is repaired by inventing an ID, provenance, knowledge link or gameplay result.
func applyNarrative(ctx Context, c Candidate) (Candidate, State, error) {
	if c.NarrativeOnly && !narrativeUpdates(c) && textOK(c.Passage) {
		// A decoder fallback may be checked again at the commit boundary. Its
		// local marker must not trigger a pinned gameplay action through Apply
		// while commitGameplay intentionally skips a prose-only receipt.
		c = normalizeNarrative(c, ctx.State.StoryTime)
		c.StoryTime = ctx.State.StoryTime
		return c, ctx.State, nil
	}
	c.NarrativeOnly = false
	state, err := Apply(ctx, c)
	if err == nil {
		return c, state, nil
	}
	if !textOK(c.Passage) {
		return c, State{}, err
	}
	c = normalizeNarrative(c, ctx.State.StoryTime)
	if state, err = Apply(ctx, c); err == nil {
		return c, state, nil
	}
	withoutGameplay := c
	withoutGameplay.GameplayUpdate = nil
	if state, err = Apply(ctx, withoutGameplay); err == nil {
		return withoutGameplay, state, nil
	}
	plain := normalizeNarrative(Candidate{Title: c.Title, Passage: c.Passage, StoryTime: ctx.State.StoryTime, Outcome: c.Outcome, Suggestions: c.Suggestions}, ctx.State.StoryTime)
	plain.NarrativeOnly = true
	if ctx.Mode == "ask" {
		return plain, ctx.State, nil
	}
	accepted, acceptedState := plain, ctx.State
	try := func(proposal Candidate) bool {
		proposal.NarrativeOnly = false
		if next, err := Apply(ctx, proposal); err == nil {
			accepted, acceptedState = proposal, next
			return true
		}
		return false
	}
	// Try at most seven whole-field subsets, preferring more retained fields.
	// Full Apply preserves genuine cross-field dependency graphs; an unrelated
	// broken thread need not discard an independently valid ownership fact.
	present := 0
	if len(c.NewEntities) > 0 {
		present |= 1
	}
	if len(c.NewFacts) > 0 {
		present |= 2
	}
	if len(c.NewThreads) > 0 {
		present |= 4
	}
	for _, mask := range []int{7, 3, 5, 6, 1, 2, 4} {
		if mask&present != mask {
			continue
		}
		proposal := accepted
		if mask&1 != 0 {
			proposal.NewEntities = c.NewEntities
		}
		if mask&2 != 0 {
			proposal.NewFacts = c.NewFacts
		}
		if mask&4 != 0 {
			proposal.NewThreads = c.NewThreads
		}
		if try(proposal) {
			break
		}
	}
	for _, group := range []struct {
		values []string
		set    func(*Candidate, []string)
	}{
		{c.RevealFactIDs, func(v *Candidate, ids []string) { v.RevealFactIDs = ids }},
		{c.RevealEntityIDs, func(v *Candidate, ids []string) { v.RevealEntityIDs = ids }},
		{c.RevealThreadIDs, func(v *Candidate, ids []string) { v.RevealThreadIDs = ids }},
		{c.ResolveThreadIDs, func(v *Candidate, ids []string) { v.ResolveThreadIDs = ids }},
	} {
		if len(group.values) > 0 {
			proposal := accepted
			group.set(&proposal, group.values)
			try(proposal)
		}
	}
	if len(c.KnowledgeChanges) > 0 {
		proposal := accepted
		proposal.KnowledgeChanges = c.KnowledgeChanges
		try(proposal)
	}
	// A gameplay update and its clock are indivisible. Without one, only retain
	// the proposed clock after another verified world update survived recovery.
	if c.GameplayUpdate != nil || !accepted.NarrativeOnly {
		proposal := accepted
		proposal.GameplayUpdate, proposal.StoryTime = c.GameplayUpdate, c.StoryTime
		try(proposal)
	}
	return accepted, acceptedState, nil
}
