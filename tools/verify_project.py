#!/usr/bin/env python3
"""Check the active project boundary and byte-identical shared contracts."""

from hashlib import sha256
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    issues = []
    required = (
        "frontend/pubspec.yaml", "frontend/lib/main.dart",
        "backend/go.mod", "backend/cmd/product-dev/main.go",
        "algorithms/Cargo.toml", "algorithms/src/bin/algorithm-runtime.rs",
        "tools/start-local.ps1", "tools/start-local.sh",
        "tools/artifact-compiler/package-lock.json",
    )
    for relative in required:
        if not (ROOT / relative).is_file():
            issues.append(f"missing project entry: {relative}")
    for relative in ("demo-source", "server.mjs", "package.json", "src",
                     "tools/start-local-demo.ps1", "tools/start-local-demo.sh"):
        if (ROOT / relative).exists():
            issues.append(f"legacy application remains: {relative}")
    groups = (
        ("contracts/experience/v1/contract.json",
         "algorithms/contracts/experience/v1/contract.json",
         "backend/internal/contract/source/experience/v1/contract.json",
         "frontend/contracts/experience/v1/contract.json"),
        ("contracts/algorithm/v1/runtime.proto",
         "algorithms/contracts/algorithm/v1/runtime.proto",
         "backend/internal/contract/source/algorithm/v1/runtime.proto"),
    )
    for group in groups:
        canonical = ROOT / group[0]
        if not canonical.is_file():
            issues.append(f"missing contract: {group[0]}")
            continue
        expected = canonical.read_bytes()
        for relative in group[1:]:
            path = ROOT / relative
            if not path.is_file() or path.read_bytes() != expected:
                issues.append(f"contract snapshot differs: {relative}")
    contract = ROOT / groups[0][0]
    pin = ROOT / "algorithms/.experience-sha256"
    if not pin.is_file() or not contract.is_file() or pin.read_text().strip() != sha256(contract.read_bytes()).hexdigest():
        issues.append("Rust experience contract hash differs")
    if issues:
        print("\n".join(f"FAIL: {issue}" for issue in issues), file=sys.stderr)
        return 1
    print("PASS: formal project entries, shared contracts, Rust pin and legacy application removal")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
