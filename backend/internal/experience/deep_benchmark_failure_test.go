//go:build integration && codexlive

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"

	"elselife/backend/internal/platform/database"
	"elselife/backend/internal/sqlc/pgq"
)

const deepFailureReadMethod = "fresh_service_new_connection_v1"

type deepStoredPage struct {
	Revision int64  `json:"revision"`
	Page     Page   `json:"page"`
	State    State  `json:"state"`
	Title    string `json:"title"`
}
type deepStoredBranch struct {
	ID             string           `json:"id"`
	Name           string           `json:"name"`
	Title          string           `json:"title"`
	Revision       int64            `json:"revision"`
	ParentBranchID *string          `json:"parent_branch_id"`
	ParentRevision *int64           `json:"parent_revision"`
	State          State            `json:"state"`
	Pages          []deepStoredPage `json:"pages"`
}
type deepStoredScope struct {
	AccountID    string `json:"account_id"`
	ExperienceID string `json:"experience_id"`
	BranchID     string `json:"branch_id"`
}
type deepStoredHistory struct {
	Scope       deepStoredScope        `json:"scope"`
	View        View                   `json:"public_view"`
	Snapshots   []deepRestoredSnapshot `json:"snapshots"`
	Branches    []deepStoredBranch     `json:"branches"`
	Preferences []PreferenceSnapshot   `json:"preferences"`
}
type deepFailureReadback struct {
	RequestEventSeq      int               `json:"request_event_seq"`
	FailureEventSeq      int               `json:"failure_event_seq"`
	Request              AdvanceRequest    `json:"request"`
	Operation            Operation         `json:"operation"`
	OperationLookupError string            `json:"operation_lookup_error"`
	After                deepStoredHistory `json:"authority_after"`
	Method               string            `json:"method"`
	ReadbackError        string            `json:"readback_error"`
	ReadOnlyVerified     bool              `json:"read_only_verified"`
}

// This read path has no Generator and cannot recover, cancel, apply or advance.
// SQL page state is also read through the snapshot query at each revision.
func readDeepStoredHistory(ctx context.Context, s *Service, dsn, account string, scope View) (deepStoredHistory, error) {
	result := deepStoredHistory{Scope: deepStoredScope{account, scope.ID, scope.BranchID}, Snapshots: []deepRestoredSnapshot{}, Branches: []deepStoredBranch{}, Preferences: []PreferenceSnapshot{}}
	db, err := database.OpenServing(ctx, dsn)
	if err != nil {
		return result, err
	}
	defer db.Close()
	fresh := &Service{DB: db, Artifacts: s.Artifacts}
	result.View, err = fresh.Get(ctx, account, scope.ID, scope.BranchID)
	if err != nil {
		return result, err
	}
	branches, err := pgq.New(db).ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: account, ExperienceID: scope.ID})
	if err != nil {
		return result, err
	}
	found := false
	for _, row := range branches {
		b := deepStoredBranch{ID: row.ID, Name: row.Name, Title: row.Title, Revision: row.Revision, Pages: []deepStoredPage{}}
		if row.ParentBranchID.Valid {
			value := row.ParentBranchID.String
			b.ParentBranchID = &value
		}
		if row.ParentRevision.Valid {
			value := row.ParentRevision.Int64
			b.ParentRevision = &value
		}
		if err = StrictJSON(row.State, &b.State); err != nil {
			return result, err
		}
		rows, readErr := pgq.New(db).ExperiencePages(ctx, pgq.ExperiencePagesParams{AccountID: account, ExperienceID: scope.ID, BranchID: row.ID, ThroughRevision: math.MaxInt64})
		if readErr != nil {
			return result, readErr
		}
		if len(rows) != int(row.Revision) || len(rows) == 0 {
			return result, fmt.Errorf("SQL branch history incomplete or contains unbound future pages")
		}
		for i, stored := range rows {
			p := deepStoredPage{Revision: stored.Revision, Title: stored.Title}
			if err = StrictJSON(stored.Page, &p.Page); err != nil {
				return result, err
			}
			if err = StrictJSON(stored.State, &p.State); err != nil {
				return result, err
			}
			if p.Revision != int64(i+1) || p.Page.Revision != p.Revision || !textOK(p.Title) {
				return result, fmt.Errorf("SQL page identity/title invalid")
			}
			at := result.View
			at.BranchID = row.ID
			at.Revision = p.Revision
			snapshot, snapshotErr := deepSnapshot(ctx, fresh, account, at)
			if snapshotErr != nil {
				return result, snapshotErr
			}
			if !reflect.DeepEqual(snapshot, p.State) {
				return result, fmt.Errorf("snapshot query differs from SQL page state")
			}
			b.Pages = append(b.Pages, p)
			if row.ID == scope.BranchID {
				result.Snapshots = append(result.Snapshots, deepRestoredSnapshot{Revision: p.Revision, State: snapshot})
				projected, projectionErr := deepMigrateInformationPage(p.Page, p.State)
				if projectionErr != nil {
					return result, projectionErr
				}
				if i >= len(result.View.Pages) || !reflect.DeepEqual(projected, result.View.Pages[i]) {
					return result, fmt.Errorf("SQL page differs from independently rebuilt public view")
				}
			}
		}
		last := b.Pages[len(b.Pages)-1]
		if !reflect.DeepEqual(b.State, last.State) || b.Title != last.Title {
			return result, fmt.Errorf("SQL branch differs from final page state/title")
		}
		if row.ID == scope.BranchID {
			found = true
			if result.View.Revision != b.Revision || len(result.View.Pages) != len(b.Pages) || result.View.Title != b.Title {
				return result, fmt.Errorf("current view differs from SQL branch")
			}
		}
		result.Branches = append(result.Branches, b)
	}
	if !found {
		return result, fmt.Errorf("requested SQL branch missing")
	}
	result.Preferences, err = fresh.PreferenceSnapshots(ctx, account)
	return result, err
}
func deepSameStoredHistory(a, b deepStoredHistory) bool {
	a.View.Operation, b.View.Operation = nil, nil
	a.View.UpdatedAt, b.View.UpdatedAt = time.Time{}, time.Time{}
	return reflect.DeepEqual(a, b)
}
func captureDeepFailure(ctx context.Context, s *Service, dsn, account string, scope View, request AdvanceRequest, before deepStoredHistory, requestSeq, failureSeq int) deepFailureReadback {
	result := deepFailureReadback{RequestEventSeq: requestSeq, FailureEventSeq: failureSeq, Request: request, Method: deepFailureReadMethod}
	auditContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	after, err := readDeepStoredHistory(auditContext, s, dsn, account, scope)
	result.After = after
	if err != nil {
		result.ReadbackError = err.Error()
		return result
	}
	db, err := database.OpenServing(auditContext, dsn)
	if err != nil {
		result.OperationLookupError = err.Error()
		result.ReadbackError = err.Error()
		return result
	}
	defer db.Close()
	fresh := &Service{DB: db}
	result.Operation, err = fresh.GetOperation(auditContext, account, scope.ID, request.RequestID)
	if err != nil {
		result.OperationLookupError = err.Error()
	}
	result.ReadOnlyVerified = deepSameStoredHistory(before, after)
	if err == nil && (result.Operation.RequestID != request.RequestID || result.Operation.ExperienceID != scope.ID || result.Operation.BranchID != request.BranchID || result.Operation.BaseRevision != request.ExpectedRevision || result.Operation.CommittedRevision != nil || result.Operation.Status == "committed") {
		result.ReadOnlyVerified = false
	}
	return result
}

