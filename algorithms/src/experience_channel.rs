//! Experience-only transport/model orchestration. Backend owns Generate, deadlines and durable commits.
use crate::channel::pb;
use elselife_algorithms::{
    capacity,
    experience::{self, Context, GenerationResult, ReadResult},
};
use prost::Message;
use tokio::sync::mpsc;
use tonic::Status;

#[derive(Debug)]
pub struct Failure {
    pub code: pb::FrameFailureCode,
    pub reason: &'static str,
}
fn invalid(reason: &'static str) -> Failure {
    Failure {
        code: pb::FrameFailureCode::InvalidContext,
        reason,
    }
}

pub fn validate_request(env: &pb::Envelope) -> Result<Context, Failure> {
    if env.protocol_version != experience::PROTOCOL_VERSION
        || env.r#type != "request.experience"
        || env.content_type != "application/json"
        || env.frame_id.trim().is_empty()
        || !env.correlation_frame_id.is_empty()
        || env.event_seq < 0
        || env.sent_at < 0
    {
        return Err(invalid("experience_entry_required"));
    }
    let context = Context::decode(&env.payload).map_err(|e| invalid(e.0))?;
    if !context.recalls.is_empty() {
        return Err(invalid("initial_recalls_not_empty"));
    }
    if env.encoded_len() > capacity::MAX_FRAME_BYTES {
        return Err(invalid("context_budget_exceeded"));
    }
    if env.conversation_id != context.experience_id || env.turn_id != (context.revision + 1) as i64
    {
        return Err(invalid("experience_coordinates_mismatch"));
    }
    Ok(context)
}

pub fn model_request(
    env: &pb::Envelope,
    context: &Context,
    seq: u32,
) -> Result<pb::Envelope, Failure> {
    staged_model_request(env, context, seq, None)
}

fn staged_model_request(
    env: &pb::Envelope, context: &Context, seq: u32,
    stage: Option<experience::pipeline::StageRequest>,
) -> Result<pb::Envelope, Failure> {
    let facts = env
        .facts
        .as_ref()
        .ok_or_else(|| invalid("model_settings_missing"))?;
    // No old memory/source/skill/goal closure is permitted to acquire a new narrative consumer.
    if !facts.memories.is_empty()
        || !facts.intent_id.is_empty()
        || !facts.open_intent_ids.is_empty()
        || facts.remaining_jumps != 0
        || facts.summary.is_some()
        || !facts.source_context_json.is_empty()
        || facts.domain_qualification_version != 0
        || facts.context_resources.is_some()
    {
        return Err(invalid("legacy_runtime_context_rejected"));
    }
    if facts.default_model.trim().is_empty()
        || facts.allowed_models.is_empty()
        || !facts.allowed_models.contains(&facts.default_model)
    {
        return Err(invalid("model_not_allowed"));
    }
    if seq == 0 || seq > facts.remaining_model_calls {
        return Err(invalid("model_budget_exhausted"));
    }
    if !facts.byte_token_bound_verified
        || facts.context_token_limit == 0
        || facts.output_token_reserve == 0
        || facts.context_token_limit <= facts.output_token_reserve
    {
        return Err(invalid("context_limit_unknown"));
    }
    let (schema_json, system, input, narrative_stage, narrative_actor_id) = match stage {
        Some(stage) => (stage.schema.to_string(), stage.prompt, stage.input.to_string(), stage.stage.to_owned(), stage.actor_id),
        None => (experience::response_schema().to_string(), experience::RESPONSE_PROMPT.to_owned(),
            experience::narrative_input(context).map_err(|e| invalid(e.0))?.to_string(), String::new(), String::new()),
    };
    let call = pb::ModelCallRequest {
        model: facts.default_model.clone(),
        max_output_bytes: capacity::MAX_MODEL_OUTPUT_BYTES as u32,
        schema_json,
        messages: vec![
            pb::ModelMessage {
                role: "system".into(),
                content: system,
                image_refs: vec![],
            },
            pb::ModelMessage {
                role: "user".into(),
                content: input,
                image_refs: vec![],
            },
        ],
        narrative_stage,
        narrative_actor_id,
    };
    let mut request = envelope(
        env,
        "request.model",
        "application/protobuf",
        call.encode_to_vec(),
        &format!("model:{seq}"),
    );
    // Only transport model settings are echoed. Long-lived credentials never enter this process.
    request.facts = Some(pb::RuntimeFacts {
        default_model: facts.default_model.clone(),
        allowed_models: facts.allowed_models.clone(),
        remaining_model_calls: facts.remaining_model_calls - (seq - 1),
        context_token_limit: facts.context_token_limit,
        output_token_reserve: facts.output_token_reserve,
        byte_token_bound_verified: facts.byte_token_bound_verified,
        ticket: facts.ticket.clone(),
        capacity_profile_json: facts.capacity_profile_json.clone(),
        ..Default::default()
    });
    // Verified byte-fallback bound: bytes conservatively bound input tokens. Count whole final carrier.
    if request.encoded_len() > capacity::MAX_FRAME_BYTES
        || request.encoded_len() > (facts.context_token_limit - facts.output_token_reserve) as usize
    {
        return Err(invalid("context_budget_exceeded"));
    }
    Ok(request)
}

