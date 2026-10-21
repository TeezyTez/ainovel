//! Authored structural regressions; these fixtures do not measure literary quality.
use elselife_algorithms::experience::*;
use serde_json::{json, Value};

fn opening() -> Context {
    Context::decode(include_bytes!("fixtures/experience-context.json")).unwrap()
}
fn hidden() -> Context {
    Context::decode(include_bytes!("fixtures/experience-hidden-suffix.json")).unwrap()
}
fn response(context: &Context, metadata: Value) -> Candidate {
    let raw = json!({"result":{"narrative":"你把戒指卖给商人。他将戒指收进钱匣。",
        "title":"钱匣","story_time":"当晚","metadata_json":metadata.to_string()}});
    let GenerationResult::Candidate(candidate) = decode_response(raw.to_string().as_bytes(), context).unwrap().result else {
        panic!("expected prose");
    };
    candidate.validate(context).unwrap();
    candidate
}
fn transfer() -> Value {
    json!({
        "new_entities":[
            {"id":"ring","kind":"item","name":"戒指","description":"银戒指","known":true,"related_ids":["sold"]},
            {"id":"merchant","kind":"character","name":"商人","description":"收购旧物","known":true,"related_ids":[]}
        ],
        "new_facts":[{"id":"sold","kind":"fact","text":"戒指已卖给商人。","subject_id":"merchant","known":true,"source_revision":1,"known_by":[],
            "reader":{"kind":"item","entity_id":"ring","target_id":"merchant","label":"戒指","status":"已售"}}],
        "new_threads":[{"id":"recover","text":"若要证明身份，需要找回戒指或其他证据。","known":true,"related_fact_ids":["sold"]}],
        "knowledge_changes":[{"subject_id":"merchant","fact_id":"sold"}]
    })
}

#[test]
fn invalid_independent_metadata_does_not_erase_transfer_or_its_dependencies() {
    for (field, invalid) in [("gameplay_update", json!({"invalid":true})), ("reveal_entity_ids", json!(["missing"])), ("resolve_thread_ids", Value::Null)] {
        let mut metadata = transfer();
        metadata[field] = invalid;
        let candidate = response(&opening(), metadata);
        assert_eq!(candidate.new_facts.len(), 1, "{field}");
        assert_eq!(candidate.new_entities.len(), 2, "{field}");
        assert_eq!(candidate.new_threads.len(), 1, "{field}");
        assert_eq!(candidate.knowledge_changes.len(), 1, "{field}");
        assert_eq!(candidate.new_facts[0].reader.as_ref().unwrap().target_id, "merchant");
        assert_eq!(candidate.story_time, "当晚", "{field}");
        assert_eq!(candidate.passage, "你把戒指卖给商人。他将戒指收进钱匣。");
        assert!(candidate.gameplay_update.is_none());
        assert!(candidate.reveal_entity_ids.is_empty() && candidate.resolve_thread_ids.is_empty());
    }
}

#[test]
fn semantic_invalid_additions_are_not_repaired_or_partially_guessed() {
    let mut metadata = transfer();
    metadata["new_facts"][0]["source_revision"] = json!(99);
    let candidate = response(&opening(), metadata);
    assert!(candidate.new_facts.is_empty() && candidate.new_entities.is_empty() && candidate.new_threads.is_empty());
    assert!(candidate.knowledge_changes.is_empty());
    let mut metadata = transfer();
    metadata["new_facts"][0]["reader"]["target_id"] = json!("unknown_owner");
    assert!(response(&opening(), metadata).new_facts.is_empty());
}

#[test]
fn unrelated_invalid_thread_cannot_erase_a_fact_about_an_existing_character() {
    let c = hidden();
    let candidate = response(&c, json!({
        "new_facts":[{"id":"sold","kind":"fact","text":"戒指已卖给修书人。","subject_id":"npc_restorer",
            "known":true,"source_revision":4,"known_by":["npc_restorer"]}],
        "new_threads":[{"id":"broken","text":"没有依据的联系","known":true,"related_fact_ids":["missing_fact"]}]
    }));
    assert_eq!(candidate.new_facts.len(), 1);
    assert_eq!(candidate.new_facts[0].id, "sold");
    assert!(candidate.new_threads.is_empty());
    assert_eq!(candidate.story_time, "当晚");
}

#[test]
fn malformed_addition_field_does_not_veto_independent_disclosure_and_knowledge() {
    let c = hidden();
    let candidate = response(&c, json!({"new_facts":null,"reveal_fact_ids":["fixed_secret"],
        "reveal_entity_ids":["npc_restorer"],"reveal_thread_ids":["thread_old_book"],
        "knowledge_changes":[{"subject_id":"missing","fact_id":"fixed_secret"}]}));
    assert_eq!(candidate.reveal_fact_ids, ["fixed_secret"]);
    assert_eq!(candidate.reveal_entity_ids, ["npc_restorer"]);
    assert_eq!(candidate.reveal_thread_ids, ["thread_old_book"]);
    assert!(candidate.knowledge_changes.is_empty());
}

