//go:build integration && codexlive

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

// This controlled experiment deliberately isolates evidence selection from the
// full pipeline. The recent-only arm is a lossy control, not an old-engine
// reproduction. Curated materials contain sources, never suggested dialogue.
func TestNarrativeMemoryComparisonLive(t *testing.T) {
	dir := os.Getenv("ELSELIFE_MEMORY_COMPARISON_DIR")
	if dir == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit fixed-input comparison configuration required")
	}
	must(t, os.MkdirAll(dir, 0700))
	state := EmptyState()
	state.StoryTime = "周三21:30"
	state.Entities = []Entity{
		{ID: "lin", Kind: "person", Name: "林舟", Known: true, RelatedIDs: []string{}},
		{ID: "chen", Kind: "person", Name: "陈禾", Known: true, RelatedIDs: []string{}},
	}
	fact := func(id, subject, text string, revision int64) Fact {
		return Fact{ID: id, SubjectID: subject, Text: text, Kind: "fact", Known: true, KnownBy: []string{"lin", "chen"}, SourceRevision: revision}
	}
	oldPage := "上周林舟晚归，陈禾等到饭凉了。陈禾说：“晚了发个字就行。”林舟答应了。两人没有商量固定回家的钟点。"
	current := "周三九点半，林舟带着一袋夜宵进门。陈禾坐在桌旁，面已经凉了。今晚林舟没有发过晚归消息。"
	state.Facts = []Fact{
		fact("chen-expression", "chen", "陈禾与林舟熟悉，平时说话常省略双方知道的前提；他也会拿林舟做得歪歪扭扭的陶碗开玩笑。", 1),
		fact("lin-expression", "lin", "林舟平时说话简短，解释事情时常先交代眼前可做的事；熟人追问时也会认真说清经过。", 1),
		fact("late-agreement", "chen", "林舟上周答应了陈禾的晚归告知请求，未约定固定归家钟点。", 1),
		fact("current-arrival", "lin", current, 2),
	}
	memory := MemoryEntry{MemoryChange: MemoryChange{ID: "late-message", Kind: "commitment", SubjectIDs: []string{"lin"}, TargetIDs: []string{"chen"}, Cue: "晚归时发消息的约定", Summary: "上周晚归让陈禾等饭；林舟答应以后晚归时发消息。约定不含固定回家时间，也没有约定必须随时汇报行踪。", Status: "active", RetrievalKeys: []string{"晚归", "等饭"}, FactIDs: []string{"late-agreement"}, Quote: "陈禾说：“晚了发个字就行。”林舟答应了。"}, SourceRevision: 1, UpdatedRevision: 1, SourceSHA256: memoryPageSHA256(oldPage)}
	state.LiteraryMemory = &LiteraryMemory{Version: 1, IndexedThroughRevision: 2, Entries: []MemoryEntry{memory}}
	c := Context{Version: 2, Revision: 2, Mode: "read", State: state, AuthorityState: &state}
	run := newNarrativeRun(c)
	const evidenceBudget = 8192
	needs := ContextNeeds{ParticipantIDs: []string{"lin", "chen"}, FactIDs: []string{"current-arrival"}}
	selected, err := run.prepareMaterials("write", "", needs, evidenceBudget)
	must(t, err)
	compressed := selected
	compressed.Memories = append([]MemoryMaterial{}, selected.Memories...)
	for i, item := range compressed.Memories {
		if item.ID == memory.ID {
			compressed.Memories[i] = memoryMaterial(memory, "summary")
		}
	}
	coverage := MaterialCoverage{Scope: "curated_known_sources", Unqueried: []string{"other_history"}, Uncertain: []string{}}
	curated := ContextBundle{Stage: "write", BaseRevision: 2, Facts: append([]Fact{}, state.Facts...), Memories: []MemoryMaterial{memoryMaterial(memory, "source")}, Coverage: coverage}
	recent := ContextBundle{Stage: "write", BaseRevision: 2, Facts: []Fact{state.Facts[3]}, Coverage: MaterialCoverage{Scope: "recent_only_control", Unqueried: []string{"earlier_sources"}, Uncertain: []string{"missing_history_does_not_mean_no_history"}}}
	arms := []struct {
		Name      string
		Materials ContextBundle
	}{{"recent-only-control", recent}, {"curated-source", curated}, {"system-selection", selected}, {"same-selection-summary", compressed}}
	modelName := os.Getenv("ELSELIFE_DEV_CODEX_MODEL")
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), modelName, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	prompt := "依据给定的虚构前史和当前局面写下一小段中文小说，第三人称，约300至450字。人物的目的、关系和眼下情境影响其说话和行动；资料不是必须逐条说出口的台词。允许沉默、普通交流和不确定，不强制争吵、和解、回忆或展示口头禅。缺失材料不代表历史不存在；不得补造已经发生的往事。当前新反应可以创作。只返回JSON。"
	schema := json.RawMessage(`{"type":"object","additionalProperties":false,"required":["result"],"properties":{"result":{"type":"object","additionalProperties":false,"required":["passage"],"properties":{"passage":{"type":"string"}}}}}`)
	for _, arm := range arms {
		materialBytes, _ := json.Marshal(arm.Materials)
		if len(materialBytes) > evidenceBudget {
			t.Fatalf("%s exceeded common evidence ceiling", arm.Name)
		}
		input, _ := json.Marshal(map[string]any{"scene": current, "participants": []string{"林舟", "陈禾"}, "materials": arm.Materials})
		request, err := model.VerifyContextBudget(model.Request{Model: modelName, Schema: schema, Messages: []model.Message{{Role: "system", Content: prompt}, {Role: "user", Content: string(input)}}}, 65536, 4096, true)
		must(t, err)
		raw, _ := json.MarshalIndent(request, "", "  ")
		must(t, os.WriteFile(filepath.Join(dir, arm.Name+"-request.json"), raw, 0600))
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		started := time.Now()
		result, callErr := cli.Generate(ctx, request)
		cancel()
		out := map[string]any{"arm": arm.Name, "result": result, "elapsed_ms": time.Since(started).Milliseconds(), "input_bytes": len(raw), "evidence_bytes": len(materialBytes), "evidence_ceiling": evidenceBudget, "error": ""}
		if callErr != nil {
			out["error"] = callErr.Error()
		}
		raw, _ = json.MarshalIndent(out, "", "  ")
		must(t, os.WriteFile(filepath.Join(dir, arm.Name+"-result.json"), raw, 0600))
		t.Logf("%s evidence_bytes=%d elapsed_ms=%d error=%v", arm.Name, len(materialBytes), time.Since(started).Milliseconds(), callErr)
		if callErr != nil {
			t.Error(fmt.Errorf("%s: %w", arm.Name, callErr))
		}
	}
}
