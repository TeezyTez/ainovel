//go:build integration

package model

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

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// The input schema must first be exported by the actual Rust/Go integration
// test. This exercises the real transport converter, with no CLI or model call.
// An absent export is explicit, never replaced by a handwritten schema.
func TestCodexTransportPreservesActualRustWriterParagraphContract(t *testing.T) {
	dir := os.Getenv("ELSELIFE_TEST_WRITER_CONTRACT_EXPORT")
	if dir == "" {
		t.Skip("requires schema exported by TestActualRustWriterProducerContractRejectsRecordedOverflow; no product model")
	}
	original, err := os.ReadFile(filepath.Join(dir, "writer-schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	bindingRaw, err := os.ReadFile(filepath.Join(dir, "writer-schema-source.json"))
	if err != nil {
		t.Fatal(err)
	}
	var binding struct {
		Producer   string `json:"producer"`
		SchemaHash string `json:"schema_sha256"`
	}
	if err := json.Unmarshal(bindingRaw, &binding); err != nil {
		t.Fatal(err)
	}
	if binding.Producer != "actual_rust_model_request" || binding.SchemaHash != fmt.Sprintf("%x", sha256.Sum256(original)) {
		t.Fatal("actual writer schema export binding mismatch")
	}
	originalCopy := append([]byte(nil), original...)
	transport, err := codexTransportSchema(original)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, originalCopy) {
		t.Fatal("transport conversion mutated producer schema")
	}
	if !reflect.DeepEqual(writerPatternValues(t, original), writerPatternValues(t, transport)) {
		t.Fatal("transport conversion lost or changed producer pattern constraints")
	}
	canonical, strict := compileWriterTransportSchema(t, original), compileWriterTransportSchema(t, transport)
	for _, name := range []string{"benchmark-nar017-s03-draft-paragraphs.json", "benchmark-nar010-s06-draft-paragraphs.json"} {
		raw, err := os.ReadFile(filepath.Join("../../../../algorithms/tests/fixtures", name))
		if err != nil {
			t.Fatal(err)
		}
		var fixture struct {
			Original struct {
				Raw string `json:"raw"`
			} `json:"original"`
			SeparatorOnly24 struct {
				Raw string `json:"raw"`
			} `json:"separator_only_24"`
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			label, raw string
			accept     bool
		}{
			{"recorded_overflow", fixture.Original.Raw, false},
			{"separator_only_24", fixture.SeparatorOnly24.Raw, true},
		} {
			t.Run(name+"/"+tc.label, func(t *testing.T) {
				value, err := jsonschema.UnmarshalJSON(strings.NewReader(tc.raw))
				if err != nil {
					t.Fatal(err)
				}
				for _, schema := range []struct {
					name  string
					value *jsonschema.Schema
				}{{"producer", canonical}, {"strict_transport", strict}} {
					validationErr := schema.value.Validate(value)
					if (validationErr == nil) != tc.accept {
						t.Errorf("%s contract accepts=%v want=%v; recorded overflow must be excluded before generation: %v", schema.name, validationErr == nil, tc.accept, validationErr)
					}
				}
				if tc.accept {
					normalized, err := codexNormalizeOutput(tc.raw, original)
					if err != nil {
						t.Fatal(err)
					}
					var got any
					if err := json.Unmarshal([]byte(normalized), &got); err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(value, got) {
						t.Fatal("normalization changed separator-control Draft values")
					}
				}
			})
		}
	}
	t.Logf("actual producer schema=%x strict transport=%x patterns=%d", sha256.Sum256(original), sha256.Sum256(transport), len(writerPatternValues(t, original)))
}

func TestCodexTransportPreservesActualRustActParagraphContract(t *testing.T) {
	dir := os.Getenv("ELSELIFE_TEST_WRITER_CONTRACT_EXPORT")
	if dir == "" {
		t.Skip("requires actual Rust Act writer schema export; no product model")
	}
	original, err := os.ReadFile(filepath.Join(dir, "writer-nonread-schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	bindingRaw, err := os.ReadFile(filepath.Join(dir, "writer-nonread-schema-source.json"))
	if err != nil {
		t.Fatal(err)
	}
	var binding struct {
		Producer   string `json:"producer"`
		Mode       string `json:"mode"`
		SchemaHash string `json:"schema_sha256"`
	}
	if err := json.Unmarshal(bindingRaw, &binding); err != nil {
		t.Fatal(err)
	}
	if binding.Producer != "actual_rust_model_request" || binding.Mode != "act" || binding.SchemaHash != fmt.Sprintf("%x", sha256.Sum256(original)) {
		t.Fatal("actual Act writer schema export binding mismatch")
	}
	transport, err := codexTransportSchema(original)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(writerPatternValues(t, original), writerPatternValues(t, transport)) {
		t.Fatal("transport conversion lost or changed Act pattern constraints")
	}
	canonical, strict := compileWriterTransportSchema(t, original), compileWriterTransportSchema(t, transport)
	for _, tc := range []struct {
		name, passage string
		accept        bool
	}{
		{"three_paragraphs", "one\n\ntwo\n\nthree", true},
		{"four_paragraphs", "one\n\ntwo\n\nthree\n\nfour", false},
		{"single_LF_poem", "one\ntwo\nthree\nfour", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{"result": map[string]any{
				"title": "synthetic paragraph control", "passage": tc.passage,
				"story_time": "unchanged", "outcome": "continues", "suggestions": []string{},
			}})
			if err != nil {
				t.Fatal(err)
			}
			value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
			if err != nil {
				t.Fatal(err)
			}
			for _, schema := range []*jsonschema.Schema{canonical, strict} {
				if err := schema.Validate(value); (err == nil) != tc.accept {
					t.Errorf("actual Act schema accepts=%v want=%v: %v", err == nil, tc.accept, err)
				}
			}
		})
	}
}

func compileWriterTransportSchema(t *testing.T, raw []byte) *jsonschema.Schema {
	t.Helper()
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	const uri = "https://elselife.invalid/actual-writer-transport"
	if err := compiler.AddResource(uri, value); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile(uri)
	if err != nil {
		t.Fatalf("Go RE2/JSON Schema compilation error is not a valid rejection: %v", err)
	}
	return schema
}

func writerPatternValues(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		t.Fatal(err)
	}
	out := map[string]any{}
	var walk func(string, any)
	walk = func(path string, value any) {
		switch v := value.(type) {
		case map[string]any:
			for key, child := range v {
				if key == "pattern" {
					out[path] = child
				} else {
					walk(path+"/"+key, child)
				}
			}
		case []any:
			for i, child := range v {
				walk(fmt.Sprintf("%s/%d", path, i), child)
			}
		}
	}
	walk("", root)
	return out
}
