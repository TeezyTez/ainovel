//go:build integration

package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// This recorded prose is replayed with a fixed provider into an isolated test
// world. Passing establishes producer/consumer shape compatibility, not the
// truth of the story, a repaired benchmark page, or literary quality.
type writerContractRecording struct {
	Source struct {
		RootSHA256        string `json:"root_sha256"`
		ResultEventSHA256 string `json:"result_event_sha256"`
	} `json:"source"`
	Original struct {
		Raw       string `json:"raw"`
		RawSHA256 string `json:"raw_sha256"`
	} `json:"original"`
	SeparatorOnly24 struct {
		Raw       string `json:"raw"`
		RawSHA256 string `json:"raw_sha256"`
	} `json:"separator_only_24"`
}

type writerContractModel struct {
	syntheticPipelineModel
	raw    string
	schema json.RawMessage
}

func (m *writerContractModel) Generate(ctx context.Context, req model.Request) (model.Result, error) {
	result, err := m.syntheticPipelineModel.Generate(ctx, req)
	if err != nil {
		return result, err
	}
	switch m.stages[len(m.stages)-1] {
	case "memory":
		var envelope struct {
			Result narrativeDraft `json:"result"`
		}
		if err := StrictJSON([]byte(m.raw), &envelope); err != nil {
			return model.Result{}, err
		}
		draft := envelope.Result
		m.current.Title, m.current.Passage, m.current.StoryTime = draft.Title, draft.Passage, draft.StoryTime
		m.current.Outcome, m.current.Suggestions = draft.Outcome, draft.Suggestions
	case "write":
		m.schema = append(json.RawMessage(nil), req.Schema...)
		// Preserve the recorded JSON envelope bytes, not a re-encoded Draft.
		result.Text = m.raw
	}
	return result, nil
}

func writerContractFixture(t *testing.T) (writerContractRecording, []byte) {
	t.Helper()
	raw, err := os.ReadFile("../../../algorithms/tests/fixtures/benchmark-nar017-s03-draft-paragraphs.json")
	must(t, err)
	var fixture writerContractRecording
	must(t, json.Unmarshal(raw, &fixture))
	if fixture.Source.RootSHA256 != "21c9478a5c0a2c8bc1260597d5e94add846b3fc84ff10e3e5f83514e3cc2c147" ||
		fixture.Source.ResultEventSHA256 != "7fe6a1f05e28dc2b8638d0455da12339b2466849e0edba31de16fd819a2a510c" {
		t.Fatal("recorded draft lost its sealed source binding")
	}
	for _, sample := range []struct{ raw, digest string }{
		{fixture.Original.Raw, fixture.Original.RawSHA256},
		{fixture.SeparatorOnly24.Raw, fixture.SeparatorOnly24.RawSHA256},
	} {
		sum := sha256.Sum256([]byte(sample.raw))
		if hex.EncodeToString(sum[:]) != sample.digest {
			t.Fatal("recorded envelope bytes changed")
		}
	}
	var original, changed struct {
		Result narrativeDraft `json:"result"`
	}
	must(t, StrictJSON([]byte(fixture.Original.Raw), &original))
	must(t, StrictJSON([]byte(fixture.SeparatorOnly24.Raw), &changed))
	if strings.ReplaceAll(original.Result.Passage, "\n", "") != strings.ReplaceAll(changed.Result.Passage, "\n", "") {
		t.Fatal("separator control changed non-LF story characters")
	}
	original.Result.Passage = changed.Result.Passage
	if !reflect.DeepEqual(original, changed) {
		t.Fatal("separator control changed other Draft fields")
	}
	return fixture, raw
}

func compileWriterContract(t *testing.T, raw json.RawMessage) *jsonschema.Schema {
	t.Helper()
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	must(t, err)
	compiler := jsonschema.NewCompiler()
	const uri = "https://elselife.invalid/actual-rust-writer"
	must(t, compiler.AddResource(uri, value))
	schema, err := compiler.Compile(uri)
	// jsonschema/v6 uses Go RE2 by default. An ECMA-only pattern is a real
	// incompatibility, never converted into "the invalid fixture was rejected".
	if err != nil {
		t.Fatalf("actual writer schema cannot compile with Go JSON Schema validator: %v", err)
	}
	return schema
}

