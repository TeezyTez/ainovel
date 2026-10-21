//! Synthetic pipeline fixtures test orchestration and evidence gates, not literary quality.
use elselife_algorithms::experience::pipeline::{
    select_plan, Evaluations, Pipeline, PipelineStep, Plans, Review,
};
use elselife_algorithms::experience::*;
use serde_json::{json, Value};

#[test]
fn recorded_nar017_extraction_is_invalid_inner_json_not_a_capacity_failure() {
    use sha2::{Digest, Sha256};
    let f: Value = serde_json::from_slice(include_bytes!(
        "fixtures/benchmark-nar017-s04-invalid-extraction.json"
    ))
    .unwrap();
    assert_eq!(
        f["source"]["root_sha256"],
        "8c6586c3507c737f272c2c78438dca7d45f33df073d894c7cecb2bcc16f98a97"
    );
    for (index, output) in f["outputs"].as_array().unwrap().iter().enumerate() {
        let raw = output["raw"].as_str().unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(raw.as_bytes())),
            output["raw_sha256"]
        );
        let outer: Value = serde_json::from_str(raw).expect("original outer JSON is valid");
        let inner = outer["result"]["candidate_json"].as_str().unwrap();
        assert_eq!(inner.len(), [10994, 10829][index]);
        assert!(inner.len() < elselife_algorithms::experience::pipeline::MAX_CANDIDATE_BYTES);
        assert_eq!(inner.chars().position(|c| c == '\n'), Some(319));
        assert!(serde_json::from_str::<Value>(inner).is_err());
        assert!(Candidate::decode(inner.as_bytes(), &context()).is_err());
        let mut c = context();
        c.pipeline.as_mut().unwrap().max_repairs = 0;
        let mut p = Pipeline::new(&c, 12).unwrap();
        to_extract(&mut p, &c);
        p.next_request(&c).unwrap();
        // v4.6 never adds compatibility that accepts the old malformed string.
        assert!(p.accept(&c, raw.as_bytes()).is_err());
    }
}

// Test-only v4.4 -> v2 state-machine transcription. The original Candidate is
// decoded first, including its complete notebook. The new pipeline exercise then
// omits that legacy notebook update and supplies an empty v2 delta. Thus it tests
// unchanged prose/fact/knowledge transport and repair gates, NOT equivalent memory
// application, byte-identical old transport, or new model-quality acceptance.
fn transcribed_recorded_output(c: &Context, stage: &str, raw: &str) -> Vec<u8> {
    if stage != "extract" && stage != "repair_extract" {
        return raw.as_bytes().to_vec();
    }
    let old: Value = serde_json::from_str(raw).unwrap();
    let original_raw = old["result"]["candidate_json"].as_str().unwrap();
    Candidate::decode(original_raw.as_bytes(), c).expect("original legacy candidate remains valid");
    let original: Value = serde_json::from_str(original_raw).unwrap();
    let mut candidate = original.clone();
    let notebook = candidate
        .as_object_mut()
        .unwrap()
        .remove("narrative_update")
        .unwrap();
    assert!(candidate.get("memory_changes").is_none());
    candidate["memory_delta"] = json!({"version":2,"entries":[]});
    let mut restored = candidate.clone();
    restored.as_object_mut().unwrap().remove("memory_delta");
    restored["narrative_update"] = notebook;
    assert_eq!(
        restored, original,
        "only the explicitly excluded notebook differs"
    );
    let object = json!({"result":{"candidate":candidate}});
    let encoded = serde_json::to_vec(&object).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&encoded).unwrap()["result"]["candidate"],
        candidate
    );
    encoded
}

#[test]
fn recorded_review_quote_mismatch_repairs_only_frozen_candidate_once() {
    use sha2::{Digest, Sha256};
    let f: Value =
        serde_json::from_slice(include_bytes!("fixtures/benchmark-nar001-s01-review.json"))
            .unwrap();
    let c = Context::decode(f["context"].to_string().as_bytes()).unwrap();
    let mut p = Pipeline::new(&c, 12).unwrap();
    let mut frozen = Value::Null;
    for output in f["outputs"].as_array().unwrap() {
        let raw = output["raw"].as_str().unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(raw.as_bytes())),
            output["raw_sha256"]
        );
        let request = p.next_request(&c).unwrap();
        assert_eq!(request.stage, output["stage"].as_str().unwrap());
        if request.stage == "review" {
            frozen = request.input["candidate"].clone();
        }
        assert!(matches!(
            p.accept(&c, &transcribed_recorded_output(&c, request.stage, raw))
                .unwrap(),
            PipelineStep::Continue
        ));
    }
    let repair = p.next_request(&c).unwrap();
    assert_eq!(repair.stage, "repair_review");
    assert_eq!(repair.input["candidate"], frozen);
    let mut r: Value = serde_json::from_str(f["outputs"][7]["raw"].as_str().unwrap()).unwrap();
    let passage = frozen["passage"].as_str().unwrap();
    assert!(passage.contains("\n\n"));
    assert!(r["result"]["supports"][1]["quote"]
        .as_str()
        .unwrap()
        .contains(r"\n\n"));
    r["result"]["supports"][1]["quote"] =
        json!(&passage[passage.find("余叔蹲在船边").unwrap()..passage.find("他盯了片刻").unwrap()]);
    match p.accept(&c, r.to_string().as_bytes()).unwrap() {
        PipelineStep::Complete(candidate) => {
            assert_eq!(serde_json::to_value(candidate).unwrap(), frozen)
        }
        _ => panic!("valid re-review did not complete"),
    }
    assert_eq!(p.calls(), 9);
    assert!(p.next_request(&c).is_err());
}

