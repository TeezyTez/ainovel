//! Frozen-prose extraction controls. Synthetic fixtures verify transport and
//! review boundaries, not the quality or length of model-written fiction.

use super::{require, Checked, Draft, Invalid, Value, MAX_CANDIDATE_BYTES};

pub(super) const FROZEN_FIELDS: [&str; 5] =
    ["title", "passage", "story_time", "outcome", "suggestions"];

/// The extractor emits state changes, not a second copy of the prose. Keep its
/// raw object bytes so typed decoding can still reject duplicate/unknown fields.
/// Full candidates from sealed recordings remain subject to exact draft matching.
pub(super) fn hydrate(raw: &str, draft: Option<&Draft>) -> Checked<Vec<u8>> {
    let draft = draft.ok_or(Invalid("extract_changed_draft"))?;
    require(
        raw.len() <= MAX_CANDIDATE_BYTES,
        "candidate_budget_exceeded",
    )?;
    let value: Value = serde_json::from_str(raw).map_err(|_| Invalid("invalid_candidate_shape"))?;
    let object = value
        .as_object()
        .ok_or(Invalid("invalid_candidate_shape"))?;
    let frozen_count = FROZEN_FIELDS
        .iter()
        .filter(|key| object.contains_key(**key))
        .count();
    require(
        frozen_count == 0 || frozen_count == FROZEN_FIELDS.len(),
        "extract_changed_draft",
    )?;
    if frozen_count == FROZEN_FIELDS.len() {
        return Ok(raw.as_bytes().to_vec());
    }
    // Match Go's JSON encoder with HTML escaping disabled. Go still escapes
    // these two line separators; use identical bytes for the shared 24 KiB cap.
    let frozen = serde_json::to_string(draft)
        .unwrap()
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let raw = raw.trim();
    let mut joined = raw[..raw.len() - 1].to_owned();
    if !object.is_empty() {
        joined.push(',');
    }
    joined.push_str(&frozen[1..]);
    require(
        joined.len() <= MAX_CANDIDATE_BYTES,
        "candidate_budget_exceeded",
    )?;
    Ok(joined.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::super::*;

    fn setup(passage: &str, stage: Stage) -> (Context, Pipeline, Candidate) {
        let mut c = Context::decode(include_bytes!(
            "../tests/fixtures/experience-hidden-suffix.json"
        ))
        .unwrap();
        c.mode = Mode::Read;
        c.input.clear();
        c.pipeline = Some(PipelineConfig {
            version: 1,
            max_actors: 2,
            max_repairs: 0,
        });
        let draft = Draft {
            title: "接着读".into(),
            passage: passage.into(),
            story_time: c.state.story_time.clone(),
            outcome: Outcome::Continues,
            suggestions: vec!["稍作停留".into()],
        };
        let mut candidate = draft.plain_candidate();
        candidate.memory_delta = Some(MemoryDelta {
            version: 2,
            entries: vec![],
        });
        let mut p = Pipeline::new(&c, 12).unwrap();
        p.stage = stage;
        p.draft = Some(draft);
        (c, p, candidate)
    }

    fn changes(candidate: &Candidate) -> Value {
        let mut value = serde_json::to_value(candidate).unwrap();
        for key in ["title", "passage", "story_time", "outcome", "suggestions"] {
            value.as_object_mut().unwrap().remove(key);
        }
        value
    }

    #[test]
    fn extraction_omits_frozen_prose_from_model_output_schema() {
        for stage in [Stage::Extract, Stage::RepairExtract] {
            let (c, mut p, _) = setup("原文。\n\n继续。", stage);
            let req = p.next_request(&c).unwrap();
            let schema = &req.schema["$defs"]["candidate"];
            for key in ["title", "passage", "story_time", "outcome", "suggestions"] {
                assert!(schema["properties"].get(key).is_none(), "{key} is repeated");
                assert!(!schema["required"].as_array().unwrap().contains(&json!(key)));
            }
            assert_eq!(req.input["draft"]["passage"], "原文。\n\n继续。");
        }
    }

    #[test]
    fn extraction_of_changes_restores_exact_draft_before_independent_review() {
        for passage in [
            "首段。\n\n次段。",
            "原字\"引号\"与字面\\n、反斜杠\\、<tag>🙂。\t",
        ] {
            for stage in [Stage::Extract, Stage::RepairExtract] {
                let (c, mut p, mut expected) = setup(passage, stage);
                expected.suggestions = p.draft.as_ref().unwrap().suggestions.clone();
                p.next_request(&c).unwrap();
                let raw = json!({"result":{"candidate":changes(&expected)}}).to_string();
                assert!(matches!(
                    p.accept(&c, raw.as_bytes()).unwrap(),
                    PipelineStep::Continue
                ));
                let review = p.next_request(&c).unwrap();
                assert_eq!(review.stage, "review");
                assert_eq!(
                    review.input["candidate"],
                    serde_json::to_value(&expected).unwrap()
                );
                assert_ne!(p.stage, Stage::Done);
            }
        }
    }

    #[test]
    fn partial_frozen_fields_cannot_override_or_invent_prose() {
        let (c, mut p, candidate) = setup("已冻结的正文。", Stage::Extract);
        p.next_request(&c).unwrap();
        let mut partial = changes(&candidate);
        partial["title"] = json!("试图覆盖");
        let err = p
            .accept(
                &c,
                json!({"result":{"candidate":partial}})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap_err();
        assert_eq!(err, Invalid("extract_changed_draft"));
        assert!(p.candidate.is_none());
    }

    #[test]
    fn compact_extraction_does_not_erase_duplicate_keys() {
        let (c, mut p, candidate) = setup("已冻结的正文。", Stage::Extract);
        p.next_request(&c).unwrap();
        let body = changes(&candidate).to_string().replacen(
            "\"version\":2",
            "\"version\":2,\"version\":2",
            1,
        );
        assert!(p
            .accept(
                &c,
                format!("{{\"result\":{{\"candidate\":{body}}}}}").as_bytes()
            )
            .is_err());
        assert!(p.candidate.is_none());
    }

    #[test]
    fn composed_candidate_limit_counts_frozen_prose_too() {
        let (c, mut p, candidate) = setup(&"长".repeat(2500), Stage::Extract);
        p.next_request(&c).unwrap();
        let body = changes(&candidate).to_string();
        let padded = format!("{}{}{}", &body[..body.len() - 1], " ".repeat(18000), "}");
        assert!(padded.len() < MAX_CANDIDATE_BYTES);
        let error = p
            .accept(
                &c,
                format!("{{\"result\":{{\"candidate\":{padded}}}}}").as_bytes(),
            )
            .unwrap_err();
        assert_eq!(error, Invalid("candidate_budget_exceeded"));
        assert_eq!(p.failure_reason(error), "model_output_capacity");
        assert!(p.candidate.is_none());
    }

    #[test]
    fn frozen_prose_encoding_matches_go_without_html_expansion() {
        let (_, p, candidate) = setup(&"<".repeat(5000), Stage::Extract);
        let raw = changes(&candidate).to_string();
        let hydrated = super::hydrate(&raw, p.draft.as_ref()).unwrap();
        assert!(hydrated.len() < 6000);
        let (_, p, candidate) = setup("段\u{2028}落\u{2029}与字面\\u2028<>&", Stage::Extract);
        let raw = changes(&candidate).to_string();
        let hydrated = super::hydrate(&raw, p.draft.as_ref()).unwrap();
        let wire = std::str::from_utf8(&hydrated).unwrap();
        assert!(wire.contains("段\\u2028落\\u2029与字面\\\\u2028<>&"));
        let decoded: Candidate = serde_json::from_slice(&hydrated).unwrap();
        assert_eq!(decoded.passage, p.draft.as_ref().unwrap().passage);
    }
}
