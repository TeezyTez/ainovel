//! Authored boundary counterexamples: schema/receipts/resources, not provider recall or prose quality.
use elselife_algorithms::experience::*;
use serde_json::{json, Value};

fn c() -> Context {
    Context::decode(include_bytes!("fixtures/experience-hidden-suffix.json")).unwrap()
}
fn request(c: &Context, selector: Value) -> ReadRequest {
    serde_json::from_value(json!({"request_id":"read_old","source_handle":c.state_coverage.source_handle,"selector":selector,"max_reply_bytes":8192})).unwrap()
}
fn reply(c: &Context, r: &ReadRequest, objects: Vec<ReadObject>, pages: Vec<Page>) -> ReadReply {
    let mut reply = ReadReply {
        request_id: r.request_id.clone(),
        source_handle: c.state_coverage.source_handle.clone(),
        experience_id: c.experience_id.clone(),
        branch_id: c.branch_id.clone(),
        base_revision: c.revision,
        audience: c.state_coverage.audience,
        objects,
        pages,
        complete: true,
        next_cursor: Value::Null,
        receipt: ReadReceipt {
            query_sha256: receipt_hash(&serde_json::to_value(r).unwrap()),
            body_sha256: String::new(),
        },
    };
    reply.receipt.body_sha256 = reply.body_hash();
    reply
}
fn raw(r: &ReadReply) -> Vec<u8> {
    serde_json::to_vec(r).unwrap()
}
fn candidate() -> Candidate {
    serde_json::from_slice(include_bytes!("fixtures/experience-disclosure.json")).unwrap()
}
#[test]
fn v2_coverage_counts_complete_named_policy_and_audience_are_checked() {
    let original = c();
    for damage in [
        "count", "omitted", "complete", "future", "policy", "reader", "version", "overflow",
    ] {
        let mut v = serde_json::to_value(&original).unwrap();
        match damage {
            "count" => v["state_coverage"]["total"]["facts"] = json!(2),
            "omitted" => v["state_coverage"]["omitted"]["facts"] = json!(1),
            "complete" => v["state_coverage"]["complete"] = json!(false),
            "future" => v["state_coverage"]["recent_from_revision"] = json!(4),
            "policy" => v["state_coverage"]["policy"] = json!("unknown.v1"),
            "reader" => v["state_coverage"]["audience"] = json!("reader"),
            "version" => v["version"] = json!(1),
            "overflow" => {
                v["state_coverage"]["total"]["facts"] = json!(0);
                v["state_coverage"]["omitted"]["facts"] = json!(u64::MAX);
            }
            _ => unreachable!(),
        }
        assert!(
            Context::decode(&serde_json::to_vec(&v).unwrap()).is_err(),
            "{damage}"
        );
    }
    for field in ["state_coverage", "read_budget", "recalls"] {
        let mut v = serde_json::to_value(&original).unwrap();
        v.as_object_mut().unwrap().remove(field);
        assert!(Context::decode(&serde_json::to_vec(&v).unwrap()).is_err());
    }
}
#[test]
fn reader_input_requires_a_reader_frozen_projection_and_no_duplicate_state() {
    let mut context = c();
    context.mode = Mode::Ask;
    context.input = "旧承诺是什么？".into();
    assert_eq!(
        context.validate(),
        Err(Invalid("coverage_audience_mismatch"))
    );
    context.state_coverage.audience = Audience::Reader;
    assert_eq!(context.validate(), Err(Invalid("reader_hidden_object")));
    context.state = known_information(&context.state);
    context.state_coverage.total = StateCounts::default();
    let input = narrative_input(&context).unwrap().to_string();
    for hidden in [
        "fixed_secret",
        "npc_restorer",
        "thread_old_book",
        "灰外套",
        "player_known_information",
    ] {
        assert!(!input.contains(hidden), "{hidden}");
    }
    context.state_coverage.omitted_reader_known = Some(StateCounts {
        facts: 1,
        ..Default::default()
    });
    assert_eq!(
        context.validate(),
        Err(Invalid("coverage_reader_count_mismatch"))
    );
}
#[test]
fn generation_closed_root_accepts_only_candidate_or_read_never_reply_coverage_or_bare() {
    let c = c();
    let r = request(
        &c,
        json!({"kind":"pages","from_revision":1,"to_revision":1}),
    );
    assert!(GenerationOutput::decode(
        &serde_json::to_vec(&json!({"result":candidate()})).unwrap(),
        &c
    )
    .is_ok());
    assert!(
        GenerationOutput::decode(&serde_json::to_vec(&json!({"result":r})).unwrap(), &c).is_ok()
    );
    for v in [
        json!(candidate()),
        json!({"result":c.state_coverage}),
        json!({"result":reply(&c,&r,vec![],vec![])}),
        json!({"result":r,"coverage":c.state_coverage}),
    ] {
        assert!(GenerationOutput::decode(&serde_json::to_vec(&v).unwrap(), &c).is_err());
    }
    let schema = candidate_schema();
    assert_eq!(schema["type"], "object");
    assert_eq!(schema["required"], json!(["result"]));
    for forbidden in ["context", "read_reply", "read_failure", "state_counts"] {
        assert!(schema["$defs"].get(forbidden).is_none());
    }
}
#[test]
fn typed_closed_selectors_and_real_budget_reject_null_wrong_type_future_and_zero() {
    let context = c();
    for selector in [
        json!({"kind":"names","type":"fact","names":["承诺"]}),
        json!({"kind":"enumerate","type":"entity","fact_kind":"rule"}),
        json!({"kind":"enumerate","type":"fact","terms":["承诺"]}),
        json!({"kind":"pages","from_revision":1,"to_revision":4}),
        json!({"kind":"objects","objects":[{"type":"fact","id":"f","at_revision":0}]}),
        json!({"kind":"objects","objects":[]}),
    ] {
        let r = request(&context, selector);
        assert!(r.validate(&context).is_err());
    }
    for selector in [
        json!({"kind":"objects","objects":[{"type":"fact","id":"f","at_revision":null}]}),
        json!({"kind":"enumerate","type":"fact","fact_kind":null}),
        json!({"kind":"pages","from_revision":1,"to_revision":1,"extra":1}),
    ] {
        assert!(serde_json::from_value::<ReadRequest>(
            json!({"request_id":"q","source_handle":"h","selector":selector,"max_reply_bytes":1})
        )
        .is_err());
    }
    let mut r = request(
        &context,
        json!({"kind":"pages","from_revision":1,"to_revision":1}),
    );
    r.max_reply_bytes = 0;
    assert_eq!(
        r.validate(&context),
        Err(Invalid("recall_budget_exhausted"))
    );
    r.max_reply_bytes = context.read_budget.max_reply_bytes + 1;
    assert_eq!(
        r.validate(&context),
        Err(Invalid("recall_budget_exhausted"))
    );
}
#[test]
fn receipts_have_exact_go_json_bytes_with_integer_and_unicode_escape_vector() {
    let v = json!({"z":18446744073709551615u64,"a":["中文<>&\u{2028}\u{2029}\n\t\\\"",1]});
    assert_eq!(String::from_utf8(receipt_bytes(&v)).unwrap(),"{\"a\":[\"中文\\u003c\\u003e\\u0026\\u2028\\u2029\\n\\t\\\\\\\"\",1],\"z\":18446744073709551615}");
    let r = request(
        &c(),
        json!({"kind":"objects","objects":[{"type":"thread","id":"thread_old_book"}]}),
    );
    for presence in [
        json!({"id":"thread_old_book","text":"旧承诺","known":false,"related_fact_ids":[]}),
        json!({"id":"thread_old_book","text":"旧承诺","known":false,"related_fact_ids":[],"resolved_at_revision":null}),
    ] {
        let typed: Thread = serde_json::from_value(presence.clone()).unwrap();
        assert_eq!(serde_json::to_value(&typed).unwrap(), presence);
        let rr = reply(
            &c(),
            &r,
            vec![ReadObject {
                object_type: ObjectType::Thread,
                as_of_revision: 1,
                body: ReadBody::Thread(typed),
            }],
            vec![],
        );
        assert!(rr.validate_evidence(&c()).is_ok());
    }
}
#[test]
fn read_reply_checks_scope_query_receipt_type_revision_and_raw_bytes_without_guessing() {
    let context = c();
    let r = request(
        &context,
        json!({"kind":"objects","objects":[{"type":"fact","id":"fixed_secret"}]}),
    );
    let good = reply(
        &context,
        &r,
        vec![ReadObject {
            object_type: ObjectType::Fact,
            as_of_revision: 3,
            body: ReadBody::Fact(context.state.facts[0].clone()),
        }],
        vec![],
    );
    assert!(good.validate(&context, &r, &raw(&good)).is_ok());
    for damage in [
        "scope", "branch", "base", "handle", "audience", "query", "body", "request", "future",
        "type", "cursor", "text",
    ] {
        let mut bad = good.clone();
        match damage {
            "scope" => bad.experience_id.push('x'),
            "branch" => bad.branch_id.push('x'),
            "base" => bad.base_revision += 1,
            "handle" => bad.source_handle.push('x'),
            "audience" => bad.audience = Audience::Reader,
            "query" => bad.receipt.query_sha256 = "0".repeat(64),
            "body" => bad.receipt.body_sha256 = "0".repeat(64),
            "request" => bad.request_id.push('x'),
            "future" => bad.objects[0].as_of_revision = 4,
            "type" => bad.objects[0].object_type = ObjectType::Entity,
            "cursor" => bad.next_cursor = json!("forged"),
            "text" => {
                if let ReadBody::Fact(f) = &mut bad.objects[0].body {
                    f.text = "改变旧承诺".into();
                }
            }
            _ => unreachable!(),
        }
        if damage != "body" {
            bad.receipt.body_sha256 = bad.body_hash();
        }
        assert!(bad.validate(&context, &r, &raw(&bad)).is_err(), "{damage}");
    }
    let mut tight = r.clone();
    tight.max_reply_bytes = 1;
    assert_eq!(
        good.validate(&context, &tight, &raw(&good)),
        Err(Invalid("recall_receipt_mismatch"))
    );
    let mut too_big = good.clone();
    too_big.receipt.query_sha256 = receipt_hash(&serde_json::to_value(&tight).unwrap());
    too_big.receipt.body_sha256 = too_big.body_hash();
    assert_eq!(
        too_big.validate(&context, &tight, &raw(&too_big)),
        Err(Invalid("recall_item_capacity"))
    );
}
#[test]
fn historical_revisions_are_evidence_not_permanent_current_truth_or_merge() {
    let mut context = c();
    let original = context.state.clone();
    let r = request(
        &context,
        json!({"kind":"objects","objects":[{"type":"fact","id":"fixed_secret","at_revision":1}]}),
    );
    let mut past = context.state.facts[0].clone();
    past.text = "那时约定周一取书，后来改成周五。".into();
    let old = reply(
        &context,
        &r,
        vec![ReadObject {
            object_type: ObjectType::Fact,
            as_of_revision: 1,
            body: ReadBody::Fact(past),
        }],
        vec![],
    );
    old.validate(&context, &r, &raw(&old)).unwrap();
    context.recalls.push(old.clone());
    let input = narrative_input(&context).unwrap();
    assert_eq!(context.state, original);
    assert_eq!(
        input["context"]["state"],
        serde_json::to_value(&original).unwrap()
    );
    assert_eq!(
        input["context"]["recalls"][0]["objects"][0]["body"]["text"],
        "那时约定周一取书，后来改成周五。"
    );
    let mut wrong = old;
    wrong.objects[0].as_of_revision = 3;
    wrong.receipt.body_sha256 = wrong.body_hash();
    assert_eq!(
        wrong.validate_evidence(&context),
        Err(Invalid("recall_current_body_mismatch"))
    );
}
#[test]
fn omitted_ids_are_deferred_to_full_go_apply_current_recall_checks_no_overwrite() {
    let mut context = c();
    let fact = context.state.facts.remove(0);
    context.state_coverage.policy = CoveragePolicy::Bounded;
    context.state_coverage.omitted.facts = 1;
    context.state_coverage.complete = false;
    let n = candidate();
    assert!(n.validate(&context).is_ok()); // Go must verify stable omitted fact ID.
    let r = request(
        &context,
        json!({"kind":"objects","objects":[{"type":"fact","id":"fixed_secret"}]}),
    );
    let rr = reply(
        &context,
        &r,
        vec![ReadObject {
            object_type: ObjectType::Fact,
            as_of_revision: 3,
            body: ReadBody::Fact(fact.clone()),
        }],
        vec![],
    );
    rr.validate(&context, &r, &raw(&rr)).unwrap();
    context.recalls.push(rr);
    assert!(n.validate(&context).is_ok());
    assert!(context.state.facts.is_empty());
    let mut overwrite = n.clone();
    let mut old = fact;
    old.source_revision = 4;
    overwrite.new_facts.push(old);
    assert_eq!(
        overwrite.validate(&context),
        Err(Invalid("existing_state_overwrite"))
    );
    let mut wrong = n;
    wrong.reveal_fact_ids = vec!["npc_restorer".into()];
    assert_eq!(wrong.validate(&context), Err(Invalid("unknown_reference")));
}
#[test]
fn resolved_thread_retains_stable_id_and_references_but_cannot_resolve_twice_or_rebind() {
    let mut context = c();
    context.state.threads[0].resolved_at_revision = Some(Some(2));
    context.validate().unwrap();
    let mut n = candidate();
    n.resolve_thread_ids = vec!["thread_old_book".into()];
    assert_eq!(n.validate(&context), Err(Invalid("unknown_reference")));
    n.resolve_thread_ids.clear();
    n.new_threads.push(context.state.threads[0].clone());
    assert_eq!(
        n.validate(&context),
        Err(Invalid("existing_state_overwrite"))
    );
    n.new_threads[0].id = "different_thread".into();
    assert_eq!(
        n.validate(&context),
        Err(Invalid("new_thread_already_resolved"))
    );
    context.state.threads[0].resolved_at_revision = Some(Some(4));
    assert_eq!(context.validate(), Err(Invalid("future_thread_revision")));
}
#[test]
fn reader_callback_cannot_smuggle_hidden_bodies_through_valid_receipts() {
    let mut context = c();
    let hidden = context.state.facts[0].clone();
    context.mode = Mode::Ask;
    context.input = "旧承诺？".into();
    context.state = known_information(&context.state);
    context.state_coverage.audience = Audience::Reader;
    context.state_coverage.total = StateCounts::default();
    let r = request(
        &context,
        json!({"kind":"objects","objects":[{"type":"fact","id":"fixed_secret"}]}),
    );
    let rr = reply(
        &context,
        &r,
        vec![ReadObject {
            object_type: ObjectType::Fact,
            as_of_revision: 3,
            body: ReadBody::Fact(hidden),
        }],
        vec![],
    );
    assert_eq!(
        rr.validate(&context, &r, &raw(&rr)),
        Err(Invalid("reader_hidden_object"))
    );
}