fn recorded_review_prefix(
    grant: u32,
    repairs: u32,
    extraction_repair: bool,
) -> (Pipeline, Context, Value, Value, Value) {
    let f: Value =
        serde_json::from_slice(include_bytes!("fixtures/benchmark-nar001-s01-review.json"))
            .unwrap();
    let mut raw_context = f["context"].clone();
    raw_context["pipeline"]["max_repairs"] = json!(repairs);
    let c = Context::decode(raw_context.to_string().as_bytes()).unwrap();
    let mut p = Pipeline::new(&c, grant).unwrap();
    for output in &f["outputs"].as_array().unwrap()[..7] {
        let req = p.next_request(&c).unwrap();
        assert_eq!(req.stage, output["stage"].as_str().unwrap());
        if extraction_repair && req.stage == "extract" {
            p.accept(&c, br#"{"result":{"candidate_json":"{"}}"#)
                .unwrap();
            assert_eq!(p.next_request(&c).unwrap().stage, "repair_extract");
        }
        p.accept(
            &c,
            &transcribed_recorded_output(&c, req.stage, output["raw"].as_str().unwrap()),
        )
        .unwrap();
    }
    let req = p.next_request(&c).unwrap();
    assert_eq!(req.stage, "review");
    let review = serde_json::from_str(f["outputs"][7]["raw"].as_str().unwrap()).unwrap();
    (p, c, req.input["candidate"].clone(), review, f)
}

#[test]
fn quote_repair_does_not_hide_bad_references_or_exhausted_budget() {
    for mutation in [
        "unknown_fact",
        "duplicate_fact",
        "missing_fact",
        "empty_quote",
        "unknown_knower",
        "duplicate_knower",
        "missing_knower",
        "late_bad_id",
        "no_budget",
        "no_call",
        "extraction_used",
    ] {
        let (mut p, c, _, mut r, _) = recorded_review_prefix(
            if mutation == "no_call" { 8 } else { 12 },
            if mutation == "no_budget" { 0 } else { 1 },
            mutation == "extraction_used",
        );
        match mutation {
            "unknown_fact" => r["result"]["supports"][0]["fact_id"] = json!("unknown"),
            "duplicate_fact" => r["result"]["supports"][5] = r["result"]["supports"][0].clone(),
            "missing_fact" => {
                r["result"]["supports"].as_array_mut().unwrap().pop();
            }
            "empty_quote" => r["result"]["supports"][0]["quote"] = json!(""),
            "unknown_knower" => {
                r["result"]["knowledge_supports"][0]["subject_id"] = json!("unknown")
            }
            "duplicate_knower" => {
                r["result"]["knowledge_supports"][14] = r["result"]["knowledge_supports"][0].clone()
            }
            "missing_knower" => {
                r["result"]["knowledge_supports"]
                    .as_array_mut()
                    .unwrap()
                    .pop();
            }
            "late_bad_id" => r["result"]["knowledge_supports"][14]["fact_id"] = json!("unknown"),
            _ => (),
        }
        assert!(
            p.accept(&c, r.to_string().as_bytes()).is_err(),
            "{mutation}"
        );
        assert!(p.next_request(&c).is_err(), "{mutation}");
    }
}

#[test]
fn repaired_review_can_reject_and_cannot_request_another_repair() {
    for reject in [false, true] {
        let (mut p, c, frozen, r, _) = recorded_review_prefix(12, 1, false);
        p.accept(&c, r.to_string().as_bytes()).unwrap();
        let req = p.next_request(&c).unwrap();
        assert_eq!(req.stage, "repair_review");
        assert_eq!(req.input["candidate"], frozen);
        let response = if reject {
            json!({"result":rejection()})
        } else {
            r
        };
        assert!(p.accept(&c, response.to_string().as_bytes()).is_err());
        assert!(p.next_request(&c).is_err());
        assert_eq!(p.calls(), 9);
    }
}

#[test]
fn semantic_revision_spends_the_only_budget_before_quote_repair() {
    let (mut p, c, _, r, f) = recorded_review_prefix(12, 1, false);
    p.accept(&c, json!({"result":rejection()}).to_string().as_bytes())
        .unwrap();
    assert_eq!(p.next_request(&c).unwrap().stage, "revise");
    p.accept(&c, f["outputs"][5]["raw"].as_str().unwrap().as_bytes())
        .unwrap();
    assert_eq!(p.next_request(&c).unwrap().stage, "extract");
    p.accept(
        &c,
        &transcribed_recorded_output(&c, "extract", f["outputs"][6]["raw"].as_str().unwrap()),
    )
    .unwrap();
    assert_eq!(p.next_request(&c).unwrap().stage, "review");
    assert!(p.accept(&c, r.to_string().as_bytes()).is_err());
    assert_eq!(p.calls(), 11);
    assert!(p.next_request(&c).is_err());
}

#[test]
fn review_validation_never_normalizes_newlines_or_literal_escape_sequences() {
    let (_, _, frozen, raw, _) = recorded_review_prefix(12, 1, false);
    let mut candidate: Candidate = serde_json::from_value(frozen).unwrap();
    let mut review: Review = serde_json::from_value(raw["result"].clone()).unwrap();
    assert_eq!(
        review.validate(&candidate),
        Err(Invalid("review_quote_mismatch"))
    );
    candidate.passage = candidate.passage.replace('\n', r"\n");
    review.validate(&candidate).unwrap();
    review.supports[1].quote = review.supports[1].quote.replace(r"\n", "\n");
    assert_eq!(
        review.validate(&candidate),
        Err(Invalid("review_quote_mismatch"))
    );
}

#[test]
fn quote_mismatch_cannot_mask_invalid_reveal_coverage() {
    let (_, _, frozen, raw, _) = recorded_review_prefix(12, 1, false);
    let mut candidate: Candidate = serde_json::from_value(frozen).unwrap();
    candidate.reveal_fact_ids = vec!["routes".into()];
    for supports in [
        json!([]),
        json!([{"type":"entity","id":"routes","quote":"顾岚"}]),
        json!([{"type":"fact","id":"routes","quote":"顾岚"},{"type":"fact","id":"routes","quote":"顾岚"}]),
    ] {
        let mut r = raw["result"].clone();
        r["reveal_supports"] = supports;
        let review: Review = serde_json::from_value(r).unwrap();
        let error = review.validate(&candidate).unwrap_err();
        assert_ne!(error, Invalid("review_quote_mismatch"));
    }
}

#[test]
fn sys001_original_extract_accepts_unobserved_character_voice_without_inventing_it() {
    use sha2::{Digest, Sha256};
    let fixture: Value =
        serde_json::from_slice(include_bytes!("fixtures/benchmark-sys001-s04.json")).unwrap();
    assert_eq!(fixture["source_sha256"].as_str().unwrap().len(), 64);
    let context = Context::decode(fixture["context"].to_string().as_bytes()).unwrap();
    let mut pipeline = Pipeline::new(&context, 12).unwrap();
    for output in fixture["outputs"].as_array().unwrap() {
        let raw = output["raw"].as_str().unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(raw.as_bytes())),
            output["raw_sha256"].as_str().unwrap()
        );
        assert_eq!(
            pipeline.next_request(&context).unwrap().stage,
            output["stage"].as_str().unwrap()
        );
        pipeline
            .accept(
                &context,
                &transcribed_recorded_output(&context, output["stage"].as_str().unwrap(), raw),
            )
            .unwrap();
    }
    let review = pipeline.next_request(&context).unwrap();
    assert_eq!(review.stage, "review");
    // The v2 test transcription explicitly excludes the old notebook update.
    // Preserve the original decoder/voice assertion against original bytes.
    let original = fixture["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|output| output["stage"] == "extract")
        .unwrap();
    let outer: Value = serde_json::from_str(original["raw"].as_str().unwrap()).unwrap();
    let original = Candidate::decode(
        outer["result"]["candidate_json"]
            .as_str()
            .unwrap()
            .as_bytes(),
        &context,
    )
    .unwrap();
    let original = serde_json::to_value(original).unwrap();
    let characters = original["narrative_update"]["characters"]
        .as_array()
        .unwrap();
    assert!(review.input["candidate"].get("narrative_update").is_none());
    assert_eq!(
        review.input["candidate"]["memory_delta"],
        json!({"version":2,"entries":[]})
    );
    for id in ["zhou", "shao"] {
        assert_eq!(
            characters.iter().find(|c| c["entity_id"] == id).unwrap()["voice"],
            ""
        );
    }
    // This is transport/validation replay, not an invented semantic approval.
    assert_eq!(pipeline.calls(), 7);
}

fn raw_context() -> Value {
    let mut c: Value =
        serde_json::from_slice(include_bytes!("fixtures/experience-hidden-suffix.json")).unwrap();
    c["pipeline"] = json!({"version":1,"max_actors":2,"max_repairs":1});
    c["reading_request"] = json!("减少重复解释");
    c
}

#[test]
fn stages_select_stably_and_require_an_independent_review() {
    let context = Context::decode(raw_context().to_string().as_bytes()).unwrap();
    let mut pipeline = Pipeline::new(&context, 12).unwrap();
    assert_eq!(pipeline.next_request(&context).unwrap().stage, "memory");
    assert!(matches!(
        pipeline.accept(
            &context,
            br#"{"result":{"actors":[],"relevant_fact_ids":[],"objective":"Observe the doorway"}}"#
        ),
        Ok(PipelineStep::Continue)
    ));
    assert_eq!(pipeline.next_request(&context).unwrap().stage, "plan");
    assert!(pipeline
        .accept(&context, br#"{"result":{"candidates":[]}}"#)
        .is_err());
}

#[test]
fn notebook_survives_read_only_revision_but_rejects_future_or_wrong_type() {
    let mut raw = raw_context();
    raw["state"]["narrative"] = notebook(2);
    assert!(Context::decode(raw.to_string().as_bytes()).is_ok());
    raw["state"]["narrative"]["through_revision"] = json!(4);
    assert!(Context::decode(raw.to_string().as_bytes()).is_err());
    raw["state"]["narrative"] = notebook(3);
    raw["state"]["narrative"]["episodes"] = json!([{"id":"e","summary":"Recap","from_revision":1,"to_revision":2,"fact_ids":["npc_restorer"]}]);
    assert!(Context::decode(raw.to_string().as_bytes()).is_err());
}

fn notebook(revision: u64) -> Value {
    json!({"version":1,"through_revision":revision,"episodes":[],"characters":[],"arcs":[],
        "style":{"voice":"克制的叙事","perspective":"第二人称","pace":"balanced","detail":"balanced","avoid":[],"preference_refs":[]}})
}

fn context() -> Context {
    Context::decode(raw_context().to_string().as_bytes()).unwrap()
}
// These synthetic cases verify material plumbing and bounded retrieval, not prose quality.
#[test]
fn local_memory_delta_replaces_the_requirement_to_rewrite_the_notebook() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    let mut v = candidate(&c);
    v.as_object_mut().unwrap().remove("narrative_update");
    assert_eq!(v["memory_delta"], json!({"version":2,"entries":[]}));
    assert!(Candidate::decode(v.to_string().as_bytes(), &c).is_ok());
    accept(&mut p, &c, "extract", json!({"candidate":v}));
    assert!(matches!(
        accept(&mut p, &c, "review", approval()),
        PipelineStep::Complete(_)
    ));
}

fn material_read(c: &Context, id: &str) -> Value {
    json!({"request_id":id,"source_handle":c.state_coverage.source_handle,
        "selector":{"kind":"objects","objects":[{"type":"fact","id":"fixed_secret"}]},
        "max_reply_bytes":1024})
}

#[test]
fn writer_can_request_source_once_without_spending_its_extraction_and_review_calls() {
    for grant in [6, 7] {
        let c = context();
        let mut p = Pipeline::new(&c, grant).unwrap();
        accept(
            &mut p,
            &c,
            "memory",
            json!({"actors":[],"relevant_fact_ids":[],"objective":"Observe"}),
        );
        accept(&mut p, &c, "plan", plans());
        accept(&mut p, &c, "evaluate", evaluations());
        assert_eq!(p.next_request(&c).unwrap().stage, "write");
        let result = p.accept(
            &c,
            json!({"result":material_read(&c,"writer-source")})
                .to_string()
                .as_bytes(),
        );
        if grant == 6 {
            assert!(matches!(result, Err(Invalid("model_budget_exhausted"))));
        } else {
            assert!(matches!(result, Ok(PipelineStep::Read(_))));
            assert_eq!(p.next_request(&c).unwrap().stage, "write");
            assert!(matches!(
                p.accept(
                    &c,
                    json!({"result":material_read(&c,"writer-again")})
                        .to_string()
                        .as_bytes()
                ),
                Err(Invalid("stage_read_limit"))
            ));
        }
    }
}

