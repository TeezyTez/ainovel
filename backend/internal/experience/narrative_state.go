package experience

import "encoding/json"

type NarrativePipeline struct {
	Version    int `json:"version"`
	MaxActors  int `json:"max_actors"`
	MaxRepairs int `json:"max_repairs"`
}
type NarrativeProgress struct {
	Seq   int64  `json:"seq"`
	Phase string `json:"phase"`
}
type NarrativeEpisode struct {
	ID           string   `json:"id"`
	Summary      string   `json:"summary"`
	FromRevision int64    `json:"from_revision"`
	ToRevision   int64    `json:"to_revision"`
	FactIDs      []string `json:"fact_ids"`
}
type NarrativeRelationship struct {
	EntityID string   `json:"entity_id"`
	Stance   string   `json:"stance"`
	FactIDs  []string `json:"fact_ids"`
}
type NarrativeCharacter struct {
	EntityID        string                  `json:"entity_id"`
	Goals           []string                `json:"goals"`
	Relationships   []NarrativeRelationship `json:"relationships"`
	Voice           string                  `json:"voice"`
	BeliefFactIDs   []string                `json:"belief_fact_ids"`
	UpdatedRevision int64                   `json:"updated_revision"`
}
type NarrativeArc struct {
	ThreadID         string   `json:"thread_id"`
	Status           string   `json:"status"`
	Tension          int      `json:"tension"`
	NextBeats        []string `json:"next_beats"`
	PayoffConditions []string `json:"payoff_conditions"`
	FactIDs          []string `json:"fact_ids"`
	UpdatedRevision  int64    `json:"updated_revision"`
}
type NarrativeStyle struct {
	Voice          string   `json:"voice"`
	Perspective    string   `json:"perspective"`
	Pace           string   `json:"pace"`
	Detail         string   `json:"detail"`
	Avoid          []string `json:"avoid"`
	PreferenceRefs []string `json:"preference_refs"`
}
type NarrativeState struct {
	Version         int                  `json:"version"`
	ThroughRevision int64                `json:"through_revision"`
	Episodes        []NarrativeEpisode   `json:"episodes"`
	Characters      []NarrativeCharacter `json:"characters"`
	Arcs            []NarrativeArc       `json:"arcs"`
	Style           NarrativeStyle       `json:"style"`
}

// Notebook is bounded, private derived state. References always resolve against
// the full formal state, never a model's own summary or a trimmed generation view.
func validateNarrativeState(n *NarrativeState, s State, revision int64) error {
	if n == nil {
		return nil
	}
	bad := func() error { return fail("invalid_narrative_state") }
	raw, err := json.Marshal(n)
	if err == nil && validateContract(raw, "narrative_state") != nil {
		return bad()
	}
	if err != nil || len(raw) > 12<<10 || n.Version != 1 || n.ThroughRevision < 0 || n.ThroughRevision > revision || n.Episodes == nil || len(n.Episodes) > 8 || n.Characters == nil || len(n.Characters) > 16 || n.Arcs == nil || len(n.Arcs) > 16 {
		return bad()
	}
	entities := map[string]bool{}
	characters := map[string]bool{}
	facts := map[string]Fact{}
	threads := map[string]Thread{}
	for _, v := range s.Entities {
		entities[v.ID] = true
		characters[v.ID] = v.Kind == "character" || v.Kind == "person"
	}
	for _, v := range s.Facts {
		facts[v.ID] = v
	}
	for _, v := range s.Threads {
		threads[v.ID] = v
	}
	refs := func(ids []string) bool {
		if ids == nil || len(ids) > 64 {
			return false
		}
		seen := map[string]bool{}
		for _, id := range ids {
			if _, ok := facts[id]; !ok || seen[id] {
				return false
			}
			seen[id] = true
		}
		return true
	}
	text := func(v string) bool { return textOK(v) && len(v) <= 4096 }
	texts := func(v []string, max int) bool {
		if v == nil || len(v) > max {
			return false
		}
		for _, x := range v {
			if !text(x) {
				return false
			}
		}
		return true
	}
	ids := map[string]bool{}
	for _, v := range n.Episodes {
		if !keyOK(v.ID) || ids[v.ID] || !text(v.Summary) || v.FromRevision < 1 || v.ToRevision < v.FromRevision || v.ToRevision > n.ThroughRevision || !refs(v.FactIDs) {
			return bad()
		}
		ids[v.ID] = true
		for _, id := range v.FactIDs {
			if facts[id].SourceRevision > v.ToRevision {
				return bad()
			}
		}
	}
	ids = map[string]bool{}
	for _, v := range n.Characters {
		// Empty voice means not observed. The shared contract bounds its length;
		// requiring speech evidence for silent/off-scene people would invent it.
		if !characters[v.EntityID] || ids[v.EntityID] || !texts(v.Goals, 4) || v.Relationships == nil || len(v.Relationships) > 8 || !refs(v.BeliefFactIDs) || v.UpdatedRevision < 1 || v.UpdatedRevision > n.ThroughRevision {
			return bad()
		}
		ids[v.EntityID] = true
		for _, id := range v.BeliefFactIDs {
			f := facts[id]
			if f.SubjectID != v.EntityID || (f.Kind != "belief" && f.Kind != "statement") {
				return bad()
			}
		}
		related := map[string]bool{}
		for _, r := range v.Relationships {
			if !entities[r.EntityID] || r.EntityID == v.EntityID || related[r.EntityID] || !text(r.Stance) || !refs(r.FactIDs) {
				return bad()
			}
			related[r.EntityID] = true
		}
	}
	ids = map[string]bool{}
	for _, v := range n.Arcs {
		thread, ok := threads[v.ThreadID]
		if !ok || ids[v.ThreadID] || v.Tension < 0 || v.Tension > 5 || !texts(v.NextBeats, 3) || !texts(v.PayoffConditions, 4) || !refs(v.FactIDs) || v.UpdatedRevision < 1 || v.UpdatedRevision > n.ThroughRevision {
			return bad()
		}
		ids[v.ThreadID] = true
		if v.Status != "open" && v.Status != "resolved" && v.Status != "abandoned" {
			return bad()
		}
		if (v.Status == "resolved") != (thread.ResolvedAtRevision != nil) {
			return bad()
		}
	}
	style := n.Style
	if !texts(style.Avoid, 8) || !texts(style.PreferenceRefs, 16) || (style.Pace != "slow" && style.Pace != "balanced" && style.Pace != "fast") || (style.Detail != "brief" && style.Detail != "balanced" && style.Detail != "rich") {
		return bad()
	}
	return nil
}

func applyNarrativeState(ctx Context, c Candidate, state *State) error {
	if ctx.Mode == "ask" {
		if c.NarrativeUpdate != nil {
			return fail("ask_mutation")
		}
		return nil
	}
	if c.NarrativeUpdate == nil {
		if ctx.Pipeline != nil && c.MemoryChanges == nil && c.MemoryDelta == nil {
			return fail("invalid_narrative_state")
		}
		return nil
	}
	if c.NarrativeUpdate.ThroughRevision != ctx.Revision+1 {
		return fail("invalid_narrative_state")
	}
	if err := validateNarrativeState(c.NarrativeUpdate, *state, ctx.Revision+1); err != nil {
		return err
	}
	raw, _ := json.Marshal(c.NarrativeUpdate)
	return json.Unmarshal(raw, &state.Narrative)
}
