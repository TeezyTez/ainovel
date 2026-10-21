//go:build integration && codexlive

package experience

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type deepEditorialReplayEvent struct {
	kind, step string
	data       any
}

func deepEditorialReplayStream(events []deepEditorialReplayEvent) ([]byte, string) {
	var out []byte
	root := ""
	for i, event := range events {
		raw := narrativeJSON(map[string]any{"seq": i + 1, "previous_sha256": root, "kind": event.kind, "step": event.step, "data": event.data})
		root = fmt.Sprintf("%x", sha256.Sum256(raw))
		out = append(out, raw...)
		out = append(out, '\n')
	}
	return out, root
}

func deepEditorialReplayFixture() (deepFixture, []deepEditorialReplayEvent) {
	f := deepFixture{ID: "editorial-replay", Seed: "A room.", Opening: "A quiet room.", State: EmptyState(), Steps: []deepStep{
		{ID: "S01", Mode: "ask", Input: "Where?"},
		{ID: "S02", Mode: "editorial_request", Input: "Polish this paragraph."},
		{ID: "S03", Mode: "read", Input: "Continue."},
	}}
	first := Page{HistoryPage: HistoryPage{Revision: 1, Mode: "begin", Input: f.Seed, Text: f.Opening}, Reader: ProjectReader(f.State, 1)}
	last := Page{HistoryPage: HistoryPage{Revision: 2, Mode: "ask", Input: "Where?", Text: "The same room."}, Reader: ProjectReader(f.State, 2)}
	view := View{ID: "story", BranchID: "main", Revision: 2, Title: "Original title", Pages: []Page{first, last}}
	request := map[string]any{"step": f.Steps[1], "before": f.State, "before_preferences": []PreferenceSnapshot{}, "public_view": view, "original_page": last,
		"request": AssistRequest{RequestID: "polish", BranchID: "main", ExpectedRevision: 2, Kind: "polish", Request: f.Steps[1].Input}}
	result := map[string]any{"snapshot": f.State, "after_preferences": []PreferenceSnapshot{}, "public_view": view, "original_page": last,
		"result": AssistResult{Kind: "polish", BranchID: "main", BaseRevision: 2, Text: "An unapplied alternative."}, "applied": false, "read_only_verified": true, "model_calls": 1, "elapsed_ms": 1, "error": ""}
	events := []deepEditorialReplayEvent{
		{"manifest", "", map[string]any{"fixture": f, "evidence_version": 4}},
		{"initial_readback", "", map[string]any{"snapshot": f.State, "public_view": View{Title: "Initial title", Revision: 1, Pages: []Page{first}}}},
		{"operation_request", "S01", map[string]any{"request": AdvanceRequest{Mode: "ask", Input: "Where?", ExpectedRevision: 1}}},
		{"operation_committed", "S01", map[string]any{"snapshot": f.State, "public_view": view}},
		{"editorial_request", "S02", request},
		{"model_request", "S02", map[string]any{"call": 1, "request": map[string]any{"messages": []map[string]string{{"role": "user", "content": string(narrativeJSON(map[string]string{"original": last.Text, "request": f.Steps[1].Input}))}}}}},
		{"model_result", "S02", map[string]any{"call": 1, "result": map[string]any{"text": `{"text":"An unapplied alternative."}`}, "error": ""}},
		{"editorial_result", "S02", result},
		{"run_end", "S03", map[string]any{"status": "FAIL"}},
	}
	return f, events
}

func TestDeepBenchmarkEditorialResumePreservesUnappliedOriginalEvidence(t *testing.T) {
	f, events := deepEditorialReplayFixture()
	raw, root := deepEditorialReplayStream(events)
	replay, err := decodeDeepReplay(raw, root, f)
	must(t, err)
	var wire struct {
		Editorials []struct {
			Step       string          `json:"step"`
			SourceRoot string          `json:"source_root"`
			RequestSeq int             `json:"source_request_event_seq"`
			ResultSeq  int             `json:"source_result_event_seq"`
			Request    json.RawMessage `json:"request_data"`
			Result     json.RawMessage `json:"result_data"`
		} `json:"editorials"`
	}
	must(t, json.Unmarshal(narrativeJSON(replay), &wire))
	if len(wire.Editorials) != 1 || wire.Editorials[0].Step != "S02" || wire.Editorials[0].SourceRoot != root ||
		wire.Editorials[0].RequestSeq != 5 || wire.Editorials[0].ResultSeq != 8 ||
		!bytes.Equal(wire.Editorials[0].Request, narrativeJSON(events[4].data)) || !bytes.Equal(wire.Editorials[0].Result, narrativeJSON(events[7].data)) ||
		len(replay.Pages) != 2 || replay.Pages[1].Page.Text != "The same room." {
		t.Fatal("unapplied editorial replaced history or lost original event bytes")
	}
}

