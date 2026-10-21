package experience

import "encoding/json"

// Legacy request digests are comparison-only. New operations and all ordinary
// serialization use the current DTO, which has no style setting. Explicit
// struct order recreates the old Go JSON bytes, including normal JSON escaping.
func legacyAuthorWorldJSON(world *WorldDraft) json.RawMessage {
	if world == nil || world.Narrative.legacyStyle == nil {
		return nil
	}
	type legacyNarrative struct {
		Perspective string `json:"perspective"`
		Length      string `json:"length"`
		Style       string `json:"style"`
		Pace        string `json:"pace"`
	}
	raw, _ := json.Marshal(struct {
		WorldDraft
		Narrative legacyNarrative `json:"narrative"`
	}{*world, legacyNarrative{world.Narrative.Perspective, world.Narrative.Length, *world.Narrative.legacyStyle, world.Narrative.Pace}})
	return raw
}

func (r CreateRequest) legacyDigest() string {
	world := legacyAuthorWorldJSON(r.AuthorWorld)
	if world == nil {
		return ""
	}
	return digest("create", "", struct {
		AuthorWorld json.RawMessage `json:"author_world,omitempty"`
		CreateRequest
	}{world, r})
}

func (r ForkRequest) legacyDigest(experienceID string) string {
	world := legacyAuthorWorldJSON(r.AuthorWorld)
	if world == nil {
		return ""
	}
	return digest("fork", experienceID, struct {
		AuthorWorld json.RawMessage `json:"author_world,omitempty"`
		ForkRequest
	}{world, r})
}

func requestDigestMatches(stored, current, legacy string) bool {
	return stored == current || (legacy != "" && stored == legacy)
}
