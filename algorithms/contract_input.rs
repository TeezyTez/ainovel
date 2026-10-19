//! Explicit build/test input authority: hash checked once, then compiled from owned bytes.
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const PROTO_SHA256: &str = include_str!(".sundries-sha256");
pub const SUNDRIES_REVISION: &str = include_str!(".sundries-revision");

#[derive(Debug)]
pub struct Input {
    pub origin: PathBuf,
    pub bytes: Vec<u8>,
}

pub fn validate(path: &Path) -> Result<Input, String> {
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("contract input must be a package-relative file path without traversal".into());
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let origin = root
        .join(path)
        .canonicalize()
        .map_err(|e| format!("contract input {}: {e}", path.display()))?;
    if !origin.starts_with(&root) {
        return Err("contract input must remain inside the package".into());
    }
    let bytes =
        std::fs::read(&origin).map_err(|e| format!("contract input {}: {e}", origin.display()))?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if hash != PROTO_SHA256.trim() {
        return Err(format!("contract input {}: SHA256 drift (expected {}, got {}); coordinate the input owner, never regenerate silently", origin.display(), PROTO_SHA256.trim(), hash));
    }
    Ok(Input { origin, bytes })
}

pub fn proto_file() -> Result<Input, String> {
    validate(Path::new("contracts/algorithm/v1/runtime.proto"))
}

pub fn snapshot(input: &Input, directory: &Path) -> Result<PathBuf, String> {
    // Compile from owned hash-checked bytes even if the origin changes after validation.
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let path = directory.join("runtime.proto");
    std::fs::write(&path, &input.bytes).map_err(|e| e.to_string())?;
    Ok(path)
}