#[test]
fn scene_can_declare_material_needs_without_claiming_knowledge_or_presence() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[],"relevant_fact_ids":[],"objective":"Observe",
        "context_needs":{"participant_ids":["npc_restorer"],"relationship_targets":[],
        "topics":["keeping promises"],"open_questions":["What remains unresolved?"],"fact_ids":[]}}),
    );
    let plan = p.next_request(&c).unwrap();
    assert_eq!(
        plan.input["scene"]["context_needs"]["topics"][0],
        "keeping promises"
    );
}

fn local_memory() -> Value {
    json!({"id":"m-bell","kind":"episode","subject_ids":["npc_restorer"],"target_ids":[],
        "cue":"A small interruption","summary":"The bell moved during this visit; its meaning is not established.",
        "status":"active","retrieval_keys":["visit"],"fact_ids":[],"quote":"门铃又摆了一下。"})
}

#[test]
fn literary_changes_require_exact_source_and_do_not_grant_visibility() {
    let c = context();
    let mut v = legacy_candidate(&c);
    v.as_object_mut().unwrap().remove("narrative_update");
    v["memory_changes"] = json!([local_memory()]);
    assert!(Candidate::decode(v.to_string().as_bytes(), &c).is_ok());
    for (field, bad) in [
        ("quote", json!("An event that did not appear.")),
        ("source_revision", json!(4)),
        ("known_by", json!(["npc_restorer"])),
        ("visible_to", json!(["npc_restorer"])),
        ("kind", json!("permanent_personality")),
        ("subject_ids", json!(["fixed_secret"])),
        ("fact_ids", json!(["npc_restorer"])),
        ("summary", json!("x".repeat(2049))),
    ] {
        let mut damaged = v.clone();
        damaged["memory_changes"][0][field] = bad;
        assert!(
            Candidate::decode(damaged.to_string().as_bytes(), &c).is_err(),
            "{field}"
        );
    }
    v["memory_changes"] = json!(vec![local_memory(); 13]);
    assert!(Candidate::decode(v.to_string().as_bytes(), &c).is_err());
    let mut ask = c.clone();
    ask.mode = Mode::Ask;
    ask.input = "What is known?".into();
    ask.state = known_information(&ask.state);
    ask.state_coverage.audience = Audience::Reader;
    ask.state_coverage.total = StateCounts::default();
    let mut v = legacy_candidate(&ask);
    v.as_object_mut().unwrap().remove("narrative_update");
    v["memory_changes"] = json!([]);
    assert!(Candidate::decode(v.to_string().as_bytes(), &ask).is_err());
}

#[test]
fn reviewer_must_account_for_each_local_memory_change_with_its_exact_quote() {
    let c = context();
    let mut v = legacy_candidate(&c);
    v["memory_changes"] = json!([local_memory()]);
    let candidate = Candidate::decode(v.to_string().as_bytes(), &c).unwrap();
    let missing: Review = serde_json::from_value(approval()).unwrap();
    assert!(matches!(
        missing.validate(&candidate),
        Err(Invalid("review_memory_evidence_missing"))
    ));
    let mut review = approval();
    review["memory_supports"] = json!([{"memory_id":"m-bell","quote":"门铃又摆了一下。"}]);
    assert!(serde_json::from_value::<Review>(review.clone())
        .unwrap()
        .validate(&candidate)
        .is_ok());
    for damage in ["unknown", "duplicate", "different_quote"] {
        let mut bad = review.clone();
        match damage {
            "unknown" => bad["memory_supports"][0]["memory_id"] = json!("other-memory"),
            "duplicate" => bad["memory_supports"]
                .as_array_mut()
                .unwrap()
                .push(review["memory_supports"][0].clone()),
            _ => bad["memory_supports"][0]["quote"] = json!("门铃"),
        }
        assert!(
            serde_json::from_value::<Review>(bad)
                .unwrap()
                .validate(&candidate)
                .is_err(),
            "{damage}"
        );
    }
}

#[test]
fn stored_literary_index_stays_author_only_and_preserves_migration_gaps() {
    let mut raw = raw_context();
    let mut entry = local_memory();
    entry["source_revision"] = json!(3);
    entry["updated_revision"] = json!(3);
    entry["source_sha256"] = json!("a".repeat(64));
    // An indexed new page does not imply old pages have been retrospectively indexed.
    raw["state"]["literary_memory"] =
        json!({"version":1,"indexed_through_revision":0,"entries":[entry]});
    let c = Context::decode(raw.to_string().as_bytes()).unwrap();
    assert!(serde_json::to_value(known_information(&c.state))
        .unwrap()
        .get("literary_memory")
        .is_none());
    let mut p = Pipeline::new(&c, 12).unwrap();
    assert!(!p
        .next_request(&c)
        .unwrap()
        .input
        .to_string()
        .contains("m-bell"));
    for (field, bad) in [
        ("source_revision", json!(4)),
        ("updated_revision", json!(2)),
        ("source_sha256", json!("Z".repeat(64))),
        ("fact_ids", json!(["npc_restorer"])),
    ] {
        let mut damaged = raw.clone();
        damaged["state"]["literary_memory"]["entries"][0][field] = bad;
        assert!(
            Context::decode(damaged.to_string().as_bytes()).is_err(),
            "{field}"
        );
    }
    let mut update = legacy_candidate(&c);
    update["memory_changes"] = json!([local_memory()]);
    update["memory_changes"][0]["target_ids"] = json!(["thread_old_book"]);
    assert!(Candidate::decode(update.to_string().as_bytes(), &c).is_err());
}

#[test]
fn stored_literary_lineage_preserves_ordered_sources_but_is_never_model_writable() {
    let mut raw = raw_context();
    let mut entry = local_memory();
    entry["source_revision"] = json!(3);
    entry["updated_revision"] = json!(3);
    entry["source_sha256"] = json!("a".repeat(64));
    entry["prior_sources"] = json!([
        {"revision":1,"sha256":"b".repeat(64),"quote":"An earlier promise."},
        {"revision":2,"sha256":"c".repeat(64),"quote":"The promise gained a condition."}
    ]);
    raw["state"]["literary_memory"] =
        json!({"version":1,"indexed_through_revision":0,"entries":[entry]});
    let c = Context::decode(raw.to_string().as_bytes()).unwrap();
    assert_eq!(
        serde_json::to_value(&c).unwrap()["state"]["literary_memory"]["entries"][0]
            ["prior_sources"][0]["revision"],
        1
    );
    for damage in [
        "future",
        "same_revision",
        "unordered",
        "duplicate",
        "hash",
        "empty_quote",
        "oversized_quote",
    ] {
        let mut bad = raw.clone();
        let sources = &mut bad["state"]["literary_memory"]["entries"][0]["prior_sources"];
        match damage {
            "future" => sources[1]["revision"] = json!(4),
            "same_revision" => sources[1]["revision"] = json!(3),
            "unordered" => sources.as_array_mut().unwrap().swap(0, 1),
            "duplicate" => sources[1] = sources[0].clone(),
            "hash" => sources[1]["sha256"] = json!("Z".repeat(64)),
            "empty_quote" => sources[1]["quote"] = json!(" "),
            _ => sources[1]["quote"] = json!("x".repeat(2049)),
        }
        assert!(
            Context::decode(bad.to_string().as_bytes()).is_err(),
            "{damage}"
        );
    }
    let mut proposed = legacy_candidate(&c);
    proposed["memory_changes"] = json!([local_memory()]);
    proposed["memory_changes"][0]["prior_sources"] =
        raw["state"]["literary_memory"]["entries"][0]["prior_sources"].clone();
    assert!(Candidate::decode(proposed.to_string().as_bytes(), &c).is_err());
}

#[test]
fn omitted_actor_material_is_deferred_to_go_but_loaded_hidden_or_wrong_types_are_not() {
    let mut raw = raw_context();
    raw["state_coverage"]["policy"] = json!("stage-scene-selection.v1");
    raw["state_coverage"]["total"]["facts"] = json!(2);
    raw["state_coverage"]["omitted"]["facts"] = json!(1);
    raw["state_coverage"]["complete"] = json!(false);
    for (id, should_pass) in [
        ("old-voice", true),
        ("npc_restorer", false),
        ("thread_old_book", false),
    ] {
        let c = Context::decode(raw.to_string().as_bytes()).unwrap();
        let mut p = Pipeline::new(&c, 12).unwrap();
        accept(
            &mut p,
            &c,
            "memory",
            json!({"actors":[{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}],"relevant_fact_ids":[],"objective":"A visit"}),
        );
        p.next_request(&c).unwrap();
        let decision = json!({"result":{"actor_id":"npc_restorer","intent":"Wait","action":"Wait","speech":"","conditions":[],"used_fact_ids":[id]}});
        assert_eq!(
            p.accept(&c, decision.to_string().as_bytes()).is_ok(),
            should_pass,
            "{id}"
        );
    }
}

