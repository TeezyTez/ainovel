mod contract_input;

fn check_experience_contract() {
    use sha2::{Digest, Sha256};
    let path = "contracts/experience/v1/contract.json";
    println!("cargo:rerun-if-changed={path}");
    println!("cargo:rerun-if-changed=.experience-sha256");
    println!("cargo:rerun-if-changed=.experience-revision");
    let digest = format!(
        "{:x}",
        Sha256::digest(std::fs::read(path).expect("pinned experience contract"))
    );
    assert_eq!(
        digest,
        include_str!(".experience-sha256").trim(),
        "experience contract drift"
    );
    assert_eq!(
        include_str!(".experience-sha256").trim(),
        "44f536fc3f4949e7ece9580fee0c3f3178149465df3840e342ecbb0a84cd0a21",
        "experience source digest drift"
    );
    assert_eq!(
        include_str!(".experience-revision").trim(),
        "685758b9009c647f0b6b0da2dbe1769ea6964a71",
        "experience source revision drift"
    );
}

fn main() {
    check_experience_contract();
    println!("cargo:rerun-if-changed=contracts/algorithm/v1/runtime.proto");
    println!("cargo:rerun-if-changed=.sundries-sha256");
    println!("cargo:rerun-if-changed=.sundries-revision");
    println!("cargo:rerun-if-changed=contract_input.rs");
    let input = contract_input::proto_file().unwrap_or_else(|e| panic!("{e}"));
    // Export package identity, not the absolute checkout used by a cached build script.
    println!("cargo:rustc-env=ELSELIFE_COMPILED_PROTO=contracts/algorithm/v1/runtime.proto");
    println!(
        "cargo:warning=contract {} sha256 {} (sundries revision {})",
        input.origin.display(),
        contract_input::PROTO_SHA256.trim(),
        contract_input::SUNDRIES_REVISION.trim()
    );
    println!("cargo:rerun-if-changed={}", input.origin.display());
    let directory = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"))
        .join("contract-input");
    let proto =
        contract_input::snapshot(&input, &directory).expect("private contract input snapshot");
    compile_prost(&proto);
    #[cfg(feature = "channel")]
    compile_tonic(&proto);
}

fn include_dir(proto: &std::path::Path) -> std::path::PathBuf {
    proto.parent().expect("runtime.proto parent").to_path_buf()
}

fn compile_prost(proto: &std::path::Path) {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("prost");
    std::fs::create_dir_all(&out).expect("prost out dir");
    let inc = include_dir(proto);
    prost_build::Config::new()
        .out_dir(&out)
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&[proto], &[&inc])
        .unwrap_or_else(|e| panic!("prost compile {}: {e}", proto.display()));
}

#[cfg(feature = "channel")]
fn compile_tonic(proto: &std::path::Path) {
    let inc = include_dir(proto);
    tonic_build::configure()
        .build_client(true)
        // proto RPC 名是 `Connect`，与 tonic 为客户端生成的 `connect(dst)` 传输辅助函数
        // 在同一个 impl 上重名（E0592）。关掉传输辅助，保留真正的 RPC `connect` 方法。
        .build_transport(false)
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&[proto], &[&inc])
        .unwrap_or_else(|e| panic!("tonic compile {}: {e}", proto.display()));
}
