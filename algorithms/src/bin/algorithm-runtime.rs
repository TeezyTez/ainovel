//! Experience-only RuntimeChannel listener. TLS/configuration identity stays in this executable; no legacy dispatcher.
#[cfg(feature = "channel")]
#[path = "../experience_channel.rs"]
mod experience_channel;

fn main() {
    #[cfg(not(feature = "channel"))]
    {
        eprintln!("algorithm-runtime requires --features channel");
        std::process::exit(2);
    }
    #[cfg(feature = "channel")]
    if let Err(e) = channel::listen() {
        eprintln!("algorithm-runtime: {e}");
        std::process::exit(1);
    }
}

#[cfg(feature = "channel")]
mod channel {
    use crate::experience_channel::{self as runtime, Failure};
    use elselife_algorithms::{
        capacity::{MAX_FRAME_BYTES, MAX_INFLIGHT_FRAMES},
        experience,
    };
    use prost::Message;
    use sha2::{Digest, Sha256};
    use std::{
        collections::{HashMap, VecDeque},
        net::SocketAddr,
        sync::{Arc, Mutex},
    };
    use tokio::sync::{mpsc, Semaphore};
    use tokio_stream::wrappers::ReceiverStream;
    use tonic::{
        transport::{Identity, Server, ServerTlsConfig},
        Request, Response, Status, Streaming,
    };

