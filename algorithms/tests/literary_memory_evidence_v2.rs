//! Fixed synthetic data checks representation, coverage and frozen-state gates.
//! It does not establish that a model's memory summary is semantically supported.
use elselife_algorithms::experience::pipeline::{Pipeline, PipelineStep, Review};
use elselife_algorithms::experience::{Candidate, Context, Mode, PipelineConfig};
use serde_json::{json, Value};

fn context() -> Context {
    Context::decode(include_bytes!("fixtures/experience-hidden-suffix.json")).unwrap()
}

fn interpretation() -> Value {
    json!({
        "id":"restorer-today",
        "kind":"episode",
        "subject_ids":["npc_restorer"],
        "target_ids":[],
        "cue":"今天暂不接活",
        "summary":"修书人今天暂不接活，随后把书放回桌上。",
        "status":"active",
        "retrieval_keys":["今天","暂不接活"],
        "fact_ids":[]
    })
}

fn candidate() -> Value {
    json!({
        "title":"暂歇",
        "passage":"修书人说：“今天暂不接活。”\n\n他把书放回桌上。",
        "story_time":"雨夜，稍后",
        "outcome":"continues",
        "suggestions":[],
        "new_facts":[],
        "new_entities":[],
        "new_threads":[],
        "reveal_fact_ids":[],
        "reveal_entity_ids":[],
        "reveal_thread_ids":[],
        "resolve_thread_ids":[],
        "knowledge_changes":[],
        "memory_delta":{"version":2,"entries":[interpretation()]}
    })
}

fn approved(supports: Value) -> Value {
    json!({
        "approved":true,
        "repair_scope":"none",
        "issues":[],
        "supports":[],
        "knowledge_supports":[],
        "reveal_supports":[],
        "memory_supports":supports
    })
}

#[test]
fn v2_candidate_retains_interpretation_without_forcing_a_sufficient_quote() {
    let value = candidate();
    let decoded = Candidate::decode(value.to_string().as_bytes(), &context())
        .expect("a versioned v2 interpretation without a locator must be accepted");
    let encoded = serde_json::to_value(decoded).unwrap();
    assert_eq!(encoded["memory_delta"], value["memory_delta"]);
    assert!(encoded.get("memory_changes").is_none());
    assert_eq!(encoded["passage"], value["passage"]);
}

#[test]
fn empty_v2_delta_is_present_and_is_not_a_read_only_ask() {
    let mut value = candidate();
    value["memory_delta"]["entries"] = json!([]);
    let decoded = Candidate::decode(value.to_string().as_bytes(), &context())
        .expect("an explicit empty v2 delta remains a versioned writer result");
    assert_eq!(
        serde_json::to_value(decoded).unwrap()["memory_delta"],
        json!({"version":2,"entries":[]})
    );
    let mut ask = context();
    ask.mode = Mode::Ask;
    value["story_time"] = json!(ask.state.story_time);
    assert!(Candidate::decode(value.to_string().as_bytes(), &ask).is_err());
}

#[test]
fn memory_delta_rejects_null_mixed_fields_and_model_minted_provenance() {
    for mutation in [
        "null_delta",
        "null_version",
        "unknown_version",
        "empty_legacy_and_delta",
        "null_legacy_and_delta",
        "null_locator",
        "foreign_locator",
        "model_revision",
        "model_hash",
        "model_evidence_refs",
        "model_known_by",
    ] {
        let mut value = candidate();
        match mutation {
            "null_delta" => value["memory_delta"] = Value::Null,
            "null_version" => value["memory_delta"]["version"] = Value::Null,
            "unknown_version" => value["memory_delta"]["version"] = json!(3),
            "empty_legacy_and_delta" => value["memory_changes"] = json!([]),
            "null_legacy_and_delta" => value["memory_changes"] = Value::Null,
            "null_locator" => value["memory_delta"]["entries"][0]["locator_quote"] = Value::Null,
            "foreign_locator" => {
                value["memory_delta"]["entries"][0]["locator_quote"] = json!("没有发生的原句")
            }
            "model_revision" => value["memory_delta"]["entries"][0]["updated_revision"] = json!(4),
            "model_hash" => {
                value["memory_delta"]["entries"][0]["source_sha256"] = json!("a".repeat(64))
            }
            "model_evidence_refs" => {
                value["memory_delta"]["entries"][0]["evidence_refs"] = json!([])
            }
            "model_known_by" => {
                value["memory_delta"]["entries"][0]["known_by"] = json!(["npc_restorer"])
            }
            _ => unreachable!(),
        }
        assert!(
            Candidate::decode(value.to_string().as_bytes(), &context()).is_err(),
            "{mutation}"
        );
    }
}

