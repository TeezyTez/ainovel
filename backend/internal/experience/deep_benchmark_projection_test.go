//go:build integration && codexlive

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

const deepProjectionMigration = "information_recorded_revision_v1"

// Only add one public display field; never regenerate or ignore an old field.
func deepRecordedInformation(page map[string]any, state State, add bool) error {
	reader, ok := page["reader"].(map[string]any)
	if !ok {
		if add {
			return fmt.Errorf("source page has no reader projection to migrate")
		}
		return nil
	}
	information, ok := reader["information"].([]any)
	if !ok {
		return fmt.Errorf("source reader information is missing")
	}
	visible := map[string]int64{}
	for _, fact := range ReaderState(state).Facts {
		visible["fact:"+fact.ID] = fact.SourceRevision
	}
	for _, item := range information {
		info, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid source information item")
		}
		id, _ := info["id"].(string)
		revision, fact := visible[id]
		value, exists := info["recorded_revision"]
		if exists && (!fact || revision <= 0 || value != float64(revision)) {
			return fmt.Errorf("recorded revision does not match visible source fact")
		}
		if add && fact && revision > 0 {
			info["recorded_revision"] = revision
		}
	}
	return nil
}

func deepMigrateInformationPage(page Page, state State) (Page, error) {
	var value map[string]any
	if err := json.Unmarshal(narrativeJSON(page), &value); err != nil {
		return Page{}, err
	}
	if err := deepRecordedInformation(value, state, true); err != nil {
		return Page{}, err
	}
	var result Page
	if err := StrictJSON(narrativeJSON(value), &result); err != nil {
		return Page{}, err
	}
	return result, nil
}