    pub mod pb {
        tonic::include_proto!("telos.algorithm.v1");
    }
    struct Cfg {
        addr: SocketAddr,
        plaintext: bool,
        cert: Option<String>,
        key: Option<String>,
        client_ca: Option<String>,
    }
    fn parse_cfg() -> Result<Cfg, String> {
        let mut listen = None;
        let mut plaintext = false;
        let mut args = std::env::args().skip(1);
        while let Some(a) = args.next() {
            if a == "--insecure-plaintext" {
                plaintext = true;
            } else if let Some(v) = a.strip_prefix("--listen=") {
                listen = Some(v.to_string());
            } else if a == "--listen" {
                listen = Some(args.next().ok_or("missing --listen value")?);
            } else {
                return Err(format!("unknown argument {a}; algorithm-runtime --listen HOST:PORT [--insecure-plaintext]"));
            }
        }
        if listen.is_none() {
            listen = std::env::var("ELSELIFE_ALGORITHM_ADDR").ok();
        }
        if std::env::var("ELSELIFE_ALGORITHM_INSECURE_PLAINTEXT")
            .ok()
            .as_deref()
            == Some("1")
        {
            plaintext = true;
        }
        let addr_s = listen.ok_or("missing --listen or ELSELIFE_ALGORITHM_ADDR")?;
        let addr: SocketAddr = addr_s
            .parse()
            .map_err(|_| format!("invalid explicit listen address {addr_s}"))?;
        if !addr.ip().is_loopback() {
            return Err(
                "explicit loopback listener required; no non-loopback override is supported".into(),
            );
        }
        Ok(Cfg {
            addr,
            plaintext,
            cert: std::env::var("ELSELIFE_ALGORITHM_CERT")
                .ok()
                .filter(|s| !s.is_empty()),
            key: std::env::var("ELSELIFE_ALGORITHM_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            client_ca: std::env::var("ELSELIFE_ALGORITHM_CLIENT_CA")
                .ok()
                .filter(|s| !s.is_empty()),
        })
    }
    fn replay_key(env: &pb::Envelope) -> [u8; 32] {
        Sha256::digest(env.encode_to_vec()).into()
    }
    const REPLAY_CAP: usize = 10_000;
    struct Replay {
        map: HashMap<[u8; 32], pb::Envelope>,
        order: VecDeque<[u8; 32]>,
    }
    impl Replay {
        fn new() -> Self {
            Self {
                map: HashMap::new(),
                order: VecDeque::new(),
            }
        }
        fn put(&mut self, key: [u8; 32], value: pb::Envelope) {
            if self.map.contains_key(&key) {
                return;
            }
            while self.order.len() >= REPLAY_CAP {
                if let Some(key) = self.order.pop_front() {
                    self.map.remove(&key);
                }
            }
            self.map.insert(key, value);
            self.order.push_back(key);
        }
    }
    struct Svc {
        inflight: Arc<Semaphore>,
        replay: Arc<Mutex<Replay>>,
    }
    // Only dispatch keys; callback payload/scope/sequence still go through the operation's typed gate.
    fn callback_root(env: &pb::Envelope) -> Option<&str> {
        let (prefix, number) = env.correlation_frame_id.rsplit_once(':')?;
        if number.parse::<u64>().ok().filter(|n| *n > 0).is_none() {
            return None;
        }
        let (root, kind) = prefix.rsplit_once(':')?;
        if matches!(
            (env.r#type.as_str(), kind),
            ("result.model", "model")
                | ("result.experience_read", "read")
                | ("result.frame", "model" | "read")
        ) {
            Some(root)
        } else {
            None
        }
    }
    #[tonic::async_trait]
    impl pb::runtime_channel_server::RuntimeChannel for Svc {
        type ConnectStream = ReceiverStream<Result<pb::Envelope, Status>>;
        async fn connect(
            &self,
            request: Request<Streaming<pb::Envelope>>,
        ) -> Result<Response<Self::ConnectStream>, Status> {
            let mut inbound = request.into_inner();
            let (tx, rx) = mpsc::channel(MAX_INFLIGHT_FRAMES);
            let inflight = self.inflight.clone();
            let replay = self.replay.clone();
            tokio::spawn(async move {
                let active: Arc<Mutex<HashMap<String, mpsc::Sender<pb::Envelope>>>> =
                    Arc::new(Mutex::new(HashMap::new()));
                loop {
                    let env = tokio::select! {
                        _ = tx.closed() => break,
                        frame = inbound.message() => match frame {
                            Ok(Some(env)) => env, Ok(None) => break,
                            Err(error) => { let _ = tx.send(Err(error)).await; break; }
                        }
                    };
                    if env.r#type != "request.experience" {
                        let owner = callback_root(&env).unwrap_or(&env.correlation_frame_id);
                        let callback = active.lock().ok().and_then(|a| a.get(owner).cloned());
                        if let Some(callback) = callback {
                            if callback.try_send(env.clone()).is_ok() {
                                continue;
                            }
                        }
                        let fail = Failure {
                            code: pb::FrameFailureCode::InvalidContext,
                            reason: "unexpected_or_late_callback",
                        };
                        if tx
                            .send(Ok(runtime::failure_frame(&env, fail)))
                            .await
                            .is_err()
                        {
                            break;
                        }
                        continue;
                    }
                    // Entry validation runs BEFORE cache/admission; no cached legacy decision can bypass it.
                    if let Err(fail) = runtime::validate_request(&env) {
                        if tx
                            .send(Ok(runtime::failure_frame(&env, fail)))
                            .await
                            .is_err()
                        {
                            break;
                        }
                        continue;
                    }
                    let key = replay_key(&env);
                    let cached = replay.lock().ok().and_then(|g| g.map.get(&key).cloned());
                    if let Some(cached) = cached {
                        if tx.send(Ok(cached)).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    let duplicate = active
                        .lock()
                        .map(|a| a.contains_key(&env.frame_id))
                        .unwrap_or(true);
                    if duplicate {
                        let fail = Failure {
                            code: pb::FrameFailureCode::Precondition,
                            reason: "operation_inflight",
                        };
                        if tx
                            .send(Ok(runtime::failure_frame(&env, fail)))
                            .await
                            .is_err()
                        {
                            break;
                        }
                        continue;
                    }
                    let permit = match inflight.clone().try_acquire_owned() {
                        Ok(permit) => permit,
                        Err(_) => {
                            let fail = Failure {
                                code: pb::FrameFailureCode::Capacity,
                                reason: "MAX_INFLIGHT_FRAMES",
                            };
                            if tx
                                .send(Ok(runtime::failure_frame(&env, fail)))
                                .await
                                .is_err()
                            {
                                break;
                            }
                            continue;
                        }
                    };
                    let (callback, mut receiver) = mpsc::channel(MAX_INFLIGHT_FRAMES);
                    active
                        .lock()
                        .unwrap()
                        .insert(env.frame_id.clone(), callback);
                    let active = active.clone();
                    let tx = tx.clone();
                    let replay = replay.clone();
                    tokio::spawn(async move {
                        let started = std::time::Instant::now();
                        let out = match runtime::generate(&env, &mut receiver, &tx).await {
                            Ok(out) => {
                                if let Ok(mut cache) = replay.lock() {
                                    cache.put(key, out.clone());
                                }
                                out
                            }
                            Err(fail) => runtime::failure_frame(&env, fail),
                        };
                        active.lock().unwrap().remove(&env.frame_id);
                        drop(permit);
                        eprintln!(
                            "{}",
                            serde_json::json!({"event":"experience_reply", "frame_id":env.frame_id,
                            "conversation_id":env.conversation_id, "turn_id":env.turn_id, "type":out.r#type,
                            "duration_ms":started.elapsed().as_millis(), "prompt_version":experience::PROMPT_VERSION,
                            "contract_sha256":experience::CONTRACT_SHA256})
                        );
                        let _ = tx.send(Ok(out)).await;
                    });
                }
                // Stream EOF releases every per-root receiver, even when the output stream still exists.
                active.lock().unwrap().clear();
            });
            Ok(Response::new(ReceiverStream::new(rx)))
        }
    }
    async fn shutdown_signal() {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("sigterm");
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
    #[tokio::main]
    pub async fn listen() -> Result<(), Box<dyn std::error::Error>> {
        let cfg = parse_cfg()?;
        let tls = if cfg.plaintext {
            None
        } else {
            let cert = cfg
                .cert
                .ok_or("production requires ELSELIFE_ALGORITHM_CERT")?;
            let key = cfg
                .key
                .ok_or("production requires ELSELIFE_ALGORITHM_KEY")?;
            let ca = cfg
                .client_ca
                .ok_or("production requires ELSELIFE_ALGORITHM_CLIENT_CA")?;
            Some(
                ServerTlsConfig::new()
                    .identity(Identity::from_pem(
                        std::fs::read(cert)?,
                        std::fs::read(key)?,
                    ))
                    .client_ca_root(tonic::transport::Certificate::from_pem(std::fs::read(ca)?)),
            )
        };
        let svc = pb::runtime_channel_server::RuntimeChannelServer::new(Svc {
            inflight: Arc::new(Semaphore::new(MAX_INFLIGHT_FRAMES)),
            replay: Arc::new(Mutex::new(Replay::new())),
        })
        .max_decoding_message_size(MAX_FRAME_BYTES)
        .max_encoding_message_size(MAX_FRAME_BYTES);
        let listener = tokio::net::TcpListener::bind(cfg.addr).await?;
        let bound = listener.local_addr()?;
        let mut server = Server::builder();
        if let Some(tls) = tls {
            server = server.tls_config(tls)?;
        }
        println!("listening {bound}");
        let _ = std::io::Write::flush(&mut std::io::stdout());
        eprintln!(
            "{}",
            serde_json::json!({"event":"listen_ready", "addr":bound.to_string(), "protocol_version":experience::PROTOCOL_VERSION})
        );
        server
            .add_service(svc)
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(listener),
                shutdown_signal(),
            )
            .await?;
        Ok(())
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn replay_covers_branch_payload_and_full_scope() {
            let env = pb::Envelope {
                frame_id: "a".into(),
                payload: b"branch_a".to_vec(),
                ..Default::default()
            };
            for changed in [
                pb::Envelope {
                    payload: b"branch_b".to_vec(),
                    ..env.clone()
                },
                pb::Envelope {
                    conversation_id: "other".into(),
                    ..env.clone()
                },
                pb::Envelope {
                    turn_id: 1,
                    ..env.clone()
                },
            ] {
                assert_ne!(replay_key(&env), replay_key(&changed));
            }
            assert_eq!(replay_key(&env), replay_key(&env));
        }
    }
}
