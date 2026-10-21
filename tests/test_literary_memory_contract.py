"""Synthetic shape checks, not evidence of literary quality or actor permission."""
import copy
from hashlib import sha256
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator
from test_experience_boundary import candidate, context, schema_for

ROOT = Path(__file__).resolve().parents[1]


def change():
    return {
        "id": "visit", "kind": "commitment", "subject_ids": ["lin"], "target_ids": ["chen"],
        "cue": "promised visit", "summary": "Lin promised to visit tomorrow.", "status": "active",
        "retrieval_keys": ["return"], "fact_ids": [], "quote": "I will come tomorrow.",
    }


class LiteraryMemoryContract(unittest.TestCase):
    def valid(self, kind, value):
        return not list(Draft202012Validator(schema_for(kind)).iter_errors(value))

    def test_local_changes_are_optional_bounded_and_do_not_carry_authority(self):
        value = candidate()
        self.assertTrue(self.valid("candidate", value))
        value["memory_changes"] = []
        self.assertTrue(self.valid("candidate", value))
        value["memory_changes"] = [change()]
        self.assertTrue(self.valid("candidate", value))
        for key, content in (
            ("source_revision", 1), ("source_sha256", "0" * 64),
            ("updated_revision", 1), ("visible_to", ["chen"]), ("known_by", ["chen"]),
            ("prior_sources", [{"revision": 1, "sha256": "a" * 64, "quote": "Original promise."}]),
        ):
            changed = copy.deepcopy(value)
            changed["memory_changes"][0][key] = content
            self.assertFalse(self.valid("candidate", changed), key)
        value["memory_changes"] = [change()] * 13
        self.assertFalse(self.valid("candidate", value))
        value["memory_changes"] = None
        self.assertFalse(self.valid("candidate", value))

    def test_long_term_storage_does_not_share_the_prompt_notebook_limit(self):
        item = {**change(), "source_revision": 1, "source_sha256": "a" * 64, "updated_revision": 1}
        items = [{**item, "id": f"event-{i}", "summary": "完整条件、应答关系与后果。" * 100} for i in range(80)]
        value = context()
        value["state"]["literary_memory"] = {"version": 1, "indexed_through_revision": 1, "entries": items}
        self.assertTrue(self.valid("context", value))
        del value["state"]["literary_memory"]["entries"][0]["source_sha256"]
        self.assertFalse(self.valid("context", value))

    def test_needs_are_search_terms_without_model_selected_audience(self):
        needs = {"participant_ids": ["lin"], "relationship_targets": ["chen"],
                 "topics": ["return"], "open_questions": [], "fact_ids": []}
        self.assertTrue(self.valid("context_needs", needs))
        needs["audience"] = "author"
        self.assertFalse(self.valid("context_needs", needs))
        del needs["audience"]
        needs["participant_ids"] = [f"person-{i}" for i in range(9)]
        self.assertFalse(self.valid("context_needs", needs))

    def test_material_granularity_keeps_source_locations_without_truncated_quotes(self):
        base = {key: value for key, value in change().items()
                if key not in ("summary", "quote", "retrieval_keys")}
        base.update(source_revision=1, source_sha256="a" * 64, updated_revision=1)
        cue = {**base, "granularity": "cue", "requires_source": True}
        summary = {**base, "granularity": "summary", "requires_source": True,
                   "summary": change()["summary"]}
        source = {**base, "granularity": "source", "requires_source": False,
                  "summary": change()["summary"], "quote": change()["quote"]}
        for value in (cue, summary, source):
            self.assertTrue(self.valid("memory_material", value))
        prior = [{"revision": 1, "sha256": "b" * 64, "quote": "Original promise."}]
        self.assertTrue(self.valid("memory_material", {
            **source, "prior_sources": prior, "prior_source_count": 1, "prior_source_revisions": [1],
        }))
        for value in (
            {**cue, "quote": "a fragment"},
            {**cue, "requires_source": False},
            {**summary, "quote": "a fragment"},
            {key: value for key, value in source.items() if key != "quote"},
            {**cue, "prior_sources": prior},
            {**summary, "prior_sources": prior},
        ):
            self.assertFalse(self.valid("memory_material", value))

    def test_all_granularities_keep_prior_page_locators_and_source_can_be_partial(self):
        base = {key: value for key, value in change().items()
                if key not in ("summary", "quote", "retrieval_keys")}
        base.update(source_revision=10, source_sha256="a" * 64, updated_revision=10,
                    prior_source_count=3, prior_source_revisions=[1, 3, 7])
        cue = {**base, "granularity": "cue", "requires_source": True}
        summary = {**base, "granularity": "summary", "requires_source": True,
                   "summary": change()["summary"]}
        source = {**summary, "granularity": "source", "quote": change()["quote"],
                  "prior_sources": [{"revision": 1, "sha256": "b" * 64,
                                     "quote": "Original promise."}]}
        for value in (cue, summary, source):
            self.assertTrue(self.valid("memory_material", value))
        for invalid in ([1, 1], [0], [-1], ["1"], list(range(1, 34))):
            self.assertFalse(self.valid("memory_material", {**source, "prior_source_revisions": invalid}))
        large_history = {**source, "prior_source_count": 1000, "prior_source_revisions": list(range(1, 33))}
        self.assertTrue(self.valid("memory_material", large_history))
        for missing in ("prior_source_count", "prior_source_revisions"):
            value = copy.deepcopy(source)
            del value[missing]
            self.assertFalse(self.valid("memory_material", value))
        # Locators are a stage representation, not a substitute for the stored
        # complete original source chain or a field models may write.
        self.assertFalse(self.valid("memory_change", {**change(), "prior_source_revisions": [1]}))
        item = {**change(), "source_revision": 2, "source_sha256": "a" * 64, "updated_revision": 2}
        self.assertFalse(self.valid("memory_entry", {**item, "prior_source_revisions": [1]}))

    def test_source_lineage_is_optional_in_legacy_storage_and_closed(self):
        item = {**change(), "source_revision": 2, "source_sha256": "a" * 64, "updated_revision": 2}
        for lineage in (None, [], [{"revision": 1, "sha256": "b" * 64, "quote": "Original promise."}]):
            value = copy.deepcopy(item)
            if lineage is not None:
                value["prior_sources"] = lineage
            self.assertTrue(self.valid("memory_entry", value))
        for lineage in (None, [{"revision": 1, "sha256": "b" * 64}], [
            {"revision": 1, "sha256": "b" * 64, "quote": "Original promise.", "visible_to": ["lin"]},
        ]):
            self.assertFalse(self.valid("memory_entry", {**item, "prior_sources": lineage}))

    def test_selection_never_claims_complete_history(self):
        coverage = {"scope": "current_authority_scene_selection", "matched": 2,
                    "returned": 1, "budget_omitted": 1, "unqueried": ["pages_from_1"],
                    "uncertain": ["a cue does not establish its interpretation"],
                    "history_complete": False, "indexed_through_revision": 0}
        value = {"stage": "review", "base_revision": 10, "coverage": coverage}
        self.assertTrue(self.valid("context_bundle", value))
        value["coverage"]["history_complete"] = True
        self.assertFalse(self.valid("context_bundle", value))

    def test_four_snapshots_and_digest_pin_are_identical(self):
        paths = (
            "contracts/experience/v1/contract.json",
            "algorithms/contracts/experience/v1/contract.json",
            "backend/internal/contract/source/experience/v1/contract.json",
            "frontend/contracts/experience/v1/contract.json",
        )
        expected = (ROOT / paths[0]).read_bytes()
        for path in paths[1:]:
            self.assertEqual(expected, (ROOT / path).read_bytes(), path)
        self.assertEqual(sha256(expected).hexdigest(), (ROOT / "algorithms/.experience-sha256").read_text().strip())


if __name__ == "__main__":
    unittest.main()