#[test]
fn every_main_stage_can_supplement_its_material_without_advancing_the_stage() {
    for target in [
        "memory", "actor", "plan", "evaluate", "write", "extract", "review", "answer",
    ] {
        let mut c = context();
        if target == "answer" {
            c.mode = Mode::Ask;
            c.input = "What happened?".into();
            c.state = known_information(&c.state);
            c.state_coverage.audience = Audience::Reader;
            c.state_coverage.total = StateCounts::default();
        }
        let mut p = Pipeline::new(&c, 12).unwrap();
        if !matches!(target, "memory" | "answer") {
            let actors = if target == "actor" {
                json!([{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}])
            } else {
                json!([])
            };
            accept(
                &mut p,
                &c,
                "memory",
                json!({"actors":actors,"relevant_fact_ids":[],"objective":"Observe"}),
            );
            if !matches!(target, "actor" | "plan") {
                accept(&mut p, &c, "plan", plans());
                if target != "evaluate" {
                    accept(&mut p, &c, "evaluate", evaluations());
                    if target != "write" {
                        accept(&mut p, &c, "write", draft(&c));
                        if target == "review" {
                            accept(&mut p, &c, "extract", json!({"candidate":candidate(&c)}));
                        }
                    }
                }
            }
        }
        let request = p.next_request(&c).unwrap();
        assert_eq!(request.stage, target);
        if !matches!(target, "actor" | "answer") {
            for marker in [
                "source_directory",
                "不是已读证据",
                "memory_evidence.sources",
                "ReadRequest",
            ] {
                assert!(request.prompt.contains(marker), "{target}: {marker}");
            }
        }
        assert_eq!(
            request.schema["properties"]["result"]["anyOf"][1]["$ref"],
            "#/$defs/read_request"
        );
        let read = material_read(&c, &format!("read-{target}"));
        assert!(
            matches!(
                p.accept(&c, json!({"result":read}).to_string().as_bytes()),
                Ok(PipelineStep::Read(_))
            ),
            "{target}"
        );
        assert_eq!(p.next_request(&c).unwrap().stage, target);
    }
}

#[test]
fn repair_review_explains_that_source_granularity_can_still_omit_old_quotes() {
    let (mut pipeline, context, _, review, _) = recorded_review_prefix(12, 1, false);
    pipeline
        .accept(&context, review.to_string().as_bytes())
        .unwrap();
    let request = pipeline.next_request(&context).unwrap();
    assert_eq!(request.stage, "repair_review");
    for marker in [
        "source_directory",
        "不是已读证据",
        "memory_evidence.sources",
        "ReadRequest",
    ] {
        assert!(request.prompt.contains(marker), "{marker}");
    }
}

#[test]
fn actor_source_reads_cannot_request_pages_other_objects_or_historical_knowledge() {
    for selector in [
        json!({"kind":"pages","from_revision":1,"to_revision":1}),
        json!({"kind":"objects","objects":[{"type":"entity","id":"npc_restorer"}]}),
        json!({"kind":"objects","objects":[{"type":"fact","id":"fixed_secret","at_revision":1}]}),
    ] {
        let c = context();
        let mut p = Pipeline::new(&c, 12).unwrap();
        accept(
            &mut p,
            &c,
            "memory",
            json!({"actors":[{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}],"relevant_fact_ids":[],"objective":"Observe"}),
        );
        p.next_request(&c).unwrap();
        let mut read = material_read(&c, "actor-read");
        read["selector"] = selector;
        assert!(matches!(
            p.accept(&c, json!({"result":read}).to_string().as_bytes()),
            Err(Invalid("actor_read_scope"))
        ));
    }
}

#[test]
fn prior_stage_raw_recalls_stay_in_audit_but_are_not_repeated_in_every_prompt() {
    let mut c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    p.next_request(&c).unwrap();
    let read: ReadRequest = serde_json::from_value(
        json!({"request_id":"memory-page","source_handle":c.state_coverage.source_handle,
        "selector":{"kind":"pages","from_revision":1,"to_revision":1},"max_reply_bytes":8192}),
    )
    .unwrap();
    assert!(matches!(
        p.accept(&c, json!({"result":read}).to_string().as_bytes()),
        Ok(PipelineStep::Read(_))
    ));
    let mut reply = ReadReply {
        request_id: read.request_id.clone(),
        source_handle: read.source_handle.clone(),
        experience_id: c.experience_id.clone(),
        branch_id: c.branch_id.clone(),
        base_revision: c.revision,
        audience: Audience::Author,
        objects: vec![],
        pages: vec![Page {
            revision: 1,
            mode: Mode::Begin,
            input: String::new(),
            text: "OLD_SOURCE_FOR_MEMORY_STAGE".into(),
        }],
        complete: true,
        next_cursor: Value::Null,
        receipt: ReadReceipt {
            query_sha256: receipt_hash(&serde_json::to_value(read).unwrap()),
            body_sha256: String::new(),
        },
    };
    reply.receipt.body_sha256 = reply.body_hash();
    c.recalls.push(reply);
    let memory = p.next_request(&c).unwrap();
    assert!(memory
        .input
        .to_string()
        .contains("OLD_SOURCE_FOR_MEMORY_STAGE"));
    p.accept(
        &c,
        br#"{"result":{"actors":[],"relevant_fact_ids":[],"objective":"Observe"}}"#,
    )
    .unwrap();
    let plan = p.next_request(&c).unwrap();
    assert!(!plan
        .input
        .to_string()
        .contains("OLD_SOURCE_FOR_MEMORY_STAGE"));
    assert_eq!(c.recalls.len(), 1);
}
fn plans() -> Value {
    json!({"candidates":[
        {"id":"wait","purpose":"Let the visitor act","beats":["Bell moves"],"causes":[],"costs":["time"],"consequences":[],"thread_ids":[],"fact_ids":[]},
        {"id":"knock","purpose":"A deliberate knock","beats":["Someone knocks"],"causes":[],"costs":[],"consequences":[],"thread_ids":[],"fact_ids":[]}]})
}
fn evaluations() -> Value {
    json!({"evaluations":[
        {"candidate_id":"wait","continuity":3,"agency":3,"causality":3,"consequence":3,"pacing":3,"interest":3,"blocking_issues":[],"evidence_fact_ids":[]},
        {"candidate_id":"knock","continuity":4,"agency":4,"causality":4,"consequence":4,"pacing":4,"interest":4,"blocking_issues":[],"evidence_fact_ids":[]}]})
}
fn draft(c: &Context) -> Value {
    json!({"title":"门铃","passage":"门铃又摆了一下。","story_time":c.state.story_time,"outcome":"continues","suggestions":[]})
}
fn candidate(c: &Context) -> Value {
    let mut v = draft(c);
    for field in [
        "new_facts",
        "new_entities",
        "new_threads",
        "reveal_fact_ids",
        "reveal_entity_ids",
        "reveal_thread_ids",
        "resolve_thread_ids",
        "knowledge_changes",
    ] {
        v[field] = json!([]);
    }
    v["memory_delta"] = json!({"version":2,"entries":[]});
    v
}
// Legacy decoder tests deliberately keep the original notebook/v1 carrier.
fn legacy_candidate(c: &Context) -> Value {
    let mut v = candidate(c);
    v.as_object_mut().unwrap().remove("memory_delta");
    v["narrative_update"] = notebook(c.revision + 1);
    v
}
fn accept(p: &mut Pipeline, c: &Context, expected: &str, value: Value) -> PipelineStep {
    let request = p.next_request(c).unwrap();
    assert_eq!(request.stage, expected);
    assert!(
        request.schema.to_string().len()
            <= elselife_algorithms::experience::pipeline::MAX_STAGE_SCHEMA_BYTES
    );
    p.accept(c, json!({"result":value}).to_string().as_bytes())
        .unwrap()
}
fn to_extract(p: &mut Pipeline, c: &Context) {
    accept(
        p,
        c,
        "memory",
        json!({"actors":[],"relevant_fact_ids":[],"objective":"The doorway changes"}),
    );
    accept(p, c, "plan", plans());
    accept(p, c, "evaluate", evaluations());
    let request = p.next_request(c).unwrap();
    assert_eq!(request.stage, "write");
    assert_eq!(request.input["selected_plan"]["id"], "knock");
    p.accept(c, json!({"result":draft(c)}).to_string().as_bytes())
        .unwrap();
}
fn approval() -> Value {
    json!({"approved":true,"issues":[],"supports":[],"knowledge_supports":[]})
}

// Fixed outcomes exercise feedback routing; the reviewer judgments below are
// synthetic and do not establish semantic or literary correctness.
fn state_rejection(scope: Option<&str>) -> Value {
    let mut value = json!({"approved":false,
        "issues":[{"code":"unstructured_code","detail":"复合事实把未观察到的经历授予人物；仅修候选状态。"}],
        "supports":[],"knowledge_supports":[],"memory_supports":[],"reveal_supports":[]});
    if let Some(scope) = scope {
        value["repair_scope"] = json!(scope);
    }
    value
}

