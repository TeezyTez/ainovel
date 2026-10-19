//! No-channel official binary rejects startup rather than reaching any historical compiler.
#[cfg(not(feature = "channel"))]
#[test]
fn official_runtime_without_channel_is_fail_closed() {
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_algorithm-runtime"))
        .args(["--listen", "127.0.0.1:0", "--insecure-plaintext"])
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    assert!(result.stdout.is_empty());
    assert!(String::from_utf8(result.stderr)
        .unwrap()
        .contains("channel"));
}
