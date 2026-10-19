package experience

import "encoding/json"

func decodeNarrativeCandidate(raw []byte, ctx Context) (Candidate, error) {
    if candidate, err := DecodeCandidate(raw); err == nil { return candidate, nil }
    var fields struct {
        Title string `json:"title"`
        Passage string `json:"passage"`
        StoryTime string `json:"story_time"`
    }
    if json.Unmarshal(raw, &fields) != nil || !textOK(fields.Passage) {
        return Candidate{}, fail("invalid_candidate")
    }
    candidate, _, err := applyNarrative(ctx, Candidate{Title:fields.Title, Passage:fields.Passage, StoryTime:fields.StoryTime})
    return candidate, err
}

// applyNarrative keeps actual model prose even when optional indexes cannot be
// applied. Invalid metadata is never granted authority or used to rewrite saves.
func applyNarrative(ctx Context, c Candidate) (Candidate, State, error) {
    state, err := Apply(ctx, c)
    if err == nil { return c, state, nil }
    if !textOK(c.Passage) { return c, State{}, err }
    c.GameplayUpdate = nil
    if state, err = Apply(ctx, c); err == nil { return c, state, nil }
    if !textOK(c.Title) { c.Title = "故事继续" }
    c.Outcome = "continues"
    suggestions := []string{}
    for _, s := range c.Suggestions { if textOK(s) { suggestions = append(suggestions, s) } }
    c.Suggestions = suggestions
    c.NewFacts = []Fact{}
    c.NewEntities = []Entity{}
    c.NewThreads = []Thread{}
    c.RevealFactIDs = []string{}
    c.RevealEntityIDs = []string{}
    c.RevealThreadIDs = []string{}
    c.ResolveThreadIDs = []string{}
    c.KnowledgeChanges = []KnowledgeChange{}
    c.StoryTime = ctx.State.StoryTime
    c.NarrativeOnly = true
    // The prior verified index remains intact; the new prose is saved verbatim
    // as history and remains available to subsequent generations.
    return c, ctx.State, nil
}