fn state_only(mut value: Value) -> Value {
    for field in ["title", "passage", "story_time", "outcome", "suggestions"] {
        value.as_object_mut().unwrap().remove(field);
    }
    value
}

fn to_state_review(grant: u32) -> (Context, Pipeline, Value) {
    let c = context();
    let mut p = Pipeline::new(&c, grant).unwrap();
    to_extract(&mut p, &c);
    accept(&mut p, &c, "extract", json!({"candidate":candidate(&c)}));
    let review = p.next_request(&c).unwrap();
    assert_eq!(review.stage, "review");
    (c, p, review.input["candidate"].clone())
}

#[test]
fn state_repair_feedback_reaches_second_extractor_for_legacy_review() {
    let (c, mut p, rejected) = to_state_review(12);
    let review = state_rejection(None);
    p.accept(&c, json!({"result":review}).to_string().as_bytes())
        .unwrap();
    accept(&mut p, &c, "revise", draft(&c));
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "extract");
    assert_eq!(
        request.input["repair_feedback"]["issues"], review["issues"],
        "review feedback was lost before the only stage able to change state"
    );
    assert_eq!(
        request.input["repair_feedback"]["candidate_state"],
        state_only(rejected)
    );
    assert_eq!(request.input["draft"], draft(&c));
}

#[test]
fn state_repair_routes_only_typed_state_rejection_and_freezes_prose() {
    let (c, mut p, rejected) = to_state_review(12);
    let review = state_rejection(Some("candidate_state"));
    p.accept(&c, json!({"result":review}).to_string().as_bytes())
        .unwrap();
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "repair_state");
    assert_eq!(request.input["candidate"], rejected);
    assert_eq!(request.input["issues"], review["issues"]);
    assert!(
        request.input.get("draft").is_none(),
        "do not duplicate frozen prose"
    );
    for field in ["title", "passage", "story_time", "outcome", "suggestions"] {
        assert!(request.schema["$defs"]["candidate"]["properties"]
            .get(field)
            .is_none());
    }
    p.accept(
        &c,
        json!({"result":{"candidate":state_only(rejected.clone())}})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    let independent = p.next_request(&c).unwrap();
    assert_eq!(independent.stage, "review");
    assert_eq!(independent.input["candidate"], rejected);
    assert!(
        independent.input.get("issues").is_none(),
        "independent review must not inherit verdict"
    );
    let mut approved = approval();
    approved["repair_scope"] = json!("none");
    assert!(matches!(
        p.accept(&c, json!({"result":approved}).to_string().as_bytes())
            .unwrap(),
        PipelineStep::Complete(_)
    ));
    assert_eq!(p.calls(), 8);
}

#[test]
fn state_repair_mixed_and_uncertain_feedback_uses_current_revised_draft() {
    for scope in ["draft", "mixed", "undetermined"] {
        let (c, mut p, rejected) = to_state_review(12);
        let review = state_rejection(Some(scope));
        p.accept(&c, json!({"result":review}).to_string().as_bytes())
            .unwrap();
        let mut revised = draft(&c);
        revised["passage"] = json!("门铃停住了。");
        accept(&mut p, &c, "revise", revised.clone());
        let request = p.next_request(&c).unwrap();
        assert_eq!(request.stage, "extract");
        assert_eq!(request.input["draft"], revised);
        assert_eq!(
            request.input["repair_feedback"]["candidate_state"],
            state_only(rejected)
        );
        assert_eq!(request.input["repair_feedback"]["issues"], review["issues"]);
    }
}

#[test]
fn state_repair_rejection_and_shape_failure_cannot_spend_a_second_repair() {
    for malformed in [false, true] {
        let (c, mut p, rejected) = to_state_review(12);
        let review = state_rejection(Some("candidate_state"));
        p.accept(&c, json!({"result":review}).to_string().as_bytes())
            .unwrap();
        assert_eq!(p.next_request(&c).unwrap().stage, "repair_state");
        if malformed {
            assert!(p
                .accept(&c, br#"{"result":{"candidate":"wrong shape"}}"#)
                .is_err());
            assert_eq!(p.calls(), 7);
        } else {
            p.accept(
                &c,
                json!({"result":{"candidate":state_only(rejected)}})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
            assert_eq!(p.next_request(&c).unwrap().stage, "review");
            assert_eq!(
                p.accept(&c, json!({"result":review}).to_string().as_bytes())
                    .unwrap_err(),
                Invalid("narrative_review_rejected")
            );
            assert_eq!(p.calls(), 8);
        }
    }
}

#[test]
fn state_repair_cannot_change_any_frozen_field_even_with_legacy_full_output() {
    for field in ["title", "passage", "story_time", "outcome", "suggestions"] {
        let (c, mut p, mut rejected) = to_state_review(12);
        p.accept(
            &c,
            json!({"result":state_rejection(Some("candidate_state"))})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        p.next_request(&c).unwrap();
        rejected[field] = match field {
            "suggestions" => json!(["不同建议"]),
            "outcome" => json!("awaits_player"),
            "story_time" => json!("次日"),
            _ => json!("改变原文"),
        };
        assert_eq!(
            p.accept(
                &c,
                json!({"result":{"candidate":rejected}})
                    .to_string()
                    .as_bytes()
            )
            .unwrap_err(),
            Invalid("extract_changed_draft")
        );
    }
}

#[test]
fn state_repair_requires_room_for_independent_review() {
    for (grant, scope) in [(7, "candidate_state"), (8, "mixed")] {
        let (c, mut p, _) = to_state_review(grant);
        assert_eq!(
            p.accept(
                &c,
                json!({"result":state_rejection(Some(scope))})
                    .to_string()
                    .as_bytes()
            )
            .unwrap_err(),
            Invalid("model_budget_exhausted")
        );
        assert_eq!(p.calls(), 6);
    }
}

#[test]
fn state_repair_scope_is_closed_and_consistent() {
    for scope in [json!(""), json!("unknown"), json!(null), json!("none")] {
        let (c, mut p, _) = to_state_review(12);
        let mut review = state_rejection(None);
        review["repair_scope"] = scope;
        assert!(p
            .accept(&c, json!({"result":review}).to_string().as_bytes())
            .is_err());
    }
    let (c, mut p, _) = to_state_review(12);
    let mut review = approval();
    review["repair_scope"] = json!("candidate_state");
    assert!(p
        .accept(&c, json!({"result":review}).to_string().as_bytes())
        .is_err());
}

#[test]
fn state_repair_keeps_supported_fact_and_changes_only_unsupported_knower() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    let mut rejected = candidate(&c);
    rejected["new_facts"] = json!([{"id":"bell-moved","kind":"fact","text":"门铃又摆了一下。",
        "subject_id":"","known":true,"known_by":["npc_restorer"],"source_revision":c.revision+1}]);
    accept(&mut p, &c, "extract", json!({"candidate":rejected}));
    accept(
        &mut p,
        &c,
        "review",
        state_rejection(Some("candidate_state")),
    );
    let request = p.next_request(&c).unwrap();
    let mut corrected = request.input["candidate"].clone();
    corrected["new_facts"][0]["known_by"] = json!([]);
    p.accept(
        &c,
        json!({"result":{"candidate":state_only(corrected.clone())}})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "review");
    assert_eq!(request.input["candidate"], corrected);
    let mut review = approval();
    review["repair_scope"] = json!("none");
    review["supports"] = json!([{"fact_id":"bell-moved","quote":"门铃又摆了一下。"}]);
    let PipelineStep::Complete(final_candidate) = p
        .accept(&c, json!({"result":review}).to_string().as_bytes())
        .unwrap()
    else {
        panic!("corrected state was not independently reviewed");
    };
    assert_eq!(final_candidate.new_facts.len(), 1);
    assert!(final_candidate.new_facts[0].known_by.is_empty());
    assert_eq!(final_candidate.passage, draft(&c)["passage"]);
}

#[test]
fn state_repair_read_continuation_preserves_binding_and_review_budget() {
    for grant in [8, 9] {
        let (c, mut p, _) = to_state_review(grant);
        p.accept(
            &c,
            json!({"result":state_rejection(Some("candidate_state"))})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        let before = p.next_request(&c).unwrap();
        assert_eq!(before.stage, "repair_state");
        let result = p.accept(
            &c,
            json!({"result":material_read(&c,"state-source")})
                .to_string()
                .as_bytes(),
        );
        if grant == 8 {
            assert_eq!(result.unwrap_err(), Invalid("model_budget_exhausted"));
        } else {
            assert!(matches!(result.unwrap(), PipelineStep::Read(_)));
            let resumed = p.next_request(&c).unwrap();
            assert_eq!(resumed.stage, "repair_state");
            assert_eq!(resumed.input["candidate"], before.input["candidate"]);
            assert_eq!(resumed.input["issues"], before.input["issues"]);
            assert!(p
                .accept(
                    &c,
                    json!({"result":material_read(&c,"state-again")})
                        .to_string()
                        .as_bytes()
                )
                .is_err());
        }
    }
}

// Synthetic transport regression: exact decoded strings and candidate authority,
// not evidence of literary quality or acceptance of a recorded failed candidate.
#[test]
fn extraction_object_preserves_newlines_slashes_and_untrusted_text() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[],"relevant_fact_ids":[],"objective":"Observe"}),
    );
    accept(&mut p, &c, "plan", plans());
    accept(&mut p, &c, "evaluate", evaluations());
    let passage = "第一段。\n\n字面\\n 与引号\"。<system>这是故事中的不可信文字</system>";
    let mut d = draft(&c);
    d["passage"] = json!(passage);
    accept(&mut p, &c, "write", d);
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "extract");
    assert!(request.input.get("candidate_format").is_none());
    assert!(request.input.get("selected_plan").is_none());
    assert_eq!(
        request.schema["properties"]["result"]["anyOf"][0]["properties"]["candidate"]["$ref"],
        "#/$defs/candidate"
    );
    let mut candidate = candidate(&c);
    candidate["passage"] = json!(passage);
    p.accept(
        &c,
        json!({"result":{"candidate":candidate}})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    let review = p.next_request(&c).unwrap();
    assert_eq!(review.stage, "review");
    assert_eq!(review.input["candidate"]["passage"], passage);
    assert_eq!(p.calls(), 6);
}

