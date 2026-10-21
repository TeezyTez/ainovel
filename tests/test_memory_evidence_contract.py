"""Synthetic v1/v2 shape controls; no narrative, approval or DB certification."""
import copy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from jsonschema import Draft202012Validator
from test_experience_boundary import candidate, context, schema_for
from test_literary_memory_contract import change

ROOT = Path(__file__).resolve().parents[1]


def interpretation():
    return {key: value for key, value in change().items() if key != "quote"}


def delta():
    return {"version": 2, "entries": [interpretation()]}


def legacy_entry():
    return {
        **change(), "source_revision": 2, "updated_revision": 2,
        "source_sha256": "a" * 64,
        "prior_sources": [
            {"revision": 1, "sha256": "b" * 64, "quote": "The earlier promise."},
        ],
    }


def page_ref():
    return {"kind": "formal_page", "revision": 3, "text_sha256": "c" * 64}


def fact_ref():
    return {"kind": "authority_fact", "fact_id": "promise", "as_of_revision": 2,
            "record_sha256": "d" * 64}


def sourced_entry():
    return {
        **interpretation(), "evidence_kind": "source_refs_v2", "updated_revision": 3,
        "evidence_refs": [page_ref(), fact_ref()], "legacy_entry": legacy_entry(),
    }


def material_v2():
    return {
        "version": 2, "id": "promise", "kind": "commitment",
        "subject_ids": ["lin"], "target_ids": ["chen"], "cue": "promised visit",
        "status": "active", "fact_ids": [], "updated_revision": 3,
        "evidence_kind": "source_refs_v2", "granularity": "summary",
        "summary": "The earlier visit has conditions that need the original page.",
        "source_count": 2, "source_omitted": 1,
        "source_directory": [{"ref": page_ref(), "loaded": False}],
    }


