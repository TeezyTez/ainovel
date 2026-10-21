//go:build integration

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

const extractionTransportPassage = "第一段保留真正换行。\n逐字保留\"引号\"与字面\\n、反斜杠\\、<tag>🙂。\n\n  第二段保留前导空格与\t制表符。"

// The Rust runtime and CLI adapter are real. Only the CLI process/model output
// is synthetic: this tests schema accounting and byte fidelity, not prose quality.
type extractionTransportModel struct {
	syntheticPipelineModel
	cli            *model.CodexCLI
	dir            string
	hasGameplay    bool
	extractionRuns int
	originalSchema json.RawMessage
	strictSchema   json.RawMessage
}

func (m *extractionTransportModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	result, err := m.syntheticPipelineModel.Generate(ctx, request)
	if err != nil {
		return result, err
	}
	switch m.stages[len(m.stages)-1] {
	case "memory":
		m.current.Passage = extractionTransportPassage
	case "extract":
		m.extractionRuns++
		m.originalSchema = append(json.RawMessage(nil), request.Schema...)
		if m.hasGameplay {
			// Optional nonnullable fields are required nullable fields on the
			// strict CLI wire. Exercise their removal without changing any prose.
			var wire map[string]map[string]map[string]any
			if err := json.Unmarshal([]byte(result.Text), &wire); err != nil {
				return model.Result{}, err
			}
			wire["result"]["candidate"]["gameplay_update"] = nil
			result.Text = string(narrativeJSON(wire))
		}
		completed := narrativeJSON(map[string]any{"type": "item.completed", "item": map[string]any{"type": "agent_message", "text": result.Text}})
		events := append(completed, []byte("\n{\"type\":\"turn.completed\"}\n")...)
		if err := os.WriteFile(filepath.Join(m.dir, "response.jsonl"), events, 0600); err != nil {
			return model.Result{}, err
		}
		result, err = m.cli.Generate(ctx, request)
		if err != nil {
			return result, err
		}
		m.strictSchema, err = os.ReadFile(filepath.Join(m.dir, "transport-schema.json"))
		if err != nil {
			return model.Result{}, err
		}
		var normalized struct {
			Result struct {
				Candidate Candidate `json:"candidate"`
			} `json:"result"`
		}
		if err := StrictJSON([]byte(result.Text), &normalized); err != nil {
			return model.Result{}, err
		}
		if !reflect.DeepEqual(normalized.Result.Candidate, m.current) {
			return model.Result{}, fmt.Errorf("synthetic CLI normalization changed candidate fields")
		}
	}
	return result, nil
}

