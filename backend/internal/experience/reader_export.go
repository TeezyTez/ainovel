package experience

import (
	"context"
	"database/sql"
	"encoding/json"

	"elselife/backend/internal/sqlc/pgq"
)

// ReaderExport is deliberately not an importable backup. It contains formal
// prose and each historical reader projection, never authoritative State,
// author inputs, notebooks, hidden changes, or executable artifact definitions.
type ReaderExport struct {
	Format      string                   `json:"format"`
	Version     int                      `json:"version"`
	Experiences []ReaderExportExperience `json:"experiences"`
}
type ReaderExportExperience struct {
	ID             string               `json:"id"`
	ActiveBranchID string               `json:"active_branch_id"`
	Branches       []ReaderExportBranch `json:"branches"`
}
type ReaderExportBranch struct {
	Branch
	Title  string             `json:"title"`
	Reader *ReaderProjection  `json:"reader"`
	Pages  []ReaderExportPage `json:"pages"`
}
type ReaderExportPage struct {
	Revision    int64             `json:"revision"`
	Mode        string            `json:"mode"`
	Title       string            `json:"title"`
	Text        string            `json:"text"`
	StoryTime   string            `json:"story_time"`
	Suggestions []string          `json:"suggestions"`
	Outcome     string            `json:"outcome"`
	Reader      *ReaderProjection `json:"reader"`
}

func (s *Service) ExportReader(ctx context.Context, account string) (ReaderExport, error) {
	out := ReaderExport{Format: "elselife-reader-export", Version: 1, Experiences: []ReaderExportExperience{}}
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
		e := ReaderExportExperience{ID: row.ID, ActiveBranchID: row.ActiveBranchID, Branches: []ReaderExportBranch{}}
		branches, err := q.ExperienceArchiveBranches(ctx, pgq.ExperienceArchiveBranchesParams{AccountID: account, ExperienceID: row.ID})
		if err != nil {
			return out, err
		}
		if len(branches) > 512 {
			return out, fail("archive_too_large")
		}
		for _, current := range branches {
			var state State
			if StrictJSON(current.State, &state) != nil {
				return out, fail("history_unavailable")
			}
			b := ReaderExportBranch{Branch: branch(current), Title: current.Title, Reader: ProjectReader(state, current.Revision), Pages: []ReaderExportPage{}}
			pages, err := q.ExperienceArchivePages(ctx, pgq.ExperienceArchivePagesParams{AccountID: account, ExperienceID: row.ID, BranchID: current.ID})
			if err != nil {
				return out, err
			}
			totalPages += len(pages)
			if totalPages > maxArchivePages {
				return out, fail("archive_too_large")
			}
			for _, row := range pages {
				var page Page
				var snapshot State
				if StrictJSON(row.Page, &page) != nil || StrictJSON(row.State, &snapshot) != nil || page.Revision != row.Revision {
					return out, fail("history_unavailable")
				}
				b.Pages = append(b.Pages, ReaderExportPage{Revision: page.Revision, Mode: page.Mode, Title: row.Title, Text: page.Text, StoryTime: page.StoryTime, Suggestions: page.Suggestions, Outcome: page.Outcome, Reader: ProjectReader(snapshot, page.Revision)})
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
	return out, tx.Commit()
}
