//! Closed gameplay carriers. Go performs the authoritative source-rule replay.
//! These checks bound proposals and retain evidence before they cross that boundary.
use super::{Checked, Invalid, CONTRACT};
use serde_json::Value;
use std::sync::OnceLock;

fn contract() -> &'static Value {
    static VALUE: OnceLock<Value> = OnceLock::new();
    VALUE.get_or_init(|| serde_json::from_str(CONTRACT).expect("pinned contract"))
}
fn type_matches(value: &Value, kind: &str) -> bool {
    match kind {
        "object" => value.is_object(), "array" => value.is_array(),
        "string" => value.is_string(), "boolean" => value.is_boolean(),
        "null" => value.is_null(), "number" => value.as_f64().is_some_and(f64::is_finite),
        "integer" => value.as_u64().is_some() || value.as_i64().is_some(),
        _ => false,
    }
}
fn matches(value: &Value, schema: &Value, depth: usize) -> bool {
    if depth > 80 { return false; }
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        return reference.strip_prefix('#').and_then(|p| contract().pointer(p))
            .is_some_and(|s| matches(value, s, depth + 1));
    }
    if let Some(options) = schema.get("anyOf").and_then(Value::as_array) {
        return options.iter().any(|s| matches(value, s, depth + 1));
    }
    if let Some(kind) = schema.get("type") {
        let okay = kind.as_str().map(|s| type_matches(value, s)).unwrap_or_else(||
            kind.as_array().is_some_and(|types| types.iter().any(|t|
                t.as_str().is_some_and(|s| type_matches(value, s)))));
        if !okay { return false; }
    }
    if schema.get("const").is_some_and(|v| v != value) { return false; }
    if schema.get("enum").and_then(Value::as_array).is_some_and(|items| !items.contains(value)) { return false; }
    if let Some(text) = value.as_str() {
        let count = text.chars().count() as u64;
        if schema.get("maxLength").and_then(Value::as_u64).is_some_and(|n| count > n) ||
           schema.get("minLength").and_then(Value::as_u64).is_some_and(|n| count < n) { return false; }
        if schema.get("pattern").is_some() {
            // Gameplay schemas use only the source's ASCII identifier patterns.
            let pattern = schema["pattern"].as_str().unwrap_or("");
            if !matches!(pattern, "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" | "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$") ||
                !text.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric) ||
                !text.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b)) ||
                (pattern.contains("0,99") && text.len() > 100) ||
                ["__proto__", "constructor", "prototype"].contains(&text) { return false; }
        }
    }
    if let Some(number) = value.as_f64() {
        if !number.is_finite() ||
            schema.get("minimum").and_then(Value::as_f64).is_some_and(|n| number < n) ||
            schema.get("maximum").and_then(Value::as_f64).is_some_and(|n| number > n) ||
            schema.get("exclusiveMinimum").and_then(Value::as_f64).is_some_and(|n| number <= n) { return false; }
    }
    if let Some(items) = value.as_array() {
        if schema.get("maxItems").and_then(Value::as_u64).is_some_and(|n| items.len() as u64 > n) { return false; }
        if let Some(item_schema) = schema.get("items") {
            if !items.iter().all(|v| matches(v, item_schema, depth + 1)) { return false; }
        }
        if schema["uniqueItems"] == true && items.iter().enumerate().any(|(i,v)| items[..i].contains(v)) { return false; }
    }
    if let Some(object) = value.as_object() {
        if schema.get("required").and_then(Value::as_array).is_some_and(|keys|
            keys.iter().any(|k| k.as_str().is_none_or(|s| !object.contains_key(s)))) { return false; }
        let properties = schema.get("properties").and_then(Value::as_object);
        for (key, child) in object {
            if let Some(child_schema) = properties.and_then(|p| p.get(key)) {
                if !matches(child, child_schema, depth + 1) { return false; }
            } else if schema["additionalProperties"] == false { return false; }
        }
    }
    true
}
pub(super) fn shape(value: &Value, name: &str) -> Checked<()> {
    if matches(value, &contract()["$defs"][name], 0) { Ok(()) }
    else { Err(Invalid("invalid_gameplay")) }
}
fn visit(value: &Value, check: &impl Fn(&str, &Value) -> bool) -> bool {
    match value {
        Value::Object(object) => object.iter().all(|(k,v)| check(k,v) && visit(v,check)),
        Value::Array(items) => items.iter().all(|v| visit(v,check)), _ => true,
    }
}
pub(super) fn state(value: &Value, revision: u64) -> Checked<()> {
    shape(value, "gameplay_state")?;
    if visit(value, &|key,v| !["sourceVersion","version"].contains(&key) || v.as_u64().is_some_and(|n| n <= revision)) {
        Ok(())
    } else { Err(Invalid("gameplay_future_source")) }
}
pub(super) fn update(value: &Value, passage: &str, story_time: &str) -> Checked<()> {
    shape(value, "gameplay_update")?;
    if !visit(value, &|key,v| key != "quote" || v.as_str().is_some_and(|q| !q.trim().is_empty() && passage.contains(q))) {
        return Err(Invalid("gameplay_missing_evidence"));
    }
    if value.pointer("/experience/clock/label").and_then(Value::as_str).is_some_and(|label| label != story_time) {
        return Err(Invalid("gameplay_clock_mismatch"));
    }
    Ok(())
}
