"""Narrative engine boundary shapes; synthetic data, not narrative-quality evidence."""
import copy
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator
from test_experience_boundary import candidate, context

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/experience/v1/contract.json").read_text())


def notebook():
    return {
        "version": 1, "through_revision": 1, "episodes": [], "characters": [], "arcs": [],
        "style": {"voice": "克制", "perspective": "第二人称", "pace": "balanced",
                  "detail": "balanced", "avoid": [], "preference_refs": []},
    }


class NarrativeEngineContract(unittest.TestCase):
    def errors(self, kind, value):
        validator = Draft202012Validator({"$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{kind}"})
        return list(validator.iter_errors(value))

    def test_pipeline_context_and_versioned_notebook_are_accepted(self):
        value = context()
        value["pipeline"] = {"version": 1, "max_actors": 2, "max_repairs": 1}
        value["reading_request"] = "下一段少一些解释。"
        value["state"]["narrative"] = notebook()
        self.assertEqual([], self.errors("context", value))
        proposal = candidate()
        proposal["narrative_update"] = notebook()
        self.assertEqual([], self.errors("candidate", proposal))

    def test_notebook_is_typed_and_bounded(self):
        proposal = candidate()
        proposal["narrative_update"] = notebook()
        self.assertEqual([], self.errors("candidate", proposal))
        for mutation in (
            lambda n: n.update(version=2),
            lambda n: n.update(through_revision=-1),
            lambda n: n.update(author_secret="untyped"),
            lambda n: n["style"].update(pace="unlimited"),
            lambda n: n.update(characters=[{}]),
            lambda n: n.update(episodes=[{"id": "e", "summary": "x", "from_revision": 1,
                                          "to_revision": 1, "fact_ids": []}] * 9),
        ):
            changed = copy.deepcopy(proposal)
            mutation(changed["narrative_update"])
            self.assertTrue(self.errors("candidate", changed))

    def test_pipeline_policy_is_closed_and_bounded(self):
        value = context()
        value["pipeline"] = {"version": 1, "max_actors": 2, "max_repairs": 1}
        self.assertEqual([], self.errors("context", value))
        for key, bad in (("version", 2), ("max_actors", 3), ("max_repairs", 2), ("allow_unreviewed", True)):
            changed = copy.deepcopy(value)
            changed["pipeline"][key] = bad
            self.assertTrue(self.errors("context", changed))

    def test_legacy_records_remain_accepted(self):
        self.assertEqual([], self.errors("candidate", candidate()))
        self.assertEqual([], self.errors("context", context()))

    def test_stage_identity_is_explicit_in_runtime_contract(self):
        proto = (ROOT / "contracts/algorithm/v1/runtime.proto").read_text()
        self.assertTrue("string narrative_stage = 5;" in proto, "missing explicit model stage")
        self.assertTrue("string narrative_actor_id = 6;" in proto, "missing explicit actor scope")


if __name__ == "__main__":
    unittest.main()