func TestDeepBenchmarkEditorialResumeRejectsChangedOrUnverifiedArtifacts(t *testing.T) {
	for _, fault := range []string{"applied", "missing-applied", "unverified", "failed", "empty", "wrong-input", "wrong-target", "changed-page", "changed-state", "changed-preferences", "unknown-field", "no-model", "model-target", "model-candidate", "incomplete", "duplicate", "unknown-editorial"} {
		t.Run(fault, func(t *testing.T) {
			f, events := deepEditorialReplayFixture()
			request, result := events[4].data.(map[string]any), events[7].data.(map[string]any)
			switch fault {
			case "applied":
				result["applied"] = true
			case "missing-applied":
				delete(result, "applied")
			case "unverified":
				result["read_only_verified"] = false
			case "failed":
				result["error"] = "Failed."
			case "empty":
				r := result["result"].(AssistResult)
				r.Text = ""
				result["result"] = r
			case "wrong-input":
				r := request["request"].(AssistRequest)
				r.Request = "Another instruction."
				request["request"] = r
			case "wrong-target":
				r := request["request"].(AssistRequest)
				r.ExpectedRevision = 1
				request["request"] = r
			case "changed-page":
				p := result["original_page"].(Page)
				p.Text = "Changed."
				result["original_page"] = p
			case "changed-state":
				s := f.State
				s.StoryTime = "Later"
				result["snapshot"] = s
			case "changed-preferences":
				result["after_preferences"] = []map[string]any{{"dimension": "voice", "value": "different"}}
			case "unknown-field":
				result["new_world_state"] = true
			case "no-model":
				events = append(events[:5], events[7:]...)
			case "model-target":
				events[5].data = map[string]any{"call": 1, "request": map[string]any{"messages": []map[string]string{{"role": "user", "content": `{"original":"Another paragraph.","request":"Polish this paragraph."}`}}}}
			case "model-candidate":
				events[6].data = map[string]any{"call": 1, "result": map[string]any{"text": `{"text":"Another candidate."}`}, "error": ""}
			case "incomplete":
				events = append(events[:7], events[8:]...)
			case "duplicate":
				events = append(events[:8], events[7], events[8])
			case "unknown-editorial":
				events[7].kind = "editorial_apply"
			}
			raw, root := deepEditorialReplayStream(events)
			if _, err := decodeDeepReplay(raw, root, f); err == nil {
				t.Fatal("accepted unsafe editorial evidence", fault)
			}
		})
	}
}

// The following helper is shared by ancestry controls, without models or DBs.
func writeDeepEditorialReplayLayer(t *testing.T, dir, prefix string, f deepFixture, raw []byte, root string) {
	t.Helper()
	for name, body := range map[string][]byte{"fixture.json": narrativeJSON(f), "events.jsonl": raw, "root.sha256": []byte(root + "\n")} {
		must(t, os.WriteFile(filepath.Join(dir, prefix+name), body, 0600))
	}
}

func deepNestedEditorialStream(t *testing.T, f deepFixture, source *deepReplay) ([]byte, string) {
	t.Helper()
	first, last := source.Pages[0], source.Pages[len(source.Pages)-1]
	display := []Page{}
	readback := deepRestoredReadback{ProjectionMigration: deepProjectionMigration, TitleBinding: deepTitleBinding, BranchTitle: last.Title}
	for _, prior := range source.Pages {
		page, err := deepMigrateInformationPage(prior.Page, prior.State)
		must(t, err)
		display = append(display, page)
		readback.StoredPages = append(readback.StoredPages, prior.Page)
		readback.Snapshots = append(readback.Snapshots, deepRestoredSnapshot{Revision: prior.Page.Revision, State: prior.State})
		readback.StoredTitles = append(readback.StoredTitles, deepRestoredTitle{Revision: prior.Page.Revision, Title: prior.Title})
	}
	readback.View = View{ID: "story", BranchID: "main", Title: last.Title, Revision: last.Page.Revision, Pages: display, Reader: display[len(display)-1].Reader, Information: display[len(display)-1].Reader.Information}
	initial := View{Title: first.Title, Revision: 1, Pages: []Page{display[0]}}
	next := Page{HistoryPage: HistoryPage{Revision: 3, Mode: "read", Text: "A later original page."}, Reader: ProjectReader(last.State, 3)}
	latest := View{Title: "Later title", Revision: 3, Pages: append(append([]Page{}, display...), next)}
	events := []deepEditorialReplayEvent{
		{"manifest", "", map[string]any{"fixture": f, "evidence_version": 5}},
		{"resume_manifest", "", source},
		{"resume_readback", "", readback},
		{"initial_readback", "", map[string]any{"snapshot": f.State, "public_view": initial}},
		{"restored_step", "S01", source.Pages[1]},
		{"restored_editorial", "S02", source.Editorials[0]},
		{"operation_request", "S03", map[string]any{"request": AdvanceRequest{Mode: "read", ReadingRequest: "Continue.", ExpectedRevision: 2}}},
		{"operation_committed", "S03", map[string]any{"snapshot": last.State, "public_view": latest}},
		{"run_end", "S03", map[string]any{"status": "REVIEW"}},
	}
	return deepEditorialReplayStream(events)
}