func TestDeepBenchmarkFailureIndependentReadback(t *testing.T) {
	for _, mutation := range []string{"unchanged", "old_page", "old_private_snapshot", "old_title", "branch_state", "preferences", "new_formal_page", "unavailable"} {
		t.Run(mutation, func(t *testing.T) {
			ctx := context.Background()
			s, admin, dsn := testService(t)
			view := begin(t, s, "failure-audit", "begin")
			view = advance(t, s, "failure-audit", view, "second", "act")
			before, err := readDeepStoredHistory(ctx, s, dsn, "failure-audit", view)
			must(t, err)
			request := AdvanceRequest{RequestID: "failure-op", BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: "act", Input: "一次真实失败的合成控制"}
			s.Generator = generateFunc(func(context.Context, Context, string) (Candidate, error) {
				return Candidate{}, fmt.Errorf("synthetic model failure")
			})
			_, _, err = s.Advance(ctx, "failure-audit", view.ID, request)
			must(t, err)
			_ = s.GenerateAccepted(ctx, "failure-audit", request.RequestID)
			failed, err := s.GetOperation(ctx, "failure-audit", view.ID, request.RequestID)
			must(t, err)
			if failed.Status != "failed" {
				t.Fatalf("synthetic failing generator status=%s", failed.Status)
			}
			switch mutation {
			case "old_page":
				_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET page=jsonb_set(page,'{text}','"rewritten old page"') WHERE account_id='failure-audit' AND revision=1`)
			case "old_private_snapshot":
				_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET state=jsonb_set(state,'{facts,1,text}','"changed hidden fact"') WHERE account_id='failure-audit' AND revision=1`)
			case "old_title":
				_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET title='changed old title' WHERE account_id='failure-audit' AND revision=1`)
			case "branch_state":
				_, err = admin.ExecContext(ctx, `UPDATE experience_branches SET state=jsonb_set(state,'{facts,1,text}','"changed current hidden fact"') WHERE account_id='failure-audit'`)
			case "preferences":
				_, err = admin.ExecContext(ctx, `INSERT INTO experience_preferences(account_id,dimension,value,source,evidence,confirmed) VALUES('failure-audit','voice','changed','inferred','synthetic',true)`)
			case "new_formal_page":
				s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) { return candidate(c), nil })
				_ = advance(t, s, "failure-audit", view, "unrelated-commit", "act")
			case "unavailable":
				dsn = "postgres://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1"
			}
			must(t, err)
			cancelled, cancel := context.WithCancel(ctx)
			cancel()
			audit := captureDeepFailure(cancelled, s, dsn, "failure-audit", view, request, before, 4, 8)
			if mutation == "unchanged" {
				if !audit.ReadOnlyVerified || audit.ReadbackError != "" || audit.Operation.Status != "failed" {
					t.Fatalf("fresh readback failed: %+v", audit)
				}
				if len(audit.After.Snapshots) != 2 || audit.After.Branches[0].Pages[0].Title != "雨中的旧城" {
					t.Fatal("historical snapshot/title not captured")
				}
			} else if audit.ReadOnlyVerified {
				t.Fatal("cached baseline falsely certified unchanged authority after " + mutation)
			}
			if mutation == "unavailable" && audit.ReadbackError == "" {
				t.Fatal("readback error hidden")
			}
			var shape map[string]any
			must(t, json.Unmarshal(narrativeJSON(audit), &shape))
			if shape["request_event_seq"] != float64(4) || shape["failure_event_seq"] != float64(8) {
				t.Fatal("failure evidence lost source sequence binding")
			}
		})
	}
}