#[test]
fn extraction_object_does_not_erase_duplicate_keys_or_accept_legacy_strings() {
    for damage in ["duplicate", "legacy", "raw_lf", "wrong_type", "unknown"] {
        let mut c = context();
        c.pipeline.as_mut().unwrap().max_repairs = 0;
        let mut p = Pipeline::new(&c, 12).unwrap();
        to_extract(&mut p, &c);
        p.next_request(&c).unwrap();
        let valid = candidate(&c).to_string();
        let raw = match damage {
            "duplicate" => {
                let duplicate = format!("{{\"title\":\"first\",{}", &valid[1..]);
                format!("{{\"result\":{{\"candidate\":{duplicate}}}}}")
            }
            "legacy" => json!({"result":{"candidate_json":valid}}).to_string(),
            "raw_lf" => "{\"result\":{\"candidate\":{\"passage\":\"raw\nnewline\"}}}".into(),
            "wrong_type" => "{\"result\":{\"candidate\":\"not an object\"}}".into(),
            _ => {
                let mut v = candidate(&c);
                v["surprise"] = json!(true);
                json!({"result":{"candidate":v}}).to_string()
            }
        };
        if damage == "duplicate" {
            // Prove rejection reaches preserved duplicate-key evidence, not JSON syntax.
            serde_json::from_str::<Value>(&raw).expect("syntactically valid duplicate key");
        }
        assert!(p.accept(&c, raw.as_bytes()).is_err(), "{damage}");
        assert_eq!(p.calls(), 5);
    }
}
fn rejection() -> Value {
    json!({"approved":false,"issues":[{"code":"continuity","detail":"The bell already stopped"}],"supports":[],"knowledge_supports":[]})
}

#[test]
fn full_pipeline_returns_only_exact_reviewed_candidate() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    let candidate = candidate(&c);
    assert!(matches!(
        accept(&mut p, &c, "extract", json!({"candidate":candidate})),
        PipelineStep::Continue
    ));
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "review");
    assert_eq!(request.input["candidate"], candidate);
    let PipelineStep::Complete(done) = p
        .accept(&c, json!({"result":approval()}).to_string().as_bytes())
        .unwrap()
    else {
        panic!("not approved")
    };
    assert_eq!(serde_json::to_value(done).unwrap(), candidate);
    assert_eq!(p.calls(), 6);
    assert!(p.next_request(&c).is_err());
}

#[test]
fn one_specific_repair_is_reextracted_and_reviewed_then_failure_stops() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    accept(&mut p, &c, "extract", json!({"candidate":candidate(&c)}));
    accept(&mut p, &c, "review", rejection());
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "revise");
    assert_eq!(request.input["issues"][0]["code"], "continuity");
    p.accept(&c, json!({"result":draft(&c)}).to_string().as_bytes())
        .unwrap();
    accept(&mut p, &c, "extract", json!({"candidate":candidate(&c)}));
    assert_eq!(p.next_request(&c).unwrap().stage, "review");
    assert!(matches!(
        p.accept(&c, json!({"result":rejection()}).to_string().as_bytes()),
        Err(Invalid("narrative_review_rejected"))
    ));
    assert_eq!(p.calls(), 9);
}

#[test]
fn extraction_never_rewrites_draft_or_salvages_invalid_metadata() {
    for damage in ["passage", "time", "fact", "missing_delta"] {
        let mut c = context();
        c.pipeline.as_mut().unwrap().max_repairs = 0;
        let mut p = Pipeline::new(&c, 12).unwrap();
        to_extract(&mut p, &c);
        let mut v = candidate(&c);
        match damage {
            "passage" => v["passage"] = json!("玩家答应把书送走。"),
            "time" => v["story_time"] = json!("明天"),
            "fact" => v["new_facts"] = json!([{"id":"broken"}]),
            _ => {
                v.as_object_mut().unwrap().remove("memory_delta");
            }
        }
        assert_eq!(p.next_request(&c).unwrap().stage, "extract");
        assert!(
            p.accept(&c, json!({"result":{"candidate":v}}).to_string().as_bytes())
                .is_err(),
            "{damage}"
        );
    }
}

#[test]
fn structural_extract_repair_preserves_draft_and_shares_the_only_repair_budget() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    let mut malformed = candidate(&c);
    malformed.as_object_mut().unwrap().remove("new_facts");
    accept(&mut p, &c, "extract", json!({"candidate":malformed}));
    let repair = p.next_request(&c).unwrap();
    assert_eq!(repair.stage, "repair_extract");
    assert_eq!(repair.input["draft"], draft(&c));
    assert_eq!(repair.input["extraction_error"], "invalid_candidate_shape");
    assert!(!repair.input.to_string().contains("rejected_candidate"));
    p.accept(
        &c,
        json!({"result":{"candidate":candidate(&c)}})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    assert_eq!(p.next_request(&c).unwrap().stage, "review");
    assert!(matches!(
        p.accept(&c, json!({"result":rejection()}).to_string().as_bytes()),
        Err(Invalid("narrative_review_rejected"))
    ));
    assert_eq!(p.calls(), 7);
}

#[test]
fn structural_repair_is_bounded_and_cannot_change_the_frozen_story() {
    for damage in ["shape", "passage", "reference"] {
        let c = context();
        let mut p = Pipeline::new(&c, 12).unwrap();
        to_extract(&mut p, &c);
        accept(&mut p, &c, "extract", json!({"candidate_json":"{"}));
        let mut fixed = candidate(&c);
        match damage {
            "shape" => {
                fixed.as_object_mut().unwrap().remove("new_facts");
            }
            "passage" => fixed["passage"] = json!("A different story"),
            _ => fixed["reveal_fact_ids"] = json!(["unknown_fact"]),
        }
        assert_eq!(p.next_request(&c).unwrap().stage, "repair_extract");
        assert!(p
            .accept(
                &c,
                json!({"result":{"candidate":fixed}}).to_string().as_bytes()
            )
            .is_err());
        assert_eq!(p.calls(), 6);
    }
    let c = context();
    let mut p = Pipeline::new(&c, 6).unwrap();
    to_extract(&mut p, &c);
    p.next_request(&c).unwrap();
    assert!(matches!(
        p.accept(&c, br#"{"result":{"candidate_json":"{"}}"#),
        Err(Invalid("model_budget_exhausted"))
    ));
}

#[test]
fn semantic_reference_failure_is_not_a_structural_retry() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    p.next_request(&c).unwrap();
    let mut invalid = candidate(&c);
    invalid["reveal_fact_ids"] = json!(["unknown_fact"]);
    assert!(p
        .accept(
            &c,
            json!({"result":{"candidate":invalid}})
                .to_string()
                .as_bytes()
        )
        .is_err());
    assert_eq!(p.calls(), 5);
}

#[test]
fn unknown_style_and_character_voice_match_the_shared_contract_without_fabrication() {
    let mut raw = raw_context();
    let mut n = notebook(3);
    n["characters"] = json!([{"entity_id":"npc_restorer","goals":[],"relationships":[],"voice":"","belief_fact_ids":[],"updated_revision":3}]);
    n["style"]["voice"] = json!("");
    n["style"]["perspective"] = json!("");
    raw["state"]["narrative"] = n;
    assert!(Context::decode(raw.to_string().as_bytes()).is_ok());
    raw["state"]["narrative"]["characters"][0]["voice"] = json!("x".repeat(2049));
    assert!(Context::decode(raw.to_string().as_bytes()).is_err());
}