func TestActualRustWriterProducerContractRejectsRecordedOverflow(t *testing.T) {
	fixture, fixtureRaw := writerContractFixture(t)
	address := actualReadRuntime(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	var actualSchema json.RawMessage
	schemas := map[string]json.RawMessage{}
	poem := string(narrativeJSON(map[string]any{"result": narrativeDraft{
		Title: "单换行工程正控", Passage: "雨落在窗沿。\n灯光留在屋里。\n风从门前经过。",
		StoryTime: "暮色", Outcome: "continues", Suggestions: []string{},
	}}))
	for _, tc := range []struct {
		name, raw, mode string
		commit          bool
		calls           int
	}{
		{"recorded_32_paragraphs", fixture.Original.Raw, "read", false, 4},
		{"same_story_separator_only_24", fixture.SeparatorOnly24.Raw, "read", true, 6},
		{"act_recorded_overflow", fixture.Original.Raw, "act", false, 4},
		{"act_single_LF_poem", poem, "act", true, 6},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := testService(t)
			before := begin(t, s, "writer-contract", "begin")
			producer := &writerContractModel{raw: tc.raw}
			s.NarrativeEngine = true
			s.Generator = &Algorithm{Link: link, Model: producer, ModelName: "synthetic-writer-contract", Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			request := AdvanceRequest{RequestID: "writer-contract", BranchID: before.BranchID, ExpectedRevision: before.Revision, Mode: tc.mode}
			if tc.mode == "read" {
				request.ReadingRequest = "完整展开接下来这一节。"
			} else {
				request.Input = "我观察眼前环境。"
			}
			_, fresh, err := s.Advance(ctx, "writer-contract", before.ID, request)
			must(t, err)
			if !fresh {
				t.Fatal("isolated operation was not fresh")
			}
			must(t, s.GenerateAccepted(ctx, "writer-contract", request.RequestID))
			after, err := s.Get(ctx, "writer-contract", before.ID, before.BranchID)
			must(t, err)
			op, err := s.GetOperation(ctx, "writer-contract", before.ID, request.RequestID)
			must(t, err)
			if producer.calls != tc.calls || !reflect.DeepEqual(before.Pages, after.Pages[:len(before.Pages)]) {
				t.Fatalf("unexpected calls or old-history mutation: calls=%d stages=%v", producer.calls, producer.stages)
			}
			if tc.commit {
				if op.Status != "committed" || after.Revision != before.Revision+1 || after.Pages[len(after.Pages)-1].Text != producer.current.Passage {
					t.Fatalf("separator-only control did not reach exact formal commit: op=%+v", op)
				}
			} else if op.Status != "failed" || op.ErrorCode == nil || *op.ErrorCode != "narrative_stage_invalid" || op.CommittedRevision != nil || after.Revision != before.Revision {
				t.Fatalf("consumer failed to reject overflowing recorded Draft without commit: op=%+v", op)
			}
			if len(producer.schema) == 0 {
				t.Fatal("no actual Rust writer schema captured")
			}
			if schemas[tc.mode] == nil {
				schemas[tc.mode] = producer.schema
				if tc.mode == "read" {
					actualSchema = producer.schema
				}
				exportWriterContract(t, producer.schema, fixtureRaw, tc.mode)
			} else if !bytes.Equal(schemas[tc.mode], producer.schema) {
				t.Fatal("same-mode writer producer schema drifted across controls")
			}
			value, err := jsonschema.UnmarshalJSON(strings.NewReader(tc.raw))
			must(t, err)
			schemaErr := compileWriterContract(t, producer.schema).Validate(value)
			if tc.commit && schemaErr != nil {
				t.Fatalf("producer forbids consumer-valid separator control: %v", schemaErr)
			}
			if !tc.commit && schemaErr == nil {
				t.Error("PRODUCER_CONTRACT_GAP: actual Rust writer schema accepts recorded 32-paragraph envelope that actual Rust rejects without commit")
			}
			t.Logf("fixed provider stages=%v consumer_status=%s producer_accepts=%v", producer.stages, op.Status, schemaErr == nil)
		})
	}
	t.Run("actual_act_schema_three_four_boundary", func(t *testing.T) {
		schema := compileWriterContract(t, schemas["act"])
		for _, tc := range []struct {
			passage string
			accept  bool
		}{{"甲\n\n乙\n\n丙", true}, {"甲\n\n乙\n\n丙\n\n丁", false}} {
			value, err := jsonschema.UnmarshalJSON(bytes.NewReader(narrativeJSON(map[string]any{"result": narrativeDraft{
				Title: "工程格式边界", Passage: tc.passage, StoryTime: "暮色", Outcome: "continues", Suggestions: []string{},
			}})))
			must(t, err)
			if err := schema.Validate(value); (err == nil) != tc.accept {
				t.Fatalf("actual Act producer boundary accepts=%v want=%v: %v", err == nil, tc.accept, err)
			}
		}
	})
	t.Run("recorded_010_31_paragraph_producer_boundary", func(t *testing.T) {
		raw, err := os.ReadFile("../../../algorithms/tests/fixtures/benchmark-nar010-s06-draft-paragraphs.json")
		must(t, err)
		var other writerContractRecording
		must(t, json.Unmarshal(raw, &other))
		sum := sha256.Sum256([]byte(other.Original.Raw))
		if hex.EncodeToString(sum[:]) != other.Original.RawSHA256 || other.Source.RootSHA256 == "" || other.Source.ResultEventSHA256 == "" {
			t.Fatal("second recorded envelope/source binding invalid")
		}
		if len(actualSchema) == 0 {
			t.Fatal("actual writer schema was not captured")
		}
		value, err := jsonschema.UnmarshalJSON(strings.NewReader(other.Original.Raw))
		must(t, err)
		if err := compileWriterContract(t, actualSchema).Validate(value); err == nil {
			t.Error("PRODUCER_CONTRACT_GAP: actual Rust writer schema also accepts independent recorded 31-paragraph envelope")
		}
	})
}

