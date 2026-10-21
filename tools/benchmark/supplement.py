"""Verify independent benchmark supplements without changing base-run verdicts.

Integrity is consistency with retained evidence, not external attestation of DB
isolation or model provenance. Successful structure still requires prose review.
"""
from __future__ import annotations

import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import sys

from native import (PROJECTION_MIGRATION, digest, migrate_information_page,
                    replay_pages, validate_history, validate_projection_view,
                    validate_restored_titles, verify_native)

ROOT = Path(__file__).resolve().parents[2]
RULE = "本世界使用贝币和岚币，固定汇率为3枚贝币兑换1枚岚币。"
QUESTION = "按这里的固定汇率，2枚岚币可以兑换多少枚贝币？"


def currency_initialization():
    """Public author facts only; the derived answer is intentionally absent."""
    return {"id": "SYS-014-S05-currency-control", "source_sha256": "", "source_line": 0,
            "variant": "supplement", "seed": "商港使用贝币和岚币。", "opening": RULE,
            "state": {"story_time": "商港开市时", "entities": [
                {"id": "shell-currency", "kind": "currency", "name": "贝币", "description": "商港使用的货币", "known": True, "related_ids": []},
                {"id": "mist-currency", "kind": "currency", "name": "岚币", "description": "商港使用的货币", "known": True, "related_ids": []}],
                "facts": [{"id": "fixed-currency-rate", "kind": "rule", "text": RULE, "subject_id": "", "known": True, "known_by": [], "source_revision": 1}], "threads": []},
            "steps": [{"id": "currency-ask", "mode": "ask", "input": QUESTION}], "private_tokens": [],
            "omissions": ["Evaluator-authored synthetic formal prehistory. No cash balance, exchange transaction or expected answer is initialized."]}


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def sealed_events(directory, prefix, first, last):
    raw = (directory / f"{prefix}events.jsonl").read_bytes()
    if not raw or len(raw) > 32 << 20 or not raw.endswith(b"\n"):
        raise ValueError("Supplement/source event stream is not sealed")
    previous, events = "", []
    for index, line in enumerate(raw.splitlines(), 1):
        event = strict_json(line)
        if (event.get("seq") != index or event.get("previous_sha256") != previous or
                not isinstance(event.get("data"), dict)):
            raise ValueError("Broken supplement/source event chain")
        previous = digest(line)
        events.append(event)
    if (events[0].get("kind") != first or events[-1].get("kind") != last or
            sum(e.get("kind") == first for e in events) != 1 or
            sum(e.get("kind") == last for e in events) != 1 or
            (directory / f"{prefix}root.sha256").read_text().strip() != previous):
        raise ValueError("Supplement/source root or event boundaries differ")
    return events, previous, digest(raw)


def bound_json(directory, filename, expected_hash):
    raw = (directory / filename).read_bytes()
    if digest(raw) != expected_hash:
        raise ValueError(f"{filename} byte hash differs")
    return strict_json(raw)


def readback_scope(readback, role):
    scope, history = readback.get("scope", {}), readback.get("history", {})
    view = history.get("public_view", {})
    if (scope.get("role") != role or not all(isinstance(scope.get(key), str) and scope[key]
            for key in ("account", "experience_id", "branch_id")) or
            view.get("id") != scope["experience_id"] or view.get("branch_id") != scope["branch_id"] or
            not isinstance(readback.get("preferences"), list)):
        raise ValueError("Readback logical scope/preferences are missing or inconsistent")
    return scope, history


def model_user(request, model):
    messages = request.get("messages", [])
    if (request.get("model") != model or request.get("max_output_tokens") != 8192 or
            not isinstance(request.get("schema"), dict) or not request["schema"] or
            len(messages) != 2 or messages[0].get("role") != "system" or not messages[0].get("content") or messages[1].get("role") != "user"):
        raise ValueError("Model request shape/schema/budget differs")
    user = strict_json(messages[1]["content"])
    if not isinstance(user, dict):
        raise ValueError("Model user must be a single JSON object")
    return user


