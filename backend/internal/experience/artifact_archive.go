package experience

import (
	"context"
	"database/sql"
	"elselife/backend/internal/sqlc/pgq"
	"encoding/json"
	"errors"
	"reflect"
	"time"
)

type ArchiveArtifacts struct {
	ArtifactID string                   `json:"artifact_id"`
	Head       string                   `json:"head"`
	Versions   []ArchiveArtifactVersion `json:"versions"`
}
type ArchiveArtifactVersion struct {
	ID            string          `json:"id"`
	BaseRevision  int64           `json:"base_revision"`
	StateRevision int64           `json:"state_revision"`
	Payload       json.RawMessage `json:"payload"`
	State         json.RawMessage `json:"state"`
	CreatedAt     time.Time       `json:"created_at"`
}

func exportArtifacts(ctx context.Context, q *pgq.Queries, a, e, b string) (*ArchiveArtifacts, error) {
	head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: b})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.ExperienceArtifactVersions(ctx, pgq.ExperienceArtifactVersionsParams{AccountID: a, ExperienceID: e, BranchID: b})
	if err != nil {
		return nil, err
	}
	out := &ArchiveArtifacts{ArtifactID: head.ArtifactID, Head: head.RevisionID, Versions: []ArchiveArtifactVersion{}}
	for _, row := range rows {
		out.Versions = append(out.Versions, ArchiveArtifactVersion{row.ID, row.BaseRevision, row.StateRevision, row.Payload, row.LocalState, row.CreatedAt})
	}
	return out, nil
}
func validateArchiveArtifactShape(b ArchiveBranch) error {
	a := b.Artifacts
	if a == nil {
		return nil
	}
	bad := func() error { return fail("invalid_archive") }
	if !keyOK(a.ArtifactID) || !keyOK(a.Head) || len(a.Versions) < 1 || len(a.Versions) > 64 {
		return bad()
	}
	seen := map[string]bool{}
	for _, v := range a.Versions {
		if !keyOK(v.ID) || seen[v.ID] || v.BaseRevision < 1 || v.BaseRevision > b.Revision || v.StateRevision < 0 || !archiveTime(v.CreatedAt) || len(v.Payload) > 2<<20 || len(v.State) > 24000 || !json.Valid(v.Payload) || !json.Valid(v.State) {
			return bad()
		}
		seen[v.ID] = true
	}
	if !seen[a.Head] {
		return bad()
	}
	return nil
}
func (s *Service) validateArchiveArtifacts(ctx context.Context, archive *Archive) error {
	count := 0
	for ei := range archive.Experiences {
		e := &archive.Experiences[ei]
		for bi := range e.Branches {
			b := &e.Branches[bi]
			if b.Artifacts == nil {
				continue
			}
			for vi := range b.Artifacts.Versions {
				count++
				if count > 256 {
					return fail("archive_too_large")
				}
				v := &b.Artifacts.Versions[vi]
				snapshot := b.Pages[v.BaseRevision-1].State
				view := View{Gameplay: snapshot.Gameplay, ID: e.ID, BranchID: b.ID, Revision: v.BaseRevision, Information: Project(snapshot), Reader: ProjectReader(snapshot, v.BaseRevision), Pages: []Page{}}
				for _, p := range b.Pages[:v.BaseRevision] {
					view.Pages = append(view.Pages, p.Page)
				}
				var old map[string]any
				if StrictJSON(v.Payload, &old) != nil {
					return fail("invalid_archive")
				}
				definition, _ := old["definition"].(map[string]any)
				presentation := 1
				if definition != nil {
					n, ok := definition["revision"].(float64)
					if !ok || n < 1 || n > 64 || n != float64(int(n)) {
						return fail("invalid_archive")
					}
					presentation = int(n)
				}
				public := artifactPublicContext(view, presentation)
				if capabilities, ok := old["capabilities"].(map[string]any); ok {
					public["deterministic"] = capabilities["deterministic"]
				}
				regenerated, err := s.Artifacts.run(ctx, map[string]any{"op": "validate", "value": map[string]any{"definition": old["definition"], "game": old["sourceGame"], "reason": old["reason"]}, "context": public, "allowScripts": true})
				if err != nil {
					return fail("invalid_archive")
				}
				var expected map[string]any
				if StrictJSON(regenerated, &expected) != nil {
					return fail("invalid_archive")
				}
				delete(old, "bundles")
				intent, hasIntent := old["prepareIntent"]
				delete(old, "prepareIntent")
				if hasIntent {
					v, ok := intent.(string)
					if !ok || len(v) > 6000 {
						return fail("invalid_archive")
					}
				}
				if !reflect.DeepEqual(old, expected) {
					return fail("invalid_archive")
				}
				if hasIntent {
					expected["prepareIntent"] = intent
					regenerated, _ = json.Marshal(expected)
				}
				// Rebuild every React bundle; an archive is data, never a trusted compiler.
				v.Payload, err = s.Artifacts.compilePayload(ctx, regenerated)
				if err != nil {
					return err
				}
				var state any
				if StrictJSON(v.State, &state) != nil {
					return fail("invalid_archive")
				}
				v.State, err = s.Artifacts.run(ctx, map[string]any{"op": "state", "value": state})
				if err != nil {
					return fail("invalid_archive")
				}
			}
		}
	}
	return nil
}
func importArtifacts(ctx context.Context, q *pgq.Queries, a, e string, b ArchiveBranch) error {
	if b.Artifacts == nil {
		return nil
	}
	attachment := b.Artifacts
	for _, v := range attachment.Versions {
		if err := q.ExperienceArtifactInsert(ctx, pgq.ExperienceArtifactInsertParams{AccountID: a, ExperienceID: e, BranchID: b.ID, ArtifactID: attachment.ArtifactID, ID: v.ID, BaseRevision: v.BaseRevision, StateRevision: v.StateRevision, Payload: v.Payload, LocalState: v.State, CreatedAt: v.CreatedAt}); err != nil {
			return err
		}
	}
	return q.ExperienceArtifactSetHead(ctx, pgq.ExperienceArtifactSetHeadParams{AccountID: a, ExperienceID: e, BranchID: b.ID, ArtifactID: attachment.ArtifactID, RevisionID: attachment.Head})
}
