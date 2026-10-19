package model

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCodexTransportSchemaMatchesStrictSubsetWithoutChangingCanonical(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/experience/v1/contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract map[string]any
	json.Unmarshal(raw, &contract)
	defs := contract["$defs"].(map[string]any)
	root := defs["generation_result"].(map[string]any)
	picked := contractDefinitionClosure(t, defs, "generation_result")
	root["$defs"] = picked
	original, _ := json.Marshal(root)
	transport, err := codexTransportSchema(original)
	if err != nil {
		t.Fatal(err)
	}
	var converted any
	json.Unmarshal(transport, &converted)
	var check func(any)
	check = func(v any) {
		switch n := v.(type) {
		case []any:
			for _, c := range n {
				check(c)
			}
		case map[string]any:
			for _, key := range []string{"oneOf", "allOf", "if", "then", "uniqueItems", "default", "const"} {
				if _, ok := n[key]; ok {
					t.Fatalf("unsupported keyword %s", key)
				}
			}
			if n["type"] == "object" {
				p := n["properties"].(map[string]any)
				req := n["required"].([]any)
				if n["additionalProperties"] != false || len(req) != len(p) {
					t.Fatal("non-strict object")
				}
			}
			for key, c := range n {
				if key != "properties" && key != "$defs" {
					check(c)
				} else if m, ok := c.(map[string]any); ok {
					for _, v := range m {
						check(v)
					}
				}
			}
		}
	}
	check(converted)
	after, _ := json.Marshal(root)
	if string(after) != string(original) {
		t.Fatal("mutated canonical schema")
	}
	for _, wire := range []string{`{"result":{"request_id":"r","source_handle":"h","selector":{"kind":"objects","objects":[{"type":"entity","id":"e","at_revision":null}],"cursor":null},"max_reply_bytes":1024}}`, `{"result":{"request_id":"r","source_handle":"h","selector":{"kind":"enumerate","type":"entity","terms":null,"match":null,"cursor":null,"fact_kind":null,"from_source_revision":null,"to_source_revision":null},"max_reply_bytes":1024}}`} {
		out, err := codexNormalizeOutput(wire, original)
		if err != nil || strings.Contains(out, "null") {
			t.Fatalf("normalization failed: %s %v", out, err)
		}
	}
}
func TestCodexNormalizeOnlySyntheticNullsAndPreserveUnknownFieldsForValidation(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"optional":{"type":"string"},"nullable":{"type":["string","null"]},"required_nullable":{"type":["string","null"]},"required_string":{"type":"string"},"records":{"type":"array","items":{"$ref":"#/$defs/record"}}},"required":["required_nullable","required_string","records"],"$defs":{"record":{"type":"object","properties":{"label":{"type":"string"},"extra":{"type":"string"}},"required":["label"]}}}`)
	out, err := codexNormalizeOutput(`{"optional":null,"nullable":null,"required_nullable":null,"required_string":null,"unknown":null,"records":[{"label":"x","extra":null}]}`, schema)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	json.Unmarshal([]byte(out), &got)
	if _, ok := got["optional"]; ok {
		t.Fatal("synthetic null retained")
	}
	for _, key := range []string{"nullable", "required_nullable", "required_string", "unknown"} {
		if v, ok := got[key]; !ok || v != nil {
			t.Fatalf("changed domain null %s", key)
		}
	}
	if len(got["records"].([]any)[0].(map[string]any)) != 1 {
		t.Fatal("nested synthetic null retained")
	}
}

func TestCodexNormalizationRejectsDuplicateKeys(t *testing.T) {
	for _, raw := range []string{`{"answer":1,"answer":2}`, `{"records":[{"id":"one","id":"two"}]}`} {
		if _, err := codexNormalizeOutput(raw, json.RawMessage(`{"type":"object"}`)); err != ErrInvalidResponse {
			t.Fatal("duplicate key evidence erased")
		}
	}
}

// Pick the full reference closure so optional protocol additions cannot leave
// the real Codex transport test with dangling definitions.
func contractDefinitionClosure(t *testing.T, defs map[string]any, name string) map[string]any {
	t.Helper()
	picked := map[string]any{}
	seen := map[string]bool{name: true}
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				walk(item)
			}
		case map[string]any:
			if ref, ok := x["$ref"].(string); ok {
				if !strings.HasPrefix(ref, "#/$defs/") {
					t.Fatalf("unsupported reference %s", ref)
				}
				key := strings.TrimPrefix(ref, "#/$defs/")
				definition, ok := defs[key]
				if !ok {
					t.Fatalf("missing schema definition %s", key)
				}
				if !seen[key] {
					seen[key] = true
					picked[key] = definition
					walk(definition)
				}
			}
			for _, item := range x {
				walk(item)
			}
		}
	}
	walk(defs[name])
	return picked
}
func TestContractDefinitionClosureIncludesTransitiveOptionalFields(t *testing.T) {
	defs := map[string]any{"root": map[string]any{"$ref": "#/$defs/candidate"}, "candidate": map[string]any{"properties": map[string]any{"optional": map[string]any{"$ref": "#/$defs/gameplay_update"}}}, "gameplay_update": map[string]any{"$ref": "#/$defs/event"}, "event": map[string]any{"type": "object"}}
	picked := contractDefinitionClosure(t, defs, "root")
	if len(picked) != 3 || picked["event"] == nil {
		t.Fatal("transitive schema reference omitted")
	}
}

func TestCodexTransportPreservesNullableObjectsAndDropsOnlyUnreachableDefinitions(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"record":{"type":["object","null"],"properties":{"child":{"$ref":"#/$defs/leaf"}},"required":["child"],"additionalProperties":false}},"required":["record"],"additionalProperties":false,"$defs":{"leaf":{"type":"object","properties":{"next":{"anyOf":[{"$ref":"#/$defs/leaf"},{"type":"null"}]}},"required":["next"],"additionalProperties":false},"unused":{"type":"object","properties":{"private_context":{"type":"string"}},"required":["private_context"],"additionalProperties":false}}}`)
	raw, err := codexTransportSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	var converted map[string]any
	json.Unmarshal(raw, &converted)
	record := converted["properties"].(map[string]any)["record"].(map[string]any)
	types, ok := record["type"].([]any)
	if !ok || len(types) != 2 || types[0] != "object" || types[1] != "null" {
		t.Fatal("transport narrowed a nullable object")
	}
	defs := converted["$defs"].(map[string]any)
	if len(defs) != 1 || defs["leaf"] == nil {
		t.Fatal("reachable recursive definition removed or unreachable context retained")
	}
	out, err := codexNormalizeOutput(`{"record":null}`, schema)
	if err != nil || out != `{"record":null}` {
		t.Fatal("required nullable object lost its domain meaning", err)
	}
}