#[test]
fn optional_locator_is_exact_original_text_without_becoming_summary_sufficiency() {
    let mut value = candidate();
    value["memory_delta"]["entries"][0]["locator_quote"] = json!("今天暂不接活。");
    // The short locator deliberately excludes the second sentence in the summary.
    // The independent reviewer must evaluate the supplied sources, not this slice.
    assert!(Candidate::decode(value.to_string().as_bytes(), &context()).is_ok());
    value["memory_delta"]["entries"][0]["locator_quote"] = json!("今天暂不接活。\\n");
    assert!(Candidate::decode(value.to_string().as_bytes(), &context()).is_err());
}

#[test]
fn legacy_candidate_round_trip_keeps_its_original_quote_contract() {
    let mut value = candidate();
    value.as_object_mut().unwrap().remove("memory_delta");
    let mut change = interpretation();
    change["quote"] = json!("今天暂不接活。");
    value["memory_changes"] = json!([change]);
    let decoded = Candidate::decode(value.to_string().as_bytes(), &context()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), value);
    value["memory_changes"][0]["quote"] = json!("不存在的引用");
    assert!(Candidate::decode(value.to_string().as_bytes(), &context()).is_err());
}

#[test]
fn v2_review_decodes_source_selection_without_a_repeated_quote() {
    let raw = approved(json!([{
        "memory_id":"restorer-today",
        "source_ids":["current-candidate","formal-page-3"]
    }]));
    let review: Review = serde_json::from_value(raw.clone())
        .expect("v2 support must decode before registry membership is checked by Go");
    assert_eq!(serde_json::to_value(review).unwrap(), raw);
}

#[test]
fn v2_review_requires_exact_entry_coverage_and_unique_nonempty_source_ids() {
    let c = Candidate::decode(candidate().to_string().as_bytes(), &context()).unwrap();
    let valid = approved(json!([{
        "memory_id":"restorer-today",
        "source_ids":["current-candidate","formal-page-3"]
    }]));
    let review: Review = serde_json::from_value(valid.clone()).unwrap();
    assert!(review.validate(&c).is_ok());
    // These strings are syntactically valid only. This does not certify that
    // either source was supplied: that requires Go's final-request registry.
    for mutation in [
        "missing",
        "duplicate_entry",
        "wrong_entry",
        "empty_sources",
        "empty_id",
        "duplicate_source",
        "mixed_quote",
    ] {
        let mut raw = valid.clone();
        match mutation {
            "missing" => raw["memory_supports"] = json!([]),
            "duplicate_entry" => {
                raw["memory_supports"] =
                    json!([raw["memory_supports"][0], raw["memory_supports"][0]])
            }
            "wrong_entry" => raw["memory_supports"][0]["memory_id"] = json!("other"),
            "empty_sources" => raw["memory_supports"][0]["source_ids"] = json!([]),
            "empty_id" => raw["memory_supports"][0]["source_ids"] = json!([""]),
            "duplicate_source" => {
                raw["memory_supports"][0]["source_ids"] =
                    json!(["current-candidate", "current-candidate"])
            }
            "mixed_quote" => raw["memory_supports"][0]["quote"] = json!("今天暂不接活。"),
            _ => unreachable!(),
        }
        let rejected = match serde_json::from_value::<Review>(raw) {
            Ok(review) => review.validate(&c).is_err(),
            Err(_) => true,
        };
        assert!(rejected, "{mutation}");
    }
}

fn old_entry() -> Value {
    let mut entry = interpretation();
    entry["quote"] = json!("门上的铃轻轻摆动");
    entry["source_revision"] = json!(3);
    entry["source_sha256"] = json!("a".repeat(64));
    entry["updated_revision"] = json!(3);
    entry["prior_sources"] = json!([{
        "revision":2,"sha256":"b".repeat(64),"quote":"雨势缓下来"
    }]);
    entry
}

