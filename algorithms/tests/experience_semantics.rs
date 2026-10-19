//! Canonical boundary retention and differences. Fixtures are authored tests, not provider quality evidence.
use elselife_algorithms::experience::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
fn opening() -> Context {
    Context::decode(include_bytes!("fixtures/experience-context.json")).unwrap()
}
fn candidate() -> Candidate {
    Candidate::decode(
        include_bytes!("fixtures/experience-candidate.json"),
        &opening(),
    )
    .unwrap()
}
fn full(c: &Context) -> Context {
    let mut c = c.clone();
    if c.mode == Mode::Ask {
        c.state = known_information(&c.state);
        c.state_coverage.audience = Audience::Reader;
        c.state_coverage.source_handle = "fixture_reader_operation".into();
    }
    c.state_coverage.total = StateCounts {
        facts: c.state.facts.len() as u64,
        entities: c.state.entities.len() as u64,
        threads: c.state.threads.len() as u64,
    };
    c
}
fn continued(mode: Mode) -> Context {
    let mut c = opening();
    let first = candidate();
    c.revision = 1;
    c.mode = mode;
    c.input = if matches!(mode, Mode::Ask | Mode::Act) {
        "为什么他拒绝借书？".into()
    } else {
        "".into()
    };
    c.state.story_time = first.story_time.clone();
    c.state.facts = first.new_facts;
    c.state.entities = first.new_entities;
    c.history.push(Page {
        revision: 1,
        mode: Mode::Begin,
        input: "".into(),
        text: first.passage,
    });
    full(&c)
}
fn continuation() -> Candidate {
    let mut n = candidate();
    n.new_facts.clear();
    n.new_entities.clear();
    n.passage = "他收好桌上的书，等你开口。".into();
    n
}
#[test]
fn canonical_commit_hash_and_candidate_root_closure_are_exact() {
    assert_eq!(
        format!("{:x}", Sha256::digest(CONTRACT.as_bytes())),
        CONTRACT_SHA256
    );
    assert_eq!(
        include_str!("../.experience-sha256").trim(),
        CONTRACT_SHA256
    );
    assert_eq!(
        include_str!("../.experience-revision").trim(),
        CONTRACT_REVISION
    );
    let schema = candidate_schema();
    assert_eq!(schema["type"], "object");
    assert!(schema.get("oneOf").is_none());
    let canonical: Value = serde_json::from_str(CONTRACT).unwrap();
    assert_eq!(
        schema["properties"],
        canonical["$defs"]["generation_result"]["properties"]
    );
    assert_eq!(schema["$defs"]["fact"], canonical["$defs"]["fact"]);
    assert!(schema["$defs"].get("context").is_none());
}
#[test]
fn refusal_is_valid_content_not_task_failure_and_all_story_outcomes_are_legal() {
    for outcome in [Outcome::Continues, Outcome::AwaitsPlayer, Outcome::Ending] {
        let mut n = candidate();
        n.outcome = outcome;
        assert!(n.validate(&full(&opening())).is_ok());
    }
}
#[test]
fn world_truth_statement_belief_reader_and_character_knowledge_remain_distinct() {
    let mut c = continued(Mode::Read);
    for kind in [
        FactKind::Fact,
        FactKind::Rule,
        FactKind::Secret,
        FactKind::Statement,
        FactKind::Belief,
    ] {
        c.state.facts.push(Fact {
        reader: None,
            id: format!("f_{kind:?}"),
            kind,
            text: "门后有一本旧书。".into(),
            subject_id: if matches!(kind, FactKind::Statement | FactKind::Belief) {
                "npc_bookseller".into()
            } else {
                "".into()
            },
            known: false,
            known_by: vec!["npc_bookseller".into()],
            source_revision: 1,
        });
    }
    c = full(&c);
    let input = narrative_input(&full(&c)).unwrap();
    let restored: Context = serde_json::from_value(input["context"].clone()).unwrap();
    assert_eq!(restored, c);
    assert_eq!(
        input["context"]["state"]["facts"].as_array().unwrap().len(),
        6
    );
    assert!(input.get("player_known_information").is_none());
    assert_eq!(known_information(&c.state).facts.len(), 1);
    assert_eq!(c.state.facts[3].kind, FactKind::Secret);
    assert!(!c.state.facts[3].known);
    assert!(!c.state.facts[3].known_by.is_empty());
}
#[test]
fn hidden_bodies_and_linked_ids_do_not_enter_known_projection() {
    let mut c = continued(Mode::Read);
    c.state.entities.push(Entity {
        id: "hidden_person".into(),
        kind: "character".into(),
        name: "隐姓人".into(),
        description: "隐秘身份".into(),
        known: false,
        related_ids: vec![],
    });
    c.state.facts.push(Fact {
        reader: None,
        id: "hidden_fact".into(),
        kind: FactKind::Secret,
        text: "不可见的秘密正文".into(),
        subject_id: "".into(),
        known: false,
        known_by: vec!["hidden_person".into()],
        source_revision: 1,
    });
    c.state.entities[0]
        .related_ids
        .extend(["hidden_person".into(), "hidden_fact".into()]);
    c.state.facts[0].known_by.push("hidden_person".into());
    let projection = serde_json::to_string(&known_information(&c.state)).unwrap();
    for hidden in ["hidden_person", "hidden_fact", "隐姓人", "不可见的秘密正文"] {
        assert!(!projection.contains(hidden));
    }
    assert!(
        serde_json::to_string(&narrative_input(&full(&c)).unwrap()["context"])
            .unwrap()
            .contains("不可见的秘密正文")
    );
}
#[test]
fn ask_cannot_advance_time_or_any_world_or_knowledge_collection() {
    let c = continued(Mode::Ask);
    let good = continuation();
    assert!(good.validate(&full(&c)).is_ok());
    let mut modifications = vec![];
    let mut n = good.clone();
    n.story_time.push_str(" later");
    modifications.push(n);
    let mut n = good.clone();
    n.new_facts = candidate().new_facts;
    modifications.push(n);
    let mut n = good.clone();
    n.new_entities = candidate().new_entities;
    modifications.push(n);
    let mut n = good.clone();
    n.new_threads.push(Thread {
        id: "t".into(),
        text: "未完".into(),
        known: true,
        related_fact_ids: vec![],
        resolved_at_revision: None,
    });
    modifications.push(n);
    let mut n = good.clone();
    n.reveal_fact_ids.push("unknown".into());
    modifications.push(n);
    let mut n = good.clone();
    n.reveal_entity_ids.push("npc_bookseller".into());
    modifications.push(n);
    let mut n = good.clone();
    n.reveal_thread_ids.push("unknown".into());
    modifications.push(n);
    let mut n = good.clone();
    n.resolve_thread_ids.push("unknown".into());
    modifications.push(n);
    let mut n = good.clone();
    n.knowledge_changes.push(KnowledgeChange {
        subject_id: "npc_bookseller".into(),
        fact_id: "statement_refusal".into(),
    });
    modifications.push(n);
    for n in modifications {
        assert_eq!(n.validate(&full(&c)), Err(Invalid("ask_changes_world")));
    }
}
#[test]
fn begin_read_allow_empty_input_act_ask_do_not_and_rebegin_is_not_recovery() {
    assert!(opening().validate().is_ok());
    assert!(continued(Mode::Read).validate().is_ok());
    for mode in [Mode::Act, Mode::Ask] {
        let mut c = continued(mode);
        c.input.clear();
        assert_eq!(c.validate(), Err(Invalid("input_required")));
    }
    let mut c = continued(Mode::Begin);
    assert_eq!(c.validate(), Err(Invalid("invalid_begin_state")));
}
#[test]
fn prior_fact_or_secret_cannot_be_overwritten_even_if_not_reader_known() {
    let c = continued(Mode::Read);
    let before = c.clone();
    let mut n = continuation();
    let mut old = c.state.facts[0].clone();
    old.text = "变成玩家要求的相反结局".into();
    old.source_revision = 2;
    n.new_facts.push(old);
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("existing_state_overwrite"))
    );
    assert_eq!(before, c);
    let mut c = c;
    c.state.facts[0].kind = FactKind::Secret;
    c.state.facts[0].known = false;
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("existing_state_overwrite"))
    );
}
#[test]
fn next_revision_and_attribution_and_knowledge_refs_are_checked_not_repaired() {
    let c = continued(Mode::Act);
    let mut n = continuation();
    let mut f = c.state.facts[0].clone();
    f.id = "new".into();
    f.source_revision = 1;
    n.new_facts.push(f);
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("new_fact_revision_mismatch"))
    );
    n.new_facts[0].source_revision = 2;
    n.new_facts[0].subject_id = "missing".into();
    assert_eq!(n.validate(&full(&c)), Err(Invalid("unknown_fact_subject")));
    n.new_facts[0].subject_id.clear();
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("unattributed_character_claim"))
    );
    n.new_facts[0].subject_id = "npc_bookseller".into();
    n.new_facts[0].known_by.push("missing".into());
    assert_eq!(n.validate(&full(&c)), Err(Invalid("unknown_reference")));
    n.new_facts[0].known_by.pop();
    assert!(n.validate(&full(&c)).is_ok());
    n.knowledge_changes.push(KnowledgeChange {
        subject_id: "missing".into(),
        fact_id: "new".into(),
    });
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("unknown_knowledge_reference"))
    );
}
#[test]
fn complete_long_history_is_preserved_and_suffix_only_omits_old_bodies() {
    let mut c = continued(Mode::Read);
    for revision in 2..=300 {
        c.history.push(Page {
            revision,
            mode: Mode::Read,
            input: "".into(),
            text: format!("第{revision}页，仍记得开头的约定"),
        });
    }
    c.revision = 300;
    let input = narrative_input(&full(&c)).unwrap();
    assert_eq!(input["context"]["history"].as_array().unwrap().len(), 300);
    assert_eq!(input["context"]["history"][0]["text"], c.history[0].text);
    c.history_complete = false;
    assert!(c.validate().is_ok()); // A full history also qualifies as a contiguous suffix.
    c.history.drain(..290);
    let input = narrative_input(&full(&c)).unwrap();
    assert_eq!(input["context"]["history"].as_array().unwrap().len(), 10);
    assert_eq!(input["context"]["history"][0]["revision"], 291);
    assert_eq!(
        input["context"]["state"],
        serde_json::to_value(&c.state).unwrap()
    );
    c.history_complete = true;
    assert_eq!(c.validate(), Err(Invalid("history_revision_gap")));
}
#[test]
fn typed_decode_fails_closed_on_old_fields_unknown_enums_null_collections_duplicates() {
    let base = serde_json::to_value(opening()).unwrap();
    for (key, value) in [
        ("goal", json!("old")),
        ("version", json!(1)),
        ("mode", json!("direct")),
        ("history", Value::Null),
    ] {
        let mut bad = base.clone();
        bad[key] = value;
        assert!(Context::decode(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    let mut old = serde_json::to_value(candidate()).unwrap();
    old["success"] = json!(true);
    assert!(Candidate::decode(&serde_json::to_vec(&old).unwrap(), &opening()).is_err());
    let duplicate = b"{\"version\":1,\"version\":1}";
    assert!(Context::decode(duplicate).is_err());
}
#[test]
fn ask_model_input_contains_no_hidden_author_text_and_character_knowledge_does_not_reveal_it() {
    let mut c = continued(Mode::Ask);
    c.state.facts.push(Fact {
        reader: None,
        id: "secret_x".into(),
        kind: FactKind::Secret,
        text: "柜台抽屉里有一封没人见过的信".into(),
        subject_id: "".into(),
        known: false,
        known_by: vec![],
        source_revision: 1,
    });
    c = full(&c);
    let original = c.clone();
    let ask = narrative_input(&full(&c)).unwrap();
    assert!(!ask.to_string().contains("柜台抽屉里有一封没人见过的信"));
    assert_eq!(c, original);
    c.mode = Mode::Read;
    c.state_coverage.audience = Audience::Author;
    c.state.facts.push(Fact {
        reader: None,
        id: "secret_x".into(),
        kind: FactKind::Secret,
        text: "柜台抽屉里有一封没人见过的信".into(),
        subject_id: "".into(),
        known: false,
        known_by: vec![],
        source_revision: 1,
    });
    c = full(&c);
    assert!(narrative_input(&full(&c))
        .unwrap()
        .to_string()
        .contains("柜台抽屉里有一封没人见过的信"));
    let mut n = continuation();
    n.knowledge_changes.push(KnowledgeChange {
        subject_id: "npc_bookseller".into(),
        fact_id: "secret_x".into(),
    });
    assert!(n.validate(&full(&c)).is_ok());
    assert!(n.reveal_fact_ids.is_empty());
    n.knowledge_changes[0].fact_id = "statement_refusal".into();
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("character_already_knows_fact"))
    );
}

fn hidden_suffix() -> Context {
    Context::decode(include_bytes!("fixtures/experience-hidden-suffix.json")).unwrap()
}
fn disclosure() -> Candidate {
    Candidate::decode(
        include_bytes!("fixtures/experience-disclosure.json"),
        &hidden_suffix(),
    )
    .unwrap()
}
#[test]
fn hidden_stable_npc_and_thread_are_fixed_then_disclosed_without_recreation() {
    let c = hidden_suffix();
    let original = c.clone();
    let n = disclosure();
    assert!(known_information(&c.state).entities.is_empty());
    assert!(known_information(&c.state).threads.is_empty());
    let private = narrative_input(&full(&c)).unwrap();
    assert_eq!(
        private["context"]["state"],
        serde_json::to_value(&c.state).unwrap()
    );
    assert!(n.new_entities.is_empty() && n.new_threads.is_empty() && n.new_facts.is_empty());
    assert_eq!(c, original); // Rust validates/proposes; only Go commits state.

    // Authored Go-writer-shaped snapshot, NOT proof of Go's actual persistent writer.
    let mut next = c.clone();
    next.revision += 1;
    next.state.story_time = n.story_time.clone();
    next.state.entities[0].known = true;
    next.state.threads[0].known = true;
    next.state.facts[0].known = true;
    next.history.push(Page {
        revision: 4,
        mode: Mode::Read,
        input: "".into(),
        text: n.passage.clone(),
    });
    let projection = known_information(&next.state);
    assert_eq!(projection.entities[0].id, c.state.entities[0].id);
    assert_eq!(
        projection.entities[0].description,
        c.state.entities[0].description
    );
    assert_eq!(projection.threads[0].text, c.state.threads[0].text);
    assert_eq!(projection.facts[0].text, c.state.facts[0].text);
    assert_eq!(projection.facts[0].known_by, c.state.facts[0].known_by);
    assert_eq!(projection.facts[0].source_revision, 1);
    let mut fork = next.clone();
    fork.branch_id = "branch_fork".into();
    assert_eq!(
        narrative_input(&fork).unwrap()["context"]["state"],
        serde_json::to_value(&next.state).unwrap()
    );
    assert_eq!(fork.history, next.history);
    // Forking the earlier hidden snapshot must not borrow the later branch disclosure.
    let mut earlier_fork = c.clone();
    earlier_fork.branch_id = "branch_earlier".into();
    assert!(known_information(&earlier_fork.state).entities.is_empty());
    assert_eq!(earlier_fork.state.facts[0], c.state.facts[0]);
    let mut ask = earlier_fork;
    ask.mode = Mode::Ask;
    ask.input = "修书人是谁？".into();
    let input = narrative_input(&full(&ask)).unwrap().to_string();
    assert!(
        !input.contains("fixed_secret")
            && !input.contains("灰外套")
            && !input.contains("thread_old_book")
    );
    assert_eq!(n.validate(&full(&ask)), Err(Invalid("ask_changes_world")));
}
#[test]
fn disclosure_references_reject_wrong_kind_missing_empty_duplicate_and_new_alias() {
    let c = hidden_suffix();
    let good = disclosure();
    for field in ["reveal_fact_ids", "reveal_entity_ids", "reveal_thread_ids"] {
        for id in ["missing", ""] {
            let mut value = serde_json::to_value(&good).unwrap();
            value[field] = json!([id]);
            assert!(
                Candidate::decode(&serde_json::to_vec(&value).unwrap(), &c).is_err(),
                "{field}/{id}"
            );
        }
        let mut value = serde_json::to_value(&good).unwrap();
        let id = value[field][0].clone();
        value[field] = json!([id, id]);
        assert_eq!(
            Candidate::decode(&serde_json::to_vec(&value).unwrap(), &c),
            Err(Invalid("duplicate_or_empty_id"))
        );
    }
    for (field, wrong) in [
        ("reveal_fact_ids", "npc_restorer"),
        ("reveal_entity_ids", "thread_old_book"),
        ("reveal_thread_ids", "fixed_secret"),
    ] {
        let mut value = serde_json::to_value(&good).unwrap();
        value[field] = json!([wrong]);
        assert_eq!(
            Candidate::decode(&serde_json::to_vec(&value).unwrap(), &c),
            Err(Invalid("unknown_reference"))
        );
    }
    let mut n = good.clone();
    n.new_entities.push(c.state.entities[0].clone());
    assert_eq!(
        n.validate(&full(&c)),
        Err(Invalid("existing_state_overwrite"))
    );
    n.new_entities[0].id = "new_alias".into();
    n.reveal_entity_ids = vec!["new_alias".into()];
    assert_eq!(n.validate(&full(&c)), Err(Invalid("unknown_reference")));
    let mut n = good;
    n.new_threads.push(c.state.threads[0].clone());
    n.new_threads[0].id = "new_thread_alias".into();
    n.reveal_thread_ids = vec!["new_thread_alias".into()];
    assert_eq!(n.validate(&full(&c)), Err(Invalid("unknown_reference")));
}
#[test]
fn latest_whole_page_suffix_rejects_gaps_stale_tail_bad_begin_and_zero_false() {
    let c = hidden_suffix();
    assert!(c.validate().is_ok());
    let mut cases = vec![];
    let mut bad = c.clone();
    bad.history.clear();
    cases.push(bad);
    let mut bad = c.clone();
    bad.history.pop();
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[0].revision = 1;
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[0].revision = 0;
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[1].revision = 2;
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[1].revision = 4;
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[0].mode = Mode::Begin;
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[0].text.clear();
    cases.push(bad);
    let mut bad = c.clone();
    bad.history[0].mode = Mode::Act;
    cases.push(bad);
    let mut bad = c.clone();
    bad.history_complete = true;
    cases.push(bad);
    let mut bad = opening();
    bad.history_complete = false;
    cases.push(bad);
    for bad in cases {
        assert!(bad.validate().is_err(), "{bad:?}");
    }
    let mut one_page = c.clone();
    one_page.history.remove(0);
    assert!(one_page.validate().is_ok());
    let mut at_one = continued(Mode::Read);
    at_one.history_complete = false;
    assert!(at_one.validate().is_ok());
    at_one.history[0].mode = Mode::Read;
    assert_eq!(at_one.validate(), Err(Invalid("invalid_history_mode")));
}
#[test]
fn new_disclosure_arrays_are_required_typed_collections() {
    for field in ["reveal_entity_ids", "reveal_thread_ids"] {
        let mut missing = serde_json::to_value(candidate()).unwrap();
        missing.as_object_mut().unwrap().remove(field);
        assert_eq!(
            Candidate::decode(&serde_json::to_vec(&missing).unwrap(), &opening()),
            Err(Invalid("invalid_candidate_json"))
        );
        for value in [Value::Null, json!([5]), json!("id")] {
            let mut bad = serde_json::to_value(candidate()).unwrap();
            bad[field] = value;
            assert_eq!(
                Candidate::decode(&serde_json::to_vec(&bad).unwrap(), &opening()),
                Err(Invalid("invalid_candidate_json"))
            );
        }
    }
}
#[test]
fn prompt_carries_read_agency_private_canon_and_no_legacy_memory_injection() {
    for clause in [
        "角色拒绝不是生成失败",
        "不得替玩家作重大决定",
        "ask 是跳出角色",
        "不是用户现实人格",
        "known_by独立",
        "完整正式历史",
        "省略旧正文不等于丢失旧事实",
        "仍持续约束创作",
        "不声称无限容量",
        "reveal_entity_ids/reveal_thread_ids",
        "不注入旧私人工作记忆",
    ] {
        assert!(NARRATIVE_PROMPT.contains(clause), "{clause}");
    }
}