class MemoryEvidenceContract(unittest.TestCase):
    def valid(self, definition, value):
        return not list(Draft202012Validator(schema_for(definition)).iter_errors(value))

    def with_memory(self, memory):
        value = context()
        value["state"]["literary_memory"] = memory
        return value

    def test_new_delta_without_quote_and_explicit_empty_delta_are_valid(self):
        for entries in ([interpretation()], []):
            value = {**candidate(), "memory_delta": {"version": 2, "entries": entries}}
            self.assertTrue(self.valid("candidate", value), entries)

    def test_old_candidate_and_index_remain_valid_without_new_markers(self):
        for old in (None, [], [change()]):
            value = candidate()
            if old is not None:
                value["memory_changes"] = old
            self.assertTrue(self.valid("candidate", value))
        memory = {"version": 1, "indexed_through_revision": 2, "entries": [legacy_entry()]}
        self.assertTrue(self.valid("context", self.with_memory(memory)))

    def test_new_index_can_preserve_legacy_and_source_refs_as_distinct_variants(self):
        memory = {
            "version": 2, "indexed_through_revision": 3,
            "entries": [{**legacy_entry(), "evidence_kind": "legacy_v1"}, sourced_entry()],
        }
        self.assertTrue(self.valid("context", self.with_memory(memory)))
        self.assertTrue(self.valid("context", self.with_memory({
            "version": 2, "indexed_through_revision": 0, "entries": [],
        })))

    def test_old_and_new_delta_are_mutually_exclusive_by_presence(self):
        for old in ([], [change()], None):
            for new in (delta(), {"version": 2, "entries": []}, None):
                value = {**candidate(), "memory_changes": old, "memory_delta": new}
                self.assertFalse(self.valid("candidate", value), (old, new))

    def test_delta_version_entries_and_unknown_fields_are_closed(self):
        for invalid in (None, {}, {"version": 1, "entries": []},
                        {"version": 3, "entries": []}, {"version": 2, "entries": None},
                        {"version": 2, "entries": [interpretation()] * 13},
                        {**delta(), "approval": True}):
            self.assertFalse(self.valid("candidate", {**candidate(), "memory_delta": invalid}),
                             invalid)

    def test_model_interpretation_cannot_carry_authority_or_old_quote(self):
        for key, value in (
            ("quote", "I will come tomorrow."), ("known_by", ["lin"]), ("visible_to", ["lin"]),
            ("source_revision", 3), ("source_sha256", "a" * 64), ("updated_revision", 3),
            ("evidence_refs", [page_ref()]), ("evidence_kind", "source_refs_v2"),
            ("legacy_entry", legacy_entry()),
        ):
            item = {**interpretation(), key: value}
            self.assertFalse(self.valid("candidate", {
                **candidate(), "memory_delta": {"version": 2, "entries": [item]},
            }), key)

    def test_locator_is_optional_but_present_null_empty_or_oversize_is_invalid(self):
        value = interpretation()
        value["locator_quote"] = "The current adopted page."
        self.assertTrue(self.valid("candidate", {
            **candidate(), "memory_delta": {"version": 2, "entries": [value]},
        }))
        for locator in (None, "", "x" * 2049):
            value["locator_quote"] = locator
            self.assertFalse(self.valid("candidate", {
                **candidate(), "memory_delta": {"version": 2, "entries": [value]},
            }), locator)

    def test_durable_refs_cannot_mix_kinds_or_accept_model_local_source_ids(self):
        good = sourced_entry()
        invalid = [
            {**page_ref(), "fact_id": "promise"}, {**page_ref(), "source_id": "s1"},
            {**fact_ref(), "revision": 2}, {**fact_ref(), "known_by": ["lin"]},
            {"kind": "candidate", "revision": 3, "text_sha256": "c" * 64},
            {**page_ref(), "text_sha256": "G" * 64}, {**page_ref(), "revision": 0},
            {**fact_ref(), "as_of_revision": 0},
            {key: value for key, value in fact_ref().items() if key != "as_of_revision"},
        ]
        for ref in invalid:
            value = {**good, "evidence_refs": [ref]}
            self.assertFalse(self.valid("context", self.with_memory({
                "version": 2, "indexed_through_revision": 3, "entries": [value],
            })), ref)
        for refs in (None, [], [page_ref(), page_ref()]):
            value = {**good, "evidence_refs": refs}
            self.assertFalse(self.valid("context", self.with_memory({
                "version": 2, "indexed_through_revision": 3, "entries": [value],
            })), refs)

    def test_v2_entry_discriminator_and_legacy_payload_cannot_be_ambiguous(self):
        good = sourced_entry()
        mutations = [
            {**good, "evidence_kind": "reviewed_v2"},
            {**good, "quote": "old quote"},
            {**good, "source_revision": 3},
            {**good, "source_sha256": "c" * 64},
            {**good, "legacy_entry": None},
            {**good, "legacy_entry": good},
            {**good, "locator_quote": None},
            {**legacy_entry(), "evidence_kind": "legacy_v1", "evidence_refs": [page_ref()]},
            legacy_entry(),
        ]
        for value in mutations:
            self.assertFalse(self.valid("context", self.with_memory({
                "version": 2, "indexed_through_revision": 3, "entries": [value],
            })), value)
        self.assertFalse(self.valid("context", self.with_memory({
            "version": 1, "indexed_through_revision": 3, "entries": [good],
        })))

    def test_four_contract_snapshots_remain_byte_identical_and_pinned(self):
        raw = (ROOT / "contracts/experience/v1/contract.json").read_bytes()
        for relative in (
            "algorithms/contracts/experience/v1/contract.json",
            "backend/internal/contract/source/experience/v1/contract.json",
            "frontend/contracts/experience/v1/contract.json",
        ):
            self.assertEqual(raw, (ROOT / relative).read_bytes(), relative)
        self.assertEqual(sha256(raw).hexdigest(),
                         (ROOT / "algorithms/.experience-sha256").read_text().strip())

    def test_v2_material_distinguishes_summary_locator_and_actual_loaded_sources(self):
        value = material_v2()
        coverage = {"scope": "current_authority_scene_selection", "matched": 1,
                    "returned": 1, "budget_omitted": 0, "unqueried": [],
                    "uncertain": [], "history_complete": False}
        bundle = {"stage": "review", "base_revision": 3, "coverage": coverage,
                  "memories": [value]}
        self.assertTrue(self.valid("context_bundle", bundle))
        del value["summary"]
        value["granularity"] = "cue"
        value["evidence_kind"] = "legacy_v1"
        value["locator_quote"] = "A locator, not complete evidence."
        self.assertTrue(self.valid("context_bundle", bundle))
        value["source_directory"][0]["loaded"] = True
        self.assertTrue(self.valid("context_bundle", bundle))

    def test_v2_material_rejects_old_sufficiency_fields_and_ambiguous_directory(self):
        base = material_v2()
        mutations = [
            {**base, "requires_source": False}, {**base, "quote": "Old proof."},
            {**base, "version": 1}, {**base, "granularity": "source"},
            {**base, "granularity": "cue"},  # cue cannot carry summary
            {k: v for k, v in base.items() if k != "summary"},
            {**base, "locator_quote": None}, {**base, "source_count": -1},
            {**base, "source_omitted": -1}, {**base, "source_directory": None},
            {**base, "source_directory": [{"ref": page_ref()}]},
            {**base, "source_directory": [{"ref": page_ref(), "loaded": None}]},
            {**base, "source_directory": [{"ref": page_ref(), "loaded": False, "source_id": "made-up"}]},
            {**base, "source_directory": [
                {"ref": {**page_ref(), "revision": i}, "loaded": False} for i in range(1, 34)
            ]},
        ]
        coverage = {"scope": "current_authority_scene_selection", "matched": 1,
                    "returned": 1, "budget_omitted": 0, "unqueried": [],
                    "uncertain": [], "history_complete": False}
        for value in mutations:
            self.assertFalse(self.valid("context_bundle", {
                "stage": "review", "base_revision": 3, "coverage": coverage,
                "memories": [value],
            }), value)

    def test_updater_is_idempotent_preserves_v1_and_does_not_touch_runtime(self):
        spec = importlib.util.spec_from_file_location(
            "memory_evidence_updater", ROOT / "tools/update_memory_evidence_contract.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original = json.loads((ROOT / "contracts/experience/v1/contract.json").read_bytes())
        unchanged = copy.deepcopy(original)
        result = module.build_contract(original)
        self.assertEqual(original, unchanged, "the builder mutated its input")
        for name in ("memory_change", "memory_entry", "memory_source", "literary_memory",
                     "memory_material", "read_request", "read_reply"):
            self.assertEqual(original["$defs"][name], result["$defs"][name], name)
        self.assertEqual(result, module.build_contract(result))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw = (json.dumps(original, ensure_ascii=False, indent=2) + "\n").encode()
            digest = sha256(raw).hexdigest()
            for name in module.SNAPSHOTS:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            for name in module.PINS:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"contract pin={digest}\n")
            (root / "algorithms/.experience-sha256").write_text(digest + "\n")
            runtime = root / "contracts/algorithm/v1/runtime.proto"
            runtime.parent.mkdir(parents=True)
            runtime.write_bytes(b"unchanged protocol sentinel\r\n")
            module.update(root)
            first = {name: (root / name).read_bytes()
                     for name in (*module.SNAPSHOTS, *module.PINS)}
            module.update(root)
            for name, value in first.items():
                self.assertEqual(value, (root / name).read_bytes(), name)
            self.assertEqual(b"unchanged protocol sentinel\r\n", runtime.read_bytes())
            drift = root / module.SNAPSHOTS[-1]
            drift.write_bytes(b"unexpected snapshot drift")
            with self.assertRaisesRegex(ValueError, "snapshot drift"):
                module.update(root)
            self.assertEqual(first[module.SNAPSHOTS[0]],
                             (root / module.SNAPSHOTS[0]).read_bytes())


if __name__ == "__main__":
    unittest.main()