fn context_with_memory(memory: Value) -> Value {
    let mut value = serde_json::to_value(context()).unwrap();
    value["state"]["literary_memory"] = memory;
    value
}

#[test]
fn legacy_state_keeps_quotes_hashes_and_full_prior_sources() {
    let memory = json!({"version":1,"indexed_through_revision":3,"entries":[old_entry()]});
    let value = context_with_memory(memory.clone());
    let decoded = Context::decode(value.to_string().as_bytes()).unwrap();
    assert_eq!(
        serde_json::to_value(decoded).unwrap()["state"]["literary_memory"],
        memory
    );
}

fn refs_entry() -> Value {
    let mut entry = interpretation();
    entry["evidence_kind"] = json!("source_refs_v2");
    entry["updated_revision"] = json!(3);
    entry["evidence_refs"] = json!([
        {"kind":"formal_page","revision":3,"text_sha256":"a".repeat(64)},
        {"kind":"authority_fact","fact_id":"fixed_secret","as_of_revision":3,"record_sha256":"c".repeat(64)}
    ]);
    entry["legacy_entry"] = old_entry();
    entry
}

#[test]
fn v2_state_retains_explicit_legacy_and_typed_source_dependencies() {
    let mut legacy = old_entry();
    legacy["id"] = json!("unchanged-old-entry");
    legacy["evidence_kind"] = json!("legacy_v1");
    let memory = json!({"version":2,"indexed_through_revision":3,"entries":[legacy,refs_entry()]});
    let value = context_with_memory(memory.clone());
    let decoded = Context::decode(value.to_string().as_bytes())
        .expect("v2 state must preserve legacy origin alongside typed page/fact dependencies");
    assert_eq!(
        serde_json::to_value(decoded).unwrap()["state"]["literary_memory"],
        memory
    );
}

#[test]
fn v2_state_rejects_fake_variants_and_unversioned_or_duplicate_dependencies() {
    for mutation in [
        "unmarked_entry",
        "unknown_kind",
        "empty_refs",
        "future_page",
        "zero_fact_revision",
        "bad_hash",
        "duplicate_ref",
        "missing_current_page",
        "fact_with_page_fields",
        "recursive_legacy",
        "null_legacy",
    ] {
        let mut entry = refs_entry();
        match mutation {
            "unmarked_entry" => {
                entry.as_object_mut().unwrap().remove("evidence_kind");
            }
            "unknown_kind" => entry["evidence_kind"] = json!("certified"),
            "empty_refs" => entry["evidence_refs"] = json!([]),
            "future_page" => entry["evidence_refs"][0]["revision"] = json!(4),
            "zero_fact_revision" => entry["evidence_refs"][1]["as_of_revision"] = json!(0),
            "bad_hash" => entry["evidence_refs"][0]["text_sha256"] = json!("A".repeat(64)),
            "duplicate_ref" => {
                entry["evidence_refs"] =
                    json!([entry["evidence_refs"][0], entry["evidence_refs"][0]])
            }
            "missing_current_page" => entry["evidence_refs"][0]["revision"] = json!(2),
            "fact_with_page_fields" => entry["evidence_refs"][1]["revision"] = json!(3),
            "recursive_legacy" => entry["legacy_entry"] = refs_entry(),
            "null_legacy" => entry["legacy_entry"] = Value::Null,
            _ => unreachable!(),
        }
        let memory = json!({"version":2,"indexed_through_revision":3,"entries":[entry]});
        assert!(
            Context::decode(context_with_memory(memory).to_string().as_bytes()).is_err(),
            "{mutation}"
        );
    }
}

