package experience

import (
	"bytes"
	"context"
	"database/sql"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"errors"
)

// A page pins presentation identity and its local state. Formal world state is
// never read from this snapshot. The next page freezes its predecessor under
// the same branch lock used for the formal commit.
type ArtifactSnapshot struct {
	ArtifactID     string          `json:"artifact_id"`
	RevisionID     string          `json:"revision_id"`
	OriginBranchID string          `json:"origin_branch_id"`
	BaseRevision   int64           `json:"base_revision"`
	StateRevision  int64           `json:"state_revision"`
	State          json.RawMessage `json:"state"`
}

func captureArtifactSnapshot(ctx context.Context, q *pgq.Queries, a, e, b string, revision int64) (*ArtifactSnapshot, error) {
	if revision < 1 {
		return nil, nil
	}
	head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: b})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		row, err := q.ExperienceArtifactVersion(ctx, pgq.ExperienceArtifactVersionParams{AccountID: a, ExperienceID: e, BranchID: b, ArtifactID: head.ArtifactID, ID: head.RevisionID})
		if err != nil {
			return nil, err
		}
		if row.BaseRevision == revision {
			return &ArtifactSnapshot{head.ArtifactID, row.ID, b, revision, row.StateRevision, row.LocalState}, nil
		}
	}
	// Forks carry an immutable pin on their last copied page. For a historical
	// fork, the following source page contains the authoritative frozen pin.
	pages, err := q.ExperienceRawPageRange(ctx, pgq.ExperienceRawPageRangeParams{AccountID: a, ExperienceID: e, BranchID: b, FromRevision: revision, ToRevision: revision + 1})
	if err != nil {
		return nil, err
	}
	var inherited *ArtifactSnapshot
	for _, row := range pages {
		if row.Revision != revision && row.Revision != revision+1 {
			continue
		}
		var p Page
		if json.Unmarshal(row.Page, &p) != nil {
			return nil, fail("history_unavailable")
		}
		if p.Revision == revision {
			inherited = p.InteractionSnapshot
		}
		if p.Revision == revision+1 && p.PreviousArtifactSnapshot != nil {
			return p.PreviousArtifactSnapshot, nil
		}
	}
	return inherited, nil
}
func projectArtifactSnapshots(pages []Page) {
	for i := 1; i < len(pages); i++ {
		if snapshot := pages[i].PreviousArtifactSnapshot; snapshot != nil && snapshot.BaseRevision == pages[i-1].Revision {
			pages[i-1].InteractionSnapshot = snapshot
		}
	}
	// Storage metadata is not another display surface.
	for i := range pages {
		pages[i].PreviousArtifactSnapshot = nil
	}
}
func validSnapshotState(raw json.RawMessage) bool {
	var value any
	if len(raw) > 24000 || StrictJSON(raw, &value) != nil {
		return false
	}
	count := 0
	var visit func(any, int) bool
	visit = func(v any, depth int) bool {
		count++
		if depth > 8 || count > 500 {
			return false
		}
		switch x := v.(type) {
		case map[string]any:
			for k, c := range x {
				if k == "__proto__" || k == "prototype" || k == "constructor" || !visit(c, depth+1) {
					return false
				}
			}
		case []any:
			for _, c := range x {
				if !visit(c, depth+1) {
					return false
				}
			}
		}
		return true
	}
	if !visit(value, 0) {
		return false
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	if enc.Encode(value) != nil {
		return false
	}
	return utf16Length(out.String()) <= 6001
}
func validateArchiveSnapshots(e ArchiveExperience) error {
	branches := map[string]ArchiveBranch{}
	for _, b := range e.Branches {
		branches[b.ID] = b
	}
	for _, b := range e.Branches {
		for _, p := range b.Pages {
			for index, snapshot := range []*ArtifactSnapshot{p.Page.InteractionSnapshot, p.Page.PreviousArtifactSnapshot} {
				if snapshot == nil {
					continue
				}
				base := p.Page.Revision
				if index == 1 {
					base--
				}
				if base < 1 || snapshot.BaseRevision != base || !keyOK(snapshot.ArtifactID) || !keyOK(snapshot.RevisionID) || !keyOK(snapshot.OriginBranchID) || snapshot.StateRevision < 0 || !validSnapshotState(snapshot.State) {
					return fail("invalid_archive")
				}
				origin, ok := branches[snapshot.OriginBranchID]
				if !ok || origin.Artifacts == nil || origin.Artifacts.ArtifactID != snapshot.ArtifactID {
					return fail("invalid_archive")
				}
				found := false
				for _, version := range origin.Artifacts.Versions {
					if version.ID == snapshot.RevisionID && version.BaseRevision == base && snapshot.StateRevision <= version.StateRevision {
						found = true
					}
				}
				if !found {
					return fail("invalid_archive")
				}
				current := b
				seen := map[string]bool{}
				for current.ID != origin.ID {
					if seen[current.ID] || current.ParentBranchID == nil {
						return fail("invalid_archive")
					}
					seen[current.ID] = true
					limit := *current.ParentRevision
					if current.Changes != nil && (current.Changes.Polish != nil || current.Changes.Repair != nil) {
						limit++
					}
					if base > limit {
						return fail("invalid_archive")
					}
					var exists bool
					current, exists = branches[*current.ParentBranchID]
					if !exists {
						return fail("invalid_archive")
					}
				}
			}
		}
	}
	return nil
}
