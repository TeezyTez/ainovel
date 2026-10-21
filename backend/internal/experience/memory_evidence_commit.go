package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"sort"

	"elselife/backend/internal/sqlc/pgq"
)

func verifyPreparationMemoryOrigin(p pgq.ExperienceNarrativePreparation, c Candidate) error {
	if c.MemoryDelta == nil {
		return nil
	}
	if err := verifyNarrativeApproval(c, c.Review); err != nil {
		return err
	}
	origin := c.Review.Evidence.Origin
	if origin.Kind != "preparation" || origin.ID != p.ID || origin.ExperienceID != p.ExperienceID ||
		origin.BranchID != p.BranchID || origin.BaseRevision != p.BaseRevision ||
		origin.BaseFence != p.BaseFence || origin.Pin != p.Pin {
		return fail("narrative_memory_origin_invalid")
	}
	return nil
}

// The current operation lock/fence/lease is checked by commit before this
// method. A preparation keeps its original identity across the unique SQL
// claim; this method does not rewrite or reissue that approval.
func (s *Service) verifyMemoryCommit(ctx context.Context, q *pgq.Queries, o pgq.ExperienceOperation,
	branch pgq.ExperienceBranch, c Candidate, state State) error {
	if c.MemoryDelta == nil {
		return nil
	}
	var base State
	if StrictJSON(branch.State, &base) != nil {
		return fail("invalid_literary_memory")
	}
	authority := Context{ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: o.BaseRevision,
		Mode: o.Mode, Input: o.Input, ReadingRequest: o.ReadingRequest, State: base}
	if _, err := verifyMemoryDeltaApproval(authority, c); err != nil {
		return err
	}
	origin := c.Review.Evidence.Origin
	switch origin.Kind {
	case "operation":
		var generation Context
		if StrictJSON(o.Context, &generation) != nil {
			return fail("narrative_memory_origin_invalid")
		}
		expected := newSourceReader(s, o, generation).memoryOrigin()
		if !reflect.DeepEqual(expected, origin) {
			return fail("narrative_memory_origin_invalid")
		}
	case "preparation":
		p, err := q.ExperiencePreparationClaimed(ctx, pgq.ExperiencePreparationClaimedParams{
			AccountID: o.AccountID, ClaimedRequestID: ns(o.RequestID),
		})
		if err != nil {
			return fail("narrative_memory_origin_invalid")
		}
		if p.Status != "claimed" || p.ClaimedRequestID.String != o.RequestID {
			return fail("narrative_memory_origin_invalid")
		}
		if err = s.checkPreparationClaim(ctx, q, p, branch); err != nil {
			return err
		}
		pin, err := s.preparationPin(ctx, q, o.AccountID, o.ExperienceID, o.BranchID, branch.State)
		if err != nil {
			return err
		}
		if pin != p.Pin {
			return fail("preparation_conflict")
		}
		if err = verifyPreparationMemoryOrigin(p, c); err != nil {
			return err
		}
		// Stored approval is the trusted handoff, not merely the same candidate.
		stored, err := canonicalRawJSON(p.Approval)
		proposed, proposedErr := canonicalRawJSON(narrativeMarshal(c.Review))
		storedCandidate, candidateErr := canonicalRawJSON(p.Candidate)
		actualCandidate, actualErr := canonicalCandidate(c)
		if err != nil || proposedErr != nil || candidateErr != nil || actualErr != nil ||
			!bytes.Equal(stored, proposed) || !bytes.Equal(storedCandidate, actualCandidate) {
			return fail("narrative_memory_origin_invalid")
		}
	default:
		return fail("narrative_memory_origin_invalid")
	}
	// Rebuild only this derived index under the commit lock. Other state
	// transitions retain their existing authority/apply checks.
	expected := state
	expected.LiteraryMemory = base.LiteraryMemory
	if err := applyLiteraryMemoryV2(authority, c, &expected); err != nil {
		return err
	}
	if !bytes.Equal(narrativeMarshal(expected.LiteraryMemory), narrativeMarshal(state.LiteraryMemory)) {
		return fail("invalid_literary_memory")
	}
	changed := &LiteraryMemory{Version: 2, Entries: []MemoryEntry{}, IndexedThroughRevision: state.LiteraryMemory.IndexedThroughRevision}
	ids := map[string]bool{}
	for _, entry := range c.MemoryDelta.Entries {
		ids[entry.ID] = true
	}
	for _, entry := range state.LiteraryMemory.Entries {
		if ids[entry.ID] {
			changed.Entries = append(changed.Entries, entry)
		}
	}
	if len(changed.Entries) != len(ids) {
		return fail("invalid_literary_memory")
	}
	revisions := map[int64]bool{}
	factSnapshots := map[int64]bool{}
	for _, entry := range changed.Entries {
		refs, err := memoryEntryDependencies(entry)
		if err != nil {
			return err
		}
		for _, ref := range refs {
			revision := ref.Revision
			if ref.Kind == "authority_fact" {
				revision = ref.AsOfRevision
				factSnapshots[revision] = true
			}
			if revision != o.BaseRevision+1 {
				revisions[revision] = true
			}
		}
	}
	wanted := make([]int64, 0, len(revisions))
	for revision := range revisions {
		if revision < 1 || revision > o.BaseRevision {
			return fail("invalid_literary_memory")
		}
		wanted = append(wanted, revision)
	}
	sort.Slice(wanted, func(i, j int) bool { return wanted[i] < wanted[j] })
	sources := map[int64]ArchivePage{o.BaseRevision + 1: {
		Page:  Page{HistoryPage: HistoryPage{Revision: o.BaseRevision + 1, Mode: o.Mode, Input: o.Input, Text: c.Passage}},
		State: state,
	}}
	if len(wanted) > 0 {
		rows, err := q.ExperienceMaterialSourcePages(ctx, pgq.ExperienceMaterialSourcePagesParams{
			AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revisions: wanted,
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			var page Page
			if StrictJSON(row.Page, &page) != nil || page.Revision != row.Revision {
				return fail("invalid_literary_memory")
			}
			value := ArchivePage{Page: page}
			if factSnapshots[row.Revision] {
				raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{
					AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: row.Revision,
				})
				if err != nil {
					return err
				}
				if json.Unmarshal(raw, &value.State) != nil {
					return fail("invalid_literary_memory")
				}
			}
			sources[row.Revision] = value
		}
	}
	return validateMemorySourcesAt(changed, sources)
}