#[test]
fn compact_response_preserves_story_position_without_changing_prose() {
    for outcome in ["awaits_player", "ending"] {
        let raw = json!({"result":{"narrative":"他把账册按住，等你回答。","outcome":outcome,"metadata_json":"{}"}});
        let GenerationResult::Candidate(c) = decode_response(raw.to_string().as_bytes(), &opening()).unwrap().result else { panic!() };
        assert_eq!(serde_json::to_value(c.outcome).unwrap(), outcome);
        assert_eq!(c.passage, "他把账册按住，等你回答。");
    }
    for invalid in [Value::Null, json!("success"), json!(17)] {
        let raw = json!({"result":{"narrative":"雨继续下着。","outcome":invalid,"metadata_json":"{}"}});
        let GenerationResult::Candidate(c) = decode_response(raw.to_string().as_bytes(), &opening()).unwrap().result else { panic!() };
        assert_eq!(c.outcome, Outcome::Continues);
    }
}

#[test]
fn active_response_schema_exposes_scoped_read_without_full_candidate_payload() {
    let schema = response_schema();
    let alternatives = schema["properties"]["result"]["anyOf"].as_array().expect("prose or recall");
    assert!(alternatives.iter().any(|s| s["$ref"] == "#/$defs/read_request"));
    let canonical: Value = serde_json::from_str(CONTRACT).unwrap();
    assert_eq!(schema["$defs"]["read_request"], canonical["$defs"]["read_request"]);
    assert!(schema["$defs"].get("candidate").is_none());
    assert!(schema["$defs"].get("context").is_none());
    assert!(schema.to_string().len() < NARRATIVE_SCHEMA_MAX_BYTES);
    let c = hidden();
    let raw = json!({"result":{"request_id":"old_promise","source_handle":c.state_coverage.source_handle,
        "selector":{"kind":"pages","from_revision":1,"to_revision":1},"max_reply_bytes":4096}});
    assert!(matches!(decode_response(raw.to_string().as_bytes(), &c).unwrap().result, GenerationResult::ReadRequest(_)));
    let mut wrong = raw;
    wrong["result"]["source_handle"] = json!("other_branch");
    assert!(decode_response(wrong.to_string().as_bytes(), &c).is_err());
}

#[test]
fn advisory_separates_objective_memory_claims_and_unresolved_intentions() {
    let mut c = hidden();
    c.state.facts.push(Fact { reader: None, id: "belief".into(), kind: FactKind::Belief,
        text: "修书人相信旧书还在店内，实际已经卖出。".into(), subject_id: "npc_restorer".into(), known: true,
        source_revision: 2, known_by: vec!["npc_restorer".into()] });
    c.state.threads.push(Thread { id: "closed".into(), text: "已经解决".into(), known: true,
        related_fact_ids: vec![], resolved_at_revision: Some(Some(3)) });
    c.state_coverage.total.facts = 2;
    c.state_coverage.total.threads = 2;
    c.preferences.push(Preference { dimension: "pace".into(), value: "快".into(), source: PreferenceSource::Explicit, evidence: "明确提出".into() });
    let original = c.clone();
    let input = narrative_input(&c).unwrap();
    let brief = &input["authoring"]["narrative_brief"];
    assert_eq!(brief["scope"]["branch_id"], "branch_main");
    assert_eq!(brief["objective_facts"], json!([{"id":"fixed_secret","kind":"secret","source_revision":1}]));
    assert_eq!(brief["character_claims"], json!([{"id":"belief","kind":"belief","subject_id":"npc_restorer","source_revision":2}]));
    assert_eq!(brief["unresolved_thread_ids"], json!(["thread_old_book"]));
    assert_eq!(brief["character_knowledge"], json!([{"entity_id":"npc_restorer","fact_ids":["fixed_secret","belief"]}]));
    assert_eq!(brief["preference_refs"], json!([{"index":0,"source":"explicit"}]));
    assert!(!brief.to_string().contains("修书人相信"));
    assert_eq!(input["context"], serde_json::to_value(&original).unwrap());
    assert_eq!(c, original);
    c.branch_id = "earlier_fork".into();
    assert_eq!(narrative_input(&c).unwrap()["authoring"]["narrative_brief"]["scope"]["branch_id"], "earlier_fork");
}

#[test]
fn ask_advisory_and_salvage_cannot_restore_author_only_material() {
    let mut c = hidden();
    c.mode = Mode::Ask;
    c.input = "修书人是谁？".into();
    c.state = known_information(&c.state);
    c.state_coverage.audience = Audience::Reader;
    c.state_coverage.total = StateCounts::default();
    let input = narrative_input(&c).unwrap();
    let brief = &input["authoring"]["narrative_brief"];
    assert!(brief.is_object());
    for forbidden in ["fixed_secret", "npc_restorer", "thread_old_book"] {
        assert!(!input.to_string().contains(forbidden));
    }
    let candidate = response(&c, transfer());
    assert_eq!(candidate.story_time, c.state.story_time);
    assert!(candidate.new_facts.is_empty() && candidate.new_entities.is_empty() && candidate.knowledge_changes.is_empty());
}

#[test]
fn advisory_is_bounded_and_explicitly_reports_omitted_references() {
    let mut c = hidden();
    for i in 0..150 {
        let mut fact = c.state.facts[0].clone();
        fact.id = format!("fact_{i}_{}", "x".repeat(400));
        fact.kind = FactKind::Fact;
        c.state.facts.push(fact);
    }
    c.state_coverage.total.facts = c.state.facts.len() as u64;
    let brief = narrative_input(&c).unwrap()["authoring"]["narrative_brief"].clone();
    assert!(brief.is_object());
    assert!(brief.to_string().len() <= 8192);
    assert_eq!(brief["truncated"], true);
    assert_eq!(brief["available"]["facts"], 151);
    assert!(brief["objective_facts"].as_array().unwrap().len() < 151);
}