fn to_extract() -> (Context, Pipeline, Value) {
    let mut c = context();
    c.pipeline = Some(PipelineConfig {
        version: 1,
        max_actors: 0,
        max_repairs: 1,
    });
    let mut p = Pipeline::new(&c, 12).unwrap();
    let full = candidate();
    let mut draft = json!({});
    for key in ["title", "passage", "story_time", "outcome", "suggestions"] {
        draft[key] = full[key].clone();
    }
    for (stage, result) in [
        (
            "memory",
            json!({"actors":[],"relevant_fact_ids":[],"objective":"Ordinary visit"}),
        ),
        (
            "plan",
            json!({"candidates":[
                {"id":"pause","purpose":"Continue the visit","beats":["Speak and put the book down"],"causes":[],"costs":[],"consequences":[],"thread_ids":[],"fact_ids":[]},
                {"id":"wait","purpose":"Wait briefly","beats":["Wait beside the table"],"causes":[],"costs":["time"],"consequences":[],"thread_ids":[],"fact_ids":[]}
            ]}),
        ),
        (
            "evaluate",
            json!({"evaluations":[
                {"candidate_id":"pause","continuity":4,"agency":4,"causality":4,"consequence":4,"pacing":4,"interest":4,"blocking_issues":[],"evidence_fact_ids":[]},
                {"candidate_id":"wait","continuity":3,"agency":3,"causality":3,"consequence":3,"pacing":3,"interest":3,"blocking_issues":[],"evidence_fact_ids":[]}
            ]}),
        ),
        ("write", draft),
    ] {
        assert_eq!(p.next_request(&c).unwrap().stage, stage);
        assert!(matches!(
            p.accept(&c, json!({"result":result}).to_string().as_bytes())
                .unwrap(),
            PipelineStep::Continue
        ));
    }
    (c, p, full)
}

fn compact(mut full: Value) -> Value {
    for key in ["title", "passage", "story_time", "outcome", "suggestions"] {
        full.as_object_mut().unwrap().remove(key);
    }
    full
}

#[test]
fn v2_compact_extraction_restores_five_fields_and_still_needs_independent_review() {
    let (c, mut p, full) = to_extract();
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "extract");
    assert!(request.schema["$defs"]["candidate"]["properties"]
        .get("memory_delta")
        .is_some());
    assert!(request.schema["$defs"]["candidate"]["properties"]
        .get("memory_changes")
        .is_none());
    assert!(matches!(
        p.accept(
            &c,
            json!({"result":{"candidate":compact(full.clone())}})
                .to_string()
                .as_bytes()
        )
        .unwrap(),
        PipelineStep::Continue
    ));
    let review = p.next_request(&c).unwrap();
    assert_eq!(review.stage, "review");
    assert_eq!(review.input["candidate"], full);
    let approval =
        approved(json!([{"memory_id":"restorer-today","source_ids":["candidate-local"]}]));
    match p
        .accept(&c, json!({"result":approval}).to_string().as_bytes())
        .unwrap()
    {
        PipelineStep::Complete(candidate) => {
            assert_eq!(serde_json::to_value(candidate).unwrap(), full)
        }
        other => panic!("expected completion only after the independent review: {other:?}"),
    }
    assert_eq!(p.calls(), 6);
}

#[test]
fn v2_state_repair_changes_interpretation_and_rechecks_the_same_frozen_draft_once() {
    let (c, mut p, full) = to_extract();
    assert_eq!(p.next_request(&c).unwrap().stage, "extract");
    p.accept(
        &c,
        json!({"result":{"candidate":compact(full.clone())}})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    assert_eq!(p.next_request(&c).unwrap().stage, "review");
    let rejection = json!({"approved":false,"repair_scope":"candidate_state",
        "issues":[{"code":"summary_condition","detail":"Preserve the temporary condition; do not invent a lifelong trait."}],
        "supports":[],"knowledge_supports":[],"reveal_supports":[],"memory_supports":[]});
    p.accept(&c, json!({"result":rejection}).to_string().as_bytes())
        .unwrap();
    let repair = p.next_request(&c).unwrap();
    assert_eq!(repair.stage, "repair_state");
    assert_eq!(repair.input["candidate"], full);
    assert_eq!(repair.input["issues"], rejection["issues"]);
    let mut revised = full.clone();
    revised["memory_delta"]["entries"][0]["summary"] = json!("修书人今天暂不接活。");
    assert!(matches!(
        p.accept(
            &c,
            json!({"result":{"candidate":compact(revised.clone())}})
                .to_string()
                .as_bytes()
        )
        .unwrap(),
        PipelineStep::Continue
    ));
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "review");
    assert_eq!(request.input["candidate"], revised);
    for key in ["title", "passage", "story_time", "outcome", "suggestions"] {
        assert_eq!(request.input["candidate"][key], full[key]);
    }
    let approval =
        approved(json!([{"memory_id":"restorer-today","source_ids":["new-review-candidate"]}]));
    assert!(matches!(
        p.accept(&c, json!({"result":approval}).to_string().as_bytes())
            .unwrap(),
        PipelineStep::Complete(_)
    ));
    assert_eq!(p.calls(), 8);
    assert!(p.next_request(&c).is_err());
}

