package experience

import (
	"context"
	"encoding/json"

	"elselife/backend/internal/sqlc/pgq"
)

// ReadMaterials retrieves only the selected records from the operation's
// immutable database pin. It does not take an experience/branch/revision from
// the model. A selected interpretation is checked against its actual source
// page before it can be used. Stage dispatch records the resulting bundle.
func (r *sourceReader) ReadMaterials(ctx context.Context, actor string, factIDs, memoryIDs []string) (State, error) {
	out := EmptyState()
	if actor != "" && (!keyOK(actor) || len(memoryIDs) != 0) || len(factIDs) > 256 || len(memoryIDs) > 64 {
		return out, fail("recall_scope_mismatch")
	}
	o := r.operation
	err := r.service.transaction(ctx, func(q *pgq.Queries) error {
		if err := r.check(ctx, q); err != nil {
			return err
		}
		if r.generation.StateCoverage.Audience == "reader" {
			if actor != "" || len(memoryIDs) != 0 {
				return fail("recall_scope_mismatch")
			}
			// ReaderState also removes private known_by edges and records with
			// hidden entity references. Match only after that projection.
			visible, err := r.snapshot(ctx, q, o.BaseRevision)
			if err != nil {
				return err
			}
			selected := stringSet(factIDs)
			for _, fact := range visible.Facts {
				if selected[fact.ID] {
					out.Facts = append(out.Facts, fact)
				}
			}
			return r.check(ctx, q)
		}
		if len(factIDs) > 0 {
			rows, err := q.ExperienceMaterialFacts(ctx, pgq.ExperienceMaterialFactsParams{
				AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID,
				Revision: o.BaseRevision, FactIds: factIDs, ActorID: actor,
			})
			if err != nil {
				return err
			}
			for _, raw := range rows {
				var fact Fact
				if json.Unmarshal(raw, &fact) != nil || fact.SourceRevision > o.BaseRevision {
					return fail("recall_revision_unavailable")
				}
				out.Facts = append(out.Facts, fact)
			}
		}
		if len(memoryIDs) > 0 {
			rows, err := q.ExperienceMaterialMemories(ctx, pgq.ExperienceMaterialMemoriesParams{
				AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID,
				Revision: o.BaseRevision, MemoryIds: memoryIDs,
			})
			if err != nil {
				return err
			}
			out.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{}}
			revisions := []int64{}
			seen := map[int64]bool{}
			factSnapshots := map[int64]bool{}
			memoryVersion := 0
			for _, raw := range rows {
				var memory MemoryEntry
				if json.Unmarshal(raw, &memory) != nil || latestMemoryRevision(memory) < 1 ||
					latestMemoryRevision(memory) > o.BaseRevision || memory.UpdatedRevision > o.BaseRevision {
					return fail("recall_revision_unavailable")
				}
				version := 1
				if memory.EvidenceKind != "" {
					version = 2
				}
				if memoryVersion != 0 && memoryVersion != version {
					return fail("recall_revision_unavailable")
				}
				memoryVersion = version
				out.LiteraryMemory.Version = version
				out.LiteraryMemory.Entries = append(out.LiteraryMemory.Entries, memory)
				trail, err := memoryEntryDependencies(memory)
				if err != nil {
					return fail("recall_revision_unavailable")
				}
				for _, source := range trail {
					revision := source.Revision
					if source.Kind == "authority_fact" {
						revision = source.AsOfRevision
						factSnapshots[revision] = true
					}
					if revision < 1 || revision > o.BaseRevision {
						return fail("recall_revision_unavailable")
					}
					if !seen[revision] {
						revisions = append(revisions, revision)
						seen[revision] = true
					}
				}
			}
			if len(revisions) > 0 {
				pages, err := q.ExperienceMaterialSourcePages(ctx, pgq.ExperienceMaterialSourcePagesParams{
					AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revisions: revisions,
				})
				if err != nil {
					return err
				}
				// These full pages/snapshots validate durable identities only.
				// They are never installed in ReadReply, its audit, or a
				// same-operation model-visible evidence cache.
				sources := map[int64]ArchivePage{}
				for _, raw := range pages {
					var page Page
					if json.Unmarshal(raw.Page, &page) != nil || page.Revision != raw.Revision {
						return fail("recall_revision_unavailable")
					}
					if _, duplicate := sources[page.Revision]; duplicate {
						return fail("recall_revision_unavailable")
					}
					source := ArchivePage{Page: page}
					if factSnapshots[page.Revision] {
						source.State, err = r.snapshot(ctx, q, page.Revision)
						if err != nil {
							return err
						}
					}
					sources[page.Revision] = source
				}
				if err := validateMemorySourcesAt(out.LiteraryMemory, sources); err != nil {
					return fail("recall_revision_unavailable")
				}
			}
		}
		return r.check(ctx, q)
	})
	return out, err
}