fn envelope(
    parent: &pb::Envelope,
    typ: &str,
    content_type: &str,
    payload: Vec<u8>,
    suffix: &str,
) -> pb::Envelope {
    pb::Envelope {
        protocol_version: experience::PROTOCOL_VERSION.into(),
        frame_id: format!("{}:{suffix}", parent.frame_id),
        correlation_frame_id: parent.frame_id.clone(),
        conversation_id: parent.conversation_id.clone(),
        turn_id: parent.turn_id,
        event_seq: parent.event_seq,
        sent_at: parent.sent_at,
        r#type: typ.into(),
        content_type: content_type.into(),
        payload,
        ..Default::default()
    }
}

pub fn failure_frame(env: &pb::Envelope, fail: Failure) -> pb::Envelope {
    let mut reply = envelope(
        env,
        "result.frame",
        "application/protobuf",
        pb::FrameFailure {
            code: fail.code as i32,
            reason: fail.reason.into(),
        }
        .encode_to_vec(),
        "failure",
    );
    reply.protocol_version = env.protocol_version.clone();
    reply
}

pub fn validate_result(request: &pb::Envelope, result: &pb::Envelope) -> Result<(), Failure> {
    if result.protocol_version != request.protocol_version
        || result.r#type != "result.model"
        || result.content_type != "application/protobuf"
        || result.frame_id != format!("{}:result", request.frame_id)
        || result.correlation_frame_id != request.frame_id
        || result.conversation_id != request.conversation_id
        || result.turn_id != request.turn_id
        || result.event_seq != request.event_seq
        || result.encoded_len() > capacity::MAX_FRAME_BYTES
        || result.facts.is_some()
    {
        return Err(invalid("model_result_coordinates_mismatch"));
    }
    Ok(())
}
fn model_failure(code: &str) -> Failure {
    // Closed, sanitized reasons. Provider text, endpoints and credentials are never echoed.
    let reason = match code {
        "model_unavailable" => "model_unavailable",
        "invalid_model_request" => "invalid_model_request",
        "model_output_capacity" => "model_output_capacity",
        "model_failed" => "model_failed",
        "model_canceled" => "model_canceled",
        "model_deadline_exceeded" => "model_deadline_exceeded",
        "model_not_allowed" => "model_not_allowed",
        "empty_model_call" => "empty_model_call",
        "model_allow_list_missing" => "model_allow_list_missing",
        "context_limit_unknown" => "context_limit_unknown",
        "context_budget_exceeded" => "context_budget_exceeded",
        "credential_rejected" => "credential_rejected",
        "credential_quota" => "credential_quota",
        "upstream_rejected" => "upstream_rejected",
        "upstream_retryable" => "upstream_retryable",
        _ => "invalid_model_error_code",
    };
    Failure {
        code: match code {
            "model_canceled" => pb::FrameFailureCode::Cancelled,
            "model_deadline_exceeded" => pb::FrameFailureCode::Deadline,
            _ => pb::FrameFailureCode::Precondition,
        },
        reason,
    }
}

