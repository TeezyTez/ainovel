"""Add the approved versioned memory-evidence shapes without rewriting v1.

This is a schema/pin updater, not a data migration or runtime feature switch.
Runtime protobuf bytes and historical source manifests are deliberately untouched.
"""
import argparse
import copy
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = (
    "contracts/experience/v1/contract.json",
    "algorithms/contracts/experience/v1/contract.json",
    "backend/internal/contract/source/experience/v1/contract.json",
    "frontend/contracts/experience/v1/contract.json",
)
PINS = (
    "algorithms/build.rs",
    "algorithms/src/experience.rs",
    "backend/internal/contract/source/experience/v1/contract.go",
)


def ref(name):
    return {"$ref": f"#/$defs/{name}"}


def closed(properties, optional=()):
    return {
        "type": "object", "additionalProperties": False,
        "required": [key for key in properties if key not in optional],
        "properties": properties,
    }


def build_contract(original):
    """Return a deterministic additive contract; never mutate caller input."""
    contract = copy.deepcopy(original)
    definitions = contract["$defs"]
    interpretation = copy.deepcopy(definitions["memory_change"])
    interpretation["required"].remove("quote")
    del interpretation["properties"]["quote"]
    interpretation["properties"]["locator_quote"] = {
        "type": "string", "minLength": 1, "maxLength": 2048,
    }
    definitions["memory_interpretation"] = interpretation
    definitions["memory_delta"] = closed({
        "version": {"const": 2},
        "entries": {"type": "array", "maxItems": 12, "items": ref("memory_interpretation")},
    })
    digest = {"type": "string", "minLength": 64, "maxLength": 64,
              "pattern": "^[0-9a-f]{64}$"}
    revision = {"type": "integer", "minimum": 1}
    definitions["memory_evidence_ref"] = {"oneOf": [
        closed({"kind": {"const": "formal_page"}, "revision": revision,
                "text_sha256": digest}),
        closed({"kind": {"const": "authority_fact"},
                "fact_id": {"type": "string", "minLength": 1, "maxLength": 128},
                "as_of_revision": revision, "record_sha256": digest}),
    ]}
    legacy = copy.deepcopy(definitions["memory_entry"])
    legacy["properties"]["evidence_kind"] = {"const": "legacy_v1"}
    legacy["required"].append("evidence_kind")
    sourced = copy.deepcopy(interpretation)
    sourced["properties"].update({
        "evidence_kind": {"const": "source_refs_v2"},
        "updated_revision": revision,
        "evidence_refs": {"type": "array", "minItems": 1, "uniqueItems": True,
                          "items": ref("memory_evidence_ref")},
        # The original v1 entry is retained once, never recursively wrapped.
        "legacy_entry": ref("memory_entry"),
    })
    sourced["required"].extend(["evidence_kind", "updated_revision", "evidence_refs"])
    definitions["memory_entry_v2"] = {"oneOf": [legacy, sourced]}
    definitions["literary_memory_v2"] = closed({
        "version": {"const": 2},
        "indexed_through_revision": {"type": "integer", "minimum": 0},
        "entries": {"type": "array", "items": ref("memory_entry_v2")},
    })
    # Keep the old material language intact. V2 separately describes available
    # locators and whether their exact source is loaded in this stage.
    material = {
        name: copy.deepcopy(interpretation["properties"][name])
        for name in ("id", "kind", "subject_ids", "target_ids", "cue", "status", "fact_ids")
    }
    material.update({
        "version": {"const": 2},
        "updated_revision": revision,
        "evidence_kind": {"enum": ["legacy_v1", "source_refs_v2"]},
        "source_count": {"type": "integer", "minimum": 0},
        "source_omitted": {"type": "integer", "minimum": 0},
        "source_directory": {
            "type": "array", "maxItems": 32,
            "items": closed({"ref": ref("memory_evidence_ref"), "loaded": {"type": "boolean"}}),
        },
        "locator_quote": copy.deepcopy(interpretation["properties"]["locator_quote"]),
    })
    definitions["memory_material_v2"] = {"oneOf": [
        closed({**material, "granularity": {"const": "cue"}}, optional=("locator_quote",)),
        closed({**material, "granularity": {"const": "summary"},
                "summary": copy.deepcopy(interpretation["properties"]["summary"])},
               optional=("locator_quote",)),
    ]}
    definitions["context_bundle"]["properties"]["memories"]["items"] = {
        "oneOf": [ref("memory_material"), ref("memory_material_v2")],
    }
    definitions["state"]["properties"]["literary_memory"] = {
        "oneOf": [ref("literary_memory"), ref("literary_memory_v2")],
    }
    candidate = definitions["candidate"]
    candidate["properties"]["memory_delta"] = ref("memory_delta")
    exclusive = {"not": {"required": ["memory_changes", "memory_delta"]}}
    constraints = candidate.setdefault("allOf", [])
    if exclusive not in constraints:
        constraints.append(exclusive)
    return contract


def update(root):
    root = Path(root)
    previous = (root / SNAPSHOTS[0]).read_bytes()
    old_hash = sha256(previous).hexdigest()
    # A pre-existing discrepancy must be investigated, not overwritten.
    for path in SNAPSHOTS[1:]:
        if (root / path).read_bytes() != previous:
            raise ValueError(f"contract snapshot drift: {path}")
    marker = root / "algorithms/.experience-sha256"
    if marker.read_text(encoding="utf-8").strip() != old_hash:
        raise ValueError("contract marker does not match source bytes")
    result = build_contract(json.loads(previous))
    encoded = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    new_hash = sha256(encoded).hexdigest()
    pin_updates = {}
    for relative in PINS:
        source = (root / relative).read_bytes()
        if old_hash.encode("ascii") not in source:
            raise ValueError(f"unknown contract pin: {relative}")
        pin_updates[relative] = source.replace(old_hash.encode("ascii"), new_hash.encode("ascii"))
    for relative in SNAPSHOTS:
        (root / relative).write_bytes(encoded)
    for relative, source in pin_updates.items():
        (root / relative).write_bytes(source)
    marker.write_text(new_hash + "\n", encoding="ascii")
    return old_hash, new_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    old, new = update(args.root)
    print(f"previous_experience_sha256={old}\nexperience_sha256={new}")


if __name__ == "__main__":
    main()
