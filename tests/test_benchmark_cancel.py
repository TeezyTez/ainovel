"""Cancellation audit controls use synthetic events, not narrative acceptance."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from test_benchmark_native import CATALOG, ROOT, load_native, seal_events


def cancel_records():
    fixture = json.loads((ROOT / "backend/internal/experience/testdata/deep_benchmark/SYS-005.json").read_bytes())
    state = fixture["state"]
    page = {"revision": 1, "mode": "begin", "input": fixture["seed"], "text": fixture["opening"]}
    view = {"id": "story", "branch_id": "main", "revision": 1, "pages": [page], "branches": [{"id": "main", "revision": 1}]}
    snapshots = [{"revision": 1, "state": state}]
    step = next(s for s in fixture["steps"] if s["id"] == "S06")
    request = {"request_id": "control", "branch_id": "main", "expected_revision": 1, "mode": "read"}
    operation = {"request_id": "control", "experience_id": "story", "branch_id": "main", "base_revision": 1}
    candidate = {"passage": "Synthetic candidate, not official history."}
    model_request = {"messages": [{"role": "user", "content": json.dumps({"candidate": candidate})}]}
    model_result = {"text": '{"approved":true}'}
    records = [
        ("manifest", "", {"fixture": fixture, "fixture_sha256": "0" * 64}),
        ("initial_readback", "", {"snapshot": state, "public_view": view}),
        ("control_request", "S06", {"step": step, "kind": "restore_cancel", "request": request, "before": state, "public_view": view, "before_snapshots": snapshots}),
        ("restore_readback", "S06", {"public_view": view, "snapshots": snapshots, "new_service": True, "new_db_connection": True, "process_restart": False, "recovery_method": "RecoverExpired", "error": ""}),
        ("cancel_pending", "S06", {"request": request, "operation": {**operation, "status": "pending"}, "snapshot": state, "public_view": view}),
        ("model_request", "S06", {"call": 1, "request": model_request}),
        ("model_result", "S06", {"call": 1, "result": model_result, "error": ""}),
        ("stage", "S06", {"stage": "review", "error": ""}),
        ("cancel_pause", "S06", {"model_call": 1, "review_request_event_seq": 6, "review_result_event_seq": 7,
                                  "candidate": candidate, "model_request": model_request, "model_result": model_result,
                                  "candidate_commit_eligibility": "not_established", "operation": {**operation, "status": "generating"}}),
        ("cancel_issued", "S06", {"operation": {**operation, "status": "cancelled"}}),
        ("cancel_result", "S06", {"operation": {**operation, "status": "cancelled"}, "snapshot": state, "public_view": view,
                                   "snapshots": snapshots, "model_calls": 1, "elapsed_ms": 10, "generation_error": "cancelled",
                                   "error": "", "review_reached": True, "read_only_verified": True}),
        ("observation", "S07", {"snapshot": state, "public_view": view}),
        ("run_end", "S07", {"status": "REVIEW"}),
    ]
    return json.loads(json.dumps(records, ensure_ascii=False))


class CancellationEvidenceTests(unittest.TestCase):
    def test_cancel_preserves_history_and_satisfies_readback_dependency(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            seal_events(directory, cancel_records())
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("REVIEW", result["steps"]["S06"])
            self.assertEqual("REVIEW", result["steps"]["S07"])
            self.assertEqual(1, result["independent_checks"]["restore_cancel_no_writes"]["verified"])

    def test_provenance_and_full_snapshot_history_are_independently_checked(self):
        module = load_native(self)
        for mutation in ("input", "before", "historical_state", "restore", "pending", "candidate", "result", "seq", "eligibility", "op_identity", "missing_issued", "missing_pause", "model_calls", "wrong_step"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                records = cancel_records()
                if mutation == "input":
                    records[2][2]["request"]["input"] = "Make player sign."
                elif mutation == "before":
                    records[2][2]["before"]["story_time"] = "tomorrow"
                elif mutation == "historical_state":
                    records[2][2]["before_snapshots"][0]["state"]["story_time"] = "tomorrow"
                elif mutation == "restore":
                    records[3][2]["process_restart"] = True
                elif mutation == "pending":
                    records[4][2]["operation"]["status"] = "committed"
                elif mutation == "candidate":
                    records[8][2]["candidate"]["passage"] = "Different candidate."
                elif mutation == "result":
                    records[8][2]["model_result"]["text"] = "changed response"
                elif mutation == "seq":
                    records[8][2]["review_request_event_seq"] = 7
                elif mutation == "eligibility":
                    records[8][2]["candidate_commit_eligibility"] = "approved"
                elif mutation == "op_identity":
                    records[9][2]["operation"]["request_id"] = "another"
                elif mutation == "missing_issued":
                    del records[9]
                elif mutation == "missing_pause":
                    del records[8]
                elif mutation == "model_calls":
                    records[10][2]["model_calls"] = 0
                else:
                    records[2][1] = "S05"
                seal_events(directory, records)
                with self.assertRaises(ValueError):
                    module.verify_native(directory, CATALOG)

    def test_authority_mutation_or_unreached_review_is_fail_not_completion(self):
        module = load_native(self)
        for mutation in ("state", "page", "branch", "committed", "review_unreached"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                records = cancel_records()
                data = records[10][2]
                records.pop(11)  # Failed S06 must never satisfy observation's prerequisite.
                if mutation == "state":
                    data["snapshots"][0]["state"]["story_time"] = "tomorrow"
                elif mutation == "page":
                    data["public_view"]["pages"][0]["text"] = "Rewritten"
                elif mutation == "branch":
                    data["public_view"]["branches"][0]["revision"] = 2
                elif mutation == "committed":
                    data["operation"]["committed_revision"] = 2
                else:
                    data.update(review_reached=False, error="review not reached")
                    del records[8:10]
                seal_events(directory, records)
                result = module.verify_native(directory, CATALOG)
                self.assertEqual("FAIL", result["steps"]["S06"])
                self.assertEqual("FAIL", result["status"])

    def test_cancel_source_cannot_be_replayed_as_only_committed_pages(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = cancel_records()
            seal_events(directory, source, prefix="source-")
            records = [source[0], ("resume_manifest", "", {
                "source_root": (directory / "source-root.sha256").read_text().strip(),
                "events_sha256": hashlib.sha256((directory / "source-events.jsonl").read_bytes()).hexdigest(), "pages": []}),
                ("run_end", "", {"status": "FAIL"})]
            seal_events(directory, records)
            with self.assertRaisesRegex(ValueError, "noncommitting control"):
                module.verify_native(directory, CATALOG)


if __name__ == "__main__":
    unittest.main()
