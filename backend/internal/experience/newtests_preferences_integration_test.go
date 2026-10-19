//go:build integration

// Fixtures here prove scope, source, version and zero world effects only.
// They do not prove model quality, literary value or low confirmation cost.
package experience

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

// newtestsInsertInferred models a credible historical record that today has no
// production producer; it exists so the same-dimension override can be proven.
func newtestsInsertInferred(t *testing.T, db *sql.DB, account, dimension, value, evidence string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(),
		`INSERT INTO experience_preferences (account_id, dimension, value, source, evidence, confirmed) VALUES ($1,$2,$3,'inferred',$4,true)`,
		account, dimension, value, evidence); err != nil {
		t.Fatal(err)
	}
}

func TestNewtestsPreferenceKeyedCASPreservesUnnamedRows(t *testing.T) {
	s, db, _ := testService(t)
	ctx := context.Background()
	newtestsInsertInferred(t, db, "a", "关系", " 原字\n  犹豫 ", " 引文\n  原字 ")
	quiet := "安静"
	got, err := s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Value: &quiet, Expression: "安静", Confirmation: "direct_expression"})
	must(t, err)
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	var relation, pace *PreferenceSnapshot
	for i := range got {
		switch got[i].Dimension {
		case "关系":
			relation = &got[i]
		case "节奏":
			pace = &got[i]
		}
	}
	if relation == nil || pace == nil || relation.Source != "inferred" || relation.Value != " 原字\n  犹豫 " || relation.Evidence != " 引文\n  原字 " {
		t.Fatalf("unnamed row changed: %+v", got)
	}
	if pace.Source != "explicit" {
		t.Fatalf("named row source: %+v", pace)
	}
	// The named dimension's own evidence keeps the user's words, not model wording.
	var evidence struct {
		Expression   string `json:"expression"`
		Confirmation string `json:"confirmation"`
	}
	if err = json.Unmarshal([]byte(pace.Evidence), &evidence); err != nil || evidence.Expression != "安静" || evidence.Confirmation != "direct_expression" {
		t.Fatalf("evidence=%q err=%v", pace.Evidence, err)
	}
	// Changing 节奏 again must not touch 关系's version or any field.
	fast := "更快"
	got2, err := s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Expected: pace, Value: &fast, Expression: "更快", Confirmation: "direct_expression"})
	must(t, err)
	for _, row := range got2 {
		if row.Dimension == "关系" && *relation != row {
			t.Fatalf("unnamed row rewritten: %+v vs %+v", relation, row)
		}
	}
}

func TestNewtestsPreferenceConflictingStaleReadNeverOverwrites(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	first := "早"
	got, err := s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Value: &first, Expression: "早", Confirmation: "direct_expression"})
	must(t, err)
	deviceA, deviceB := got[0], got[0]
	// Device A writes successfully.
	second := "慢"
	got, err = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Expected: &deviceA, Value: &second, Expression: "慢", Confirmation: "direct_expression"})
	must(t, err)
	// Device B still holds the old read; it must conflict instead of overwriting.
	third := "快"
	_, err = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Expected: &deviceB, Value: &third, Expression: "快", Confirmation: "direct_expression"})
	code(t, err, "preference_conflict")
	after, err := s.PreferenceSnapshots(ctx, "a")
	must(t, err)
	if len(after) != 1 || after[0] != got[0] || after[0].Value != "慢" {
		t.Fatalf("stale write leaked: %+v", after)
	}
}

func TestNewtestsPreferenceConcurrentSameExpectedOnlyOneWins(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	start := "起"
	got, err := s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Value: &start, Expression: "起", Confirmation: "direct_expression"})
	must(t, err)
	expected := got[0]
	values := []string{"一", "二"}
	var wg sync.WaitGroup
	errs := make([]error, len(values))
	for i := range values {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			value := values[i]
			_, errs[i] = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Expected: &expected, Value: &value, Expression: value, Confirmation: "direct_expression"})
		}(i)
	}
	wg.Wait()
	successes := 0
	for _, err := range errs {
		switch {
		case err == nil:
			successes++
		default:
			code(t, err, "preference_conflict")
		}
	}
	if successes != 1 {
		t.Fatalf("successes=%d errs=%v", successes, errs)
	}
}

