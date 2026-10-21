//! Recorded synthetic drafts characterize the existing consumer boundary.
//! Separator-only controls are not narrative repairs or new model acceptances.
use elselife_algorithms::experience::pipeline::{Pipeline, PipelineStep};
use elselife_algorithms::experience::{Context, Invalid};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn recordings() -> Vec<Value> {
    [
        include_bytes!("fixtures/benchmark-nar017-s03-draft-paragraphs.json").as_slice(),
        include_bytes!("fixtures/benchmark-nar010-s06-draft-paragraphs.json").as_slice(),
    ]
    .iter()
    .map(|bytes| serde_json::from_slice(bytes).unwrap())
    .collect()
}

fn context() -> Context {
    let mut value: Value =
        serde_json::from_slice(include_bytes!("fixtures/experience-hidden-suffix.json")).unwrap();
    value["pipeline"] = json!({"version":1,"max_actors":2,"max_repairs":1});
    value["reading_request"] = json!("继续本章。");
    Context::decode(value.to_string().as_bytes()).unwrap()
}

fn accept(p: &mut Pipeline, c: &Context, stage: &str, result: Value) {
    assert_eq!(p.next_request(c).unwrap().stage, stage);
    assert!(matches!(
        p.accept(c, json!({"result":result}).to_string().as_bytes()),
        Ok(PipelineStep::Continue)
    ));
}

