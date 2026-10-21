//! Recorded output plus a reconstructed entry context test reference semantics.
//! This does not call a model, commit a page, or assess literary quality.
use elselife_algorithms::experience::{
    pipeline::{Pipeline, PipelineStep},
    Context, Invalid,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[test]
fn recorded_nar009_relationship_description_is_rejected_but_entity_id_continues() {
    let fixture: Value = serde_json::from_slice(include_bytes!(
        "fixtures/nar009-context-needs-reference.json"
    ))
    .expect("recorded reference fixture");
    let original = fixture["original_result"]
        .as_str()
        .expect("preserve the exact recorded model text");
    let expected_sha256 = "35c10777407f1812ac59ff25439cea1098cb3d1cbb9b88e9875fb161df83808d";
    assert_eq!(
        fixture["provenance"]["original_result_sha256"],
        expected_sha256
    );
    assert_eq!(
        format!("{:x}", Sha256::digest(original.as_bytes())),
        expected_sha256
    );
    assert_eq!(original.len(), 1188);

    // The saved model projection was partial. Rust validated the complete entry
    // context reconstructed from the recorded operation's authoritative state.
    let context = Context::decode(fixture["context"].to_string().as_bytes())
        .expect("valid reconstructed entry context");
    assert!(context.state_coverage.complete);
    let mut pipeline = Pipeline::new(&context, 12).unwrap();
    assert_eq!(pipeline.next_request(&context).unwrap().stage, "memory");
    let error = pipeline.accept(&context, original.as_bytes()).unwrap_err();
    assert_eq!(error, Invalid("unknown_reference"));
    assert_eq!(pipeline.failure_reason(error), "narrative_stage_invalid");
    eprintln!(
        "original: {error:?}; public={}",
        pipeline.failure_reason(error)
    );

    // Change only the relation selector. Keep the same actors, facts, objective
    // and complete entry context so another validation failure cannot mask this.
    let mut corrected: Value = serde_json::from_str(original).unwrap();
    corrected["result"]["context_needs"]["relationship_targets"] = json!(["fq"]);
    let mut control = Pipeline::new(&context, 12).unwrap();
    assert_eq!(control.next_request(&context).unwrap().stage, "memory");
    assert!(matches!(
        control.accept(&context, &serde_json::to_vec(&corrected).unwrap()),
        Ok(PipelineStep::Continue)
    ));
    assert_eq!(control.next_request(&context).unwrap().stage, "actor");
    eprintln!("fq-only positive control: Continue; next_stage=actor");
}
