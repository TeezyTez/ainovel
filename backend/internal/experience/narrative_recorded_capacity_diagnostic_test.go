package experience

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Recorded synthetic worlds measure a compiler/provider capacity boundary only.
// This test neither invokes a model nor evaluates narrative quality. The event
// files remain sealed; an opt-in path avoids copying unrelated transcripts into
// the product source. Missing local evidence is an explicit skip.
func TestRecordedV46ReadingContinuationCapacity(t *testing.T) {
	root := os.Getenv("ELSELIFE_RECORDED_CAPACITY_ROOT")
	if root == "" {
		t.Skip("set ELSELIFE_RECORDED_CAPACITY_ROOT to sealed 20261020T041218Z-v46-reading-resume evidence")
	}
	for _, tc := range []struct {
		id, root, sha, failedStep string
		commitSeq, failSeq        int
	}{
		{"NAR-014", "2286b1d6535f17a4a59d1679548074b64f9294ce36b0dc3c58a737c03dd8ecdb", "c6c0165fdfed92aaf0a5972f625cd8e4e7dfeec3f181e6b071d8eab962fc9c47", "S07", 37, 43},
		{"NAR-017", "f3306ffdff22e58b85e8ef490c2300728a23d1bc439bf0d397231e51e4f7fab7", "b56029d5824f8466fb58b499ee55152c238ce62c0d6b913272ee34e0be71bc06", "S05", 33, 35},
	} {
		t.Run(tc.id, func(t *testing.T) {
			dir := filepath.Join(root, tc.id)
			sealed, err := os.ReadFile(filepath.Join(dir, "events.jsonl"))
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(sealed)
			if hex.EncodeToString(sum[:]) != tc.sha {
				t.Fatal("sealed event bytes changed")
			}
			rootBytes, err := os.ReadFile(filepath.Join(dir, "root.sha256"))
			if err != nil || strings.TrimSpace(string(rootBytes)) != tc.root {
				t.Fatal("sealed event root changed", err)
			}
			var authority Context
			var snapshot State
			var request AdvanceRequest
			var pages []Page
			var committed, failed, originalContext bool
			for _, line := range bytes.Split(sealed, []byte{'\n'}) {
				if len(line) == 0 {
					continue
				}
				var event struct {
					Seq  int             `json:"seq"`
					Kind string          `json:"kind"`
					Step string          `json:"step"`
					Data json.RawMessage `json:"data"`
				}
				if err := json.Unmarshal(line, &event); err != nil {
					t.Fatal(err)
				}
				switch event.Kind {
				case "model_request":
					if originalContext {
						continue
					}
					var data struct {
						Request struct {
							Messages []struct{ Role, Content string }
						}
					}
					if err := json.Unmarshal(event.Data, &data); err != nil {
						t.Fatal(err)
					}
					for _, message := range data.Request.Messages {
						if message.Role == "user" {
							if err := json.Unmarshal([]byte(message.Content), &authority); err != nil || authority.Version != 2 {
								t.Fatal("first memory request is not the original Context", err)
							}
							originalContext = true
						}
					}
				case "operation_committed":
					if event.Seq != tc.commitSeq {
						continue
					}
					var data struct {
						Snapshot   State `json:"snapshot"`
						PublicView struct {
							Pages []Page `json:"pages"`
						} `json:"public_view"`
					}
					if err := json.Unmarshal(event.Data, &data); err != nil {
						t.Fatal(err)
					}
					snapshot, pages, committed = data.Snapshot, data.PublicView.Pages, true
				case "operation_request":
					if event.Step != tc.failedStep {
						continue
					}
					var data struct {
						Request AdvanceRequest `json:"request"`
					}
					if err := json.Unmarshal(event.Data, &data); err != nil {
						t.Fatal(err)
					}
					request = data.Request
				case "operation_failure":
					if event.Seq != tc.failSeq || event.Step != tc.failedStep {
						continue
					}
					var data struct {
						ModelCalls int `json:"model_calls"`
						Operation  struct {
							BaseRevision int64  `json:"base_revision"`
							ErrorCode    string `json:"error_code"`
						} `json:"operation"`
					}
					if err := json.Unmarshal(event.Data, &data); err != nil {
						t.Fatal(err)
					}
					if data.ModelCalls != 0 || data.Operation.ErrorCode != "context_capacity" || data.Operation.BaseRevision != request.ExpectedRevision {
						t.Fatal("source no longer records the zero-call capacity failure")
					}
					failed = true
				}
			}
			if !committed || !failed || !originalContext || len(pages) == 0 || request.RequestID == "" {
				t.Fatal("source evidence incomplete")
			}
			// Same constructor inputs as Service.buildContext: current committed
			// State, all immutable HistoryPages, original seed/preferences, and
			// the exact accepted request. No candidate or polish text is used.
			authority.State = snapshot
			authority.Revision = request.ExpectedRevision
			authority.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}
			authority.Mode, authority.Input = request.Mode, request.Input
			authority.ReadingRequest = request.ReadingRequest
			authority.History = []HistoryPage{}
			for _, page := range pages {
				authority.History = append(authority.History, page.HistoryPage)
			}
			authority.HistoryComplete = true
			authority.Recalls = []ReadReply{}
			authority.StateCoverage = StateCoverage{}
			authority.ReadBudget = ReadBudget{}
			if authority.Pipeline == nil || authority.Pipeline.Version != 1 {
				t.Fatal("replay must exercise the narrative pipeline capacity path")
			}
			if err := validateArchiveState(authority.State, authority.Revision); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(authority)
			algorithm := &Algorithm{ModelName: "gpt-6.1-sol", ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			capacity, err := algorithm.narrativeContextCapacity(authority, 256<<10)
			if err != nil {
				t.Fatal(err)
			}
			budget := ReadBudget{MaxReads: 4, MaxReplyBytes: 64 << 10, MaxTotalReplyBytes: 128 << 10}
			// The sealed event proves the historical compiler failed before
			// calling a model. Reusing its reservation with today's compiler
			// is a separate observation: stage-specific memory selection now
			// omits the whole notebook from the initial generation view.
			oldCapacity := capacity - (40<<10 - narrativePipelineOverheadBytes)
			oldGeneration, oldErr := compileGeneration(authority, authority.State, "source_"+strings.Repeat("0", 32), authority.Revision, budget, oldCapacity)
			minimumGeneration, minimumErr := compileGeneration(authority, authority.State, "source_"+strings.Repeat("0", 32), authority.Revision, budget, 1)
			t.Logf("current_compiler_at_recorded_reservation capacity=%d retained_context=%d error=%v minimum_context=%d minimum_probe_error=%v authority_notebook=%d generation_notebook=%d authority_literary_memory=%d generation_literary_memory=%d",
				oldCapacity, len(narrativeJSON(oldGeneration)), oldErr, len(narrativeJSON(minimumGeneration)), minimumErr,
				len(narrativeJSON(authority.State.Narrative)), len(narrativeJSON(oldGeneration.State.Narrative)),
				len(narrativeJSON(authority.State.LiteraryMemory)), len(narrativeJSON(oldGeneration.State.LiteraryMemory)))
			oldBytes := len(narrativeJSON(oldGeneration))
			if oldErr == nil {
				if oldBytes > oldCapacity {
					t.Fatal("current compiler accepted an oversized generation at the recorded reservation")
				}
			} else if oldErr.Error() != "context_capacity" || oldBytes <= oldCapacity {
				t.Fatal("current compiler failure is inconsistent with the recorded reservation", oldErr, oldBytes, oldCapacity)
			}
			// This probe uses the current compiler's final mandatory closure
			// and latest whole page, not an arbitrary lower business budget.
			// Verify the exact same complete payload fits at its measured size
			// and is rejected one byte below it; never truncate it to pass.
			minimumRaw := narrativeJSON(minimumGeneration)
			minimumBytes := len(minimumRaw)
			if minimumErr == nil || minimumErr.Error() != "context_capacity" || minimumBytes <= 1 {
				t.Fatal("minimum-material probe must return a complete oversized context", minimumErr, minimumBytes)
			}
			exactGeneration, exactErr := compileGeneration(authority, authority.State, "source_"+strings.Repeat("0", 32), authority.Revision, budget, minimumBytes)
			if exactErr != nil || !bytes.Equal(narrativeJSON(exactGeneration), minimumRaw) {
				t.Fatal("the same minimum complete payload must fit exactly", exactErr)
			}
			belowGeneration, belowErr := compileGeneration(authority, authority.State, "source_"+strings.Repeat("0", 32), authority.Revision, budget, minimumBytes-1)
			if belowErr == nil || belowErr.Error() != "context_capacity" || !bytes.Equal(narrativeJSON(belowGeneration), minimumRaw) {
				t.Fatal("one byte below the minimum must reject without changing the complete payload", belowErr)
			}
			t.Logf("current_compiler_exact_fit=%d minus_one_rejected=%d sealed_failure_preserved=true model_calls=0", minimumBytes, minimumBytes-1)
			// Match the lower-bound probe in buildGeneration exactly. Rules,
			// secrets, open threads, explicit references and newest facts remain;
			// complete authority remains on the Go-only pointer.
			generation, compileErr := compileGeneration(authority, authority.State, "source_"+strings.Repeat("0", 32), authority.Revision, budget, capacity)
			raw, _ := json.Marshal(generation)
			components := map[string]json.RawMessage{}
			_ = json.Unmarshal(raw, &components)
			stateRaw, _ := json.Marshal(generation.State)
			notebookRaw, _ := json.Marshal(generation.State.Narrative)
			t.Logf("source_root=%s event_sha=%s revision=%d capacity=%d retained_context=%d headroom=%d state=%d facts=%d notebook=%d retained_history=%d latest_text=%d coverage=%d",
				tc.root, tc.sha, authority.Revision, capacity, len(raw), capacity-len(raw), len(stateRaw), len(narrativeJSON(generation.State.Facts)), len(notebookRaw), len(components["history"]), len(pages[len(pages)-1].Text), len(components["state_coverage"]))
			for _, result := range []struct {
				name string
				view Context
			}{
				{"current_at_recorded_reservation", oldGeneration},
				{"minimum_probe", minimumGeneration},
				{"exact_fit", exactGeneration},
				{"minus_one_rejected", belowGeneration},
				{"current_reservation", generation},
			} {
				view := result.view
				if !reflect.DeepEqual(view.AuthorityState, &authority.State) ||
					view.State.Narrative != nil || view.State.LiteraryMemory != nil ||
					len(view.History) == 0 || len(view.History) > len(authority.History) ||
					!reflect.DeepEqual(view.History, authority.History[len(authority.History)-len(view.History):]) {
					t.Fatal(result.name, "changed authority or whole history pages, or reintroduced the unselected notebook")
				}
				loaded := map[string]Fact{}
				for _, fact := range view.State.Facts {
					loaded[fact.ID] = fact
				}
				for _, fact := range authority.State.Facts {
					actual, exists := loaded[fact.ID]
					if exists && !reflect.DeepEqual(actual, fact) {
						t.Fatal(result.name, "materialized fact text or knowledge edges changed", fact.ID)
					}
					required := fact.Kind == "rule" || fact.Kind == "secret" ||
						fact.SourceRevision == authority.Revision
					if required && !exists {
						t.Fatal(result.name, "required source fact omitted", fact.ID)
					}
				}
				for _, thread := range authority.State.Threads {
					if thread.ResolvedAtRevision != nil {
						continue
					}
					for _, id := range thread.RelatedFactIDs {
						if _, exists := loaded[id]; !exists {
							t.Fatal(result.name, "open-thread premise omitted", id)
						}
					}
				}
			}
			after, _ := json.Marshal(authority)
			if !bytes.Equal(before, after) {
				t.Fatal("capacity replay changed complete authority, including its retained notebook")
			}
			if compileErr != nil {
				t.Fatalf("current compiler continuation must fit the unchanged 65536/8192 model budget: %v", compileErr)
			}
			if len(raw) > capacity {
				t.Fatal("current compiler accepted an oversized generation")
			}
		})
	}
}