func TestActualRustExtractionCLITransportSchemasAndExactObjectBytes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("synthetic CLI subprocess requires POSIX; no real model is used")
	}
	address := actualReadRuntime(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	var schemaHashes [][32]byte
	for _, carrier := range []string{"ordinary", "experience_only", "active_game"} {
		t.Run(carrier, func(t *testing.T) {
			authority := sampleContext()
			authority.Mode, authority.Seed, authority.Revision = "read", "", 1
			authority.State.StoryTime = "雨后"
			authority.History = []HistoryPage{{Revision: 1, Mode: "begin", Text: "雨声渐轻。"}}
			authority.State.Narrative = notebookFixture(1)
			authority.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}
			if carrier != "ordinary" {
				authority.State.Gameplay = &GameplayState{SchemaVersion: 1, Game: json.RawMessage(`null`), Location: "茶铺", Inventory: []string{}, Experience: json.RawMessage(`null`)}
				authority.GameplayRuntime = artifactRuntimeForTest(t)
				if carrier == "active_game" {
					authority.State.Gameplay.Game = json.RawMessage(`{"schemaVersion":1,"entities":[],"surfaces":[],"spatial":null,"journeys":null}`)
				}
			}
			if err := validateContract(narrativeJSON(authority), "context"); err != nil {
				t.Fatal("invalid controlled initial context", err)
			}
			dir := t.TempDir()
			path := filepath.Join(dir, "synthetic-codex")
			// The executable locates only its own fixed test files. It never reads
			// credentials, executes model commands, or contacts a model provider.
			script := `#!/bin/sh
set -eu
fixture_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
schema=
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output-schema' ]; then
    shift
    schema=$1
  fi
  shift
done
test -n "$schema"
cp -- "$schema" "$fixture_dir/transport-schema.json"
cat > "$fixture_dir/input.txt"
printf 'call\n' >> "$fixture_dir/calls.txt"
cat "$fixture_dir/response.jsonl"
`
			must(t, os.WriteFile(path, []byte(script), 0700))
			cli, err := model.NewCodexCLI(path, dir, "synthetic-extraction-transport", dir)
			must(t, err)
			producer := &extractionTransportModel{cli: cli, dir: dir, hasGameplay: carrier != "ordinary"}
			a := &Algorithm{Link: link, Model: producer, ModelName: cli.Model, Timeout: 10 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			service := &Service{NarrativeEngine: true, Generator: a}
			generation, err := service.buildGeneration(ctx, pgq.ExperienceOperation{BaseRevision: authority.Revision}, authority)
			must(t, err)
			candidate, err := a.GenerateWithReads(ctx, generation, "synthetic-extraction-transport", &recordedReviewAudit{origin: syntheticPipelineOrigin(generation)})
			if err != nil {
				t.Fatalf("actual pipeline failed: %v stages=%v", err, producer.stages)
			}
			if producer.extractionRuns != 1 || !reflect.DeepEqual(producer.stages, []string{"memory", "plan", "evaluate", "write", "extract", "review"}) {
				t.Fatalf("unexpected retry/stage path: %v", producer.stages)
			}
			calls, err := os.ReadFile(filepath.Join(dir, "calls.txt"))
			must(t, err)
			if string(calls) != "call\n" {
				t.Fatal("synthetic extraction CLI ran more than once")
			}
			if !json.Valid(producer.strictSchema) || len(producer.strictSchema)-len(producer.originalSchema) > 1024 {
				t.Fatalf("strict schema exceeds 1 KiB growth allowance: source=%d transport=%d", len(producer.originalSchema), len(producer.strictSchema))
			}
			checkExtractionCarrierSchema(t, producer.originalSchema, carrier)
			schemaHash := sha256.Sum256(producer.originalSchema)
			schemaHashes = append(schemaHashes, schemaHash)
			t.Logf("synthetic transport carrier=%s source_bytes=%d strict_bytes=%d growth=%d source_sha256=%x strict_sha256=%x", carrier, len(producer.originalSchema), len(producer.strictSchema), len(producer.strictSchema)-len(producer.originalSchema), schemaHash, sha256.Sum256(producer.strictSchema))
			if candidate.Passage != extractionTransportPassage {
				t.Fatal("Rust extraction round trip changed LF/literal slash-n/Unicode/whitespace")
			}
			must(t, verifyNarrativeApproval(candidate, candidate.Review))
			_, err = Apply(authority, candidate)
			must(t, err)
			withoutReview := candidate
			withoutReview.Review = nil
			// Service checks approval before its generic Apply function. Exercise
			// that actual gate, rather than assigning review policy to Apply.
			if err := verifyNarrativeApproval(withoutReview, withoutReview.Review); err == nil {
				t.Fatal("structured extraction bypassed independent approval")
			}
			changed := candidate
			changed.Passage = strings.Replace(changed.Passage, "\\n", "\n", 1)
			if err := verifyNarrativeApproval(changed, changed.Review); err == nil {
				t.Fatal("changing a literal slash-n after review bypassed approval binding")
			}
		})
	}
	if len(schemaHashes) == 3 && (schemaHashes[0] == schemaHashes[1] || schemaHashes[1] == schemaHashes[2] || schemaHashes[0] == schemaHashes[2]) {
		t.Fatal("three carrier tests did not exercise distinct actual Rust schemas")
	}
}

func checkExtractionCarrierSchema(t *testing.T, raw json.RawMessage, carrier string) {
	t.Helper()
	var schema struct {
		Definitions map[string]struct {
			Properties map[string]json.RawMessage `json:"properties"`
		} `json:"$defs"`
	}
	must(t, json.Unmarshal(raw, &schema))
	_, gameplay := schema.Definitions["candidate"].Properties["gameplay_update"]
	if gameplay != (carrier != "ordinary") || strings.Contains(string(raw), "candidate_json") {
		t.Fatal("unexpected actual Rust candidate wire/carrier schema")
	}
	if carrier != "ordinary" {
		var game struct {
			Type string `json:"type"`
		}
		must(t, json.Unmarshal(schema.Definitions["gameplay_update"].Properties["game"], &game))
		if (game.Type == "null") != (carrier == "experience_only") {
			t.Fatal("experience and game extraction schemas were not specialized")
		}
	}
}