async fn wait_result(
    root: &pb::Envelope,
    request: &pb::Envelope,
    typ: &str,
    inbound: &mut mpsc::Receiver<pb::Envelope>,
    tx: &mpsc::Sender<Result<pb::Envelope, Status>>,
) -> Result<pb::Envelope, Failure> {
    loop {
        let received = tokio::select! {
            result = inbound.recv() => result,
            _ = tx.closed() => return Err(Failure { code: pb::FrameFailureCode::Cancelled, reason: "caller_disconnected" }),
        };
        let frame = received.ok_or(Failure {
            code: pb::FrameFailureCode::Cancelled,
            reason: "operation_result_unknown_stream_closed",
        })?;
        if frame.r#type == typ && frame.correlation_frame_id == request.frame_id {
            let mut expected = request.clone();
            if typ == "result.experience_read" {
                // Same transport identity checks as model, but JSON read callback.
                expected.content_type = "application/json".into();
            }
            if frame.protocol_version != expected.protocol_version
                || frame.content_type != expected.content_type
                || frame.frame_id != format!("{}:result", request.frame_id)
                || frame.correlation_frame_id != request.frame_id
                || frame.conversation_id != request.conversation_id
                || frame.turn_id != request.turn_id
                || frame.event_seq != request.event_seq
                || frame.sent_at < 0
                || frame.encoded_len() > capacity::MAX_FRAME_BYTES
                || frame.facts.is_some()
            {
                return Err(invalid(if typ == "result.model" {
                    "model_result_coordinates_mismatch"
                } else {
                    "recall_scope_mismatch"
                }));
            }
            return Ok(frame);
        }
        if frame.r#type == "result.frame"
            && (frame.correlation_frame_id == request.frame_id
                || frame.correlation_frame_id == root.frame_id)
        {
            if frame.protocol_version != root.protocol_version
                || frame.conversation_id != root.conversation_id
                || frame.turn_id != root.turn_id
                || frame.event_seq != root.event_seq
                || frame.facts.is_some()
                || frame.content_type != "application/protobuf"
                || frame.encoded_len() > capacity::MAX_FRAME_BYTES
            {
                return Err(invalid("recall_scope_mismatch"));
            }
            let failure = pb::FrameFailure::decode(frame.payload.as_slice())
                .map_err(|_| invalid("invalid_operation_failure"))?;
            return Err(Failure {
                code: match pb::FrameFailureCode::try_from(failure.code) {
                    Ok(pb::FrameFailureCode::Cancelled) => pb::FrameFailureCode::Cancelled,
                    Ok(pb::FrameFailureCode::Deadline) => pb::FrameFailureCode::Deadline,
                    _ => pb::FrameFailureCode::Precondition,
                },
                reason: "operation_interrupted",
            });
        }
        tx.send(Ok(failure_frame(
            &frame,
            invalid("unexpected_frame_while_generating"),
        )))
        .await
        .map_err(|_| Failure {
            code: pb::FrameFailureCode::Cancelled,
            reason: "caller_disconnected",
        })?;
    }
}

