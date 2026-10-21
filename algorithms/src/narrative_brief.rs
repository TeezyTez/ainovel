//! Bounded, disposable pointers into this operation's evidence. Never another story state.
use super::*;

const MAX_BYTES: usize = 8192;
const MAX_FACTS: usize = 48;
const MAX_THREADS: usize = 16;
const MAX_CHARACTERS: usize = 16;
const MAX_KNOWLEDGE_EDGES: usize = 64;
const MAX_PREFERENCES: usize = 16;

fn append(brief: &mut Value, field: &str, value: Value) -> bool {
    brief[field].as_array_mut().unwrap().push(value);
    if brief.to_string().len() <= MAX_BYTES {
        true
    } else {
        brief[field].as_array_mut().unwrap().pop();
        brief["truncated"] = json!(true);
        false
    }
}

pub(super) fn build(c: &Context) -> Checked<Value> {
    // Historical recall objects stay in context.recalls at their own revision; only current
    // evidence may supplement these pointers. This does not mutate context.state.
    let state = recall::current_evidence(c)?;
    let open: Vec<_> = state.threads.iter()
        .filter(|t| t.resolved_at_revision.flatten().is_none()).collect();
    let mut characters = Vec::new();
    let mut seen = HashSet::new();
    for fact in &state.facts {
        for id in &fact.known_by {
            if seen.insert(id) { characters.push(id); }
        }
    }
    let mut brief = json!({
        "advisory_only":true,
        "scope":{"experience_id":c.experience_id,"branch_id":c.branch_id,"revision":c.revision},
        "state_complete":c.state_coverage.complete,"history_complete":c.history_complete,
        "available":{"facts":state.facts.len(),"unresolved_threads":open.len(),
            "characters_with_knowledge":characters.len(),"preferences":c.preferences.len()},
        "truncated":false,"objective_facts":[],"character_claims":[],
        "unresolved_thread_ids":[],"character_knowledge":[],"preference_refs":[]
    });
    // Validated coordinates have no separate length limit. Do not truncate an ID into a new ID.
    if brief.to_string().len() > MAX_BYTES {
        return Ok(json!({"advisory_only":true,"scope_in_context":true,"truncated":true}));
    }
    for fact in state.facts.iter().take(MAX_FACTS) {
        let claim = matches!(fact.kind, FactKind::Statement | FactKind::Belief);
        let mut reference = json!({"id":fact.id,"kind":fact.kind,"source_revision":fact.source_revision});
        if claim { reference["subject_id"] = json!(fact.subject_id); }
        append(&mut brief, if claim { "character_claims" } else { "objective_facts" }, reference);
    }
    for thread in open.iter().take(MAX_THREADS) {
        append(&mut brief, "unresolved_thread_ids", json!(thread.id));
    }
    let mut edges = 0;
    for id in characters.iter().take(MAX_CHARACTERS) {
        let all: Vec<_> = state.facts.iter().filter(|f| f.known_by.contains(id)).map(|f| &f.id).collect();
        let retained: Vec<_> = all.iter().take(MAX_KNOWLEDGE_EDGES - edges).copied().collect();
        if retained.len() < all.len() { brief["truncated"] = json!(true); }
        edges += retained.len();
        if !retained.is_empty() {
            append(&mut brief, "character_knowledge", json!({"entity_id":id,"fact_ids":retained}));
        }
    }
    for (index, preference) in c.preferences.iter().enumerate().take(MAX_PREFERENCES) {
        append(&mut brief, "preference_refs", json!({"index":index,"source":preference.source}));
    }
    if state.facts.len() > MAX_FACTS || open.len() > MAX_THREADS || characters.len() > MAX_CHARACTERS
        || c.preferences.len() > MAX_PREFERENCES {
        brief["truncated"] = json!(true);
    }
    Ok(brief)
}