func TestDeepBenchmarkEditorialResumeReadsVerifiedAncestorChain(t *testing.T) {
	f, events := deepEditorialReplayFixture()
	sourceRaw, sourceRoot := deepEditorialReplayStream(events)
	source, err := decodeDeepReplay(sourceRaw, sourceRoot, f)
	must(t, err)
	raw, root := deepNestedEditorialStream(t, f, source)
	parent := t.TempDir()
	dir := filepath.Join(parent, f.ID)
	must(t, os.Mkdir(dir, 0700))
	writeDeepEditorialReplayLayer(t, dir, "", f, raw, root)
	writeDeepEditorialReplayLayer(t, dir, "source-", f, sourceRaw, sourceRoot)
	replay, err := readDeepReplay(parent, f)
	must(t, err)
	if len(replay.Pages) != 3 || !reflect.DeepEqual(replay.Editorials, source.Editorials) ||
		replay.Editorials[0].SourceRoot != sourceRoot || replay.Pages[2].Page.Text != "A later original page." {
		t.Fatal("nested resume lost ancestor binding or changed original editorial")
	}
	if _, err := decodeDeepReplay(raw, root, f); err == nil {
		t.Fatal("nested stream accepted without its original ancestor assets")
	}
	destination := t.TempDir()
	must(t, copyDeepReplaySource(parent, f.ID, destination))
	copied, err := deepReadReplayChain(destination, "source-", 1, f, map[string]bool{})
	must(t, err)
	if copied.SourceRoot != replay.SourceRoot || !reflect.DeepEqual(copied.Pages, replay.Pages) || !reflect.DeepEqual(copied.Editorials, replay.Editorials) {
		t.Fatal("source copy changed its recorded ancestry")
	}
	for name, original := range replay.sourceFiles {
		copy, err := os.ReadFile(filepath.Join(destination, "source-"+name))
		must(t, err)
		if !bytes.Equal(copy, original) {
			t.Fatal("source copy reconstructed original bytes", name)
		}
	}
	if err := copyDeepReplaySource(parent, f.ID, destination); err == nil {
		t.Fatal("source copy overwrote existing evidence")
	}
	if _, err := deepReadReplayChain(dir, "", deepReplayMaxSourceDepth+1, f, map[string]bool{}); err == nil {
		t.Fatal("source ancestry depth was unbounded")
	}
	for _, fault := range []string{"missing", "unsealed", "fixture", "root", "loop"} {
		t.Run(fault, func(t *testing.T) {
			writeDeepEditorialReplayLayer(t, dir, "source-", f, sourceRaw, sourceRoot)
			switch fault {
			case "missing":
				must(t, os.Remove(filepath.Join(dir, "source-events.jsonl")))
			case "unsealed":
				must(t, os.WriteFile(filepath.Join(dir, "source-events.jsonl"), sourceRaw[:len(sourceRaw)-1], 0600))
			case "fixture":
				changed := f
				changed.Seed = "Different."
				must(t, os.WriteFile(filepath.Join(dir, "source-fixture.json"), narrativeJSON(changed), 0600))
			case "root":
				must(t, os.WriteFile(filepath.Join(dir, "source-root.sha256"), []byte(strings.Repeat("0", 64)+"\n"), 0600))
			case "loop":
				writeDeepEditorialReplayLayer(t, dir, "source-", f, raw, root)
			}
			if _, err := readDeepReplay(parent, f); err == nil {
				t.Fatal("accepted altered or incomplete ancestor", fault)
			}
		})
	}
}

