package experience

import (
	"context"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// UnmarshalJSON reads the one removed field in legacy saved author worlds and
// keeps it only for pre-upgrade request digest comparison. Current DTOs and model
// attachments never serialize it; other unknown fields and malformed values fail.
func (n *WorldNarrative) UnmarshalJSON(raw []byte) error {
	type narrativeFields WorldNarrative
	var wire struct {
		narrativeFields
		LegacyStyle json.RawMessage `json:"style"`
	}
	if RequiredJSON(raw, "perspective", "length", "pace") != nil || StrictJSON(raw, &wire) != nil {
		return fail("invalid_json")
	}
	var legacy *string
	if wire.LegacyStyle != nil {
		if json.Unmarshal(wire.LegacyStyle, &legacy) != nil || legacy == nil || !utf8.ValidString(*legacy) || strings.ContainsRune(*legacy, 0) || utf16Length(*legacy) > 200 {
			return fail("invalid_json")
		}
	}
	*n = WorldNarrative(wire.narrativeFields)
	n.legacyStyle = legacy
	return nil
}

// ValidateAuthorWorldJSON requires the complete author DTO, never an arbitrary
// browser snapshot, credential blob, or partially decoded free-form object.
func ValidateAuthorWorldJSON(raw []byte) error {
	if len(raw) > 1<<20 || RequiredJSON(raw, "title", "description", "era", "rules", "characters", "identity", "location", "goal", "opening", "narrative") != nil {
		return fail("invalid_input")
	}
	var world WorldDraft
	if StrictJSON(raw, &world) != nil || validateAuthorWorld(world) != nil {
		return fail("invalid_input")
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	if RequiredJSON(fields["narrative"], "perspective", "length", "pace") != nil {
		return fail("invalid_input")
	}
	var characters []json.RawMessage
	_ = json.Unmarshal(fields["characters"], &characters)
	for _, character := range characters {
		if RequiredJSON(character, "name", "role", "public", "goal", "history", "secret") != nil {
			return fail("invalid_input")
		}
	}
	return nil
}
func branchAuthorWorld(ctx context.Context, q *pgq.Queries, a, e, b string) (*WorldDraft, error) {
	branches, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: a, ExperienceID: e})
	if err != nil {
		return nil, err
	}
	parents := map[string]string{}
	for _, row := range branches {
		parents[row.ID] = row.ParentBranchID.String
	}
	seen := map[string]bool{}
	for b != "" {
		if seen[b] {
			return nil, fail("history_unavailable")
		}
		seen[b] = true
		changes, err := branchChanges(ctx, q, a, e, b)
		if err != nil {
			return nil, err
		}
		if changes.AuthorWorld != nil || changes.WorldVersion != nil {
			return changes.AuthorWorld, nil
		}
		b = parents[b]
	}
	return nil, nil
}

// Saved author input follows the editor's UTF-16 limits; generated draft output
// has its own smaller byte/field budget and must not restrict edited worlds.
func validateAuthorWorld(w WorldDraft) error {
	if !textOK(w.Title) || !textOK(w.Identity) || !textOK(w.Location) || !textOK(w.Opening) || w.Rules == nil || w.Characters == nil || len(w.Rules) > 40 || len(w.Characters) > 30 {
		return fail("invalid_input")
	}
	type field struct {
		value string
		max   int
	}
	fields := []field{{w.Title, 100}, {w.Description, 4000}, {w.Era, 500}, {w.Identity, 500}, {w.Location, 500}, {w.Goal, 1000}, {w.Opening, 12000}}
	for _, r := range w.Rules {
		fields = append(fields, field{r, 2000})
	}
	for _, c := range w.Characters {
		if !textOK(c.Name) {
			return fail("invalid_input")
		}
		fields = append(fields, field{c.Name, 100}, field{c.Role, 200}, field{c.Public, 3000}, field{c.Goal, 500}, field{c.History, 1000}, field{c.Secret, 3000})
	}
	for _, f := range fields {
		if !utf8.ValidString(f.value) || strings.ContainsRune(f.value, 0) || utf16Length(f.value) > f.max {
			return fail("invalid_input")
		}
	}
	for _, enum := range []struct {
		value   string
		options []string
	}{{w.Narrative.Perspective, []string{"第一人称", "第二人称", "第三人称"}}, {w.Narrative.Length, []string{"简短", "适中", "舒展"}}, {w.Narrative.Pace, []string{"从容", "适中", "紧凑"}}} {
		found := false
		for _, v := range enum.options {
			if v == enum.value {
				found = true
			}
		}
		if !found {
			return fail("invalid_input")
		}
	}
	return nil
}
