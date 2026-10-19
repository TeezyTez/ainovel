//! Experience-only real channel fixture probe. No provider calls; rejects old entries before/after failures.
fn main() {
    #[cfg(not(feature = "channel"))]
    {
        eprintln!("probe requires channel");
        std::process::exit(2);
    }
    #[cfg(feature = "channel")]
    if let Err(e) = probe::run() {
        eprintln!("probe: {e}");
        std::process::exit(1);
    }
}
#[cfg(feature = "channel")]
mod probe {
    use elselife_algorithms::{
        experience::{self, Candidate, Context, Mode, Page},
        MAX_FRAME_BYTES,
    };
    use prost::Message;
    use std::{error::Error, time::Duration};
    use tokio::{sync::mpsc, time::timeout};
    use tokio_stream::wrappers::ReceiverStream;
    use tonic::{
        client::Grpc, codec::ProstCodec, codegen::http::uri::PathAndQuery, transport::Endpoint,
        Request,
    };
    mod pb {
        tonic::include_proto!("telos.algorithm.v1");
    }
    type TestResult<T> = Result<T, Box<dyn Error>>;
    const PATH: &str = "/telos.algorithm.v1.RuntimeChannel/Connect";
    struct Session {
        tx: mpsc::Sender<pb::Envelope>,
        incoming: tonic::Streaming<pb::Envelope>,
    }
    impl Session {
        async fn connect(addr: &str) -> TestResult<Self> {
            let channel = Endpoint::from_shared(format!("http://{addr}"))?
                .connect_timeout(Duration::from_secs(10))
                .connect()
                .await?;
            let mut grpc = Grpc::new(channel);
            grpc.ready().await?;
            let (tx, rx) = mpsc::channel(64);
            let incoming = grpc
                .streaming::<ReceiverStream<pb::Envelope>, pb::Envelope, pb::Envelope, _>(
                    Request::new(ReceiverStream::new(rx)),
                    PathAndQuery::from_static(PATH),
                    ProstCodec::default(),
                )
                .await?
                .into_inner();
            Ok(Self { tx, incoming })
        }
        async fn next(&mut self) -> TestResult<pb::Envelope> {
            timeout(Duration::from_secs(10), self.incoming.message())
                .await??
                .ok_or_else(|| "stream ended".into())
        }
        async fn rejected(&mut self, env: pb::Envelope) -> TestResult<()> {
            self.tx.send(env.clone()).await?;
            let out = self.next().await?;
            assert_failure(&env, &out)?;
            Ok(())
        }
        async fn candidate_rejected(
            &mut self,
            env: pb::Envelope,
            candidate: &str,
        ) -> TestResult<()> {
            self.tx.send(env.clone()).await?;
            let call = self.next().await?;
            validate_call(&env, &call)?;
            self.tx.send(model_result(&call, candidate)).await?;
            let out = self.next().await?;
            assert_failure(&env, &out)
        }
        async fn exchange(
            &mut self,
            env: pb::Envelope,
            candidate: &str,
            damage: Option<&str>,
        ) -> TestResult<pb::Envelope> {
            self.tx.send(env.clone()).await?;
            let call = self.next().await?;
            validate_call(&env, &call)?;
            let mut result = model_result(&call, candidate);
            if let Some(damage) = damage {
                match damage {
                    "version" => result.protocol_version = "v0.2".into(),
                    "frame_id" => result.frame_id.push_str(":wrong"),
                    "conversation" => result.conversation_id.push_str(":other"),
                    "turn" => result.turn_id += 1,
                    "event_seq" => result.event_seq += 1,
                    "content_type" => result.content_type = "application/json".into(),
                    "error" => {
                        result.payload = pb::ModelCallResult {
                            text: "private provider message not for user".into(),
                            error_code: "model_deadline_exceeded".into(),
                        }
                        .encode_to_vec()
                    }
                    "cancel" => {
                        result.payload = pb::ModelCallResult {
                            text: "".into(),
                            error_code: "model_canceled".into(),
                        }
                        .encode_to_vec()
                    }
                    "unavailable" => {
                        result.payload = pb::ModelCallResult {
                            text: "".into(),
                            error_code: "model_unavailable".into(),
                        }
                        .encode_to_vec()
                    }
                    "provider_error" => {
                        result.payload = pb::ModelCallResult {
                            text: "".into(),
                            error_code: "secret-provider-error".into(),
                        }
                        .encode_to_vec()
                    }
                    "malformed" => result.payload = b"not protobuf".to_vec(),
                    "facts" => result.facts = Some(pb::RuntimeFacts::default()),
                    _ => return Err("unknown damage".into()),
                }
            }
            self.tx.send(result).await?;
            let out = self.next().await?;
            if damage.is_some() {
                assert_failure(&env, &out)?;
            } else {
                validate_decision(&env, &out)?;
            }
            Ok(out)
        }
    }
    fn fixture_context() -> Context {
        Context::decode(include_bytes!(
            "../../tests/fixtures/experience-context.json"
        ))
        .unwrap()
    }
    fn fixture_candidate() -> String {
        include_str!("../../tests/fixtures/experience-candidate.json").into()
    }
    fn env(context: &Context, frame: &str) -> pb::Envelope {
        pb::Envelope {
            protocol_version: experience::PROTOCOL_VERSION.into(),
            frame_id: frame.into(),
            conversation_id: context.experience_id.clone(),
            turn_id: (context.revision + 1) as i64,
            event_seq: 7,
            sent_at: 123,
            r#type: "request.experience".into(),
            content_type: "application/json".into(),
            payload: serde_json::to_vec(context).unwrap(),
            facts: Some(pb::RuntimeFacts {
                allowed_models: vec!["probe-fixture".into()],
                default_model: "probe-fixture".into(),
                remaining_model_calls: 1,
                context_token_limit: 262144,
                output_token_reserve: 4096,
                byte_token_bound_verified: true,
                ..Default::default()
            }),
            ..Default::default()
        }
    }
    fn validate_scope(parent: &pb::Envelope, reply: &pb::Envelope) -> TestResult<()> {
        if reply.protocol_version != parent.protocol_version
            || reply.conversation_id != parent.conversation_id
            || reply.turn_id != parent.turn_id
            || reply.event_seq != parent.event_seq
            || reply.correlation_frame_id != parent.frame_id
            || reply.payload.len() > MAX_FRAME_BYTES
        {
            return Err("reply envelope scope mismatch".into());
        }
        Ok(())
    }
    fn assert_failure(env: &pb::Envelope, out: &pb::Envelope) -> TestResult<()> {
        validate_scope(env, out)?;
        if out.r#type != "result.frame"
            || out.frame_id != format!("{}:failure", env.frame_id)
            || out.content_type != "application/protobuf"
        {
            return Err("expected failure without model/fallback".into());
        }
        let fail = pb::FrameFailure::decode(out.payload.as_slice())?;
        if fail.code == 0
            || fail.reason.trim().is_empty()
            || fail.reason.contains("secret-provider")
            || fail.reason.contains("private provider")
        {
            return Err("invalid or leaking failure".into());
        }
        println!(
            "probe rejected frame={} reason={}",
            env.frame_id, fail.reason
        );
        Ok(())
    }
    fn validate_call(env: &pb::Envelope, out: &pb::Envelope) -> TestResult<()> {
        validate_scope(env, out)?;
        if out.r#type != "request.model"
            || out.frame_id != format!("{}:model:1", env.frame_id)
            || out.content_type != "application/protobuf"
        {
            return Err("expected real reverse model roundtrip".into());
        }
        let call = pb::ModelCallRequest::decode(out.payload.as_slice())?;
        if call.model != "probe-fixture"
            || call.messages.len() != 2
            || call.messages[0].role != "system"
            || call.messages[0].content != experience::RESPONSE_PROMPT
            || call.max_output_bytes != elselife_algorithms::capacity::MAX_MODEL_OUTPUT_BYTES as u32
        {
            return Err("invalid model settings/messages".into());
        }
        let context = Context::decode(&env.payload).unwrap();
        let input: serde_json::Value = serde_json::from_str(&call.messages[1].content)?;
        if input != experience::narrative_input(&context).unwrap()
            || serde_json::from_str::<serde_json::Value>(&call.schema_json)?
                != experience::response_schema()
        {
            return Err("model context/schema drift".into());
        }
        println!("probe request.model frame={}", out.frame_id);
        Ok(())
    }
    fn model_result(call: &pb::Envelope, candidate: &str) -> pb::Envelope {
        pb::Envelope {
            protocol_version: call.protocol_version.clone(),
            frame_id: format!("{}:result", call.frame_id),
            correlation_frame_id: call.frame_id.clone(),
            conversation_id: call.conversation_id.clone(),
            turn_id: call.turn_id,
            event_seq: call.event_seq,
            sent_at: 123,
            r#type: "result.model".into(),
            content_type: "application/protobuf".into(),
            payload: pb::ModelCallResult {
                text: match serde_json::from_str::<serde_json::Value>(candidate) {
                    Ok(value) => serde_json::json!({"result": value}).to_string(),
                    Err(_) => candidate.into(),
                },
                error_code: "".into(),
            }
            .encode_to_vec(),
            ..Default::default()
        }
    }
    fn validate_decision(env: &pb::Envelope, out: &pb::Envelope) -> TestResult<()> {
        validate_scope(env, out)?;
        if out.r#type != "decision.experience"
            || out.frame_id != format!("{}:decision", env.frame_id)
            || out.content_type != "application/json"
        {
            return Err("expected experience decision".into());
        }
        let context = Context::decode(&env.payload).unwrap();
        Candidate::decode(&out.payload, &context)
            .map_err(|e| format!("invalid candidate {}", e.0))?;
        println!("probe decision.experience frame={}", out.frame_id);
        Ok(())
    }
    async fn old_frames(s: &mut Session, label: &str) -> TestResult<()> {
        for typ in [
            "request.route",
            "request.goal",
            "request.graph",
            "request.taskgraph",
            "request.verify",
            "request.direct",
            "request.summary",
            "event.execution",
            "result.context_read",
            "request.skill",
            "request.memory",
            "request.model",
        ] {
            for version in ["v0.2", experience::PROTOCOL_VERSION] {
                let mut old = env(&fixture_context(), &format!("old_{label}_{typ}_{version}"));
                old.r#type = typ.into();
                old.protocol_version = version.into();
                old.content_type = "application/protobuf".into();
                old.payload = b"legacy or malformed".to_vec();
                s.rejected(old).await?;
            }
        }
        Ok(())
    }
    /// Proves per-root callback isolation on the real wire: an unanswered slow root must not
    /// block an independent root, and a late reply must not restart or leak into the other root.
    async fn concurrency(addr: &str) -> TestResult<()> {
        let mut s = Session::connect(addr).await?;
        let c = fixture_context();
        let n = fixture_candidate();
        let slow = env(&c, "slow_root");
        s.tx.send(slow.clone()).await?;
        let slow_call = s.next().await?;
        validate_call(&slow, &slow_call)?;
        let fast = env(&c, "fast_root");
        s.tx.send(fast.clone()).await?;
        let fast_call = s.next().await?;
        validate_call(&fast, &fast_call)?;
        if fast_call.conversation_id != fast.conversation_id
            || fast_call.frame_id == slow_call.frame_id
        {
            return Err("fast root call borrowed the slow root scope".into());
        }
        s.tx.send(model_result(&fast_call, &n)).await?;
        let fast_decision = s.next().await?;
        validate_decision(&fast, &fast_decision)?;
        let mut canceled = model_result(&slow_call, &n);
        canceled.payload = pb::ModelCallResult {
            text: String::new(),
            error_code: "model_canceled".into(),
        }
        .encode_to_vec();
        s.tx.send(canceled).await?;
        let slow_out = s.next().await?;
        assert_failure(&slow, &slow_out)?;
        s.rejected(model_result(&slow_call, &n)).await?;
        println!(
            "probe_ok concurrency slow_root={} fast_root={} isolated_no_wait",
            slow.frame_id, fast.frame_id
        );
        Ok(())
    }
    #[tokio::main]
    pub async fn run() -> TestResult<()> {
        let addr = std::env::args()
            .nth(1)
            .ok_or("usage: algorithm-runtime-probe HOST:PORT")?;
        if addr == "--schema" {
            println!("{}", experience::candidate_schema());
            return Ok(());
        }
        if addr == "--concurrency" {
            let addr = std::env::args()
                .nth(2)
                .ok_or("--concurrency needs HOST:PORT")?;
            return concurrency(&addr).await;
        }
        let mut s = Session::connect(&addr).await?;
        let c = fixture_context();
        let n = fixture_candidate();
        old_frames(&mut s, "normal").await?;
        let opening_env = env(&c, "begin_refusal");
        let opening = s.exchange(opening_env.clone(), &n, None).await?;
        // Transport replay is byte exact; not a durable commit/idempotency assertion.
        s.tx.send(opening_env.clone()).await?;
        let replay = s.next().await?;
        if replay != opening {
            return Err("replay mismatch".into());
        }
        for field in [
            "version",
            "frame_id",
            "conversation",
            "turn",
            "event_seq",
            "content_type",
            "error",
            "cancel",
            "unavailable",
            "provider_error",
            "malformed",
            "facts",
        ] {
            s.exchange(env(&c, &format!("bad_{field}")), &n, Some(field))
                .await?;
            old_frames(&mut s, &format!("after_{field}")).await?;
        }
        // Invalid candidate must fail, never retry for desired outcome or use a legacy compiler.
        let mut bad = serde_json::from_str::<serde_json::Value>(&n)?;
        bad["new_facts"][0]["source_revision"] = serde_json::json!(0);
        s.tx.send(env(&c, "bad_candidate")).await?;
        let call = s.next().await?;
        validate_call(&env(&c, "bad_candidate"), &call)?;
        s.tx.send(model_result(&call, &bad.to_string())).await?;
        let failure = s.next().await?;
        assert_failure(&env(&c, "bad_candidate"), &failure)?;
        for issue in [
            "legacy_context",
            "unknown_budget",
            "capacity",
            "incomplete",
            "coordinate",
            "old_version",
        ] {
            let mut request = env(&c, issue);
            match issue {
                "legacy_context" => {
                    request.facts.as_mut().unwrap().source_context_json =
                        "{\"skill\":\"private-old\"}".into()
                }
                "unknown_budget" => request.facts.as_mut().unwrap().context_token_limit = 0,
                "capacity" => request.facts.as_mut().unwrap().context_token_limit = 4100,
                "incomplete" => {
                    let mut c = c.clone();
                    c.history_complete = false;
                    request.payload = serde_json::to_vec(&c)?;
                }
                "coordinate" => request.turn_id = 99,
                "old_version" => request.protocol_version = "v0.2".into(),
                _ => unreachable!(),
            }
            s.rejected(request).await?;
        }
        let first: Candidate = serde_json::from_str(&n)?;
        for mode in [Mode::Read, Mode::Ask, Mode::Act] {
            let mut c = c.clone();
            c.revision = 1;
            c.mode = mode;
            c.input = if mode == Mode::Read {
                "".into()
            } else {
                "我想了解他的拒绝。".into()
            };
            c.state.story_time = first.story_time.clone();
            c.state.facts = first.new_facts.clone();
            c.state.entities = first.new_entities.clone();
            c.history.push(Page {
                revision: 1,
                mode: Mode::Begin,
                input: "".into(),
                text: first.passage.clone(),
            });
            c.state_coverage.total = experience::StateCounts {
                facts: c.state.facts.len() as u64,
                entities: c.state.entities.len() as u64,
                threads: c.state.threads.len() as u64,
            };
            if mode == Mode::Ask {
                c.state_coverage.audience = experience::Audience::Reader;
            }
            let mut n = first.clone();
            n.new_facts.clear();
            n.new_entities.clear();
            n.passage = "你还不知道他为什么拒绝，柜台后的人等着你开口。".into();
            s.exchange(
                env(&c, &format!("mode_{mode:?}")),
                &serde_json::to_string(&n)?,
                None,
            )
            .await?;
        }
        // Stable hidden objects and full-state suffix survive the real transport and fork coordinates.
        let hidden = Context::decode(include_bytes!(
            "../../tests/fixtures/experience-hidden-suffix.json"
        ))
        .unwrap();
        let reveal = include_str!("../../tests/fixtures/experience-disclosure.json");
        let request = env(&hidden, "hidden_suffix_disclosure");
        let out = s.exchange(request, reveal, None).await?;
        let expected: serde_json::Value = serde_json::from_str(reveal)?;
        if serde_json::from_slice::<serde_json::Value>(&out.payload)? != expected {
            return Err("disclosure candidate changed in transit".into());
        }
        let mut fork = hidden.clone();
        fork.branch_id = "branch_fork".into();
        s.exchange(env(&fork, "fork_hidden_suffix"), reveal, None)
            .await?;
        let mut ask = hidden.clone();
        ask.mode = Mode::Ask;
        ask.input = "这是谁？".into();
        ask.state = experience::known_information(&ask.state);
        ask.state_coverage.total = experience::StateCounts::default();
        ask.state_coverage.audience = experience::Audience::Reader;
        ask.state_coverage.source_handle = "fixture_reader_operation".into();
        let mut answer = expected.clone();
        answer["story_time"] = serde_json::json!(ask.state.story_time);
        for field in ["reveal_fact_ids", "reveal_entity_ids", "reveal_thread_ids"] {
            let mut forbidden = answer.clone();
            for other in ["reveal_fact_ids", "reveal_entity_ids", "reveal_thread_ids"] {
                if field != other {
                    forbidden[other] = serde_json::json!([]);
                }
            }
            s.candidate_rejected(env(&ask, &format!("ask_{field}")), &forbidden.to_string())
                .await?;
        }
        for (field, invalid) in [
            ("reveal_entity_ids", "fixed_secret"),
            ("reveal_thread_ids", "npc_restorer"),
        ] {
            let mut bad = expected.clone();
            bad[field] = serde_json::json!([invalid]);
            s.candidate_rejected(
                env(&hidden, &format!("wrong_kind_{field}")),
                &bad.to_string(),
            )
            .await?;
        }
        for issue in ["gap", "tail", "begin", "empty_suffix"] {
            let mut bad = hidden.clone();
            match issue {
                "gap" => bad.history[0].revision = 1,
                "tail" => {
                    bad.history.pop();
                }
                "begin" => bad.history[0].mode = Mode::Begin,
                "empty_suffix" => bad.history.clear(),
                _ => unreachable!(),
            }
            s.rejected(env(&bad, &format!("bad_suffix_{issue}")))
                .await?;
        }
        // Reject old frames and wrong correlation while waiting; valid model result still owns its call.
        let request = env(&c, "during_generation");
        s.tx.send(request.clone()).await?;
        let call = s.next().await?;
        validate_call(&request, &call)?;
        let mut old = env(&c, "old_pending");
        old.r#type = "request.direct".into();
        s.rejected(old).await?;
        let mut unrelated = model_result(&call, &n);
        unrelated.correlation_frame_id = "other_call".into();
        s.rejected(unrelated).await?;
        s.tx.send(model_result(&call, &n)).await?;
        let decision = s.next().await?;
        validate_decision(&request, &decision)?;
        s.rejected(model_result(&call, &n)).await?; // late duplicate cannot restart anything
                                                    // Disconnect with a pending Generate. New stream must not inherit old waiter or legacy route.
        let disconnected = env(&c, "disconnect_pending");
        s.tx.send(disconnected.clone()).await?;
        let call = s.next().await?;
        validate_call(&disconnected, &call)?;
        drop(s);
        let mut s = Session::connect(&addr).await?;
        old_frames(&mut s, "reconnected").await?;
        s.rejected(model_result(&call, &n)).await?;
        s.exchange(env(&c, "after_disconnect"), &n, None).await?;
        println!("probe_ok experience_only addr={addr}; strict reverse fixtures, legacy normal/error/pending/replay/reconnect rejection; NOT provider quality");
        Ok(())
    }
}