def currency_model_context(context, scope, state):
    allowed = {"version", "experience_id", "branch_id", "revision", "next_revision", "mode", "input", "state", "preferences", "reading_request", "history", "history_complete", "state_coverage", "historical_recalls", "read_budget"}
    if (context.get("mode") != "ask" or context.get("input") != QUESTION or
            context.get("state") != state or context.get("revision") != 1 or
            context.get("experience_id") != scope["experience_id"] or context.get("branch_id") != scope["branch_id"] or
            set(context) - allowed):
        raise ValueError("Model did not receive original currency state/question/scope")


def verify_currency(directory, catalog):
    directory = Path(directory)
    events, root, _ = sealed_events(directory, "", "supplement_manifest", "supplement_end")
    manifest = events[0]["data"]
    if (manifest.get("schema_version"), manifest.get("kind"), manifest.get("case_id"), manifest.get("step_id")) != (1, "sys014_currency_positive_control", "SYS-014", "S05"):
        raise ValueError("Unknown supplement schema/case/step")
    if manifest.get("separate_databases") is not True:
        raise ValueError("Supplement did not declare separate isolated databases")
    source_events, source_root, source_sha = sealed_events(directory, "source-", "manifest", "run_end")
    if source_root != manifest.get("source_root") or source_sha != manifest.get("source_events_sha256"):
        raise ValueError("Original source identity differs")
    source_report = verify_native(directory, catalog, _source=True)
    if source_report["integrity"] != "VERIFIED" or source_report["case_id"] != "SYS-014" or source_report["steps"].get("S05") != "BLOCKED":
        raise ValueError("Supplement requires sealed SYS-014 with original S05 BLOCKED")
    source_manifest = source_events[0]["data"]
    fixture = bound_json(directory, "source-fixture.json", manifest.get("source_fixture_sha256"))
    if fixture != source_manifest.get("fixture") or manifest["source_fixture_sha256"] != source_manifest.get("fixture_sha256"):
        raise ValueError("Original fixture differs")
    step = next(s for s in fixture["steps"] if s["id"] == "S05")
    if manifest.get("step") != step or manifest.get("step_input") != step["input"]:
        raise ValueError("Original S05 text/metadata differs")
    build_raw = (directory / "source-build-manifest.json").read_bytes()
    build = strict_json(build_raw)
    if (digest(build_raw.removesuffix(b"\n")) != manifest.get("source_tree_sha256") or
            manifest["source_tree_sha256"] != source_manifest.get("source_tree_sha256") or
            build.get("backend/internal/experience/testdata/deep_benchmark/SYS-014.json") != manifest["source_fixture_sha256"]):
        raise ValueError("Original source build/fixture binding differs")
    current_build = (directory / "current-build-manifest.json").read_bytes()
    if not isinstance(strict_json(current_build), dict) or digest(current_build.removesuffix(b"\n")) != manifest.get("current_source_tree_sha256"):
        raise ValueError("Current frozen source manifest binding differs")
    with (directory / "algorithm-runtime").open("rb") as runtime:
        if hashlib.file_digest(runtime, "sha256").hexdigest() != manifest.get("runtime_sha256"):
            raise ValueError("Pinned runtime binary hash differs")
    budgets = {"max_model_calls_per_operation": 12, "max_repairs": 1, "context_token_limit": 65536, "max_output_tokens": 8192, "operations_authorized": 1, "retry": False}
    if any(type(manifest.get(key)) is not type(value) or manifest[key] != value for key, value in budgets.items()) or not manifest.get("engine"):
        raise ValueError("Supplement operation/model budget differs")
    prereg = bound_json(directory, "preregistration.json", manifest.get("preregistration_sha256"))
    if prereg != {"version": 1, "currencies": ["贝币", "岚币"], "rule": RULE, "input": QUESTION}:
        raise ValueError("Preregistered currency direction/question differs or contains extra oracle")
    currency = bound_json(directory, "currency-fixture.json", manifest.get("currency_fixture_sha256"))
    if currency != manifest.get("currency_fixture") or manifest.get("currency_input") != QUESTION:
        raise ValueError("Currency initialization/input differs from its original bytes")
    state = currency.get("state", {})
    if currency != currency_initialization():
        raise ValueError("Currency world is not the minimal registered public rule")
    pages = replay_pages(source_events, fixture, titles=True)
    expected_source_snapshots = [{"revision": p["page"]["revision"], "state": p["state"]} for p in pages]
    expected_source_pages = [p["page"] for p in pages]
    kinds = [e["kind"] for e in events]
    if kinds[:4] != ["supplement_manifest", "original_readback_before", "currency_initial_readback", "currency_operation_request"] or kinds[-3:] != ["original_readback_after", "source_files_readback", "supplement_end"]:
        raise ValueError("Supplement readback/request order differs")
    if any(e.get("step") not in {"", "S05"} for e in events):
        raise ValueError("Unexpected supplement step")
    before, initial, operation_request = (e["data"] for e in events[1:4])
    original_scope, original_history = readback_scope(before, "original-restored")
    if (original_history.get("stored_pages") != expected_source_pages or
            original_history.get("snapshots") != expected_source_snapshots or
            original_history.get("projection_migration") != PROJECTION_MIGRATION or
            original_history.get("public_view", {}).get("revision") != len(pages)):
        raise ValueError("Original restored history/snapshots differ from source")
    migrated = [migrate_information_page(p["page"], p["state"]) for p in pages]
    validate_projection_view(original_history["public_view"], migrated)
    original_titles = validate_restored_titles(original_history, pages)
    if events[-3]["data"] != before:
        raise ValueError("Original restored world/history/branches/preferences changed")
    file_readback = events[-2]["data"]
    expected_hashes = {name: digest((directory / ("source-" + name)).read_bytes()) for name in ("events.jsonl", "root.sha256", "fixture.json")}
    if file_readback.get("sha256") != expected_hashes or file_readback.get("unchanged") is not True or file_readback.get("error") != "":
        raise ValueError("Original source files did not retain exact bytes")
    currency_scope, currency_history = readback_scope(initial, "currency-positive-control")
    if currency_scope["account"] == original_scope["account"]:
        raise ValueError("Logical original/currency scopes are not distinct")
    if currency_history.get("snapshots") != [{"revision": 1, "state": state}]:
        raise ValueError("Initial currency snapshot differs")
    if currency_history.get("stored_pages") is not None or currency_history.get("projection_migration", ""):
        raise ValueError("New currency world must not masquerade as a restored projection")
    initial_pages = validate_history({"public_view": currency_history["public_view"], "snapshot": state}, [], currency)
    request = operation_request.get("request", {})
    if (operation_request.get("scope") != currency_scope or operation_request.get("before") != state or
            request.get("mode") != "ask" or request.get("input") != QUESTION or request.get("expected_revision") != 1 or
            request.get("branch_id") != currency_scope["branch_id"] or not request.get("request_id") or request.get("reading_request", "")):
        raise ValueError("Actual single ask differs from preregistered question/scope")
    requests, results, stages, users, settlement = {}, {}, {}, {}, None
    for event in events[4:-3]:
        kind, data = event["kind"], event["data"]
        if settlement is not None:
            raise ValueError("Unexpected event after currency operation settlement")
        if kind == "model_request":
            call = data.get("call")
            if type(call) is not int or call != len(requests) + 1 or call > 12 or requests.keys() != results.keys():
                raise ValueError("Model request order/pairing differs")
            users[call] = model_user(data.get("request", {}), manifest.get("model"))
            currency_model_context(users[call].get("context", users[call]), currency_scope, state)
            requests[call] = data
        elif kind == "model_result":
            call = data.get("call")
            if call not in requests or call in results or not isinstance(data.get("result"), dict) or not isinstance(data.get("error"), str):
                raise ValueError("Model result lacks its unique original request")
            results[call] = data
        elif kind == "stage":
            call = len(results)
            if not results or requests.keys() != results.keys() or call in stages or not isinstance(data.get("stage"), str):
                raise ValueError("Stage precedes model result")
            stages[call] = data
        elif kind in {"currency_operation_committed", "currency_operation_failure"}:
            settlement = event
        else:
            raise ValueError(f"Unexpected currency supplement event: {kind}")
    if settlement is None or requests.keys() != results.keys():
        raise ValueError("Incomplete currency operation/model evidence")
    data = settlement["data"]
    if data.get("model_calls") != len(requests):
        raise ValueError("Currency operation model count differs")
    final_scope, final_history = readback_scope(data.get("readback", {}), "currency-positive-control")
    if final_scope != currency_scope or data["readback"]["preferences"] != initial["preferences"]:
        raise ValueError("Currency scope/preferences changed")
    if final_history.get("stored_pages") is not None or final_history.get("projection_migration", ""):
        raise ValueError("Currency result cannot switch to a restored projection")
    operation = data.get("operation", {})
    if (operation.get("request_id") != request["request_id"] or operation.get("experience_id") != currency_scope["experience_id"] or
            operation.get("branch_id") != currency_scope["branch_id"] or operation.get("base_revision") != 1):
        raise ValueError("Currency operation identity differs")
    declared_status = events[-1]["data"].get("status")
    if declared_status not in {"REVIEW", "FAIL"}:
        raise ValueError("Supplement may not declare benchmark acceptance")
    committed = settlement["kind"] == "currency_operation_committed"
    if committed:
        if (not requests or data.get("error") != "" or any(r["error"] for r in results.values()) or
                operation.get("status") != "committed" or operation.get("committed_revision") != 2):
            raise ValueError("Committed ask lacks successful model/operation evidence")
        if final_history.get("snapshots") != [{"revision": 1, "state": state}, {"revision": 2, "state": state}]:
            raise ValueError("Ask changed initial/current domain snapshot or time")
        answer_pages = validate_history({"public_view": final_history["public_view"], "snapshot": state}, initial_pages, currency, request)
        if not isinstance(answer_pages[-1].get("text"), str) or not answer_pages[-1]["text"].strip():
            raise ValueError("Committed answer text missing")
        final_call = len(requests)
        if (stages.keys() != requests.keys() or stages[1]["stage"] != "answer" or
                stages[final_call]["stage"] not in {"review", "repair_review"} or any(s.get("error") for s in stages.values())):
            raise ValueError("Committed answer lacks complete answer/review stage bindings")
        candidate = users[final_call].get("candidate", {})
        last = answer_pages[-1]
        for candidate_key, page_key in (("passage", "text"), ("story_time", "story_time"), ("outcome", "outcome"), ("suggestions", "suggestions")):
            if candidate.get(candidate_key) != last.get(page_key):
                raise ValueError("Official answer differs from its original reviewed candidate")
        review = strict_json(results[final_call]["result"].get("text", "")).get("result", {})
        if review.get("approved") is not True or review.get("issues") != []:
            raise ValueError("Committed answer lacks actual approved review evidence")
        fields = ("title", "passage", "story_time", "outcome", "suggestions")
        original_drafts = [strict_json(results[call]["result"].get("text", "")).get("result", {}) for call, stage in stages.items() if stage["stage"] in {"answer", "revise"}]
        if not any(all(draft.get(key) == candidate.get(key) for key in fields) for draft in original_drafts):
            raise ValueError("Reviewed candidate differs from actual answer/revise output")
    else:
        if (not data.get("error") or declared_status != "FAIL" or operation.get("status") not in {"failed", "cancelled"} or operation.get("committed_revision") is not None or
                final_history.get("snapshots") != currency_history["snapshots"] or
                final_history.get("public_view", {}).get("pages") != initial_pages or final_history.get("public_view", {}).get("revision") != 1):
            raise ValueError("Failed ask did not preserve original currency world")
    return {"case_id": "SYS-014", "step_id": "S05", "source_root": source_root, "root_sha256": root,
            "integrity": "VERIFIED", "status": "REVIEW" if committed and declared_status == "REVIEW" else "FAIL",
            "source_step_status": source_report["steps"]["S05"], "source_status": source_report["status"],
            "original_titles": original_titles,
            "supplemental_evidence": "separate_currency_world_ask", "model_calls": len(requests),
            "arithmetic_semantics": "REVIEW" if committed else "NOT_REACHED", "independent_expected_quantity": str(Fraction(2) * Fraction(3)),
            "expected_unit": "贝币", "answer_event_seq": settlement["seq"] if committed else None,
            "notice": "Original BLOCKED is preserved. Arithmetic/meaning requires independent exact-prose review; no digit search or whole-case PASS. Isolation and actual-model claims remain runner evidence, not external attestation."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("verify-currency")
    command.add_argument("--run", type=Path, required=True)
    command.add_argument("--catalog", type=Path, default=ROOT / "tests/benchmark/catalog.json")
    args = parser.parse_args()
    try:
        print(json.dumps(verify_currency(args.run, strict_json(args.catalog.read_bytes())), ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, TypeError, StopIteration) as error:
        print(f"benchmark supplement: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