#[test]
fn model_validation_failures_have_stage_categories_not_protocol_failures() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    assert_eq!(
        p.failure_reason(Invalid("invalid_scene_frame")),
        "narrative_stage_invalid"
    );
    to_extract(&mut p, &c);
    assert_eq!(
        p.failure_reason(Invalid("invalid_character_memory")),
        "invalid_candidate"
    );
    assert_eq!(
        p.failure_reason(Invalid("extract_changed_draft")),
        "narrative_extraction_mismatch"
    );
    assert_eq!(
        p.failure_reason(Invalid("stage_content_capacity")),
        "context_budget_exceeded"
    );
    assert_eq!(
        p.failure_reason(Invalid("candidate_budget_exceeded")),
        "model_output_capacity"
    );
}

#[test]
fn evaluator_uses_complete_coverage_blocking_and_stable_ties() {
    let c = context();
    let plans: Plans = serde_json::from_value(plans()).unwrap();
    let mut e = evaluations();
    e["evaluations"][1]["blocking_issues"] = json!(["Unobserved secret"]);
    assert_eq!(
        select_plan(
            &plans,
            &serde_json::from_value::<Evaluations>(e.clone()).unwrap(),
            &c
        )
        .unwrap()
        .id,
        "wait"
    );
    e["evaluations"][0]["blocking_issues"] = json!(["Unauthorized player promise"]);
    assert!(select_plan(&plans, &serde_json::from_value(e).unwrap(), &c).is_err());
    let mut e = evaluations();
    let first = e["evaluations"][0].clone();
    e["evaluations"][1] = first;
    e["evaluations"][1]["candidate_id"] = json!("knock");
    assert_eq!(
        select_plan(&plans, &serde_json::from_value(e).unwrap(), &c)
            .unwrap()
            .id,
        "wait"
    );
    let mut e = evaluations();
    e["evaluations"].as_array_mut().unwrap().pop();
    assert!(select_plan(&plans, &serde_json::from_value(e).unwrap(), &c).is_err());
}

#[test]
fn actor_inputs_are_separate_and_unknown_trigger_cannot_leak_private_input() {
    let mut raw = raw_context();
    raw["mode"] = json!("act");
    raw["input"] = json!("背着修书人藏起PRIVATE_INPUT");
    raw["seed"] = json!("PRIVATE_AUTHOR_WORLD");
    let c = Context::decode(raw.to_string().as_bytes()).unwrap();
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}],"relevant_fact_ids":["fixed_secret"],"objective":"A visit"}),
    );
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "actor");
    assert_eq!(request.input.as_object().unwrap().len(), 3);
    for private in [
        "PRIVATE_INPUT",
        "PRIVATE_AUTHOR_WORLD",
        "history",
        "state",
        "objective",
    ] {
        assert!(!request.input.to_string().contains(private));
    }
    assert!(p.accept(&c,json!({"result":{"actor_id":"npc_restorer","intent":"Get book","action":"Wait","speech":"","conditions":[],"used_fact_ids":["unknown_secret"]}}).to_string().as_bytes()).is_err());
    let mut p = Pipeline::new(&c, 12).unwrap();
    p.next_request(&c).unwrap();
    assert!(matches!(p.accept(&c,json!({"result":{"actors":[{"actor_id":"npc_restorer","trigger":"PRIVATE_INPUT","fact_ids":["fixed_secret"]}],"relevant_fact_ids":[],"objective":"Visit"}}).to_string().as_bytes()),Err(Invalid("actor_trigger_not_observed"))));
}

#[test]
fn approved_review_covers_facts_and_every_new_knowledge_edge_with_exact_quotes() {
    let c = context();
    let mut v = candidate(&c);
    v["new_facts"] = json!([{"id":"bell","kind":"fact","text":"门铃摆动。","subject_id":"","known":true,"source_revision":4,"known_by":["npc_restorer"]}]);
    let candidate: Candidate = serde_json::from_value(v).unwrap();
    let mut review = approval();
    review["supports"] = json!([{"fact_id":"bell","quote":"门铃又摆了一下。"}]);
    assert_eq!(
        serde_json::from_value::<Review>(review.clone())
            .unwrap()
            .validate(&candidate),
        Err(Invalid("review_evidence_missing"))
    );
    review["knowledge_supports"] =
        json!([{"subject_id":"npc_restorer","fact_id":"bell","quote":"门铃又摆了一下。"}]);
    assert!(serde_json::from_value::<Review>(review.clone())
        .unwrap()
        .validate(&candidate)
        .is_ok());
    review["knowledge_supports"][0]["quote"] = json!("修书人看见门铃。");
    assert!(serde_json::from_value::<Review>(review)
        .unwrap()
        .validate(&candidate)
        .is_err());
    // The positive fixture establishes quote coverage only, not whether observing a bell is believable.
}

#[test]
fn ask_has_reader_only_answer_and_review_without_extraction_or_notebook() {
    let mut c = context();
    c.mode = Mode::Ask;
    c.input = "灯为何亮着？".into();
    c.seed = "PRIVATE_SEED".into();
    c.state = known_information(&c.state);
    c.state_coverage.audience = Audience::Reader;
    c.state_coverage.total = StateCounts::default();
    let mut p = Pipeline::new(&c, 12).unwrap();
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "answer");
    for private in ["PRIVATE_SEED", "fixed_secret", "npc_restorer", "narrative"] {
        assert!(!request.input.to_string().contains(private));
    }
    p.accept(&c, json!({"result":draft(&c)}).to_string().as_bytes())
        .unwrap();
    let request = p.next_request(&c).unwrap();
    assert_eq!(request.stage, "review");
    assert!(request.input["candidate"].get("narrative_update").is_none());
    let PipelineStep::Complete(candidate) = p
        .accept(&c, json!({"result":approval()}).to_string().as_bytes())
        .unwrap()
    else {
        panic!("no answer")
    };
    assert_eq!(candidate.story_time, c.state.story_time);
    assert!(candidate.new_facts.is_empty());
    assert_eq!(p.calls(), 2);
}

#[test]
fn recall_keeps_memory_stage_and_consumes_global_model_budget() {
    let c = context();
    let mut p = Pipeline::new(&c, 9).unwrap();
    assert_eq!(p.next_request(&c).unwrap().stage, "memory");
    let read = json!({"request_id":"r1","source_handle":c.state_coverage.source_handle,"selector":{"kind":"pages","from_revision":1,"to_revision":1},"max_reply_bytes":8192});
    assert!(matches!(
        p.accept(&c, json!({"result":read}).to_string().as_bytes())
            .unwrap(),
        PipelineStep::Read(_)
    ));
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[],"relevant_fact_ids":[],"objective":"Observe"}),
    );
    assert_eq!(p.calls(), 2);
    assert_eq!(p.next_request(&c).unwrap().stage, "plan");
    let mut too_small = Pipeline::new(&c, 8).unwrap();
    too_small.next_request(&c).unwrap();
    assert!(matches!(
        too_small.accept(
            &c,
            json!({"result":material_read(&c, "too-small")})
                .to_string()
                .as_bytes()
        ),
        Err(Invalid("model_budget_exhausted"))
    ));
}

#[test]
fn extraction_uses_exact_contract_definitions_without_duplicate_guides() {
    let mut c = context();
    c.state.gameplay = Some(
        json!({"schemaVersion":1,"game":null,"location":"书店","inventory":[],"experience":{"schemaVersion":1,
        "clock":{"label":c.state.story_time,"elapsed":"","precision":"unknown","quote":"雨夜","sourceVersion":3},"objects":[],"stop":null,"folded":[]}}),
    );
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    let request = p.next_request(&c).unwrap();
    let defs = &request.schema["$defs"];
    assert!(request.input.get("candidate_format").is_none());
    assert!(request.input.get("selected_plan").is_none());
    assert!(defs["reader_record"]
        .to_string()
        .contains("distance_meters"));
    assert!(defs["experience_update"].to_string().contains("certainty"));
    assert_eq!(
        defs["gameplay_update"]["properties"]["game"],
        json!({"type":"null"})
    );
    assert!(defs.get("game_update").is_none());
    assert!(defs["candidate"]["required"]
        .as_array()
        .unwrap()
        .contains(&json!("memory_delta")));
    assert!(defs["candidate"]["properties"]
        .get("narrative_update")
        .is_none());
    let canonical: Value = serde_json::from_str(CONTRACT).unwrap();
    assert_eq!(
        defs["memory_interpretation"],
        canonical["$defs"]["memory_interpretation"]
    );
    assert_eq!(defs["memory_delta"], canonical["$defs"]["memory_delta"]);
    // Legacy stored notebooks keep their exact canonical bounds even though
    // new extraction only asks the model for local source-bound changes.
    let defs = &canonical["$defs"];
    assert_eq!(
        defs["narrative_arc"]["properties"]["next_beats"]["maxItems"],
        3
    );
    assert_eq!(
        defs["narrative_arc"]["properties"]["next_beats"]["items"]["maxLength"],
        1024
    );
    assert_eq!(
        defs["narrative_arc"]["properties"]["payoff_conditions"]["maxItems"],
        4
    );
    assert_eq!(defs["narrative_arc"]["properties"]["tension"]["maximum"], 5);
    assert_eq!(
        defs["narrative_state"]["properties"]["through_revision"]["minimum"],
        0
    );
    assert_eq!(
        defs["narrative_character"]["properties"]["relationships"]["maxItems"],
        8
    );
    assert_eq!(
        defs["narrative_character"]["properties"]["belief_fact_ids"]["uniqueItems"],
        true
    );
    assert_eq!(
        defs["narrative_style"]["properties"]["voice"]["maxLength"],
        2048
    );
    assert_eq!(
        defs["narrative_style"]["properties"]["avoid"]["maxItems"],
        8
    );
}

