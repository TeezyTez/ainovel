"""Canonical v2 shape tests; not authority, retrieval or narrative-quality proofs.

Run: python3 -m unittest discover -s tests -p test_experience_boundary.py -v
Requires jsonschema in the test environment; no model, database or network is used.
"""
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/experience/v1/contract.json").read_text())


def schema_for(definition):
    return {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"],
            "$ref": f"#/$defs/{definition}"}


def read_request(selector=None):
    return {"request_id": "read-1", "source_handle": "operation-scoped",
            "selector": selector or {"kind": "names", "type": "entity", "names": ["掌柜"]},
            "max_reply_bytes": 65536}


def candidate():
    return {"title": "雨后", "passage": "掌柜把杯子推到窗边。", "story_time": "雨停后",
            "outcome": "continues", "suggestions": [], "new_facts": [],
            "new_entities": [], "new_threads": [], "reveal_fact_ids": [],
            "resolve_thread_ids": [], "knowledge_changes": [],
            "reveal_entity_ids": [], "reveal_thread_ids": []}


def context():
    counts = {"facts": 0, "entities": 0, "threads": 0}
    return {"version": 2, "experience_id": "experience-1", "branch_id": "branch-1",
            "revision": 0, "mode": "begin", "input": "雨天茶馆", "seed": "雨天茶馆",
            "state": {"story_time": "", "facts": [], "entities": [], "threads": []},
            "preferences": [], "history": [], "history_complete": True,
            "state_coverage": {"policy": "full.v1", "recent_from_revision": 0,
                               "total": counts, "omitted": dict(counts), "complete": True,
                               "source_handle": "operation-scoped", "audience": "author"},
            "recalls": [], "read_budget": {"max_reads": 3, "max_reply_bytes": 65536,
                                           "max_total_reply_bytes": 131072}}


class ExperienceBoundary(unittest.TestCase):
    def assert_valid(self, definition, value):
        self.assertEqual([], list(Draft202012Validator(schema_for(definition)).iter_errors(value)))

    def assert_invalid(self, definition, value):
        self.assertTrue(list(Draft202012Validator(schema_for(definition)).iter_errors(value)))

    def test_schema_is_valid(self):
        Draft202012Validator.check_schema(SCHEMA)

    def test_v2_context_requires_coverage_recalls_and_budget(self):
        self.assert_valid("context", context())
        for key in ("state_coverage", "recalls", "read_budget"):
            c = context()
            del c[key]
            self.assert_invalid("context", c)
        c = context()
        c["version"] = 1
        self.assert_invalid("context", c)

    def test_readers_have_an_explicit_audience(self):
        c = context()
        c["state_coverage"]["audience"] = "reader"
        self.assert_valid("context", c)
        del c["state_coverage"]["audience"]
        self.assert_invalid("context", c)

    def test_literal_selector_types_are_closed(self):
        for selector in (
            {"kind": "objects", "objects": [{"type": "fact", "id": "fact-1", "at_revision": 1}]},
            {"kind": "pages", "from_revision": 1, "to_revision": 2},
            {"kind": "enumerate", "type": "fact", "fact_kind": "statement",
             "terms": ["承诺"], "match": "all", "from_source_revision": 1},
            {"kind": "names", "type": "entity", "names": ["掌柜"]},
        ):
            self.assert_valid("read_request", read_request(selector))
        for selector in (
            {"kind": "similarity", "text": "类似的人"},
            {"kind": "names", "type": "fact", "names": ["掌柜"]},
            {"kind": "names", "type": "thread", "names": ["承诺"]},
            {"kind": "enumerate", "type": "thread", "from_source_revision": 1},
            {"kind": "enumerate", "type": "fact", "terms": ["承诺"]},
        ):
            self.assert_invalid("read_request", read_request(selector))

    def test_model_cannot_add_scope_or_state_fields(self):
        for key in ("account_id", "branch_id", "base_revision", "state_coverage"):
            r = read_request()
            r[key] = "forged"
            self.assert_invalid("read_request", r)

    def test_generation_is_root_object_with_only_candidate_or_read(self):
        self.assert_valid("generation_result", {"result": candidate()})
        self.assert_valid("generation_result", {"result": read_request()})
        self.assert_invalid("generation_result", candidate())
        self.assert_invalid("generation_result", {"result": read_request(), "state_coverage": {}})
        self.assert_invalid("generation_result", {"result": {"request_id": "read-1", "error_code": "recall_budget_exhausted"}})

    def test_failures_are_named_sanitized_and_not_candidates(self):
        for code in SCHEMA["$defs"]["read_failure"]["properties"]["error_code"]["enum"]:
            self.assert_valid("read_failure", {"request_id": "read-1", "error_code": code})
        self.assert_invalid("read_failure", {"request_id": "read-1", "error_code": "secret provider endpoint"})
        self.assert_invalid("read_failure", {"request_id": "read-1", "error_code": "recall_scope_mismatch", "detail": "other account"})

    def test_thread_resolution_preserves_identity_but_new_thread_cannot_forge_it(self):
        t = {"id": "thread-1", "text": "明天还伞", "known": True, "related_fact_ids": []}
        self.assert_valid("thread", t)
        self.assert_valid("thread", dict(t, resolved_at_revision=None))
        self.assert_valid("thread", dict(t, resolved_at_revision=2))
        self.assert_invalid("thread", dict(t, resolved_at_revision=0))
        c = candidate()
        c["new_threads"] = [dict(t, resolved_at_revision=None)]
        self.assert_valid("candidate", c)
        c["new_threads"] = [dict(t, resolved_at_revision=2)]
        self.assert_invalid("candidate", c)

    def test_unknown_or_negative_budget_rejected(self):
        c = context()
        c["read_budget"]["max_reads"] = -1
        self.assert_invalid("context", c)
        c = context()
        c["read_budget"]["unlimited"] = True
        self.assert_invalid("context", c)


if __name__ == "__main__":
    unittest.main()