func exportWriterContract(t *testing.T, schema json.RawMessage, fixtureRaw []byte, mode string) {
	t.Helper()
	dir := os.Getenv("ELSELIFE_TEST_WRITER_CONTRACT_EXPORT")
	if dir == "" {
		return
	}
	must(t, os.MkdirAll(dir, 0700))
	runtimePath := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	runtimeBytes, err := os.ReadFile(runtimePath)
	must(t, err)
	name := "writer-schema"
	if mode != "read" {
		name = "writer-nonread-schema"
	}
	must(t, os.WriteFile(filepath.Join(dir, name+".json"), schema, 0600))
	binding := map[string]any{
		"producer": "actual_rust_model_request", "synthetic_provider": true, "mode": mode,
		"runtime_sha256": fmt.Sprintf("%x", sha256.Sum256(runtimeBytes)),
		"fixture_sha256": fmt.Sprintf("%x", sha256.Sum256(fixtureRaw)),
		"schema_sha256":  fmt.Sprintf("%x", sha256.Sum256(schema)),
	}
	must(t, os.WriteFile(filepath.Join(dir, name+"-source.json"), narrativeJSON(binding), 0600))
	if oraclePath := os.Getenv("ELSELIFE_TEST_WRITER_PATTERN_ORACLE"); oraclePath != "" {
		raw, err := os.ReadFile(oraclePath)
		must(t, err)
		var oracle struct {
			Patterns map[string]string `json:"patterns"`
		}
		must(t, json.Unmarshal(raw, &oracle))
		var decoded map[string]any
		must(t, json.Unmarshal(schema, &decoded))
		result := decoded["properties"].(map[string]any)["result"].(map[string]any)
		draft := result["anyOf"].([]any)[0].(map[string]any)
		passage := draft["properties"].(map[string]any)["passage"].(map[string]any)
		limit := "24"
		if mode != "read" {
			limit = "3"
		}
		if oracle.Patterns[limit] == "" || passage["pattern"] != oracle.Patterns[limit] {
			t.Fatalf("actual %s schema pattern differs from independently verified v2/%s", mode, limit)
		}
	}
}
