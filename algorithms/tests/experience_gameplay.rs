use elselife_algorithms::experience::*;
use serde_json::json;

#[test]
fn model_schema_has_complete_reference_closure_without_authority_inputs() {
    fn check(value: &serde_json::Value, root: &serde_json::Value) {
        match value {
            serde_json::Value::Object(object) => {
                if let Some(reference)=object.get("$ref").and_then(serde_json::Value::as_str) {
                    assert!(root.pointer(reference.strip_prefix('#').unwrap()).is_some(),"unresolved model schema reference: {reference}");
                }
                for child in object.values(){check(child,root);}
            }
            serde_json::Value::Array(items)=>for child in items{check(child,root);},
            _=>(),
        }
    }
    let schema=candidate_schema();check(&schema,&schema);
    for name in ["gameplay_update","game_update","experience_update"] {
        assert!(schema["$defs"].get(name).is_some());
    }
    for name in ["context","state","gameplay_state","gameplay_action","read_reply","game_snapshot"] {
        assert!(schema["$defs"].get(name).is_none(),"unreachable authority definition: {name}");
    }
}

fn opening() -> Context { Context::decode(include_bytes!("fixtures/experience-context.json")).unwrap() }
fn candidate() -> Candidate { Candidate::decode(include_bytes!("fixtures/experience-candidate.json"), &opening()).unwrap() }
fn continued() -> Context {
    let mut c=opening(); let first=candidate();
    c.mode=Mode::Read;c.revision=1;c.input=String::new();
    c.state.story_time=first.story_time;
    c.state.facts=first.new_facts;c.state.entities=first.new_entities;c.state.threads=first.new_threads;
    c.history=vec![Page{revision:1,mode:Mode::Begin,input:String::new(),text:first.passage}];
    c.state_coverage.total=StateCounts{facts:c.state.facts.len() as u64,entities:c.state.entities.len() as u64,threads:c.state.threads.len() as u64};
    c.validate().unwrap();c
}
#[test]
fn gameplay_update_is_optional_closed_and_requires_current_prose_evidence() {
    let c=opening();let mut n=candidate();
    assert!(n.validate(&c).is_ok());
    let quote=n.passage.clone();
    n.gameplay_update=Some(json!({"schemaVersion":1,"game":null,"experience":null,"events":[{"type":"location","value":"茶铺","entityId":null,"quote":quote}]}));
    assert!(n.validate(&c).is_ok());
    n.gameplay_update.as_mut().unwrap()["events"][0]["quote"]=json!("未发生的原句");
    assert_eq!(n.validate(&c),Err(Invalid("gameplay_missing_evidence")));
    n.gameplay_update.as_mut().unwrap()["events"][0]["quote"]=json!(n.passage);
    n.gameplay_update.as_mut().unwrap()["gameplay_action"]=json!({});
    assert_eq!(n.validate(&c),Err(Invalid("invalid_gameplay")));
}
#[test]
fn gameplay_future_sources_and_spoofed_action_coordinates_are_rejected() {
    let mut c=continued();
    c.state.gameplay=Some(json!({"schemaVersion":1,"game":null,"location":"茶铺","inventory":[],"experience":{"schemaVersion":1,"clock":{"label":c.state.story_time,"elapsed":"","precision":"unknown","quote":"当前已知","sourceVersion":2},"objects":[],"stop":null,"folded":[]}}));
    assert_eq!(c.validate(),Err(Invalid("gameplay_future_source")));
    c.state.gameplay.as_mut().unwrap()["experience"]["clock"]["sourceVersion"]=json!(1);
    assert!(c.validate().is_ok());
    assert_eq!(known_information(&c.state).gameplay,c.state.gameplay);
    c.gameplay_action=Some(json!({"kind":"dynamic","action_id":"buy","result":"购入","changes":[],"destination":null,"journey":null,"base_revision":1}));
    assert_eq!(c.validate(),Err(Invalid("gameplay_action_scope")));
    c.mode=Mode::Act;c.input="购买".into();assert!(c.validate().is_ok());
    c.gameplay_action.as_mut().unwrap()["base_revision"]=json!(0);
    assert_eq!(c.validate(),Err(Invalid("gameplay_action_scope")));
}
#[test]
fn ask_cannot_propose_even_an_empty_gameplay_update_and_clock_must_match() {
    let mut c=continued();c.mode=Mode::Ask;c.input="现在怎样？".into();
    c.state=known_information(&c.state);c.state_coverage.audience=Audience::Reader;
    c.state_coverage.source_handle="fixture_reader_operation".into();
    c.state_coverage.total=StateCounts{facts:c.state.facts.len() as u64,entities:c.state.entities.len() as u64,threads:c.state.threads.len() as u64};
    c.validate().unwrap();
    let mut n=candidate();n.new_facts.clear();n.new_entities.clear();n.new_threads.clear();n.story_time=c.state.story_time.clone();
    n.gameplay_update=Some(json!({"schemaVersion":1,"game":null,"experience":null,"events":[]}));
    assert_eq!(n.validate(&c),Err(Invalid("ask_changes_world")));
    c.mode=Mode::Read;c.state_coverage.audience=Audience::Author;
    n.gameplay_update=Some(json!({"schemaVersion":1,"game":null,"experience":{"clock":{"label":"不一致的时间","elapsed":"","precision":"unknown","quote":n.passage},"objects":[],"stop":null,"folded":[]},"events":[]}));
    assert_eq!(n.validate(&c),Err(Invalid("gameplay_clock_mismatch")));
}

#[test]
fn source_numeric_game_survives_update_and_committed_snapshot_validation() {
    let mut n=candidate();
    n.passage.push_str("你有铜币5枚。买茶花费2枚铜币。");
    let game=json!({"entities":[{"id":"coins","kind":"meter","name":"铜币","detail":"随身零钱","status":"可用","value":5,"max":null,"unit":"枚","quote":"你有铜币5枚。"}],"surfaces":[{"id":"tea","kind":"interaction","title":"买茶","description":"明示价格","entityIds":["coins"],"links":[],"actions":[{"id":"buy","label":"买茶","input":"买一杯茶","mode":"apply","effects":[{"entityId":"coins","delta":-2,"status":null}],"destination":null,"disabledReason":""}],"quote":"买茶花费2枚铜币。"}],"spatial":null,"journeys":null});
    n.gameplay_update=Some(json!({"schemaVersion":1,"game":game,"experience":null,"events":[]}));
    n.validate(&opening()).unwrap();
    let mut c=continued();
    let mut snapshot=n.gameplay_update.as_ref().unwrap()["game"].clone();
    snapshot["schemaVersion"]=json!(1);
    snapshot["entities"][0]["sourceVersion"]=json!(1);
    snapshot["surfaces"][0]["version"]=json!(1);
    c.state.gameplay=Some(json!({"schemaVersion":1,"game":snapshot,"experience":null,"location":"茶铺","inventory":[]}));
    c.validate().unwrap();
    c.state.gameplay.as_mut().unwrap()["game"]["surfaces"][0]["actions"][0]["script"]=json!("bad");
    assert_eq!(c.validate(),Err(Invalid("invalid_gameplay")));
}