func TestDeepBenchmarkEditorialResumeRecordedV46Preflight(t *testing.T) {
	parent := os.Getenv("ELSELIFE_RECORDED_CAPACITY_ROOT")
	if parent == "" {
		t.Skip("explicit sealed v46 reading-resume evidence required; no model is called")
	}
	for _, id := range []string{"NAR-014", "NAR-017"} {
		t.Run(id, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(parent, id, "fixture.json"))
			must(t, err)
			var f deepFixture
			must(t, StrictJSON(raw, &f))
			replay, err := readDeepReplay(parent, f)
			must(t, err)
			wantPages := 5
			if id == "NAR-014" {
				wantPages = 6
				if len(replay.Editorials) != 1 || replay.Editorials[0].Step != "S06" ||
					replay.Editorials[0].RequestEventSeq != 38 || replay.Editorials[0].ResultEventSeq != 41 ||
					replay.Editorials[0].SourceRoot != "2286b1d6535f17a4a59d1679548074b64f9294ce36b0dc3c58a737c03dd8ecdb" {
					t.Fatal("real unapplied S06 lost original request/result identity")
				}
			} else if len(replay.Editorials) != 0 {
				t.Fatal("invented editorial for NAR-017")
			}
			if len(replay.Pages) != wantPages || len(replay.sourceFiles) != 6 {
				t.Fatal("actual resumed source lost committed pages or either original ancestor layer")
			}
			dest := t.TempDir()
			must(t, copyDeepReplaySource(parent, id, dest))
			for name, original := range replay.sourceFiles {
				got, err := os.ReadFile(filepath.Join(dest, "source-"+name))
				must(t, err)
				if !bytes.Equal(got, original) {
					t.Fatal("actual ancestor bytes changed", name)
				}
			}
			roundTrip, err := deepReadReplayChain(dest, "source-", 1, f, map[string]bool{})
			must(t, err)
			if !bytes.Equal(narrativeJSON(roundTrip), narrativeJSON(replay)) {
				t.Fatal("copied actual ancestor no longer verifies")
			}
			t.Logf("zero-model source preflight: case=%s root=%s pages=%d editorial=%d fixed_original_assets=%d", id, replay.SourceRoot, len(replay.Pages), len(replay.Editorials), len(replay.sourceFiles))
		})
	}
}

func TestDeepBenchmarkEditorialResumeRejectsReboundNestedEvidence(t *testing.T) {
	for _, fault := range []string{"manifest-root", "manifest-page", "manifest-path", "restored-sequence", "restored-candidate", "missing-restoration", "duplicate-restoration", "missing-readback", "stored-page", "late-model"} {
		t.Run(fault, func(t *testing.T) {
			f, originalEvents := deepEditorialReplayFixture()
			sourceRaw, sourceRoot := deepEditorialReplayStream(originalEvents)
			source, err := decodeDeepReplay(sourceRaw, sourceRoot, f)
			must(t, err)
			raw, _ := deepNestedEditorialStream(t, f, source)
			var events []deepEditorialReplayEvent
			for _, line := range bytes.Split(bytes.TrimSpace(raw), []byte{'\n'}) {
				var event struct {
					Kind, Step string
					Data       map[string]any
				}
				must(t, json.Unmarshal(line, &event))
				events = append(events, deepEditorialReplayEvent{event.Kind, event.Step, event.Data})
			}
			manifest := events[1].data.(map[string]any)
			restored := events[5].data.(map[string]any)
			switch fault {
			case "manifest-root":
				manifest["source_root"] = strings.Repeat("0", 64)
			case "manifest-page":
				manifest["pages"].([]any)[1].(map[string]any)["page"].(map[string]any)["text"] = "Changed."
			case "manifest-path":
				manifest["source_path"] = "../../another-world"
			case "restored-sequence":
				restored["source_request_event_seq"] = float64(99)
			case "restored-candidate":
				restored["result_data"].(map[string]any)["result"].(map[string]any)["text"] = "Replaced."
			case "missing-restoration":
				events = append(events[:5], events[6:]...)
			case "duplicate-restoration":
				events = append(events[:6], append([]deepEditorialReplayEvent{events[5]}, events[6:]...)...)
			case "missing-readback":
				events = append(events[:2], events[3:]...)
			case "stored-page":
				events[2].data.(map[string]any)["stored_pages"].([]any)[0].(map[string]any)["text"] = "Changed."
			case "late-model":
				events = append(events[:6], append([]deepEditorialReplayEvent{{"model_request", "S02", map[string]any{"call": 2}}}, events[6:]...)...)
			}
			modified, root := deepEditorialReplayStream(events)
			parent := t.TempDir()
			dir := filepath.Join(parent, f.ID)
			must(t, os.Mkdir(dir, 0700))
			writeDeepEditorialReplayLayer(t, dir, "", f, modified, root)
			writeDeepEditorialReplayLayer(t, dir, "source-", f, sourceRaw, sourceRoot)
			if _, err := readDeepReplay(parent, f); err == nil {
				t.Fatal("accepted rebound nested evidence", fault)
			}
		})
	}
}