func TestNewtestsPreferenceAccountsAreIsolated(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	value := "只属于甲"
	_, err := s.ChangePreference(ctx, "甲", PreferenceChange{Dimension: "节奏", Value: &value, Expression: value, Confirmation: "direct_expression"})
	must(t, err)
	other, err := s.PreferenceSnapshots(ctx, "乙")
	must(t, err)
	if len(other) != 0 {
		t.Fatalf("cross-account leak: %+v", other)
	}
	// The second account's same dimension is independent, not a conflict.
	value2 := "只属于乙"
	if _, err = s.ChangePreference(ctx, "乙", PreferenceChange{Dimension: "节奏", Value: &value2, Expression: value2, Confirmation: "direct_expression"}); err != nil {
		t.Fatal(err)
	}
	mine, err := s.PreferenceSnapshots(ctx, "甲")
	must(t, err)
	if len(mine) != 1 || mine[0].Value != "只属于甲" {
		t.Fatalf("other account rewrote: %+v", mine)
	}
}

func TestNewtestsPreferenceChangeNeverTouchesStoryRevision(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	v := begin(t, s, "a", "story-first")
	before, err := s.Get(ctx, "a", v.ID, v.BranchID)
	must(t, err)
	value := "慢"
	_, err = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "节奏", Value: &value, Expression: value, Confirmation: "direct_expression"})
	must(t, err)
	after, err := s.Get(ctx, "a", v.ID, v.BranchID)
	must(t, err)
	if before.Revision != after.Revision || len(before.Pages) != len(after.Pages) || before.Pages[0].Text != after.Pages[0].Text {
		t.Fatalf("profile change moved the story: %+v -> %+v", before.Revision, after.Revision)
	}
}

// An accepted model draft must keep the user's original sentence and the fact
// that the wording was confirmed, never present it as the user's own words.
func TestNewtestsAcceptedModelDraftKeepsExpressionAndConfirmation(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	value := "偏好安静氛围"
	got, err := s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "氛围", Value: &value, Expression: "角色说这里太吵了，我想安静点", Confirmation: "accepted_model_draft"})
	must(t, err)
	var evidence struct {
		Expression   string `json:"expression"`
		Confirmation string `json:"confirmation"`
	}
	if err = json.Unmarshal([]byte(got[0].Evidence), &evidence); err != nil {
		t.Fatal(err)
	}
	if evidence.Expression != "角色说这里太吵了，我想安静点" || evidence.Confirmation != "accepted_model_draft" || strings.Contains(got[0].Evidence, value) {
		t.Fatalf("evidence=%q", got[0].Evidence)
	}
	// A caller cannot smuggle another source in: source is signed explicit by SQL.
	if got[0].Source != "explicit" {
		t.Fatal(got[0])
	}
	// A mismatched expression/confirmation pair is rejected before any write.
	bad := "任意"
	if _, err = s.ChangePreference(ctx, "a", PreferenceChange{Dimension: "x", Value: &bad, Expression: "不同", Confirmation: "direct_expression"}); err == nil {
		t.Fatal("expected invalid_preferences")
	}
}

func TestNewtestsUninterpretedFeedbackHasZeroAccountEffects(t *testing.T) {
	s, db, _ := testService(t)
	ctx := context.Background()
	// No model is configured on this interpreter; the raw text is still returned.
	interpreter := &FeedbackInterpreter{}
	draft, err := interpreter.Interpret(ctx, FeedbackRequest{Text: "我希望节奏慢一点"})
	must(t, err)
	if draft.Status != "unavailable" || draft.ErrorCode != "model_unavailable" || draft.Text != "我希望节奏慢一点" || len(draft.Proposals) != 0 {
		t.Fatalf("draft=%+v", draft)
	}
	// Nothing was written anywhere by the interpretation attempt.
	rows, err := s.PreferenceSnapshots(ctx, "a")
	must(t, err)
	if len(rows) != 0 {
		t.Fatalf("interpretation wrote preferences: %+v", rows)
	}
	var count int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM experience_preferences`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}
