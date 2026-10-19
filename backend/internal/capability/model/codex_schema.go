package model

import (
	"bytes"
	"encoding/json"
	"io"
	"sort"
	"strings"
)

// Codex uses the strict structured-output subset. The domain schema stays
// authoritative: this transport schema is a superset, never a replacement for
// Go/Rust validation. Optional fields become required nullable transport fields.
func codexTransportSchema(raw json.RawMessage) (json.RawMessage, error) {
	var schema any
	if json.Unmarshal(raw, &schema) != nil {
		return nil, ErrRequestFailed
	}
	if root, ok := schema.(map[string]any); ok {
		codexPruneDefinitions(root)
	}
	var visit func(any)
	visit = func(node any) {
		m, ok := node.(map[string]any)
		if !ok {
			return
		}
		// Conditional/intersection and set constraints are checked by the domain.
		for _, key := range []string{"allOf", "if", "then", "else", "not", "uniqueItems", "default"} {
			delete(m, key)
		}
		if v, ok := m["oneOf"]; ok {
			m["anyOf"] = v
			delete(m, "oneOf")
		}
		if v, ok := m["const"]; ok {
			m["enum"] = []any{v}
			delete(m, "const")
		}
		if _, ok := m["type"]; !ok {
			if values, ok := m["enum"].([]any); ok && len(values) > 0 {
				switch values[0].(type) {
				case string:
					m["type"] = "string"
				case bool:
					m["type"] = "boolean"
				case float64:
					m["type"] = "number"
				}
			}
		}
		for _, key := range []string{"$defs", "definitions"} {
			if defs, ok := m[key].(map[string]any); ok {
				for _, v := range defs {
					visit(v)
				}
			}
		}
		for _, key := range []string{"anyOf"} {
			if parts, ok := m[key].([]any); ok {
				for _, v := range parts {
					visit(v)
				}
			}
		}
		visit(m["items"])
		if props, ok := m["properties"].(map[string]any); ok {
			required := map[string]bool{}
			if keys, ok := m["required"].([]any); ok {
				for _, key := range keys {
					if k, ok := key.(string); ok {
						required[k] = true
					}
				}
			}
			keys := make([]string, 0, len(props))
			for key, v := range props {
				keys = append(keys, key)
				visit(v)
				if !required[key] {
					props[key] = map[string]any{"anyOf": []any{v, map[string]any{"type": "null"}}}
				}
			}
			sort.Strings(keys)
			m["required"] = keys
			m["additionalProperties"] = false
			if _, exists := m["type"]; !exists {
				m["type"] = "object"
			}
		}
	}
	visit(schema)
	return json.Marshal(schema)
}