fn waiting_writer(c: &Context) -> Pipeline {
    let mut pipeline = Pipeline::new(c, 12).unwrap();
    accept(
        &mut pipeline,
        c,
        "memory",
        json!({"actors":[],"relevant_fact_ids":[],"objective":"Continue the reading unit"}),
    );
    accept(
        &mut pipeline,
        c,
        "plan",
        json!({"candidates":[
            {"id":"observe","purpose":"Observe","beats":["Observe"],"causes":[],"costs":[],"consequences":[],"thread_ids":[],"fact_ids":[]},
            {"id":"continue","purpose":"Continue","beats":["Continue"],"causes":[],"costs":[],"consequences":[],"thread_ids":[],"fact_ids":[]}]}),
    );
    accept(
        &mut pipeline,
        c,
        "evaluate",
        json!({"evaluations":[
            {"candidate_id":"observe","continuity":3,"agency":3,"causality":3,"consequence":3,"pacing":3,"interest":3,"blocking_issues":[],"evidence_fact_ids":[]},
            {"candidate_id":"continue","continuity":4,"agency":4,"causality":4,"consequence":4,"pacing":4,"interest":4,"blocking_issues":[],"evidence_fact_ids":[]}]}),
    );
    assert_eq!(pipeline.next_request(c).unwrap().stage, "write");
    assert_eq!(pipeline.calls(), 4);
    pipeline
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn without_line_endings(text: &str) -> String {
    text.chars().filter(|c| !matches!(c, '\r' | '\n')).collect()
}

#[test]
fn recorded_drafts_keep_original_bytes_and_only_change_separators_in_controls() {
    for (fixture, original_paragraphs, removed_lf, root) in [
        (
            &recordings()[0],
            32,
            8,
            "21c9478a5c0a2c8bc1260597d5e94add846b3fc84ff10e3e5f83514e3cc2c147",
        ),
        (
            &recordings()[1],
            31,
            7,
            "cb31a7c02bff7068635fd35d6814e9ccbc8e81c846e57c55260d6c71598ce9e4",
        ),
    ] {
        assert_eq!(fixture["source"]["root_sha256"], root);
        let mut drafts = vec![];
        for (key, paragraphs) in [("original", original_paragraphs), ("separator_only_24", 24)] {
            let raw = fixture[key]["raw"].as_str().unwrap();
            assert_eq!(sha256(raw.as_bytes()), fixture[key]["raw_sha256"]);
            let draft: Value = serde_json::from_str(raw).unwrap();
            let passage = draft["result"]["passage"].as_str().unwrap();
            assert_eq!(sha256(passage.as_bytes()), fixture[key]["passage_sha256"]);
            assert_eq!(passage.len(), fixture[key]["passage_utf8_bytes"]);
            assert_eq!(passage.split("\n\n").count(), paragraphs);
            drafts.push(draft);
        }
        let original = drafts[0]["result"]["passage"].as_str().unwrap().to_owned();
        let control = drafts[1]["result"]["passage"].as_str().unwrap();
        assert_eq!(control, original.replacen("\n\n", "\n", removed_lf));
        assert_eq!(
            without_line_endings(&original),
            without_line_endings(control)
        );
        assert_eq!(original.len() - control.len(), removed_lf);
        drafts[1]["result"]["passage"] = json!(original);
        assert_eq!(
            drafts[0], drafts[1],
            "a control changed a non-passage field"
        );
    }
}

#[test]
fn recorded_over_paragraph_drafts_fail_while_separator_only_controls_reach_extraction() {
    let c = context();
    for fixture in recordings() {
        let mut original = waiting_writer(&c);
        let error = original
            .accept(&c, fixture["original"]["raw"].as_str().unwrap().as_bytes())
            .unwrap_err();
        assert_eq!(error, Invalid("invalid_scene_beat"));
        assert_eq!(original.failure_reason(error), "narrative_stage_invalid");
        assert_eq!(original.calls(), 4, "no automatic retry may consume a call");

        let mut control = waiting_writer(&c);
        let raw = fixture["separator_only_24"]["raw"].as_str().unwrap();
        assert!(matches!(
            control.accept(&c, raw.as_bytes()),
            Ok(PipelineStep::Continue)
        ));
        let extraction = control.next_request(&c).unwrap();
        assert_eq!(extraction.stage, "extract");
        let expected: Value = serde_json::from_str(raw).unwrap();
        assert_eq!(extraction.input["draft"], expected["result"]);
        // No extractor or reviewer result is fabricated and no formal page is made.
    }
}

#[test]
fn draft_consumer_remains_fail_closed_when_a_provider_ignores_the_schema() {
    let c = context();
    let fixture = &recordings()[0];
    let valid: Value =
        serde_json::from_str(fixture["separator_only_24"]["raw"].as_str().unwrap()).unwrap();
    let original: Value =
        serde_json::from_str(fixture["original"]["raw"].as_str().unwrap()).unwrap();
    let invalid_passages = [
        original["result"]["passage"]
            .as_str()
            .unwrap()
            .replace('\n', "\r\n"),
        std::iter::repeat_n("一段。", 25)
            .collect::<Vec<_>>()
            .join("\r\n\r\n"),
        "字".repeat(2731), // 8193 UTF-8 bytes, despite only 2731 characters.
        " \t\r\n \n ".into(),
    ];
    for passage in invalid_passages {
        let mut payload = valid.clone();
        payload["result"]["passage"] = json!(passage);
        let mut pipeline = waiting_writer(&c);
        assert_eq!(
            pipeline
                .accept(&c, payload.to_string().as_bytes())
                .unwrap_err(),
            Invalid("invalid_scene_beat")
        );
        assert_eq!(pipeline.calls(), 4);
    }
}

#[test]
fn draft_consumer_keeps_legal_single_line_breaks_crlf_and_indentation() {
    let c = context();
    let fixture = &recordings()[0];
    let mut payload: Value =
        serde_json::from_str(fixture["separator_only_24"]["raw"].as_str().unwrap()).unwrap();
    for passage in [
        "  第一行诗。\n\t第二行诗。\r\n第三行诗。  ".into(),
        std::iter::repeat_n("  对白。\r\n下一行。  ", 24)
            .collect::<Vec<_>>()
            .join("\r\n\r\n"),
    ] {
        payload["result"]["passage"] = json!(passage);
        let mut pipeline = waiting_writer(&c);
        assert!(matches!(
            pipeline.accept(&c, payload.to_string().as_bytes()),
            Ok(PipelineStep::Continue)
        ));
        assert_eq!(pipeline.next_request(&c).unwrap().stage, "extract");
    }
}