pub async fn generate(
    env: &pb::Envelope,
    inbound: &mut mpsc::Receiver<pb::Envelope>,
    tx: &mpsc::Sender<Result<pb::Envelope, Status>>,
) -> Result<pb::Envelope, Failure> {
    let mut context = validate_request(env)?;
    // Accounting against Go's frozen grants, not a new policy or hidden retry allowance.
    let mut model_seq = 1u32;
    let mut read_seq = 0u64;
    let mut reply_bytes = 0u64;
    let mut pipeline = if context.pipeline.is_some() {
        Some(experience::pipeline::Pipeline::new(&context,
            env.facts.as_ref().map(|f| f.remaining_model_calls).unwrap_or(0)).map_err(|e| invalid(e.0))?)
    } else { None };
    loop {
        let stage = pipeline.as_mut().map(|p| p.next_request(&context).map_err(|e| invalid(p.failure_reason(e)))).transpose()?;
        let request = staged_model_request(env, &context, model_seq, stage)?;
        tx.send(Ok(request.clone())).await.map_err(|_| Failure {
            code: pb::FrameFailureCode::Cancelled,
            reason: "caller_disconnected",
        })?;
        let result = wait_result(env, &request, "result.model", inbound, tx).await?;
        let output = pb::ModelCallResult::decode(result.payload.as_slice())
            .map_err(|_| invalid("invalid_model_result"))?;
        if !output.error_code.is_empty() {
            return Err(model_failure(&output.error_code));
        }
        let generation = if let Some(pipeline) = &mut pipeline {
            use experience::pipeline::PipelineStep;
            match pipeline.accept(&context, output.text.as_bytes()).map_err(|e| invalid(pipeline.failure_reason(e)))? {
                PipelineStep::Continue => { model_seq += 1; continue; },
                PipelineStep::Read(read) => GenerationResult::ReadRequest(read),
                PipelineStep::Complete(candidate) => GenerationResult::Candidate(candidate),
            }
        } else { experience::decode_response(output.text.as_bytes(), &context).map_err(|e| invalid(e.0))?.result };
        match generation {
            GenerationResult::Candidate(candidate) => {
                // A legal candidate on the final permitted call is still returned for Go's full Apply.
                let payload = serde_json::to_vec(&candidate)
                    .map_err(|_| invalid("candidate_encoding_failed"))?;
                let decision = envelope(
                    env,
                    "decision.experience",
                    "application/json",
                    payload,
                    "decision",
                );
                if decision.encoded_len() > capacity::MAX_FRAME_BYTES {
                    return Err(invalid("candidate_budget_exceeded"));
                }
                return Ok(decision);
            }
            GenerationResult::ReadRequest(read) => {
                if model_seq >= env.facts.as_ref().unwrap().remaining_model_calls {
                    return Err(invalid("model_budget_exhausted"));
                }
                if read_seq >= context.read_budget.max_reads
                    || read.max_reply_bytes
                        > context
                            .read_budget
                            .max_total_reply_bytes
                            .saturating_sub(reply_bytes)
                {
                    return Err(invalid("recall_budget_exhausted"));
                }
                if context
                    .recalls
                    .iter()
                    .any(|r| r.request_id == read.request_id)
                {
                    return Err(invalid("recall_query_incomplete"));
                }
                read_seq += 1;
                let read_request = envelope(
                    env,
                    "request.experience_read",
                    "application/json",
                    serde_json::to_vec(&read).map_err(|_| invalid("invalid_read_request"))?,
                    &format!("read:{read_seq}"),
                );
                if read_request.encoded_len() > capacity::MAX_FRAME_BYTES {
                    return Err(invalid("recall_item_capacity"));
                }
                tx.send(Ok(read_request.clone()))
                    .await
                    .map_err(|_| Failure {
                        code: pb::FrameFailureCode::Cancelled,
                        reason: "caller_disconnected",
                    })?;
                let result =
                    wait_result(env, &read_request, "result.experience_read", inbound, tx).await?;
                let reply: ReadResult = serde_json::from_slice(&result.payload)
                    .map_err(|_| invalid("invalid_read_reply"))?;
                match reply {
                    ReadResult::Failure(failure) => {
                        if failure.request_id != read.request_id {
                            return Err(invalid("recall_scope_mismatch"));
                        }
                        return Err(invalid(failure.error_code.reason()));
                    }
                    ReadResult::Reply(reply) => {
                        reply
                            .validate(&context, &read, &result.payload)
                            .map_err(|e| invalid(e.0))?;
                        reply_bytes = reply_bytes
                            .checked_add(result.payload.len() as u64)
                            .ok_or_else(|| invalid("recall_budget_exhausted"))?;
                        if reply_bytes > context.read_budget.max_total_reply_bytes {
                            return Err(invalid("recall_budget_exhausted"));
                        }
                        // Preserve source snapshots separately; do not replace generation state/history.
                        context.recalls.push(reply);
                    }
                }
                model_seq += 1;
                // Next call repeats final prost/input/output guards with all raw recall evidence.
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v46_near_capacity_carrier_fits_final_protobuf_and_single_schema_provider_cost() {
        use experience::pipeline::{Pipeline,MAX_STAGE_OVERHEAD_BYTES,SCHEMA_TRANSPORT_GROWTH_BYTES};
        let mut context=Context::decode(include_bytes!("../tests/fixtures/experience-context.json")).unwrap();
        context.pipeline=Some(experience::PipelineConfig {version:1,max_actors:2,max_repairs:1});
        context.seed="x".into();
        let frame_id="f".repeat(75); let model="fixture".to_owned();
        let dynamic=2*frame_id.len()+context.experience_id.len()+3*model.len()+1024;
        let limit=65536usize; let reserve=8192usize;
        let context_allowance=limit-reserve-MAX_STAGE_OVERHEAD_BYTES-dynamic;
        let base=serde_json::to_vec(&context).unwrap().len()-1;
        context.seed="x".repeat(context_allowance-base);
        let context_bytes=serde_json::to_vec(&context).unwrap().len();
        assert_eq!(context_bytes,context_allowance);
        let env=pb::Envelope {protocol_version:experience::PROTOCOL_VERSION.into(),frame_id,
            conversation_id:context.experience_id.clone(),turn_id:1,
            facts:Some(pb::RuntimeFacts {default_model:model.clone(),allowed_models:vec![model],remaining_model_calls:12,
                context_token_limit:limit as u32,output_token_reserve:reserve as u32,byte_token_bound_verified:true,..Default::default()}),..Default::default()};
        let mut pipeline=Pipeline::new(&context,12).unwrap();
        let mut stage=pipeline.next_request(&context).unwrap();
        // Transport capacity fixture: fill the full published aggregate reservation. Separate
        // pipeline tests construct maximal real review components and validate their producer caps.
        stage.input=serde_json::json!({"context":context,"carrier_padding":""});
        let extra=context_bytes+MAX_STAGE_OVERHEAD_BYTES-SCHEMA_TRANSPORT_GROWTH_BYTES-stage.prompt.len()-stage.schema.to_string().len()-stage.input.to_string().len();
        stage.input["carrier_padding"]=serde_json::json!("x".repeat(extra));
        let request=staged_model_request(&env,&context,12,Some(stage.clone())).unwrap();
        let call=pb::ModelCallRequest::decode(request.payload.as_slice()).unwrap();
        assert!(request.encoded_len() <= limit-reserve);
        let provider=reserve+256+129+call.schema_json.len()+call.messages.iter().map(|m| m.content.len()+m.role.len()+32).sum::<usize>();
        assert!(provider<=limit);
        let mut too_small=env;
        too_small.facts.as_mut().unwrap().context_token_limit=(request.encoded_len()+reserve-1) as u32;
        assert_eq!(staged_model_request(&too_small,&context,12,Some(stage)).unwrap_err().reason,"context_budget_exceeded");
    }

    #[test]
    fn generation_preflight_bound_covers_actual_carrier_and_provider_framing() {
        for ask in [false, true] {
            for model_len in [12, 4096] {
                let mut context = Context::decode(include_bytes!("../tests/fixtures/experience-hidden-suffix.json")).unwrap();
                context.experience_id = "e".repeat(512);
                context.branch_id = "b".repeat(512);
                context.state.entities[0].known = true;
                for i in 0..100 {
                    let mut fact = context.state.facts[0].clone();
                    fact.id = format!("fact_{i}_{}", "x".repeat(200));
                    fact.kind = experience::FactKind::Fact;
                    fact.known = true;
                    context.state.facts.push(fact);
                }
                if ask {
                    context.mode = experience::Mode::Ask;
                    context.input = "解释已经知道的事。".into();
                    context.state = experience::known_information(&context.state);
                    context.state_coverage.audience = experience::Audience::Reader;
                }
                context.state_coverage.total = experience::StateCounts {
                    facts: context.state.facts.len() as u64,
                    entities: context.state.entities.len() as u64,
                    threads: context.state.threads.len() as u64,
                };
                let context_bytes = serde_json::to_vec(&context).unwrap().len();
                let model = "m".repeat(model_len);
                // Production uses a fixed hash frame ID. Model names and experience IDs are
                // variable; charge their actual bytes in addition to bounded content overhead.
                let frame_id = "f".repeat(75);
                let dynamic = 2 * frame_id.len() + context.experience_id.len() + 3 * model.len() + 1024;
                let reserve = 8192;
                let limit = context_bytes + experience::NARRATIVE_CONTENT_OVERHEAD_BYTES
                    + experience::NARRATIVE_SCHEMA_MAX_BYTES + dynamic + reserve;
                let env = pb::Envelope {
                    protocol_version: experience::PROTOCOL_VERSION.into(),
                    frame_id, conversation_id: context.experience_id.clone(),
                    turn_id: (context.revision + 1) as i64,
                    facts: Some(pb::RuntimeFacts {
                        default_model: model.clone(), allowed_models: vec![model], remaining_model_calls: 2,
                        context_token_limit: limit as u32, output_token_reserve: reserve as u32,
                        byte_token_bound_verified: true, ..Default::default()
                    }),
                    ..Default::default()
                };
                let request = model_request(&env, &context, 1).unwrap();
                let call = pb::ModelCallRequest::decode(request.payload.as_slice()).unwrap();
                let message_bytes: usize = call.messages.iter().map(|m| m.content.len()).sum();
                let content = message_bytes + call.schema_json.len();
                assert!(content <= context_bytes + experience::NARRATIVE_CONTENT_OVERHEAD_BYTES);
                assert!(request.encoded_len() <= context_bytes + experience::NARRATIVE_CONTENT_OVERHEAD_BYTES + dynamic);
                assert!(request.encoded_len() > context_bytes + 8192, "old reservation cannot fit v3");
                // Native schema and JSON fallback are separate attempts. Count one
                // schema plus the fallback's instruction/role framing and messages.
                let provider = reserve + 256 + 129 + call.schema_json.len()
                    + call.messages.iter().map(|m| m.content.len() + m.role.len() + 32).sum::<usize>();
                assert!(provider <= limit);
                let input: serde_json::Value = serde_json::from_str(&call.messages[1].content).unwrap();
                assert_eq!(input["authoring"]["narrative_brief"]["truncated"], true);
                if ask { assert!(!input.to_string().contains("fixed_secret")); }
            }
        }
    }
}
