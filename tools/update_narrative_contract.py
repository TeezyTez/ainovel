"""Apply additive narrative and literary-memory boundaries and pin all snapshots.

Original export revisions/manifests remain historical provenance. This tool must
only be run for this reviewed contract change; it does not weaken drift checks.
"""
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def text(limit=2048, minimum=0):
    return {"type": "string", "minLength": minimum, "maxLength": limit}


def integer(maximum=None, minimum=0):
    result = {"type": "integer", "minimum": minimum}
    if maximum is not None:
        result["maximum"] = maximum
    return result


def array(item, maximum, unique=False):
    result = {"type": "array", "items": item, "maxItems": maximum}
    if unique:
        result["uniqueItems"] = True
    return result


def obj(fields):
    return {"type": "object", "additionalProperties": False,
            "required": list(fields), "properties": fields}


def ref(name):
    return {"$ref": f"#/$defs/{name}"}


def replace_digest(relative, old, new):
    path = ROOT / relative
    source = path.read_text(encoding="utf-8")
    if old not in source and new not in source:
        raise RuntimeError(f"unrecognized pin in {relative}")
    path.write_text(source.replace(old, new), encoding="utf-8", newline="\n")


def main():
    path = ROOT / "contracts/experience/v1/contract.json"
    original = path.read_bytes()
    old_hash = sha256(original).hexdigest()
    contract = json.loads(original)
    definitions = contract["$defs"]
    ids = array(text(256, 1), 64, True)
    definitions["pipeline_config"] = obj({
        "version": {"const": 1}, "max_actors": integer(2), "max_repairs": integer(1),
    })
    definitions["narrative_episode"] = obj({
        "id": text(256, 1), "summary": text(4096, 1),
        "from_revision": integer(), "to_revision": integer(), "fact_ids": ids,
    })
    definitions["narrative_relationship"] = obj({
        "entity_id": text(256, 1), "stance": text(1024, 1), "fact_ids": ids,
    })
    definitions["narrative_character"] = obj({
        "entity_id": text(256, 1), "goals": array(text(1024, 1), 4),
        "relationships": array(ref("narrative_relationship"), 8),
        "voice": text(2048), "belief_fact_ids": ids, "updated_revision": integer(),
    })
    definitions["narrative_arc"] = obj({
        "thread_id": text(256, 1), "status": {"enum": ["open", "resolved", "abandoned"]},
        "tension": integer(5), "next_beats": array(text(1024, 1), 3),
        "payoff_conditions": array(text(1024, 1), 4), "fact_ids": ids,
        "updated_revision": integer(),
    })
    definitions["narrative_style"] = obj({
        "voice": text(2048), "perspective": text(256),
        "pace": {"enum": ["slow", "balanced", "fast"]},
        "detail": {"enum": ["brief", "balanced", "rich"]},
        "avoid": array(text(512, 1), 8), "preference_refs": array(text(128, 1), 16, True),
    })
    definitions["narrative_state"] = obj({
        "version": {"const": 1}, "through_revision": integer(),
        "episodes": array(ref("narrative_episode"), 8),
        "characters": array(ref("narrative_character"), 16),
        "arcs": array(ref("narrative_arc"), 16), "style": ref("narrative_style"),
    })
    memory_ids = array(text(128, 1), 8, True)
    memory_subject_ids = dict(memory_ids, minItems=1)
    memory_fields = {
        "id": text(128, 1),
        "kind": {"enum": ["disposition", "goal", "relationship", "episode",
                          "commitment", "expression", "object", "thread"]},
        "subject_ids": memory_subject_ids, "target_ids": memory_ids,
        "cue": text(256, 1), "summary": text(2048, 1),
        "status": {"enum": ["active", "resolved", "revised"]},
        "retrieval_keys": array(text(128, 1), 12, True),
        "fact_ids": array(text(128, 1), 64, True),
        "quote": text(2048, 1),
    }
    definitions["memory_change"] = obj(memory_fields)
    definitions["memory_entry"] = obj({
        **memory_fields,
        "source_revision": integer(minimum=1),
        "source_sha256": text(64, 64),
        "updated_revision": integer(minimum=1),
    })
    definitions["memory_source"] = obj({
        "revision": integer(minimum=1), "sha256": text(64, 64), "quote": text(2048, 1),
    })
    definitions["memory_entry"]["properties"]["prior_sources"] = {
        "type": "array", "items": ref("memory_source"),
    }
    definitions["literary_memory"] = obj({
        "version": {"const": 1}, "indexed_through_revision": integer(),
        # Storage is not a prompt budget: entries are selected at read time.
        "entries": {"type": "array", "items": ref("memory_entry")},
    })
    definitions["context_needs"] = obj({
        "participant_ids": array(text(128, 1), 8, True),
        "relationship_targets": array(text(128, 1), 8, True),
        "topics": array(text(128, 1), 8, True),
        "open_questions": array(text(256, 1), 8, True),
        "fact_ids": array(text(128, 1), 32, True),
    })
    needs_properties = definitions["context_needs"]["properties"]
    needs_properties["participant_ids"]["description"] = (
        "Existing entity IDs relevant to this scene, not display names."
    )
    needs_properties["relationship_targets"]["description"] = (
        "Existing entity IDs for relationship counterparts, not names or relationship "
        "descriptions. Put natural-language relationship descriptions in topics."
    )
    needs_properties["topics"]["description"] = "Natural-language retrieval topics and relationship descriptions."
    needs_properties["fact_ids"]["description"] = "Existing fact IDs needed for this scene."
    definitions["actor_material_fact"] = obj({
        "id": text(128, 1), "kind": {"enum": ["fact", "rule", "secret", "statement", "belief"]},
        "text": text(131072, 1), "subject_id": text(128),
        "source_revision": integer(),
    })
    definitions["material_coverage"] = obj({
        "scope": text(128, 1), "matched": integer(), "returned": integer(),
        "budget_omitted": integer(), "unqueried": array(text(512, 1), 32),
        "uncertain": array(text(512, 1), 32), "history_complete": {"const": False},
    })
    definitions["material_coverage"]["properties"]["indexed_through_revision"] = integer()
    material_fields = {
        name: schema for name, schema in definitions["memory_entry"]["properties"].items()
        if name not in ("summary", "quote", "retrieval_keys", "prior_sources")
    }
    # Selection may reduce reading granularity but never truncate a sentence.
    # Stored entries retain the complete interpretation and source quote.
    definitions["memory_material"] = {"oneOf": [
        obj({**material_fields, "granularity": {"const": "cue"},
             "requires_source": {"const": True}}),
        obj({**material_fields, "granularity": {"const": "summary"},
             "requires_source": {"type": "boolean"}, "summary": text(2048, 1)}),
        obj({**material_fields, "granularity": {"const": "source"},
             "requires_source": {"type": "boolean"}, "summary": text(2048, 1),
             "quote": text(2048, 1)}),
    ]}
    for material in definitions["memory_material"]["oneOf"]:
        material["properties"]["prior_source_count"] = {
            **integer(), "description": "Total older sources in this stored entry. Selected locators and quotes may cover only a subset.",
        }
        material["properties"]["prior_source_revisions"] = {
            **array(integer(minimum=1), 32, True),
            "description": "Bounded original-page locators selected for this material; not an assertion that all older sources are listed.",
        }
        material["dependentRequired"] = {"prior_source_revisions": ["prior_source_count"]}
    definitions["memory_material"]["oneOf"][2]["properties"]["prior_sources"] = {
        "type": "array", "items": ref("memory_source"), "maxItems": 32,
        "description": "Selected exact older quotes, each also listed in prior_source_revisions. requires_source remains true when any stored original quote is omitted.",
    }
    definitions["memory_material"]["oneOf"][2]["dependentRequired"]["prior_sources"] = [
        "prior_source_count", "prior_source_revisions",
    ]
    definitions["context_bundle"] = obj({
        "stage": {"enum": ["memory", "actor", "plan", "evaluate", "write", "extract", "repair_extract", "review", "repair_review", "revise", "answer"]},
        "base_revision": integer(), "coverage": ref("material_coverage"),
    })
    definitions["context_bundle"]["properties"].update({
        "actor_id": text(128, 1),
        "facts": {"type": "array", "items": ref("fact")},
        "actor_facts": {"type": "array", "items": ref("actor_material_fact")},
        "memories": {"type": "array", "items": ref("memory_material")},
        "legacy_characters": {"type": "array", "items": ref("narrative_character")},
        "legacy_episodes": {"type": "array", "items": ref("narrative_episode")},
        "legacy_arcs": {"type": "array", "items": ref("narrative_arc")},
    })
    definitions["state"]["properties"]["narrative"] = ref("narrative_state")
    definitions["state"]["properties"]["literary_memory"] = ref("literary_memory")
    definitions["candidate"]["properties"]["narrative_update"] = ref("narrative_state")
    definitions["candidate"]["properties"]["memory_changes"] = array(ref("memory_change"), 12)
    definitions["context"]["properties"]["pipeline"] = ref("pipeline_config")
    definitions["context"]["properties"]["reading_request"] = text(4096)
    policies = definitions["context"]["properties"]["state_coverage"]["properties"]["policy"]["enum"]
    if "stage-scene-selection.v1" not in policies:
        policies.append("stage-scene-selection.v1")
    definitions["context"]["properties"]["state_coverage"]["properties"]["recent_from_revision"]["description"] = (
        "Lowest revision whose newly introduced facts/entities are mandatory roots under "
        "rules-secrets-open-recent-closure.v1; 0 for full.v1 or stage-scene-selection.v1. "
        "Scene selection does not promise inclusion of every recent object.")
    data = (json.dumps(contract, ensure_ascii=False, indent=2) + "\n").encode()
    for relative in ("contracts/experience/v1/contract.json",
                     "algorithms/contracts/experience/v1/contract.json",
                     "backend/internal/contract/source/experience/v1/contract.json",
                     "frontend/contracts/experience/v1/contract.json"):
        (ROOT / relative).write_bytes(data)
    new_hash = sha256(data).hexdigest()
    for relative in ("algorithms/build.rs", "algorithms/src/experience.rs",
                     "backend/internal/contract/source/experience/v1/contract.go"):
        replace_digest(relative, old_hash, new_hash)
    (ROOT / "algorithms/.experience-sha256").write_text(new_hash + "\n")

    path = ROOT / "contracts/algorithm/v1/runtime.proto"
    original = path.read_bytes()
    old_proto = sha256(original).hexdigest()
    source = original.decode().replace("\r\n", "\n")
    if "string narrative_stage = 5;" not in source:
        pattern = r"(message ModelCallRequest \{[\s\S]*?)(\n\})"
        addition = ("\n  // ElseLife v4 only: Go validates stage order and actor-scoped access."
                    "\n  string narrative_stage = 5;"
                    "\n  string narrative_actor_id = 6;")
        source, count = re.subn(pattern, lambda m: m[1] + addition + m[2], source, count=1)
        if count != 1:
            raise RuntimeError("ModelCallRequest not found")
    data = source.encode()
    for relative in ("contracts/algorithm/v1/runtime.proto",
                     "algorithms/contracts/algorithm/v1/runtime.proto",
                     "backend/internal/contract/source/algorithm/v1/runtime.proto"):
        (ROOT / relative).write_bytes(data)
    new_proto = sha256(data).hexdigest()
    (ROOT / "algorithms/.sundries-sha256").write_text(new_proto + "\n")
    replace_digest("algorithms/tests/contract_input.rs", old_proto, new_proto)
    print(f"experience_sha256={new_hash}\nruntime_sha256={new_proto}")


if __name__ == "__main__":
    main()