#[test]
fn v2_supports_do_not_relax_fact_and_character_knowledge_quotes() {
    let mut value = candidate();
    value["new_facts"] = json!([{
        "id":"restorer-utterance","kind":"statement","text":"修书人说今天暂不接活。",
        "subject_id":"npc_restorer","known":false,"source_revision":4,"known_by":["npc_restorer"]
    }]);
    let c = Candidate::decode(value.to_string().as_bytes(), &context()).unwrap();
    let mut raw =
        approved(json!([{"memory_id":"restorer-today","source_ids":["candidate-local"]}]));
    raw["supports"] = json!([{"fact_id":"restorer-utterance","quote":"今天暂不接活。"}]);
    raw["knowledge_supports"] = json!([{"subject_id":"npc_restorer","fact_id":"restorer-utterance","quote":"今天暂不接活。"}]);
    assert!(serde_json::from_value::<Review>(raw.clone())
        .unwrap()
        .validate(&c)
        .is_ok());
    raw["knowledge_supports"][0]["quote"] = json!("这个人物总不接活。");
    assert!(serde_json::from_value::<Review>(raw.clone())
        .unwrap()
        .validate(&c)
        .is_err());
    raw["knowledge_supports"] = json!([]);
    assert!(serde_json::from_value::<Review>(raw)
        .unwrap()
        .validate(&c)
        .is_err());
}

#[test]
fn v2_raw_duplicate_fields_are_not_lost_by_value_round_trip() {
    let raw = candidate().to_string();
    let duplicate = raw.replacen("\"version\":2", "\"version\":2,\"version\":2", 1);
    assert!(Candidate::decode(duplicate.as_bytes(), &context()).is_err());
    let duplicate = raw.replacen(
        "\"memory_delta\":",
        "\"memory_delta\":{\"version\":2,\"entries\":[]},\"memory_delta\":",
        1,
    );
    assert!(Candidate::decode(duplicate.as_bytes(), &context()).is_err());
}

#[test]
fn nonpipeline_response_contract_offers_prose_or_read_without_direct_candidate() {
    let schema = elselife_algorithms::experience::response_schema();
    let alternatives = schema["properties"]["result"]["anyOf"].as_array().unwrap();
    assert_eq!(alternatives.len(), 2);
    assert!(alternatives[0]["properties"].get("narrative").is_some());
    assert_eq!(alternatives[0]["additionalProperties"], false);
    assert!(alternatives[0]["properties"].get("memory_delta").is_none());
    assert!(alternatives[0]["properties"].get("candidate").is_none());
    assert_eq!(alternatives[1]["$ref"], "#/$defs/read_request");
    // The canonical decoder remains compatible for archive callers. Removing an
    // unreachable definition would not enforce the author-return/Apply boundary.
}

#[test]
fn v2_update_keeps_existing_memory_identity_and_cannot_add_a_target_to_the_same_id() {
    let mut raw_context = context_with_memory(json!({
        "version":1,"indexed_through_revision":3,"entries":[old_entry()]
    }));
    raw_context["state"]["entities"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"second-person","kind":"character","name":"另一个人","description":"",
            "known":false,"related_ids":[]
        }));
    raw_context["state_coverage"]["total"]["entities"] = json!(2);
    let c = Context::decode(raw_context.to_string().as_bytes()).unwrap();
    let mut value = candidate();
    assert!(Candidate::decode(value.to_string().as_bytes(), &c).is_ok());
    value["memory_delta"]["entries"][0]["target_ids"] = json!(["second-person"]);
    assert!(Candidate::decode(value.to_string().as_bytes(), &c).is_err());
    value["memory_delta"]["entries"][0]["id"] = json!("new-participants");
    assert!(Candidate::decode(value.to_string().as_bytes(), &c).is_ok());
}
