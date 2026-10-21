package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"time"
	"unicode/utf8"

	"elselife/backend/internal/sqlc/pgq"
)

const MaxArchiveBytes = 32 << 20
const archiveFormat = "elselife-experience-archive"
const maxArchivePages = 100000

type Archive struct {
	Format      string              `json:"format"`
	Version     int                 `json:"version"`
	Experiences []ArchiveExperience `json:"experiences"`
}
type ArchiveExperience struct {
	ID             string          `json:"id"`
	Seed           string          `json:"seed"`
	ActiveBranchID string          `json:"active_branch_id"`
	CreatedAt      time.Time       `json:"created_at"`
	Branches       []ArchiveBranch `json:"branches"`
}
type ArchiveBranch struct {
	Artifacts      *ArchiveArtifacts `json:"artifacts,omitempty"`
	Changes        *BranchChanges    `json:"changes,omitempty"`
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Title          string            `json:"title"`
	Revision       int64             `json:"revision"`
	ParentBranchID *string           `json:"parent_branch_id"`
	ParentRevision *int64            `json:"parent_revision"`
	State          State             `json:"state"`
	CreatedAt      time.Time         `json:"created_at"`
	Pages          []ArchivePage     `json:"pages"`
}
type ArchivePage struct {
	Page      Page      `json:"page"`
	State     State     `json:"state"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
}
type ArchiveImportResult struct {
	Imported []string `json:"imported"`
	Skipped  []string `json:"skipped"`
}

// ExportArchive uses one MVCC snapshot: concurrent generation cannot mix an old
// branch revision with a new page. This explicit backup includes hidden state;
// ordinary reader projections continue to exclude it.
func (s *Service) ExportArchive(ctx context.Context, account string) (Archive, error) {
	out := Archive{Format: archiveFormat, Version: 1, Experiences: []ArchiveExperience{}}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	q := pgq.New(tx)
	rows, err := q.ExperienceArchiveList(ctx, account)
	if err != nil {
		return out, err
	}
	if len(rows) > 1000 {
		return out, fail("archive_too_large")
	}
	totalPages := 0
	for _, row := range rows {
		e := ArchiveExperience{ID: row.ID, Seed: row.Seed, ActiveBranchID: row.ActiveBranchID, CreatedAt: row.CreatedAt, Branches: []ArchiveBranch{}}
		branches, err := q.ExperienceArchiveBranches(ctx, pgq.ExperienceArchiveBranchesParams{AccountID: account, ExperienceID: row.ID})
		if err != nil {
			return out, err
		}
		if len(branches) > 512 {
			return out, fail("archive_too_large")
		}
		for _, branch := range branches {
			b := ArchiveBranch{ID: branch.ID, Name: branch.Name, Title: branch.Title, Revision: branch.Revision, CreatedAt: branch.CreatedAt, Pages: []ArchivePage{}}
			changes, err := branchChanges(ctx, q, account, row.ID, branch.ID)
			if err != nil {
				return out, err
			}
			if changes.count() > 0 {
				b.Changes = &changes
			}
			if branch.ParentBranchID.Valid {
				v := branch.ParentBranchID.String
				b.ParentBranchID = &v
			}
			if branch.ParentRevision.Valid {
				v := branch.ParentRevision.Int64
				b.ParentRevision = &v
			}
			if err = StrictJSON(branch.State, &b.State); err != nil {
				return out, fail("history_unavailable")
			}
			if b.State.LiteraryMemory != nil && b.State.LiteraryMemory.Version == 2 {
				out.Version = 2
			}
			pages, err := q.ExperienceArchivePages(ctx, pgq.ExperienceArchivePagesParams{AccountID: account, ExperienceID: row.ID, BranchID: branch.ID})
			if err != nil {
				return out, err
			}
			totalPages += len(pages)
			if totalPages > maxArchivePages {
				return out, fail("archive_too_large")
			}
			for _, page := range pages {
				p := ArchivePage{Title: page.Title, CreatedAt: page.CreatedAt}
				if StrictJSON(page.Page, &p.Page) != nil || StrictJSON(page.State, &p.State) != nil {
					return out, fail("history_unavailable")
				}
				if p.Page.Revision != page.Revision {
					return out, fail("history_unavailable")
				}
				if p.State.LiteraryMemory != nil && p.State.LiteraryMemory.Version == 2 {
					out.Version = 2
				}
				p.Page.Reader = ProjectReader(p.State, p.Page.Revision)
				b.Pages = append(b.Pages, p)
			}
			b.Artifacts, err = exportArtifacts(ctx, q, account, row.ID, branch.ID)
			if err != nil {
				return out, err
			}
			e.Branches = append(e.Branches, b)
		}
		out.Experiences = append(out.Experiences, e)
		raw, err := json.Marshal(out)
		if err != nil {
			return out, err
		}
		if len(raw) > MaxArchiveBytes {
			return out, fail("archive_too_large")
		}
	}
	if err = validateArchive(out); err != nil {
		return out, fail("history_unavailable")
	}
	return out, tx.Commit()
}

// DecodeArchive validates before any transaction is opened. Pending operations,
// model credentials, identities, and inferred account IDs are not archive fields.
func DecodeArchive(raw []byte) (Archive, error) {
	var archive Archive
	if len(raw) > MaxArchiveBytes {
		return archive, fail("archive_too_large")
	}
	if StrictJSON(raw, &archive) != nil || !archiveFieldsPresent(raw) {
		return archive, fail("invalid_archive")
	}
	if err := validateArchive(archive); err != nil {
		return archive, err
	}
	return archive, nil
}

// ImportArchive retains IDs for retry safety. Each new experience is restored
// atomically, and a conflicting existing ID is always preserved, never replaced.
func (s *Service) ImportArchive(ctx context.Context, account string, archive Archive) (ArchiveImportResult, error) {
	result := ArchiveImportResult{Imported: []string{}, Skipped: []string{}}
	raw, err := json.Marshal(archive)
	if err != nil {
		return result, fail("invalid_archive")
	}
	if len(raw) > MaxArchiveBytes {
		return result, fail("archive_too_large")
	}
	if err = validateArchive(archive); err != nil {
		return result, err
	}
	if err = s.validateArchiveGameplay(ctx, archive); err != nil {
		return result, err
	}
	if err = s.validateArchiveArtifacts(ctx, &archive); err != nil {
		return result, err
	}
	for _, e := range archive.Experiences {
		imported := false
		err = s.transaction(ctx, func(q *pgq.Queries) error {
			count, err := q.ExperienceArchiveCreate(ctx, pgq.ExperienceArchiveCreateParams{AccountID: account, ID: e.ID, Seed: e.Seed, ActiveBranchID: e.ActiveBranchID, CreatedAt: e.CreatedAt})
			if err != nil {
				return err
			}
			if count == 0 {
				return nil
			}
			for _, b := range e.Branches {
				var parent sql.NullString
				var revision sql.NullInt64
				if b.ParentBranchID != nil {
					parent = ns(*b.ParentBranchID)
					revision = sql.NullInt64{Int64: *b.ParentRevision, Valid: true}
				}
				state, _ := json.Marshal(b.State)
				if err = q.ExperienceArchiveBranchCreate(ctx, pgq.ExperienceArchiveBranchCreateParams{AccountID: account, ExperienceID: e.ID, ID: b.ID, Name: b.Name, Title: b.Title, Revision: b.Revision, ParentBranchID: parent, ParentRevision: revision, State: state, CreatedAt: b.CreatedAt}); err != nil {
					return err
				}
				if b.Changes != nil {
					changeRaw, _ := json.Marshal(b.Changes)
					if err = q.ExperienceForkCreate(ctx, pgq.ExperienceForkCreateParams{AccountID: account, RequestID: newID("import-fork_"), ExperienceID: e.ID, BranchID: b.ID, Digest: digest("import-changes", b.ID, b.Changes), Edit: changeRaw}); err != nil {
						return err
					}
				}
				if err = importArtifacts(ctx, q, account, e.ID, b); err != nil {
					return err
				}
				for _, p := range b.Pages {
					p.Page.Reader = ProjectReader(p.State, p.Page.Revision)
					page, _ := json.Marshal(p.Page)
					state, _ := json.Marshal(p.State)
					if err = q.ExperienceArchivePageCreate(ctx, pgq.ExperienceArchivePageCreateParams{AccountID: account, ExperienceID: e.ID, BranchID: b.ID, Revision: p.Page.Revision, Page: page, State: state, Title: p.Title, CreatedAt: p.CreatedAt}); err != nil {
						return err
					}
				}
			}
			imported = true
			return nil
		})
		if err != nil {
			return result, err
		}
		if imported {
			result.Imported = append(result.Imported, e.ID)
		} else {
			result.Skipped = append(result.Skipped, e.ID)
		}
	}
	return result, nil
}

// DeleteExperience takes the same branch locks as commit/fork/advance. Repeat the
// lock scan to include a branch that a previously blocked fork just committed.
// Once the set is stable, all branch creators are blocked on one of these locks.
func (s *Service) DeleteExperience(ctx context.Context, account, id string) error {
	if !keyOK(id) {
		return fail("invalid_input")
	}
	return s.transaction(ctx, func(q *pgq.Queries) error {
		if _, err := q.ExperienceGet(ctx, pgq.ExperienceGetParams{AccountID: account, ID: id}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		previous := -1
		for {
			branches, err := q.ExperienceDeleteLockBranches(ctx, pgq.ExperienceDeleteLockBranchesParams{AccountID: account, ExperienceID: id})
			if err != nil {
				return err
			}
			if previous == len(branches) {
				break
			}
			previous = len(branches)
		}
		if err := q.ExperienceDeleteForks(ctx, pgq.ExperienceDeleteForksParams{AccountID: account, ExperienceID: id}); err != nil {
			return err
		}
		if err := q.ExperienceDeleteOperations(ctx, pgq.ExperienceDeleteOperationsParams{AccountID: account, ExperienceID: id}); err != nil {
			return err
		}
		if err := q.ExperienceDeletePages(ctx, pgq.ExperienceDeletePagesParams{AccountID: account, ExperienceID: id}); err != nil {
			return err
		}
		if err := q.ExperienceDeleteBranches(ctx, pgq.ExperienceDeleteBranchesParams{AccountID: account, ExperienceID: id}); err != nil {
			return err
		}
		return q.ExperienceDelete(ctx, pgq.ExperienceDeleteParams{AccountID: account, ID: id})
	})
}

func archiveTime(t time.Time) bool { return !t.IsZero() && t.Year() >= 1 && t.Year() <= 9999 }
func archiveText(s string) bool    { return textOK(s) && len(s) <= MaxArchiveBytes }
func validateArchive(a Archive) error {
	bad := func() error { return fail("invalid_archive") }
	if a.Format != archiveFormat || (a.Version != 1 && a.Version != 2) || a.Experiences == nil || len(a.Experiences) > 1000 {
		return bad()
	}
	ids := map[string]bool{}
	total := 0
	for _, e := range a.Experiences {
		if !keyOK(e.ID) || ids[e.ID] || !textOK(e.Seed) || len(e.Seed) > 32<<10 || !keyOK(e.ActiveBranchID) || !archiveTime(e.CreatedAt) || len(e.Branches) == 0 || len(e.Branches) > 512 {
			return bad()
		}
		ids[e.ID] = true
		branches := map[string]ArchiveBranch{}
		for _, b := range e.Branches {
			if a.Version == 1 && b.State.LiteraryMemory != nil && b.State.LiteraryMemory.Version == 2 {
				return bad()
			}
			if !keyOK(b.ID) || !archiveText(b.Name) || len(b.Name) > 512 || !archiveText(b.Title) || !archiveTime(b.CreatedAt) || b.Revision < 0 || b.Revision > maxArchivePages || b.Pages == nil || int64(len(b.Pages)) != b.Revision {
				return bad()
			}
			if _, ok := branches[b.ID]; ok {
				return bad()
			}
			if validateArchiveArtifactShape(b) != nil {
				return bad()
			}
			branches[b.ID] = b
			if (b.ParentBranchID == nil) != (b.ParentRevision == nil) {
				return bad()
			}
			if validateArchiveState(b.State, b.Revision) != nil {
				return bad()
			}
			if validateMemorySources(b.State.LiteraryMemory, b.Pages) != nil {
				return bad()
			}
			total += len(b.Pages)
			if total > maxArchivePages {
				return bad()
			}
			for i, p := range b.Pages {
				if a.Version == 1 && p.State.LiteraryMemory != nil && p.State.LiteraryMemory.Version == 2 {
					return bad()
				}
				if p.Page.Revision != int64(i+1) || !archiveText(p.Title) || !archiveText(p.Page.Text) || !utf8.ValidString(p.Page.Input) || len(p.Page.Input) > 32<<10 || !archiveTime(p.CreatedAt) || !archiveTime(p.Page.CreatedAt) || p.Page.Suggestions == nil || p.Page.StoryTime != p.State.StoryTime {
					return bad()
				}
				switch p.Page.Mode {
				case "begin":
					if i != 0 {
						return bad()
					}
				case "act", "read", "ask":
				default:
					return bad()
				}
				switch p.Page.Outcome {
				case "continues", "awaits_player", "ending":
				default:
					return bad()
				}
				for _, v := range p.Page.Suggestions {
					if !archiveText(v) {
						return bad()
					}
				}
				if validateArchiveState(p.State, p.Page.Revision) != nil {
					return bad()
				}
				if validateMemorySources(p.State.LiteraryMemory, b.Pages[:i+1]) != nil {
					return bad()
				}
				if p.Page.Mode == "ask" && i > 0 && (b.ParentRevision == nil || *b.ParentRevision != p.Page.Revision) && !reflect.DeepEqual(p.State, b.Pages[i-1].State) {
					return bad()
				}
			}
			if len(b.Pages) > 0 {
				last := b.Pages[len(b.Pages)-1]
				if !reflect.DeepEqual(last.State, b.State) || last.Title != b.Title {
					return bad()
				}
			}
		}
		if validateArchiveSnapshots(e) != nil {
			return bad()
		}
		if _, ok := branches[e.ActiveBranchID]; !ok {
			return bad()
		}
		for _, b := range e.Branches {
			seen := map[string]bool{b.ID: true}
			current := b
			for current.ParentBranchID != nil {
				parent, ok := branches[*current.ParentBranchID]
				if !ok || seen[parent.ID] || *current.ParentRevision < 0 || *current.ParentRevision > parent.Revision || *current.ParentRevision > current.Revision {
					return bad()
				}
				seen[parent.ID] = true
				current = parent
			}
			if b.Changes != nil {
				if (b.ParentBranchID == nil && (b.Changes.Polish != nil || b.Changes.Repair != nil)) || b.Changes.count() != 1 || b.Changes.validate() != nil {
					return bad()
				}
				var parent ArchiveBranch
				if b.ParentBranchID != nil {
					parent = branches[*b.ParentBranchID]
				}
				if b.Changes.Polish != nil || b.Changes.Repair != nil {
					at := *b.ParentRevision
					if at >= int64(len(parent.Pages)) || at >= int64(len(b.Pages)) {
						return bad()
					}
					original, changed := parent.Pages[at], b.Pages[at]
					if b.Changes.Polish != nil {
						oldPage, newPage := original.Page, changed.Page
						oldPage.Reader, newPage.Reader = nil, nil
						oldPage.InteractionSnapshot, newPage.InteractionSnapshot = nil, nil
						oldPage.Text = b.Changes.Polish.Text
						expectedState := original.State
						invalidateLiteraryForEdit(&expectedState, at+1, false)
						stateMatches := reflect.DeepEqual(expectedState, changed.State)
						// Older exports predate sourced literary memory and retained
						// their notebook on polish. Accept those historical bytes;
						// sourced indexes must follow current invalidation semantics.
						if original.State.LiteraryMemory == nil && changed.State.LiteraryMemory == nil {
							stateMatches = stateMatches || reflect.DeepEqual(original.State, changed.State)
						}
						if !reflect.DeepEqual(oldPage, newPage) || !stateMatches || original.Title != changed.Title {
							return bad()
						}
					} else {
						state := EmptyState()
						if at > 0 {
							state = b.Pages[at-1].State
						}
						authority := Context{Revision: at, Mode: changed.Page.Mode, State: state}
						candidate := b.Changes.Repair.Candidate
						// DecodeArchive performs pure structural/fact validation. ImportArchive
						// separately replays the complete gameplay candidate with the fixed worker.
						authority.State.Gameplay = nil
						candidate.GameplayUpdate = nil
						expected := changed.State
						expected.Gameplay = nil
						applied, err := Apply(authority, candidate)
						if changed.Page.GameplayReceipt != nil || err != nil || !reflect.DeepEqual(applied, expected) || changed.Page.Text != candidate.Passage || changed.Title != candidate.Title || changed.Page.StoryTime != candidate.StoryTime || changed.Page.Outcome != candidate.Outcome || !reflect.DeepEqual(changed.Page.Suggestions, candidate.Suggestions) {
							return bad()
						}
					}
				}
			}
			if b.ParentBranchID != nil {
				parent := branches[*b.ParentBranchID]
				for i := int64(0); i < *b.ParentRevision; i++ {
					childPage, parentPage := b.Pages[i].Page, parent.Pages[i].Page
					childPage.Reader, parentPage.Reader = nil, nil
					childPage.InteractionSnapshot, parentPage.InteractionSnapshot = nil, nil
					if !reflect.DeepEqual(childPage, parentPage) {
						return bad()
					}
				}
			}
		}
	}
	return nil
}

func validateArchiveState(state State, revision int64) error {
	bad := func() error { return fail("invalid_archive") }
	if validateNarrativeState(state.Narrative, state, revision) != nil {
		return bad()
	}
	if validateLiteraryMemoryState(state.LiteraryMemory, state, revision) != nil {
		return bad()
	}
	if state.Facts == nil || state.Entities == nil || state.Threads == nil || !utf8.ValidString(state.StoryTime) {
		return bad()
	}
	if revision == 0 && (len(state.Facts)+len(state.Entities)+len(state.Threads) > 0 || state.StoryTime != "") {
		return bad()
	}
	ids := map[string]bool{}
	entities := map[string]bool{}
	facts := map[string]bool{}
	add := func(id string) bool {
		if !keyOK(id) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for _, e := range state.Entities {
		if !add(e.ID) || !archiveText(e.Name) || !utf8.ValidString(e.Kind) || !utf8.ValidString(e.Description) || e.RelatedIDs == nil {
			return bad()
		}
		entities[e.ID] = true
	}
	for _, f := range state.Facts {
		if !validReaderRecord(f.Reader, entities) {
			return bad()
		}
		if !add(f.ID) || !archiveText(f.Text) || f.SourceRevision < 1 || f.SourceRevision > revision || f.KnownBy == nil {
			return bad()
		}
		facts[f.ID] = true
		switch f.Kind {
		case "fact", "rule", "secret":
		case "statement", "belief":
			if f.SubjectID == "" {
				return bad()
			}
		default:
			return bad()
		}
		if f.SubjectID != "" && !entities[f.SubjectID] {
			return bad()
		}
		seen := map[string]bool{}
		for _, id := range f.KnownBy {
			if !entities[id] || seen[id] {
				return bad()
			}
			seen[id] = true
		}
	}
	for _, t := range state.Threads {
		if !add(t.ID) || !archiveText(t.Text) || t.RelatedFactIDs == nil {
			return bad()
		}
		if t.ResolvedAtRevision != nil && (*t.ResolvedAtRevision < 1 || *t.ResolvedAtRevision > revision) {
			return bad()
		}
		for _, id := range t.RelatedFactIDs {
			if !facts[id] {
				return bad()
			}
		}
	}
	for _, e := range state.Entities {
		for _, id := range e.RelatedIDs {
			if !ids[id] {
				return bad()
			}
		}
	}
	return nil
}

// Explicit field presence rejects omitted or null authority fields that Go zero
// values would otherwise accept. Optional reader projections remain optional.
func archiveFieldsPresent(raw []byte) bool {
	var root map[string]any
	if json.Unmarshal(raw, &root) != nil {
		return false
	}
	fields := func(value any, names ...string) bool {
		m, ok := value.(map[string]any)
		if !ok {
			return false
		}
		for _, name := range names {
			if v, ok := m[name]; !ok || v == nil {
				return false
			}
		}
		return true
	}
	list := func(value any) ([]any, bool) { v, ok := value.([]any); return v, ok }
	stateOK := func(value any) bool {
		if !fields(value, "story_time", "facts", "entities", "threads") {
			return false
		}
		m := value.(map[string]any)
		for _, item := range []struct {
			name   string
			fields []string
		}{
			{"facts", []string{"id", "kind", "text", "subject_id", "known", "known_by", "source_revision"}},
			{"entities", []string{"id", "kind", "name", "description", "known", "related_ids"}},
			{"threads", []string{"id", "text", "known", "related_fact_ids"}},
		} {
			rows, ok := list(m[item.name])
			if !ok {
				return false
			}
			for _, row := range rows {
				if !fields(row, item.fields...) {
					return false
				}
				if item.name == "threads" {
					if _, ok := row.(map[string]any)["resolved_at_revision"]; !ok {
						return false
					}
				}
			}
		}
		return true
	}
	if !fields(root, "format", "version", "experiences") {
		return false
	}
	experiences, ok := list(root["experiences"])
	if !ok {
		return false
	}
	for _, value := range experiences {
		if !fields(value, "id", "seed", "active_branch_id", "created_at", "branches") {
			return false
		}
		e := value.(map[string]any)
		branches, ok := list(e["branches"])
		if !ok {
			return false
		}
		for _, value := range branches {
			if !fields(value, "id", "name", "title", "revision", "state", "created_at", "pages") {
				return false
			}
			b := value.(map[string]any)
			if changes, ok := b["changes"].(map[string]any); ok {
				if author, exists := changes["author_world"]; exists {
					authorRaw, _ := json.Marshal(author)
					if ValidateAuthorWorldJSON(authorRaw) != nil {
						return false
					}
				}
			}
			if _, ok := b["parent_branch_id"]; !ok {
				return false
			}
			if _, ok := b["parent_revision"]; !ok {
				return false
			}
			if !stateOK(b["state"]) {
				return false
			}
			pages, ok := list(b["pages"])
			if !ok {
				return false
			}
			for _, value := range pages {
				if !fields(value, "page", "state", "title", "created_at") {
					return false
				}
				p := value.(map[string]any)
				if !stateOK(p["state"]) || !fields(p["page"], "revision", "mode", "input", "text", "story_time", "created_at", "suggestions", "outcome") {
					return false
				}
			}
		}
	}
	return true
}
