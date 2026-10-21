//! Real official-runtime result.model carriers preserve only closed, sanitized failure reasons.
#![cfg(feature = "channel")]
use elselife_algorithms::experience::{self, Context};
use prost::Message;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

mod pb {
    #![allow(dead_code)]
    tonic::include_proto!("telos.algorithm.v1");
}

struct Runtime(Child);
impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
impl Runtime {
    fn start() -> (Self, String) {
        let mut process = Self(
            Command::new(env!("CARGO_BIN_EXE_algorithm-runtime"))
                .args(["--listen", "127.0.0.1:0", "--insecure-plaintext"])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let stdout = process.0.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
            let _ = tx.send(result);
        });
        let banner = rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap();
        let endpoint = banner.strip_prefix("listening ").unwrap().trim().to_owned();
        (process, endpoint)
    }
}

async fn next(inbound: &mut tonic::Streaming<pb::Envelope>) -> pb::Envelope {
    tokio::time::timeout(Duration::from_secs(10), inbound.message())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn pipeline_stage_metadata_is_sent_over_the_official_runtime() {
    let (_runtime, endpoint) = Runtime::start();
    let transport = tonic::transport::Endpoint::from_shared(format!("http://{endpoint}")).unwrap().connect().await.unwrap();
    let mut client = pb::runtime_channel_client::RuntimeChannelClient::new(transport);
    let (tx, rx) = mpsc::channel(4);
    let mut inbound = client.connect(ReceiverStream::new(rx)).await.unwrap().into_inner();
    let mut context = Context::decode(include_bytes!("fixtures/experience-context.json")).unwrap();
    context.pipeline = Some(experience::PipelineConfig {version:1,max_actors:2,max_repairs:1});
    tx.send(pb::Envelope {
        protocol_version:experience::PROTOCOL_VERSION.into(),frame_id:"pipeline_wire".into(),
        conversation_id:context.experience_id.clone(),turn_id:(context.revision+1) as i64,
        r#type:"request.experience".into(),content_type:"application/json".into(),payload:serde_json::to_vec(&context).unwrap(),
        facts:Some(pb::RuntimeFacts {allowed_models:vec!["fixture".into()],default_model:"fixture".into(),remaining_model_calls:12,
            context_token_limit:65536,output_token_reserve:4096,byte_token_bound_verified:true,..Default::default()}),..Default::default()
    }).await.unwrap();
    use serde_json::json;
    let mut candidate:serde_json::Value=serde_json::from_slice(include_bytes!("fixtures/experience-candidate.json")).unwrap();
    // This synthetic current-engine carrier uses v2. The legacy decoder fixture
    // stays unchanged; no legacy memory history is claimed equivalent.
    candidate.as_object_mut().unwrap().remove("memory_changes");
    candidate.as_object_mut().unwrap().remove("narrative_update");
    candidate["memory_delta"]=json!({"version":2,"entries":[]});
    let draft=json!({"title":candidate["title"],"passage":candidate["passage"],"story_time":candidate["story_time"],"outcome":candidate["outcome"],"suggestions":candidate["suggestions"]});
    let plan=|id:&str| json!({"id":id,"purpose":"The proprietor has a boundary","beats":["The proprietor refuses"],"causes":[],"costs":[],"consequences":[],"thread_ids":[],"fact_ids":[]});
    let score=|id:&str| json!({"candidate_id":id,"continuity":4,"agency":4,"causality":4,"consequence":3,"pacing":4,"interest":3,"blocking_issues":[],"evidence_fact_ids":[]});
    let quote="今晚不借书。";
    for (index,(stage,result)) in [
        ("memory",json!({"actors":[],"relevant_fact_ids":[],"objective":"Meet the proprietor"})),
        ("plan",json!({"candidates":[plan("one"),plan("two")]})),
        ("evaluate",json!({"evaluations":[score("one"),score("two")]})),
        ("write",draft),
        ("extract",json!({"candidate":candidate})),
        ("review",json!({"approved":true,"issues":[],"supports":[{"fact_id":"statement_refusal","quote":quote}],
            "knowledge_supports":[{"subject_id":"npc_bookseller","fact_id":"statement_refusal","quote":quote}]})),
    ].into_iter().enumerate() {
        let call = next(&mut inbound).await;
        assert_eq!(call.r#type,"request.model");
        assert_eq!(call.frame_id,format!("pipeline_wire:model:{}",index+1));
        let model = pb::ModelCallRequest::decode(call.payload.as_slice()).unwrap();
        assert_eq!(model.narrative_stage,stage); assert_eq!(model.narrative_actor_id,"");
        assert!(call.encoded_len()<65536-4096);
        // Stage schemas include the bounded supplemental-read alternative.
        // Keep the shared reservation and actual transport bound in agreement.
        assert!(model.schema_json.len()<=experience::pipeline::MAX_STAGE_SCHEMA_BYTES);
        if stage=="review" { let input:serde_json::Value=serde_json::from_str(&model.messages[1].content).unwrap(); assert_eq!(input["candidate"],candidate); }
        tx.send(pb::Envelope {protocol_version:call.protocol_version,frame_id:format!("{}:result",call.frame_id),correlation_frame_id:call.frame_id,
            conversation_id:call.conversation_id,turn_id:call.turn_id,event_seq:call.event_seq,r#type:"result.model".into(),content_type:"application/protobuf".into(),
            payload:pb::ModelCallResult {text:json!({"result":result}).to_string(),error_code:String::new()}.encode_to_vec(),..Default::default()}).await.unwrap();
    }
    let decision=next(&mut inbound).await;
    assert_eq!(decision.r#type,"decision.experience");
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&decision.payload).unwrap(),candidate);
}

#[tokio::test]
async fn model_failure_reasons_are_exact_closed_and_sanitized_over_real_channel() {
    let (_runtime, endpoint) = Runtime::start();
    let transport = tonic::transport::Endpoint::from_shared(format!("http://{endpoint}"))
        .unwrap()
        .connect_timeout(Duration::from_secs(10))
        .connect()
        .await
        .unwrap();
    let mut client = pb::runtime_channel_client::RuntimeChannelClient::new(transport);
    let (tx, rx) = mpsc::channel(4);
    let mut inbound = client
        .connect(ReceiverStream::new(rx))
        .await
        .unwrap()
        .into_inner();
    let context = Context::decode(include_bytes!("fixtures/experience-context.json")).unwrap();
    let cases = [
        (
            "invalid_model_request",
            pb::FrameFailureCode::Precondition,
            "invalid_model_request",
        ),
        (
            "model_output_capacity",
            pb::FrameFailureCode::Precondition,
            "model_output_capacity",
        ),
        (
            "model_canceled",
            pb::FrameFailureCode::Cancelled,
            "model_canceled",
        ),
        (
            "model_deadline_exceeded",
            pb::FrameFailureCode::Deadline,
            "model_deadline_exceeded",
        ),
        (
            "unknown_model_error",
            pb::FrameFailureCode::Precondition,
            "invalid_model_error_code",
        ),
        (
            "invalid_model_request: provider-private fixture-secret",
            pb::FrameFailureCode::Precondition,
            "invalid_model_error_code",
        ),
        (
            "model_output_capacity ",
            pb::FrameFailureCode::Precondition,
            "invalid_model_error_code",
        ),
        (
            "MODEL_OUTPUT_CAPACITY",
            pb::FrameFailureCode::Precondition,
            "invalid_model_error_code",
        ),
    ];
    for (index, (error_code, failure_code, reason)) in cases.into_iter().enumerate() {
        let request = pb::Envelope {
            protocol_version: experience::PROTOCOL_VERSION.into(),
            frame_id: format!("model_failure_{index}"),
            conversation_id: context.experience_id.clone(),
            turn_id: (context.revision + 1) as i64,
            event_seq: 7,
            sent_at: 123,
            r#type: "request.experience".into(),
            content_type: "application/json".into(),
            payload: serde_json::to_vec(&context).unwrap(),
            facts: Some(pb::RuntimeFacts {
                allowed_models: vec!["wire-fixture".into()],
                default_model: "wire-fixture".into(),
                remaining_model_calls: 1,
                context_token_limit: 262144,
                output_token_reserve: 4096,
                byte_token_bound_verified: true,
                ..Default::default()
            }),
            ..Default::default()
        };
        tx.send(request.clone()).await.unwrap();
        let call = next(&mut inbound).await;
        assert_eq!(call.r#type, "request.model");
        assert_eq!(call.frame_id, format!("{}:model:1", request.frame_id));
        assert_eq!(call.correlation_frame_id, request.frame_id);
        assert_eq!(call.protocol_version, request.protocol_version);
        assert_eq!(call.conversation_id, request.conversation_id);
        assert_eq!(call.turn_id, request.turn_id);
        assert_eq!(call.event_seq, request.event_seq);
        assert_eq!(call.content_type, "application/protobuf");
        pb::ModelCallRequest::decode(call.payload.as_slice()).unwrap();
        tx.send(pb::Envelope {
            protocol_version: call.protocol_version,
            frame_id: format!("{}:result", call.frame_id),
            correlation_frame_id: call.frame_id,
            conversation_id: call.conversation_id,
            turn_id: call.turn_id,
            event_seq: call.event_seq,
            sent_at: 456,
            r#type: "result.model".into(),
            content_type: "application/protobuf".into(),
            payload: pb::ModelCallResult {
                // Deliberately non-candidate private text: the error path must not echo or decode it.
                text:
                    "provider-private https://provider.invalid Authorization: Bearer fixture-secret"
                        .into(),
                error_code: error_code.into(),
            }
            .encode_to_vec(),
            ..Default::default()
        })
        .await
        .unwrap();
        let out = next(&mut inbound).await;
        let failure = pb::FrameFailure::decode(out.payload.as_slice()).unwrap();
        assert_eq!(failure.code, failure_code as i32);
        assert_eq!(failure.reason, reason);
        // Exact whole-carrier equality also excludes private text, credentials and settings anywhere.
        assert_eq!(
            out,
            pb::Envelope {
                protocol_version: request.protocol_version,
                frame_id: format!("{}:failure", request.frame_id),
                correlation_frame_id: request.frame_id,
                conversation_id: request.conversation_id,
                turn_id: request.turn_id,
                event_seq: request.event_seq,
                sent_at: request.sent_at,
                r#type: "result.frame".into(),
                content_type: "application/protobuf".into(),
                payload: pb::FrameFailure {
                    code: failure_code as i32,
                    reason: reason.into(),
                }
                .encode_to_vec(),
                ..Default::default()
            }
        );
        println!("model_failure_wire case={index} reason={reason}");
    }
}