#[test]
fn four_next_beats_are_rejected_without_truncating_or_salvaging_the_candidate() {
    let mut c = context();
    c.pipeline.as_mut().unwrap().max_repairs = 0;
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    let mut proposed = legacy_candidate(&c);
    proposed["narrative_update"]["arcs"] = json!([{"thread_id":"thread_old_book","status":"open","tension":2,
        "next_beats":["first","second","third","fourth"],"payoff_conditions":[],"fact_ids":["fixed_secret"],"updated_revision":4}]);
    assert!(Candidate::decode(proposed.to_string().as_bytes(), &c).is_err());
    p.next_request(&c).unwrap();
    assert!(matches!(
        p.accept(
            &c,
            json!({"result":{"candidate":proposed}})
                .to_string()
                .as_bytes()
        ),
        Err(Invalid("invalid_candidate_shape"))
    ));
}

#[test]
fn person_alias_works_but_place_cannot_be_an_actor_or_character_memory() {
    for kind in ["person", "place"] {
        let mut raw = raw_context();
        raw["state"]["entities"][0]["kind"] = json!(kind);
        let c = Context::decode(raw.to_string().as_bytes()).unwrap();
        let mut p = Pipeline::new(&c, 12).unwrap();
        p.next_request(&c).unwrap();
        let result=p.accept(&c,json!({"result":{"actors":[{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}],"relevant_fact_ids":[],"objective":"Visit"}}).to_string().as_bytes());
        assert_eq!(result.is_ok(), kind == "person");
        raw["state"]["narrative"] = notebook(3);
        raw["state"]["narrative"]["characters"] = json!([{"entity_id":"npc_restorer","goals":[],"relationships":[],"voice":"沉稳","belief_fact_ids":[],"updated_revision":3}]);
        assert_eq!(
            Context::decode(raw.to_string().as_bytes()).is_ok(),
            kind == "person"
        );
    }
}

#[test]
fn two_actor_calls_do_not_share_each_others_observations_or_decisions() {
    let mut raw = raw_context();
    raw["state"]["entities"].as_array_mut().unwrap().push(json!({"id":"other","kind":"person","name":"另一人","description":"","known":false,"related_ids":[]}));
    raw["state"]["facts"].as_array_mut().unwrap().push(json!({"id":"other_secret","kind":"secret","text":"OTHER_PRIVATE_OBSERVATION","subject_id":"","known":false,"source_revision":2,"known_by":["other"]}));
    raw["state_coverage"]["total"]["facts"] = json!(2);
    raw["state_coverage"]["total"]["entities"] = json!(2);
    let c = Context::decode(raw.to_string().as_bytes()).unwrap();
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[
        {"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]},
        {"actor_id":"other","trigger":"OTHER_PRIVATE_OBSERVATION","fact_ids":["other_secret"]}],"relevant_fact_ids":[],"objective":"Two people arrive"}),
    );
    let first = p.next_request(&c).unwrap();
    assert_eq!(first.actor_id, "npc_restorer");
    assert!(!first.input.to_string().contains("OTHER_PRIVATE"));
    p.accept(&c,json!({"result":{"actor_id":"npc_restorer","intent":"FIRST_PRIVATE_INTENT","action":"wait","speech":"","conditions":[],"used_fact_ids":["fixed_secret"]}}).to_string().as_bytes()).unwrap();
    let second = p.next_request(&c).unwrap();
    assert_eq!(second.actor_id, "other");
    assert!(!second.input.to_string().contains("FIRST_PRIVATE_INTENT"));
    assert!(!second.input.to_string().contains("fixed_secret"));
}

#[test]
fn notebook_partial_references_defer_but_loaded_wrong_types_and_future_sources_fail() {
    let mut raw = raw_context();
    raw["state"]["narrative"] = notebook(3);
    raw["state"]["narrative"]["episodes"] = json!([{"id":"old","summary":"Earlier promise","from_revision":1,"to_revision":1,"fact_ids":["omitted_fact"]}]);
    raw["state_coverage"]["policy"] = json!("rules-secrets-open-recent-closure.v1");
    raw["state_coverage"]["complete"] = json!(false);
    raw["state_coverage"]["total"]["facts"] = json!(2);
    raw["state_coverage"]["omitted"]["facts"] = json!(1);
    assert!(Context::decode(raw.to_string().as_bytes()).is_ok());
    raw["state"]["narrative"]["episodes"][0]["fact_ids"] = json!(["npc_restorer"]);
    assert!(Context::decode(raw.to_string().as_bytes()).is_err());
    raw["state"]["narrative"]["episodes"][0]["fact_ids"] = json!(["fixed_secret"]);
    raw["state"]["facts"][0]["source_revision"] = json!(2);
    assert!(Context::decode(raw.to_string().as_bytes()).is_err());
}

#[test]
fn actor_can_use_a_current_known_fact_not_chosen_as_the_trigger() {
    let mut raw = raw_context();
    raw["state"]["facts"].as_array_mut().unwrap().push(json!({"id":"statement_linzhou_trust_and_sister","kind":"statement","text":"I trust my sister","subject_id":"npc_restorer","known":true,"source_revision":2,"known_by":["npc_restorer"]}));
    raw["state_coverage"]["total"]["facts"] = json!(2);
    let c = Context::decode(raw.to_string().as_bytes()).unwrap();
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}],"relevant_fact_ids":[],"objective":"A visit"}),
    );
    p.next_request(&c).unwrap();
    let result=p.accept(&c,json!({"result":{"actor_id":"npc_restorer","intent":"Protect sister","action":"Refuse","speech":"","conditions":[],"used_fact_ids":["statement_linzhou_trust_and_sister"]}}).to_string().as_bytes());
    assert!(result.is_ok(), "{result:?}");
}

#[test]
fn revealing_hidden_objects_needs_separate_exact_quote_coverage() {
    let c = context();
    let mut v = candidate(&c);
    v["reveal_fact_ids"] = json!(["fixed_secret"]);
    let candidate: Candidate = serde_json::from_value(v).unwrap();
    let r: Review = serde_json::from_value(approval()).unwrap();
    assert!(r.validate(&candidate).is_err());
    let mut r = approval();
    r["reveal_supports"] = json!([{"type":"fact","id":"fixed_secret","quote":""}]);
    assert!(serde_json::from_value::<Review>(r.clone())
        .unwrap()
        .validate(&candidate)
        .is_err());
    r["reveal_supports"][0]["quote"] = json!("门铃又摆了一下。");
    assert!(serde_json::from_value::<Review>(r)
        .unwrap()
        .validate(&candidate)
        .is_ok());
}

#[test]
fn producer_bounds_reject_metadata_before_a_later_review_can_overflow() {
    let c = context();
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[],"relevant_fact_ids":[],"objective":"Visit"}),
    );
    let mut oversized = plans();
    oversized["candidates"][0]["purpose"] = json!("p".repeat(2500));
    p.next_request(&c).unwrap();
    assert!(p
        .accept(&c, json!({"result":oversized}).to_string().as_bytes())
        .is_err());
    let mut p = Pipeline::new(&c, 12).unwrap();
    accept(
        &mut p,
        &c,
        "memory",
        json!({"actors":[{"actor_id":"npc_restorer","trigger":"每周五","fact_ids":["fixed_secret"]}],"relevant_fact_ids":[],"objective":"Visit"}),
    );
    p.next_request(&c).unwrap();
    assert!(p.accept(&c,json!({"result":{"actor_id":"npc_restorer","intent":"Visit","action":"a".repeat(2500),"speech":"","conditions":[],"used_fact_ids":[]}}).to_string().as_bytes()).is_err());
    let mut p = Pipeline::new(&c, 12).unwrap();
    to_extract(&mut p, &c);
    p.next_request(&c).unwrap();
    let mut v = candidate(&c);
    v["new_facts"] = json!([{"id":"large","kind":"fact","text":"x".repeat(25000),"subject_id":"","known":true,"source_revision":4,"known_by":[]}]);
    assert!(p
        .accept(&c, json!({"result":{"candidate":v}}).to_string().as_bytes())
        .is_err());
}

#[test]
fn explicit_pipeline_context_is_accepted_and_reader_projection_strips_notebook() {
    let mut raw = raw_context();
    raw["state"]["narrative"] = json!({"version":1,"through_revision":3,"episodes":[],"characters":[],"arcs":[],
        "style":{"voice":"PRIVATE_STYLE","perspective":"第二人称","pace":"balanced","detail":"balanced","avoid":[],"preference_refs":[]}});
    let c = Context::decode(raw.to_string().as_bytes()).unwrap();
    assert!(!serde_json::to_string(&known_information(&c.state))
        .unwrap()
        .contains("PRIVATE_STYLE"));
}
