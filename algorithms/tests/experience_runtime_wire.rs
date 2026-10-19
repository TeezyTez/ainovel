//! Official composition test uses this build's runtime/probe, not the historical compiler executable.
#![cfg(feature = "channel")]
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    time::Duration,
};
struct Runtime(Child);
impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
fn official_runtime_accepts_experience_and_rejects_legacy_before_after_and_during_errors() {
    let mut process = Runtime(
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
    let endpoint = banner.strip_prefix("listening ").unwrap().trim();
    let result = Command::new(env!("CARGO_BIN_EXE_algorithm-runtime-probe"))
        .arg(endpoint)
        .output()
        .unwrap();
    let stdout = String::from_utf8(result.stdout).unwrap();
    let stderr = String::from_utf8(result.stderr).unwrap();
    assert!(result.status.success(), "{stdout}\n{stderr}");
    for marker in [
        "probe_ok experience_only",
        "begin_refusal:decision",
        "mode_Read:decision",
        "mode_Ask:decision",
        "mode_Act:decision",
        "hidden_suffix_disclosure:decision",
        "fork_hidden_suffix:decision",
        "ask_reveal_entity_ids",
        "ask_reveal_thread_ids",
        "ask_changes_world",
        "bad_suffix_gap",
        "old_pending",
        "after_disconnect:decision",
        "model_result_coordinates_mismatch",
        "new_fact_revision_mismatch",
        "context_budget_exceeded",
        "legacy_runtime_context_rejected",
    ] {
        assert!(stdout.contains(marker), "missing {marker}: {stdout}");
    }
    assert!(stdout.matches("probe rejected ").count() > 250, "{stdout}");
}
#[test]
fn slow_root_callback_does_not_block_an_independent_root_on_the_same_channel() {
    let mut process = Runtime(
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
    let endpoint = banner.strip_prefix("listening ").unwrap().trim();
    let result = Command::new(env!("CARGO_BIN_EXE_algorithm-runtime-probe"))
        .args(["--concurrency", endpoint])
        .output()
        .unwrap();
    let stdout = String::from_utf8(result.stdout).unwrap();
    let stderr = String::from_utf8(result.stderr).unwrap();
    assert!(result.status.success(), "{stdout}\n{stderr}");
    for marker in [
        "probe_ok concurrency",
        "slow_root:model:1",
        "fast_root:model:1",
        "fast_root:decision",
        "reason=model_canceled",
        "unexpected_or_late_callback",
    ] {
        assert!(stdout.contains(marker), "missing {marker}: {stdout}");
    }
    assert_eq!(
        stdout.matches("reason=model_canceled").count(),
        1,
        "slow-root cancel must terminate exactly its own operation: {stdout}"
    );
}
