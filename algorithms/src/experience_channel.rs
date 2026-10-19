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
    let call = pb::ModelCallRequest {
        model: facts.default_model.clone(),
        max_output_bytes: capacity::MAX_MODEL_OUTPUT_BYTES as u32,
        schema_json: experience::response_schema().to_string(),
        messages: vec![
            pb::ModelMessage {
                role: "system".into(),
                content: experience::RESPONSE_PROMPT.into(),
                image_refs: vec![],
            },
            pb::ModelMessage {
                role: "user".into(),
                content: experience::narrative_input(context)
                    .map_err(|e| invalid(e.0))?
                    .to_string(),
                image_refs: vec![],
            },
        ],
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
    loop {
        let request = model_request(env, &context, model_seq)?;
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
        let generation =
            experience::decode_response(output.text.as_bytes(), &context).map_err(|e| invalid(e.0))?;
        match generation.result {
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