func deepStrictSourcePages(data json.RawMessage) error {
	var envelope struct {
		View struct {
			Pages []json.RawMessage `json:"pages"`
		} `json:"public_view"`
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	var state State
	if err := StrictJSON(envelope.Snapshot, &state); err != nil {
		return err
	}
	for i, raw := range envelope.View.Pages {
		var page Page
		if err := StrictJSON(raw, &page); err != nil {
			return fmt.Errorf("source page contains unsupported fields: %w", err)
		}
		var value map[string]any
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
		if reader, ok := value["reader"].(map[string]any); ok {
			if information, ok := reader["information"].([]any); ok {
				for _, item := range information {
					if info, ok := item.(map[string]any); ok {
						if recorded, exists := info["recorded_revision"]; exists {
							number, numeric := recorded.(float64)
							if !numeric || number <= 0 {
								return fmt.Errorf("source recorded revision must be a positive integer, not an omitted zero")
							}
						}
					}
				}
			}
		}
		// The event snapshot belongs only to its newest page; older page metadata
		// was checked with its own snapshot when that page first appeared.
		if i == len(envelope.View.Pages)-1 {
			if err := deepRecordedInformation(value, state, false); err != nil {
				return err
			}
		}
	}
	return nil
}

func TestDeepBenchmarkProjectionMigrationAddsOnlyRecordedFactRevision(t *testing.T) {
	state := EmptyState()
	state.Facts = []Fact{{ID: "visible", Kind: "fact", Text: "Earlier recorded event.", Known: true, KnownBy: []string{}, SourceRevision: 1},
		{ID: "hidden", Kind: "secret", Text: "Not visible.", Known: false, KnownBy: []string{}, SourceRevision: 1}}
	var original Page
	must(t, json.Unmarshal([]byte(`{"revision":2,"mode":"read","input":"","text":"Current prose.","reader":{"revision":2,"story_time":"","information":[{"id":"fact:visible","kind":"fact","name":"","text":"Earlier recorded event.","related_ids":[]}],"records":[]}}`), &original))
	migrated, err := deepMigrateInformationPage(original, state)
	must(t, err)
	var got map[string]any
	must(t, json.Unmarshal(narrativeJSON(migrated), &got))
	info := got["reader"].(map[string]any)["information"].([]any)[0].(map[string]any)
	if info["recorded_revision"] != float64(1) {
		t.Fatal("recorded time confused with page revision")
	}
	delete(info, "recorded_revision")
	var roundtrip Page
	must(t, json.Unmarshal(narrativeJSON(got), &roundtrip))
	if !reflect.DeepEqual(roundtrip, original) {
		t.Fatal("migration changed something besides public metadata")
	}
	for _, mutation := range []string{"wrong", "hidden"} {
		var bad map[string]any
		must(t, json.Unmarshal(narrativeJSON(migrated), &bad))
		entry := bad["reader"].(map[string]any)["information"].([]any)[0].(map[string]any)
		if mutation == "wrong" {
			entry["recorded_revision"] = 2
		} else {
			entry["id"] = "fact:hidden"
		}
		var page Page
		must(t, json.Unmarshal(narrativeJSON(bad), &page))
		if _, err := deepMigrateInformationPage(page, state); err == nil {
			t.Fatalf("accepted %s metadata provenance", mutation)
		}
	}
	original.Reader = nil
	if _, err := deepMigrateInformationPage(original, state); err == nil {
		t.Fatal("accepted missing source reader")
	}
}

func TestDeepBenchmarkProjectionMigrationPreservesStoredOriginalPages(t *testing.T) {
	s, _, _ := testService(t)
	state := EmptyState()
	state.Facts = []Fact{{ID: "known", Kind: "fact", Text: "Earlier public fact.", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	f := deepFixture{ID: "migration", Seed: "room", Opening: "A room.", State: state}
	pages := []deepReplayPage{}
	for revision := int64(1); revision <= 2; revision++ {
		reader := ProjectReader(state, revision)
		for i := range reader.Information {
			reader.Information[i].RecordedRevision = 0 // Legacy source bytes omitted it.
		}
		p := Page{HistoryPage: HistoryPage{Revision: revision, Mode: "read", Text: "Public prose."}, Reader: reader, Outcome: "continues", Suggestions: []string{}}
		if revision == 1 {
			p.Mode, p.Input, p.Text = "begin", f.Seed, f.Opening
		}
		pages = append(pages, deepReplayPage{Page: p, State: state})
	}
	replay := &deepReplay{Pages: pages}
	view, err := seedDeepFixture(context.Background(), s, f, "migration", replay)
	must(t, err)
	expected, err := deepMigrateInformationPage(pages[0].Page, state)
	must(t, err)
	if !reflect.DeepEqual(view.Pages[0], expected) {
		t.Fatalf("derived mismatch: got %s expected %s", narrativeJSON(view.Pages[0]), narrativeJSON(expected))
	}
	readback, err := readDeepRestored(context.Background(), s, "migration", view, replay)
	must(t, err)
	if readback.ProjectionMigration != deepProjectionMigration || len(readback.StoredPages) != 2 {
		t.Fatal("migration provenance missing")
	}
	for i, page := range readback.StoredPages {
		if !reflect.DeepEqual(page, pages[i].Page) || page.Reader.Information[0].RecordedRevision != 0 || readback.View.Pages[i].Reader.Information[0].RecordedRevision != 1 {
			t.Fatal("stored source changed or display revision not derived from its snapshot")
		}
	}
}

func TestDeepBenchmarkProjectionSourceRejectsWrongOrUnknownMetadata(t *testing.T) {
	state := EmptyState()
	state.Facts = []Fact{{ID: "known", Kind: "fact", Text: "Known.", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	for _, mutation := range []string{"zero", "wrong", "unknown", "zero_old"} {
		page := map[string]any{"reader": map[string]any{"information": []any{map[string]any{"id": "fact:known", "recorded_revision": 1}}}}
		info := page["reader"].(map[string]any)["information"].([]any)[0].(map[string]any)
		switch mutation {
		case "zero", "zero_old":
			info["recorded_revision"] = 0
		case "wrong":
			info["recorded_revision"] = 2
		case "unknown":
			info["unsupported_metadata"] = "must not silently drop"
		}
		pages := []any{page}
		if mutation == "zero_old" {
			pages = append(pages, map[string]any{"reader": map[string]any{"information": []any{}}})
		}
		raw := narrativeJSON(map[string]any{"snapshot": state, "public_view": map[string]any{"pages": pages}})
		if deepStrictSourcePages(raw) == nil {
			t.Fatalf("accepted %s source metadata", mutation)
		}
	}
}