// Remove only synthetic nulls added to originally optional, nonnullable fields.
// Required nulls and originally nullable fields keep their domain meaning.
func codexNormalizeOutput(text string, raw json.RawMessage) (string, error) {
	var schema map[string]any
	if json.Unmarshal(raw, &schema) != nil {
		return "", ErrRequestFailed
	}
	if !codexUniqueJSON(text) {
		return "", ErrInvalidResponse
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return "", ErrInvalidResponse
	}
	var resolve func(map[string]any) map[string]any
	resolve = func(m map[string]any) map[string]any {
		if ref, ok := m["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
			var current any = schema
			for _, key := range strings.Split(ref[2:], "/") {
				obj, ok := current.(map[string]any)
				if !ok {
					return m
				}
				current = obj[strings.ReplaceAll(strings.ReplaceAll(key, "~1", "/"), "~0", "~")]
			}
			if obj, ok := current.(map[string]any); ok {
				return obj
			}
		}
		return m
	}
	var nullable func(map[string]any) bool
	nullable = func(m map[string]any) bool {
		m = resolve(m)
		if m["type"] == "null" {
			return true
		}
		if types, ok := m["type"].([]any); ok {
			for _, v := range types {
				if v == "null" {
					return true
				}
			}
		}
		for _, key := range []string{"anyOf", "oneOf"} {
			if parts, ok := m[key].([]any); ok {
				for _, part := range parts {
					if p, ok := part.(map[string]any); ok && nullable(p) {
						return true
					}
				}
			}
		}
		return false
	}
	var matches func(any, map[string]any) bool
	matches = func(v any, m map[string]any) bool {
		m = resolve(m)
		if c, ok := m["const"]; ok {
			a, _ := json.Marshal(v)
			b, _ := json.Marshal(c)
			return bytes.Equal(a, b)
		}
		obj, ok := v.(map[string]any)
		if !ok {
			return true
		}
		if keys, ok := m["required"].([]any); ok {
			for _, k := range keys {
				if _, exists := obj[k.(string)]; !exists {
					return false
				}
			}
		}
		if props, ok := m["properties"].(map[string]any); ok {
			for k, p := range props {
				if child, exists := obj[k]; exists {
					if sub, ok := p.(map[string]any); ok {
						if _, constant := sub["const"]; constant && !matches(child, sub) {
							return false
						}
					}
				}
			}
		}
		return true
	}
	var normalize func(any, map[string]any)
	normalize = func(v any, m map[string]any) {
		m = resolve(m)
		for _, key := range []string{"anyOf", "oneOf"} {
			if parts, ok := m[key].([]any); ok {
				for _, part := range parts {
					if sub, ok := part.(map[string]any); ok && matches(v, sub) {
						normalize(v, sub)
						break
					}
				}
			}
		}
		if arr, ok := v.([]any); ok {
			if item, ok := m["items"].(map[string]any); ok {
				for _, child := range arr {
					normalize(child, item)
				}
			}
		}
		obj, ok := v.(map[string]any)
		if !ok {
			return
		}
		props, ok := m["properties"].(map[string]any)
		if !ok {
			return
		}
		required := map[string]bool{}
		if keys, ok := m["required"].([]any); ok {
			for _, k := range keys {
				required[k.(string)] = true
			}
		}
		for key, property := range props {
			child, exists := obj[key]
			if !exists {
				continue
			}
			sub, ok := property.(map[string]any)
			if !ok {
				continue
			}
			if child == nil && !required[key] && !nullable(sub) {
				delete(obj, key)
				continue
			}
			normalize(child, sub)
		}
	}
	normalize(value, schema)
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", ErrInvalidResponse
	}
	return string(encoded), nil
}

// Normalization must not erase duplicate-key evidence before domain validation.
func codexUniqueJSON(text string) bool {
	d := json.NewDecoder(strings.NewReader(text))
	d.UseNumber()
	var read func() bool
	read = func() bool {
		token, err := d.Token()
		if err != nil {
			return false
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return true
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return false
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return false
				}
				seen[name] = true
				if !read() {
					return false
				}
			}
			end, err := d.Token()
			return err == nil && end == json.Delim('}')
		case '[':
			for d.More() {
				if !read() {
					return false
				}
			}
			end, err := d.Token()
			return err == nil && end == json.Delim(']')
		default:
			return false
		}
	}
	if !read() {
		return false
	}
	_, err := d.Token()
	return err == io.EOF
}

// Keep the complete transitive reference closure, including recursive definitions.
// Unused Context/State schemas are not part of the response transport contract.
func codexPruneDefinitions(root map[string]any) {
	namespaces := map[string]map[string]any{}
	kept := map[string]map[string]any{}
	for _, name := range []string{"$defs", "definitions"} {
		if defs, ok := root[name].(map[string]any); ok {
			namespaces[name] = defs
			kept[name] = map[string]any{}
		}
	}
	seen := map[string]bool{}
	var walk func(any)
	walk = func(v any) {
		switch n := v.(type) {
		case []any:
			for _, child := range n {
				walk(child)
			}
		case map[string]any:
			if ref, ok := n["$ref"].(string); ok {
				parts := strings.Split(ref, "/")
				if len(parts) >= 3 && parts[0] == "#" {
					namespace, key := parts[1], strings.ReplaceAll(strings.ReplaceAll(parts[2], "~1", "/"), "~0", "~")
					marker := namespace + "/" + key
					if def, exists := namespaces[namespace][key]; exists && !seen[marker] {
						seen[marker] = true
						kept[namespace][key] = def
						walk(def)
					}
				}
			}
			for _, child := range n {
				walk(child)
			}
		}
	}
	for key, value := range root {
		if key != "$defs" && key != "definitions" {
			walk(value)
		}
	}
	for namespace, defs := range kept {
		root[namespace] = defs
	}
}
