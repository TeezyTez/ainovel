use elselife_algorithms::experience::*;
use serde_json::json;

#[test]
fn reader_attachment_is_optional_closed_and_never_invents_distance() {
    let record: ReaderRecord = serde_json::from_value(json!({"kind":"route","entity_id":"a","target_id":"b","label":"路","passage":"unknown"})).unwrap();
    assert!(record.valid());
    assert_eq!(record.distance_meters, None);
    assert!(serde_json::from_value::<ReaderRecord>(json!({"kind":"route","entity_id":"a","target_id":"b","label":"路","execute":"anything"})).is_err());
    let malformed: ReaderRecord = serde_json::from_value(json!({"kind":"artifact","entity_id":"a","label":"表","columns":["列"],"rows":[["一","二"]]})).unwrap();
    assert!(!malformed.valid());
}

#[test]
fn reader_projection_hides_attachment_referencing_private_entity() {
    let state: State = serde_json::from_value(json!({"story_time":"早上","entities":[
        {"id":"a","kind":"location","name":"书店","description":"","known":true,"related_ids":[]},
        {"id":"b","kind":"location","name":"秘密地点","description":"","known":false,"related_ids":[]}],
        "facts":[{"id":"f","kind":"fact","text":"有一条道路。","subject_id":"a","known":true,"known_by":[],"source_revision":1,
            "reader":{"kind":"route","entity_id":"a","target_id":"b","label":"秘密路线"}}],"threads":[]})).unwrap();
    let known = known_information(&state);
    assert!(known.facts[0].reader.is_none());
    assert!(state.facts[0].reader.is_some());
    assert!(!serde_json::to_string(&known).unwrap().contains("秘密路线"));
}
