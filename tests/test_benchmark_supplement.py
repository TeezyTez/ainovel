"""Synthetic evidence plumbing for the independent SYS-014 positive control.

These tests never evaluate conversion prose or establish benchmark acceptance.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/benchmark"))
from native import digest, migrate_information_page
from test_benchmark_native import seal_events

CATALOG = json.loads((ROOT / "tests/benchmark/catalog.json").read_text(encoding="utf-8"))


def write_json(path, value):
    raw = json.dumps(value, ensure_ascii=False).encode()
    path.write_bytes(raw)
    return digest(raw)


def synthetic_supplement(directory):
    f = json.loads((ROOT / "backend/internal/experience/testdata/deep_benchmark/SYS-014.json").read_text(encoding="utf-8"))
    fixture_sha = write_json(directory / "source-fixture.json", f)
    tree_sha = write_json(directory / "source-build-manifest.json", {"backend/internal/experience/testdata/deep_benchmark/SYS-014.json": fixture_sha})
    current_tree = write_json(directory / "current-build-manifest.json", {"synthetic-evaluator": "3" * 64})
    runtime = b"synthetic runtime evidence only"
    (directory / "algorithm-runtime").write_bytes(runtime)
    reader = {"information": []}
    first = {"revision": 1, "mode": "begin", "input": f["seed"], "text": f["opening"], "reader": reader}
    second = {"revision": 2, "mode": "ask", "input": f["steps"][0]["input"], "text": "Synthetic source answer.", "reader": reader}
    source = [
        ("manifest", "", {"evidence_version": 2, "fixture": f, "fixture_sha256": fixture_sha, "source_tree_sha256": tree_sha}),
        ("initial_readback", "", {"snapshot": f["state"], "public_view": {"revision": 1, "pages": [first]}}),
        ("operation_request", "S01", {"request": {"mode": "ask", "input": second["input"], "expected_revision": 1}, "before": f["state"]}),
        ("model_request", "S01", {"call": 1, "request": {}}),
        ("model_result", "S01", {"call": 1, "result": {}, "error": ""}),
        ("operation_committed", "S01", {"snapshot": f["state"], "public_view": {"title": "Synthetic source answer title", "revision": 2, "pages": [first, second]}}),
        ("blocked_step", "S05", {"reason": "Separate currency world not implemented in base run."}),
        ("run_end", "", {"status": "REVIEW"}),
    ]
    seal_events(directory, source, prefix="source-")
    pages = [first, second]
    projected = [migrate_information_page(p, f["state"]) for p in pages]
    original = {"scope": {"role": "original-restored", "account": "original", "experience_id": "benchmark-story", "branch_id": "benchmark-main"},
                "history": {"public_view": {"id": "benchmark-story", "branch_id": "benchmark-main", "title": "Synthetic source answer title", "revision": 2, "pages": projected,
                                            "reader": reader, "information": [], "branches": [{"id": "benchmark-main", "revision": 2}]},
                            "snapshots": [{"revision": i + 1, "state": f["state"]} for i in range(2)],
                            "stored_pages": pages, "projection_migration": "information_recorded_revision_v1",
                            "stored_titles": [{"revision": 1, "title": "合成世界初始记录"}, {"revision": 2, "title": "Synthetic source answer title"}],
                            "title_binding": "source_public_view_title_v1", "branch_title": "Synthetic source answer title"}, "preferences": []}
    state = {"story_time": "商港开市时", "entities": [
        {"id": "shell-currency", "kind": "currency", "name": "贝币", "description": "商港使用的货币", "known": True, "related_ids": []},
        {"id": "mist-currency", "kind": "currency", "name": "岚币", "description": "商港使用的货币", "known": True, "related_ids": []}],
        "facts": [{"id": "fixed-currency-rate", "kind": "rule", "text": "本世界使用贝币和岚币，固定汇率为3枚贝币兑换1枚岚币。", "subject_id": "", "known": True, "known_by": [], "source_revision": 1}], "threads": []}
    question = "按这里的固定汇率，2枚岚币可以兑换多少枚贝币？"
    currency = {"id": "SYS-014-S05-currency-control", "source_sha256": "", "source_line": 0, "variant": "supplement", "seed": "商港使用贝币和岚币。", "opening": state["facts"][0]["text"], "state": state,
                "steps": [{"id": "currency-ask", "mode": "ask", "input": question}], "private_tokens": [], "omissions": ["Evaluator-authored synthetic formal prehistory. No cash balance, exchange transaction or expected answer is initialized."]}
    prereg = {"version": 1, "currencies": ["贝币", "岚币"], "rule": state["facts"][0]["text"], "input": question}
    currency_sha = write_json(directory / "currency-fixture.json", currency)
    prereg_sha = write_json(directory / "preregistration.json", prereg)
    scope = {"role": "currency-positive-control", "account": "currency", "experience_id": "benchmark-story", "branch_id": "benchmark-main"}
    cfirst = {"revision": 1, "mode": "begin", "input": currency["seed"], "text": currency["opening"]}
    clast = {"revision": 2, "mode": "ask", "input": question, "text": "Synthetic deliberately wrong conversion: nine shells.", "story_time": state["story_time"], "outcome": "continues", "suggestions": []}
    def readback(pages):
        return {"scope": scope, "history": {"public_view": {"id": scope["experience_id"], "branch_id": scope["branch_id"], "revision": len(pages), "pages": pages},
                "snapshots": [{"revision": i + 1, "state": state} for i in range(len(pages))], "stored_pages": None, "projection_migration": ""}, "preferences": []}
    request = {"request_id": "currency-only-ask", "mode": "ask", "input": question, "expected_revision": 1, "branch_id": scope["branch_id"]}
    operation = {"request_id": request["request_id"], "experience_id": scope["experience_id"], "branch_id": scope["branch_id"], "base_revision": 1, "committed_revision": 2, "status": "committed"}
    draft = {"title": "Synthetic", "passage": clast["text"], "story_time": state["story_time"], "outcome": "continues", "suggestions": []}
    context = {"mode": "ask", "input": question, "state": state, "revision": 1, "experience_id": scope["experience_id"], "branch_id": scope["branch_id"]}
    def model_request(call, user):
        return ("model_request", "S05", {"call": call, "request": {"model": "synthetic", "max_output_tokens": 8192,
                "messages": [{"role": "system", "content": "Synthetic evidence test."}, {"role": "user", "content": json.dumps(user, ensure_ascii=False)}], "schema": {"type": "object"}}})
    return [
        ("supplement_manifest", "", {"schema_version": 1, "kind": "sys014_currency_positive_control", "case_id": "SYS-014", "step_id": "S05", "step": f["steps"][4],
            "source_root": (directory / "source-root.sha256").read_text().strip(), "source_events_sha256": digest((directory / "source-events.jsonl").read_bytes()),
            "source_fixture_sha256": fixture_sha, "source_tree_sha256": tree_sha, "preregistration_sha256": prereg_sha, "step_input": f["steps"][4]["input"],
            "currency_fixture_sha256": currency_sha, "currency_fixture": currency, "currency_input": question, "separate_databases": True, "model": "synthetic", "runtime_sha256": digest(runtime), "current_source_tree_sha256": current_tree, "engine": "narrative-engine.v4.5", "max_model_calls_per_operation": 12, "max_repairs": 1, "context_token_limit": 65536, "max_output_tokens": 8192, "operations_authorized": 1, "retry": False}),
        ("original_readback_before", "S05", original),
        ("currency_initial_readback", "S05", readback([cfirst])),
        ("currency_operation_request", "S05", {"request": request, "before": state, "scope": scope}),
        model_request(1, context),
        ("model_result", "S05", {"call": 1, "result": {"text": json.dumps({"result": draft})}, "error": ""}),
        ("stage", "S05", {"stage": "answer", "error": ""}),
        model_request(2, {"context": context, "candidate": draft}),
        ("model_result", "S05", {"call": 2, "result": {"text": json.dumps({"result": {"approved": True, "issues": [], "supports": [], "knowledge_supports": [], "reveal_supports": []}})}, "error": ""}),
        ("stage", "S05", {"stage": "review", "error": ""}),
        ("currency_operation_committed", "S05", {"readback": readback([cfirst, clast]), "operation": operation, "model_calls": 2, "elapsed_ms": 1, "error": ""}),
        ("original_readback_after", "S05", copy.deepcopy(original)),
        ("source_files_readback", "S05", {"sha256": {name: digest((directory / ("source-" + name)).read_bytes()) for name in ("events.jsonl", "root.sha256", "fixture.json")}, "unchanged": True, "error": ""}),
        ("supplement_end", "S05", {"status": "REVIEW"}),
    ]


class CurrencySupplementTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("benchmark_supplement", ROOT / "tools/benchmark/supplement.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_structural_control_stays_review_even_with_wrong_answer(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            seal_events(directory, synthetic_supplement(directory))
            result = self.module.verify_currency(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("REVIEW", result["status"])
            self.assertEqual("BLOCKED", result["source_step_status"])
            self.assertEqual("6", result["independent_expected_quantity"])
            self.assertEqual("REVIEW", result["arithmetic_semantics"])

    def test_rejects_forged_or_incomplete_supplement(self):
        for mutation in ("source_root", "source_bytes", "step", "prereg", "fixture", "scope", "input", "missing_result", "extra_request", "world_change", "old_page", "old_snapshot", "preferences", "operation", "automatic_pass", "answer_relocated", "model_candidate", "model_context", "source_file_readback", "runtime", "budget", "oracle_initialized", "oracle_user", "answer_output"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = synthetic_supplement(directory)
                manifest, committed = records[0][2], next(e[2] for e in records if e[0] == "currency_operation_committed")
                after = next(e[2] for e in records if e[0] == "original_readback_after")
                if mutation == "source_root": manifest["source_root"] = "0" * 64
                elif mutation == "source_bytes": (directory / "source-events.jsonl").write_bytes(b"{}\n")
                elif mutation == "step": manifest["step"]["input"] += " altered"
                elif mutation == "prereg": (directory / "preregistration.json").write_text("{}")
                elif mutation == "fixture": manifest["currency_fixture"]["opening"] += " Expected answer is six."
                elif mutation == "scope": committed["readback"]["scope"] = records[1][2]["scope"]
                elif mutation == "input": records[3][2]["request"]["input"] += " changed"
                elif mutation == "missing_result": records.pop(5)
                elif mutation == "extra_request": records.insert(6, copy.deepcopy(records[3]))
                elif mutation == "world_change":
                    committed["readback"]["history"]["snapshots"] = copy.deepcopy(committed["readback"]["history"]["snapshots"])
                    committed["readback"]["history"]["snapshots"][1]["state"]["story_time"] = "Later"
                elif mutation == "old_page":
                    committed["readback"]["history"]["public_view"]["pages"] = copy.deepcopy(committed["readback"]["history"]["public_view"]["pages"])
                    committed["readback"]["history"]["public_view"]["pages"][0]["text"] = "Rewritten"
                elif mutation == "old_snapshot": after["history"]["snapshots"][0]["state"]["story_time"] = "Rewritten source"
                elif mutation == "preferences": after["preferences"] = [{"key": "forced"}]
                elif mutation == "operation": committed["operation"]["committed_revision"] = 3
                elif mutation == "automatic_pass": records[-1][2]["status"] = "PASS"
                elif mutation == "answer_relocated": committed["readback"]["history"]["public_view"]["pages"][-1]["mode"] = "act"
                elif mutation == "model_candidate":
                    request = records[7][2]["request"]
                    user = json.loads(request["messages"][1]["content"])
                    user["candidate"]["passage"] = "A different answer."
                    request["messages"][1]["content"] = json.dumps(user)
                elif mutation == "model_context":
                    request = records[4][2]["request"]
                    user = json.loads(request["messages"][1]["content"])
                    user["input"] = "A different question."
                    request["messages"][1]["content"] = json.dumps(user)
                elif mutation == "source_file_readback": records[-2][2]["sha256"]["events.jsonl"] = "0" * 64
                elif mutation == "runtime": (directory / "algorithm-runtime").write_bytes(b"different runtime")
                elif mutation == "budget": manifest["operations_authorized"] = 2
                elif mutation == "oracle_initialized":
                    manifest["currency_fixture"]["state"]["narrative"] = {"answer": "Expected six"}
                    manifest["currency_fixture_sha256"] = write_json(directory / "currency-fixture.json", manifest["currency_fixture"])
                elif mutation == "oracle_user":
                    request = records[4][2]["request"]
                    user = json.loads(request["messages"][1]["content"])
                    user["expected_result"] = "6"
                    request["messages"][1]["content"] = json.dumps(user)
                elif mutation == "answer_output":
                    result = records[5][2]["result"]
                    value = json.loads(result["text"])
                    value["result"]["passage"] = "Different actual model output."
                    result["text"] = json.dumps(value)
                seal_events(directory, records)
                with self.assertRaises((ValueError, KeyError)):
                    self.module.verify_currency(directory, CATALOG)

    def test_failed_model_keeps_failure_and_original_state(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            records = synthetic_supplement(directory)
            failed = copy.deepcopy(next(e[2] for e in records if e[0] == "currency_operation_committed"))
            failed.update(error="synthetic provider failure", model_calls=1, readback=copy.deepcopy(records[2][2]))
            failed["operation"].update(status="failed")
            failed["operation"].pop("committed_revision")
            records[5][2].update(error="synthetic provider failure", result={"text": ""})
            records[6][2]["error"] = "model_failed"
            records = records[:7] + [("currency_operation_failure", "S05", failed)] + records[-3:]
            records[-1][2]["status"] = "FAIL"
            seal_events(directory, records)
            result = self.module.verify_currency(directory, CATALOG)
            self.assertEqual(("VERIFIED", "FAIL", "NOT_REACHED", 1), (result["integrity"], result["status"], result["arithmetic_semantics"], result["model_calls"]))


if __name__ == "__main__":
    unittest.main()
