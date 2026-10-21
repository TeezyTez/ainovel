"""Synthetic evidence checks for real Assist proposals; no literary acceptance."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from test_benchmark_native import CATALOG, ROOT, load_native, seal_events


def editorial_records():
    fixture = json.loads((ROOT / "backend/internal/experience/testdata/deep_benchmark/NAR-014.json").read_bytes())
    page = {"revision": 1, "mode": "begin", "input": fixture["seed"], "text": fixture["opening"]}
    view = {"id": "story", "branch_id": "main", "revision": 1, "pages": [page], "branches": [{"id": "main"}]}
    step = next(s for s in fixture["steps"] if s["id"] == "S06")
    preferences = {"revision": 0, "explicit": [], "proposals": []}
    records = [
        ("manifest", "", {"fixture": fixture, "fixture_sha256": "0" * 64}),
        ("initial_readback", "", {"snapshot": fixture["state"], "public_view": view}),
        ("editorial_request", "S06", {"request": {"kind": "polish", "request": step["input"], "branch_id": "main", "expected_revision": 1},
                                        "before": fixture["state"], "public_view": view, "original_page": page, "before_preferences": preferences}),
        ("model_request", "S06", {"call": 1, "request": {}}),
        ("model_result", "S06", {"call": 1, "result": {"text": '{"text":"Edited synthetic paragraph."}'}, "error": ""}),
        ("editorial_result", "S06", {"result": {"kind": "polish", "branch_id": "main", "base_revision": 1, "text": "Edited synthetic paragraph."},
                                     "snapshot": fixture["state"], "public_view": view, "original_page": page, "after_preferences": preferences,
                                     "model_calls": 1, "elapsed_ms": 10, "applied": False, "read_only_verified": True, "error": ""}),
        ("run_end", "S06", {"status": "REVIEW"}),
    ]
    # Separate each captured read, so a mutation cannot silently alter both.
    return json.loads(json.dumps(records, ensure_ascii=False))


class EditorialEvidenceTests(unittest.TestCase):
    def test_proposal_is_reviewed_without_a_new_formal_page(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            seal_events(directory, editorial_records())
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("REVIEW", result["steps"]["S06"])
            self.assertEqual(1, result["model_calls"])
            self.assertEqual(1, result["independent_checks"]["editorial_no_writes"]["verified"])

    def test_changed_authority_or_preferences_cannot_hide_behind_true_assertion(self):
        module = load_native(self)
        for mutation in ("snapshot", "page", "branch", "preferences", "applied", "error"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = editorial_records()
                data = records[5][2]
                if mutation == "snapshot":
                    data["snapshot"]["story_time"] = "tomorrow"
                elif mutation == "page":
                    data["public_view"]["pages"][0]["text"] = "Replaced official text"
                elif mutation == "branch":
                    data["public_view"]["branches"].append({"id": "unexpected"})
                elif mutation == "preferences":
                    data["after_preferences"]["explicit"] = [{"value": "permanent style"}]
                elif mutation == "applied":
                    data["applied"] = True
                else:
                    data["error"] = "model_failed"
                    data["result"]["text"] = ""
                seal_events(directory, records)
                result = module.verify_native(directory, CATALOG)
                self.assertEqual("FAIL", result["status"])
                self.assertEqual("FAIL", result["steps"]["S06"])

    def test_request_original_and_model_provenance_are_bound(self):
        module = load_native(self)
        for mutation in ("input", "kind", "revision", "before", "original", "result_identity", "no_calls", "missing_preferences"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = editorial_records()
                request = records[2][2]
                if mutation == "input":
                    request["request"]["request"] = "Permanently change my preferences."
                elif mutation == "kind":
                    request["request"]["kind"] = "repair"
                elif mutation == "revision":
                    request["request"]["expected_revision"] = 999
                elif mutation == "before":
                    request["before"]["story_time"] = "different"
                elif mutation == "original":
                    request["original_page"]["text"] = "Wrong paragraph"
                elif mutation == "result_identity":
                    records[5][2]["result"]["base_revision"] = 999
                elif mutation == "missing_preferences":
                    del records[5][2]["after_preferences"]
                else:
                    del records[3:5]
                seal_events(directory, records)
                with self.assertRaises(ValueError):
                    module.verify_native(directory, CATALOG)

    def test_unsettled_editorial_cannot_be_relabelled_as_complete_or_blocked(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            records = editorial_records()
            del records[5]
            seal_events(directory, records)
            self.assertEqual("INCOMPLETE", module.verify_native(directory, CATALOG)["integrity"])
            records.insert(-1, ("blocked_step", "S06", {"reason": "changed classification"}))
            seal_events(directory, records)
            with self.assertRaises(ValueError):
                module.verify_native(directory, CATALOG)

    def test_editorial_alone_cannot_invent_a_committed_resume_prefix(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = editorial_records()
            seal_events(directory, source, prefix="source-")
            records = [source[0], ("resume_manifest", "", {
                "source_root": (directory / "source-root.sha256").read_text().strip(),
                "events_sha256": hashlib.sha256((directory / "source-events.jsonl").read_bytes()).hexdigest(), "pages": []}),
                ("run_end", "", {"status": "FAIL"})]
            seal_events(directory, records)
            with self.assertRaisesRegex(ValueError, "no committed prefix"):
                module.verify_native(directory, CATALOG)


if __name__ == "__main__":
    unittest.main()
