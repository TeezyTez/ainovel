"""Cross-language ceiling drift only; actual request admission is tested in Rust/Go."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


def integer_expression(expression):
    match = re.fullmatch(r"\s*(\d+)\s*(?:(\*|<<)\s*(\d+))?\s*", expression)
    if match is None:
        raise AssertionError(f"unsupported capacity constant: {expression!r}")
    left, operator, right = match.groups()
    if operator == "*":
        return int(left) * int(right)
    if operator == "<<":
        return int(left) << int(right)
    return int(left)


class NarrativeCapacityDrift(unittest.TestCase):
    def test_pipeline_object_schema_and_aggregate_ceilings_match(self):
        rust = (ROOT / "algorithms/src/narrative_pipeline.rs").read_text(encoding="utf-8")
        go = (ROOT / "backend/internal/experience/narrative_capacity.go").read_text(encoding="utf-8")
        for rust_name, go_name in (
            ("MAX_STAGE_OVERHEAD_BYTES", "narrativePipelineOverheadBytes"),
            ("MAX_STAGE_SCHEMA_BYTES", "narrativePipelineSchemaMaxBytes"),
        ):
            with self.subTest(ceiling=rust_name):
                rust_match = re.search(rf"pub const {rust_name}: usize\s*=\s*([^;]+);", rust)
                go_match = re.search(rf"const {go_name}\s*=\s*([^\r\n]+)", go)
                self.assertIsNotNone(rust_match, "missing Rust stage ceiling")
                self.assertIsNotNone(go_match, "missing Go stage reservation")
                self.assertEqual(integer_expression(rust_match[1]), integer_expression(go_match[1]))

    def test_go_reserves_the_same_ceilings_rust_checks(self):
        rust = (ROOT / "algorithms/src/experience.rs").read_text(encoding="utf-8")
        go = (ROOT / "backend/internal/experience/narrative_capacity.go").read_text(encoding="utf-8")
        for rust_name, go_name in (
            ("NARRATIVE_CONTENT_OVERHEAD_BYTES", "narrativeContentOverheadBytes"),
            ("NARRATIVE_SCHEMA_MAX_BYTES", "narrativeSchemaMaxBytes"),
        ):
            with self.subTest(ceiling=rust_name):
                rust_match = re.search(rf"pub const {rust_name}: usize\s*=\s*([^;]+);", rust)
                go_match = re.search(rf"const {go_name}\s*=\s*([^\r\n]+)", go)
                self.assertIsNotNone(rust_match, "missing Rust capacity ceiling")
                self.assertIsNotNone(go_match, "missing Go capacity reservation")
                self.assertEqual(integer_expression(rust_match[1]), integer_expression(go_match[1]))


if __name__ == "__main__":
    unittest.main()
