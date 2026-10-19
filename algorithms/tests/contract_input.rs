//! Standalone package contract wiring: exact pins, confined paths and owned snapshots.
#[path = "../contract_input.rs"]
mod contract_input;
use std::path::Path;

#[test]
fn packaged_proto_is_the_compiled_pin() {
    let input = contract_input::proto_file().unwrap();
    let compiled = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(env!("ELSELIFE_COMPILED_PROTO"))
        .canonicalize()
        .unwrap();
    assert_eq!(input.origin, compiled);
    assert_eq!(
        contract_input::SUNDRIES_REVISION.trim(),
        "060671c11d0cd67260f68352d05348accb2f0622"
    );
    assert_eq!(
        contract_input::PROTO_SHA256.trim(),
        "4a7f66d6e1f5be0fe974388aaff6a275014761cfd23a01bd20ef5c99c2587646"
    );
}

#[test]
fn missing_absolute_traversal_and_drift_are_rejected() {
    for path in ["runtime.proto", "/nonexistent", "../runtime.proto"] {
        assert!(contract_input::validate(Path::new(path)).is_err());
    }
    assert!(contract_input::validate(Path::new("Cargo.toml"))
        .unwrap_err()
        .contains("SHA256 drift"));
}

#[test]
fn snapshot_preserves_validated_bytes() {
    let input = contract_input::proto_file().unwrap();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".contract-input-test");
    let snapshot = contract_input::snapshot(&input, &dir).unwrap();
    assert_eq!(std::fs::read(&snapshot).unwrap(), input.bytes);
    std::fs::remove_dir_all(dir).unwrap();
}
