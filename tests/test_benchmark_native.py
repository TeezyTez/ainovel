"""Go-adapter evidence verification, including negative chain controls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/benchmark/native.py"
CATALOG = json.loads((ROOT / "tests/benchmark/catalog.json").read_text(encoding="utf-8"))


def load_native(test):
    test.assertTrue(MODULE.is_file(), "native Go evidence verifier is missing")
    spec = importlib.util.spec_from_file_location("benchmark_native", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture():
    return json.loads((ROOT / "backend/internal/experience/testdata/deep_benchmark/SYS-001.json").read_text(encoding="utf-8"))


def write_events(directory, *, changed_state=False, finish=True, broken_pair=False):
    snapshot = fixture()["state"]
    if changed_state:
        snapshot["story_time"] = "19:00"
    records = replay_records()[:-1]
    records[4][2]["call"] = 2 if broken_pair else 1
    records[5][2]["snapshot"] = snapshot
    records += [
        ("assertion", "S01", {"id": "ask-domain-state-unchanged", "passed": True}),
        ("blocked_step", "S03", {"reason": "browser binding absent"}),
    ]
    if finish:
        records.append(("run_end", "S03", {"status": "REVIEW"}))
    seal_events(directory, records, finish=finish)


def seal_events(directory, records, *, finish=True, prefix=""):
    previous = ""
    lines = []
    for index, (kind, step, data) in enumerate(records, 1):
        raw = json.dumps({"seq": index, "at": "2026-10-19T00:00:00Z", "step": step,
                          "kind": kind, "previous_sha256": previous, "data": data}, ensure_ascii=False).encode()
        previous = hashlib.sha256(raw).hexdigest()
        lines.append(raw)
    (directory / f"{prefix}events.jsonl").write_bytes(b"\n".join(lines) + b"\n")
    if finish:
        (directory / f"{prefix}root.sha256").write_text(previous + "\n")


def replay_records():
    """Synthetic evidence for provenance checks only, never narrative acceptance."""
    f = fixture()
    initial = {"revision": 1, "mode": "begin", "input": f["seed"], "text": f["opening"]}
    committed = {"revision": 2, "mode": "ask", "input": f["steps"][0]["input"], "text": "Synthetic answer."}
    return [
        ("manifest", "", {"fixture": f, "fixture_sha256": "0" * 64}),
        ("initial_readback", "", {"snapshot": f["state"], "public_view": {"revision": 1, "pages": [initial]}}),
        ("operation_request", "S01", {"request": {"mode": "ask", "input": committed["input"], "expected_revision": 1}, "before": f["state"]}),
        ("model_request", "S01", {"call": 1, "request": {}}),
        ("model_result", "S01", {"call": 1, "result": {}, "error": ""}),
        ("operation_committed", "S01", {"snapshot": f["state"], "public_view": {"revision": 2, "pages": [initial.copy(), committed]}, "elapsed_ms": 10}),
        ("run_end", "S01", {"status": "FAIL"}),
    ]


def resume_records(directory, source=None, *, version=2):
    source = replay_records() if source is None else source
    seal_events(directory, source, prefix="source-")
    pages = []
    for kind, step, data in source:
        if kind in {"initial_readback", "operation_committed"}:
            pages.append({"step": step, "page": data["public_view"]["pages"][-1], "state": data["snapshot"]})
    manifest = {"source_root": (directory / "source-root.sha256").read_text().strip(),
                "events_sha256": hashlib.sha256((directory / "source-events.jsonl").read_bytes()).hexdigest(), "pages": pages}
    fixture_raw = json.dumps(source[0][2]["fixture"], ensure_ascii=False).encode()
    if version >= 2:
        (directory / "fixture.json").write_bytes(fixture_raw)
    return [
        ("manifest", "", {"fixture": source[0][2]["fixture"], "fixture_sha256": hashlib.sha256(fixture_raw).hexdigest(), "evidence_version": version}),
        ("resume_manifest", "", manifest),
        ("initial_readback", "", {"snapshot": pages[0]["state"], "public_view": {"revision": 1, "pages": [pages[0]["page"]]}}),
        ("resume_readback", "", {"public_view": {"revision": len(pages), "pages": [p["page"] for p in pages]},
                                    "snapshots": [{"revision": p["page"]["revision"], "state": p["state"]} for p in pages]}),
        ("restored_step", "S01", pages[1]),
        ("run_end", "S01", {"status": "REVIEW"}),
    ]


class NativeBenchmarkTests(unittest.TestCase):
    def test_external_gate_binds_source_bytes_and_both_exact_citations(self):
        module = load_native(self)
        for mutation in ("valid", "deny", "root", "quote", "pointer", "missing_snapshot", "method", "bytes", "deny_action"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                source = replay_records()
                f = source[0][2]["fixture"]
                f["steps"][3].update(requires_steps=["S01"], evidence_gate="permission")
                records = resume_records(directory, source)
                decision = {"version": 1, "source_root": records[1][2]["source_root"], "case_id": f["id"],
                            "step_id": "S04", "gate_id": "permission", "decision": "allow", "reviewer": "synthetic-reviewer",
                            "method": "model_review", "note": "Synthetic provenance test, not a narrative permission judgment.",
                            "citations": [
                                {"event_seq": 6, "step_id": "S01", "revision": 2, "kind": "prose", "quote": "Synthetic answer."},
                                {"event_seq": 6, "step_id": "S01", "revision": 2, "kind": "snapshot", "pointer": "/story_time", "quote": f["state"]["story_time"]}]}
                if mutation in {"deny", "deny_action"}:
                    decision["decision"] = "deny"
                elif mutation == "root":
                    decision["source_root"] = "0" * 64
                elif mutation == "quote":
                    decision["citations"][0]["quote"] = "Invented permission"
                elif mutation == "pointer":
                    decision["citations"][1]["pointer"] = "/missing"
                elif mutation == "missing_snapshot":
                    decision["citations"].pop()
                elif mutation == "method":
                    decision["method"] = "deterministic"
                raw = json.dumps(decision, ensure_ascii=False).encode()
                (directory / "gate-S04.json").write_bytes(raw if mutation != "bytes" else b"{}")
                records.pop()
                records.append(("gate_decision", "S04", {"file": "gate-S04.json", "decision_sha256": hashlib.sha256(raw).hexdigest(), "decision": decision}))
                if mutation == "deny":
                    records.append(("blocked_step", "S04", {"reason": "independent decision denied"}))
                else:
                    pages = records[1][2]["pages"]
                    new_page = {"revision": 3, "mode": "act", "input": f["steps"][3]["input"], "text": "Synthetic search."}
                    records.extend([
                        ("operation_request", "S04", {"request": {"mode": "act", "input": new_page["input"], "expected_revision": 2}, "before": f["state"]}),
                        ("model_request", "S04", {"call": 1, "request": {}}),
                        ("model_result", "S04", {"call": 1, "result": {}, "error": ""}),
                        ("operation_committed", "S04", {"snapshot": f["state"], "public_view": {"revision": 3, "pages": [p["page"] for p in pages] + [new_page]}})])
                records.append(("run_end", "S04", {"status": "REVIEW"}))
                seal_events(directory, records)
                if mutation in {"valid", "deny"}:
                    result = module.verify_native(directory, CATALOG)
                    self.assertEqual("VERIFIED", result["integrity"])
                    self.assertEqual("REVIEW" if mutation == "valid" else "BLOCKED", result["steps"]["S04"])
                    self.assertEqual(decision["decision"], result["gate_decisions"]["S04"]["decision"])
                else:
                    with self.assertRaises(ValueError):
                        module.verify_native(directory, CATALOG)

    def test_main_run_checks_complete_immutable_history_and_revision(self):
        module = load_native(self)
        for mutation in ("missing_view", "old_revision", "rewrite", "expected_revision", "no_calls", "opening", "seed", "begin"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = replay_records()
                if mutation == "missing_view":
                    del records[5][2]["public_view"]
                elif mutation == "old_revision":
                    records[5][2]["public_view"] = records[1][2]["public_view"]
                elif mutation == "rewrite":
                    records[5][2]["public_view"]["pages"][0]["text"] = "Rewritten"
                elif mutation == "expected_revision":
                    records[2][2]["request"]["expected_revision"] = 999
                elif mutation == "no_calls":
                    del records[3:5]
                else:
                    field = {"opening": "text", "seed": "input", "begin": "mode"}[mutation]
                    records[1][2]["public_view"]["pages"][0][field] = "different"
                    records[5][2]["public_view"]["pages"][0][field] = "different"
                seal_events(directory, records)
                with self.assertRaises(ValueError):
                    module.verify_native(directory, CATALOG)

    def test_execution_policy_dependencies_and_closed_gates_are_enforced(self):
        module = load_native(self)
        for mutation in ("unexecuted", "blocked", "gate"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = replay_records()
                f = records[0][2]["fixture"]
                if mutation == "gate":
                    f["steps"][0]["evidence_gate"] = "approval"
                else:
                    # S02 must not treat S01's absent/blocked evidence as completed.
                    f["steps"][1]["requires_steps"] = ["S01"]
                    records = records[:2]
                    if mutation == "blocked":
                        records.append(("blocked_step", "S01", {"reason": "unsupported"}))
                    records.append(("observation", "S02", {"snapshot": f["state"], "public_view": records[1][2]["public_view"]}))
                    records.append(("run_end", "S02", {"status": "REVIEW"}))
                seal_events(directory, records)
                with self.assertRaisesRegex(ValueError, "[Dd]ependen|[Gg]ate"):
                    module.verify_native(directory, CATALOG)

    def test_fixture_policy_accepts_only_prior_unique_dependencies(self):
        module = load_native(self)
        good = fixture()
        good["steps"][1]["requires_steps"] = ["S01"]
        good["steps"][1]["evidence_gate"] = "approval"
        module.validate_fixture(good, CATALOG)
        for dependencies in (["S02"], ["S99"], ["S01", "S01"], "S01", [True], []):
            with self.subTest(dependencies=dependencies):
                bad = fixture()
                bad["steps"][1]["requires_steps"] = dependencies
                with self.assertRaises(ValueError):
                    module.validate_fixture(bad, CATALOG)

    def test_completed_step_satisfies_a_later_dependency(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            records = replay_records()
            records[0][2]["fixture"]["steps"][1]["requires_steps"] = ["S01"]
            records.insert(-1, ("observation", "S02", {"snapshot": fixture()["state"],
                                                      "public_view": records[5][2]["public_view"]}))
            seal_events(directory, records)
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("REVIEW", result["steps"]["S02"])

    def test_observation_cannot_replace_an_action_or_change_authoritative_readback(self):
        module = load_native(self)
        for mutation in ("action", "snapshot", "history"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = replay_records()
                data = {"snapshot": fixture()["state"], "public_view": records[5][2]["public_view"]}
                if mutation == "snapshot":
                    data["snapshot"]["story_time"] = "a different day"
                elif mutation == "history":
                    data["public_view"] = records[1][2]["public_view"]
                records.insert(-1, ("observation", "S04" if mutation == "action" else "S02", data))
                seal_events(directory, records)
                with self.assertRaisesRegex(ValueError, "[Oo]bservation"):
                    module.verify_native(directory, CATALOG)

    def test_resume_cannot_substitute_the_same_false_initial_page_everywhere(self):
        module = load_native(self)
        for field in ("text", "input", "mode"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                source = replay_records()
                source[1][2]["public_view"]["pages"][0][field] = "replacement"
                source[5][2]["public_view"]["pages"][0][field] = "replacement"
                seal_events(directory, resume_records(directory, source))
                with self.assertRaisesRegex(ValueError, "[Ii]nitial.*fixture"):
                    module.verify_native(directory, CATALOG)

    def test_repository_fixtures_match_original_step_inputs_modes_and_lines(self):
        module = load_native(self)
        paths = list((ROOT / "backend/internal/experience/testdata/deep_benchmark").glob("*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            with self.subTest(path=path.name):
                module.validate_fixture(json.loads(path.read_text(encoding="utf-8")), CATALOG)
        bad = fixture()
        bad["steps"][0]["input"] = "我已经知道付款完成。"
        with self.assertRaises(ValueError):
            module.validate_fixture(bad, CATALOG)
        bad = fixture()
        bad["source_line"] += 1
        with self.assertRaises(ValueError):
            module.validate_fixture(bad, CATALOG)

    def test_complete_chain_is_review_and_preserves_unrun_and_blocked_steps(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            write_events(directory)
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("REVIEW", result["status"])
            self.assertEqual("BLOCKED", result["steps"]["S03"])
            self.assertEqual("NOT_RUN", result["steps"]["S08"])
            self.assertEqual(1, result["independent_checks"]["ask_snapshot_unchanged"]["verified"])

    def test_missing_end_or_root_is_incomplete_not_pass(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            write_events(directory, finish=False)
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("INCOMPLETE", result["integrity"])
            self.assertEqual("INCONCLUSIVE", result["status"])

    def test_modified_bytes_sequence_and_unpaired_calls_are_rejected(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            write_events(directory)
            event_path = directory / "events.jsonl"
            original = event_path.read_bytes()
            event_path.write_bytes(original.replace(b'"passed": true', b'"passed": false'))
            with self.assertRaises(ValueError):
                module.verify_native(directory, CATALOG)
            write_events(directory, broken_pair=True)
            with self.assertRaises(ValueError):
                module.verify_native(directory, CATALOG)

    def test_state_mutation_cannot_hide_behind_a_self_reported_pass(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            write_events(directory, changed_state=True)
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("FAIL", result["status"])
            self.assertEqual(1, result["independent_checks"]["ask_snapshot_unchanged"]["failed"])

    def test_actual_request_must_match_registered_input_and_mode(self):
        module = load_native(self)
        for field, value in (("input", "Different player action"), ("mode", "act"), ("reading_request", "Unregistered direction")):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = replay_records()
                records[2][2]["request"][field] = value
                seal_events(directory, records)
                with self.assertRaisesRegex(ValueError, "request.*benchmark"):
                    module.verify_native(directory, CATALOG)

    def test_resume_preserves_original_failure_without_counting_restored_model_calls(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            seal_events(directory, resume_records(directory))
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("REVIEW", result["status"])
            self.assertEqual("RESTORED", result["steps"]["S01"])
            self.assertEqual(0, result["model_calls"])
            self.assertEqual("FAIL", result.get("resume_source", {}).get("status"))
            self.assertEqual(1, result.get("resume_source", {}).get("model_calls"))
            self.assertEqual("VERIFIED", result.get("resume_readback"))

    def test_resume_rejects_resealed_but_invalid_source_operations_and_history(self):
        module = load_native(self)
        for mutation in ("input", "unpaired", "rewrite", "revision"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                source = replay_records()
                if mutation == "input":
                    source[2][2]["request"]["input"] = "A different action"
                elif mutation == "unpaired":
                    source.pop(4)
                elif mutation == "rewrite":
                    source[5][2]["public_view"]["pages"][0]["text"] = "Rewritten initial history"
                else:
                    source[5][2]["public_view"]["revision"] = 7
                seal_events(directory, resume_records(directory, source))
                with self.assertRaises(ValueError):
                    module.verify_native(directory, CATALOG)

    def test_resume_checks_independent_full_history_readback(self):
        module = load_native(self)
        for mutation in ("page", "state", "revision"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = resume_records(directory)
                # Break aliases so only the independent readback is changed.
                readback = json.loads(json.dumps(records[3][2]))
                if mutation == "page":
                    readback["public_view"]["pages"][1]["text"] = "Other text"
                elif mutation == "state":
                    readback["snapshots"][1]["state"] = {"wrong": "state"}
                else:
                    readback["public_view"]["revision"] = 99
                records[3] = ("resume_readback", "", readback)
                seal_events(directory, records)
                with self.assertRaisesRegex(ValueError, "[Rr]esume.*readback"):
                    module.verify_native(directory, CATALOG)

    def test_v2_resume_requires_readback_and_all_restored_markers(self):
        module = load_native(self)
        for omitted in ("resume_readback", "restored_step"):
            with self.subTest(omitted=omitted), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = [r for r in resume_records(directory) if r[0] != omitted]
                seal_events(directory, records)
                result = module.verify_native(directory, CATALOG)
                self.assertEqual("INCOMPLETE", result["integrity"])
                self.assertEqual("INCONCLUSIVE", result["status"])

    def test_legacy_resume_identifies_missing_independent_history_readback(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            records = [r for r in resume_records(directory, version=1) if r[0] != "resume_readback"]
            seal_events(directory, records)
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("LEGACY_NOT_RECORDED", result.get("resume_readback"))

    def test_restored_steps_cannot_be_reexecuted_or_relabelled(self):
        module = load_native(self)
        for kind in ("operation_request", "observation", "blocked_step"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = resume_records(directory)
                data = replay_records()[2][2] if kind == "operation_request" else {"reason": "changed status"}
                records.insert(-1, (kind, "S01", data))
                seal_events(directory, records)
                with self.assertRaises(ValueError):
                    module.verify_native(directory, CATALOG)

    def test_recorded_fixture_bytes_must_match_hash_and_manifest_object(self):
        module = load_native(self)
        for mutation in ("hash", "object", "missing"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = replay_records()
                fixture_raw = json.dumps(fixture(), ensure_ascii=False).encode()
                (directory / "fixture.json").write_bytes(fixture_raw)
                records[0][2].update(evidence_version=2, fixture_sha256=hashlib.sha256(fixture_raw).hexdigest())
                if mutation == "hash":
                    (directory / "fixture.json").write_bytes(b"{}")
                elif mutation == "object":
                    records[0][2]["fixture"]["opening"] = "An unregistered initial scene."
                else:
                    (directory / "fixture.json").unlink()
                seal_events(directory, records)
                with self.assertRaisesRegex(ValueError, "[Ff]ixture"):
                    module.verify_native(directory, CATALOG)

    def test_before_snapshot_cannot_be_forged_to_hide_ask_mutation(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            records = replay_records()
            changed = {**fixture()["state"], "story_time": "19:00"}
            records[2][2]["before"] = changed
            records[5][2]["snapshot"] = changed
            seal_events(directory, records)
            with self.assertRaisesRegex(ValueError, "snapshot"):
                module.verify_native(directory, CATALOG)

    def test_model_call_requires_an_active_product_operation(self):
        module = load_native(self)
        for mutation in ("before_operation", "after_commit"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                records = replay_records()
                model_pair = records[3:5]
                del records[3:5]
                position = 2 if mutation == "before_operation" else -1
                records[position:position] = model_pair
                seal_events(directory, records)
                with self.assertRaisesRegex(ValueError, "active.*operation|committed.*model calls"):
                    module.verify_native(directory, CATALOG)


if __name__ == "__main__":
    unittest.main()
