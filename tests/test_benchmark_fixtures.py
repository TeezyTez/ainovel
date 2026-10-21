"""Evaluator fixture coverage and execution policy; no narrative acceptance."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "backend/internal/experience/testdata/deep_benchmark"


class BenchmarkFixtureTests(unittest.TestCase):
    def test_new_cases_preserve_exact_catalog_steps(self):
        catalog = json.loads((ROOT / "tests/benchmark/catalog.json").read_bytes())
        for case_id in ("SYS-005", "SYS-006", "FUN-002", "FUN-003", "NAR-010", "NAR-018"):
            with self.subTest(case_id=case_id):
                path = FIXTURES / (case_id + ".json")
                self.assertTrue(path.is_file(), f"Missing adapter for {case_id}")
                fixture = json.loads(path.read_bytes())
                case = next(c for c in catalog["cases"] if c["id"] == case_id)
                self.assertEqual([(s["id"], s["operation"], s["input"]) for s in case["steps"]],
                                 [(s["id"], s["mode"], s["input"]) for s in fixture["steps"]])

    def test_technical_restoration_and_search_permission_are_not_assumed(self):
        for case_id, step_id, dependency in (("SYS-005", "S07", "S06"), ("SYS-006", "S05", "S04"),
                                              ("FUN-001", "10", "09"), ("FUN-001", "11", "10"),
                                              ("FUN-001", "12", "10"), ("FUN-001", "13", "10")):
            with self.subTest(case_id=case_id, step=step_id):
                path = FIXTURES / (case_id + ".json")
                self.assertTrue(path.is_file())
                fixture = json.loads(path.read_bytes())
                step = next(s for s in fixture["steps"] if s["id"] == step_id)
                self.assertIn(dependency, step.get("requires_steps", []))
                if case_id == "FUN-001" and step_id == "10":
                    self.assertEqual("search-approval", step.get("evidence_gate"))


if __name__ == "__main__":
    unittest.main()
