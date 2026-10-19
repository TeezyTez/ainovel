#!/usr/bin/env python3
"""Verify the received source snapshot, its contracts, and excluded material.

This is an export-integrity check, not a release or product-quality acceptance.
After intentional edits the original manifest is expected to stop matching.
"""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "SOURCE_MANIFEST.json"
EXCLUDED_DIRS = {".git", ".dart_tool", "build", "target", "node_modules", "__pycache__", ".venv"}
EXCLUDED_PARTS = {"billing", "payment", "commerce", "staff", "admin", "account", "identity"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    issues = []
    if not MANIFEST.is_file():
        print("FAIL: SOURCE_MANIFEST.json is missing", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected = manifest["files"]
    actual = {}
    for path in sorted(ROOT.rglob("*")):
        rel = path.relative_to(ROOT)
        # Build output produced by the recipient is not source. It is ignored
        # here, but the distributed archive must not contain it (see manifest).
        if any(p in EXCLUDED_DIRS for p in rel.parts):
            continue
        if path.is_symlink():
            issues.append(f"symlink is not a portable source input: {rel}")
            continue
        if not path.is_file() or str(rel) == MANIFEST.name:
            continue
        if path.name == ".env" or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".dump"}:
            issues.append(f"private/runtime file: {rel}")
        if any(p in EXCLUDED_PARTS for p in rel.parts):
            issues.append(f"excluded business directory: {rel}")
        actual[rel.as_posix()] = sha(path)
    for rel, row in expected.items():
        if rel not in actual:
            issues.append(f"missing source file: {rel}")
        elif actual[rel] != row["sha256"]:
            issues.append(f"modified source file: {rel}")
    for rel in actual.keys() - expected.keys():
        issues.append(f"unlisted source file: {rel}")
    pins = json.loads((ROOT / "SOURCE_REVISIONS.json").read_text(encoding="utf-8"))
    for key in ("experience_contract", "runtime_proto"):
        pin = pins[key]
        path = ROOT / pin["path"]
        if not path.is_file() or sha(path) != pin["sha256"]:
            issues.append(f"pinned input drift: {key}")
    contract = pins["experience_contract"]
    for rel in (
        "algorithms/contracts/experience/v1/contract.json",
        "backend/internal/contract/source/experience/v1/contract.json",
        "frontend/contracts/experience/v1/contract.json",
    ):
        path = ROOT / rel
        if not path.is_file() or sha(path) != contract["sha256"]:
            issues.append(f"consumer contract drift: {rel}")
    if issues:
        for issue in issues:
            print("FAIL:", issue, file=sys.stderr)
        return 1
    print(f"PASS: {len(expected)} source files; contract bytes agree; no excluded business directories or private files")
    print("This checks the source snapshot only; it does not certify generated story quality or production deployment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
