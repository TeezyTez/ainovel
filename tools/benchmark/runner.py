"""Project-local evidence runner; independent of the unavailable upstream zip.

A successful process is REVIEW, never acceptance. Reviews are separate, hashed
addenda. This tool does not send benchmark text to a product or judge model.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from catalog import extract, inventory, sha256
from native import verify_native

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = ROOT / "tests/benchmark/catalog.json"
STATUSES = ("NOT_RUN", "PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "REVIEW")
BASE_ENV = {"PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME",
            "USERPROFILE", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "SYSTEMDRIVE"}


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def load_catalog(path):
    path = Path(path).resolve()
    catalog = read_json(path)
    source = path.parent / catalog["source"]["file"]
    if sha256(source.read_bytes()) != catalog["source"]["sha256"]:
        raise ValueError("Benchmark source hash mismatch")
    if extract(source)["cases"] != catalog["cases"]:
        raise ValueError("Catalog no longer matches the source; regenerate, do not edit definitions")
    return catalog


def select_case(catalog, case_id):
    for case in catalog["cases"]:
        if case["id"] == case_id:
            return case
    raise ValueError(f"Unknown case {case_id}")


def case_checks(case):
    result = {check["id"]: check for group in case["checks"].values() for check in group}
    result.update({step["id"]: {**step, "kind": "steps", "automatic_pass_allowed": None} for step in case["steps"]})
    return result


def registry(catalog):
    cases = {}
    for case in catalog["cases"]:
        item = {"title": case["title"], "parent_case_id": case["parent_case_id"],
                "status": "NOT_RUN", "source_sha256": case["source"]["sha256"],
                "requirement_links": "related_only_not_passed_coverage"}
        for kind, checks in {**case["checks"], "steps": case["steps"]}.items():
            item[kind] = {check["id"]: {"status": "NOT_RUN", "evidence": []} for check in checks}
        cases[case["id"]] = item
    return {"schema_version": 1, "created_at": now(), "source_sha256": catalog["source"]["sha256"],
            "notice": "Frozen denominator. No copied source status counts as product execution.", "cases": cases}


def file_record(path, root):
    data = path.read_bytes()
    return {"path": path.relative_to(root).as_posix(), "sha256": sha256(data), "bytes": len(data)}


def verify_bundle(directory):
    directory = Path(directory).resolve()
    manifest_path = directory / "bundle.json"
    manifest = read_json(manifest_path)
    if manifest.get("schema_version") != 1 or not manifest.get("files"):
        raise ValueError("Missing bundle manifest entries")
    listed = set()
    for entry in manifest["files"]:
        relative = entry["path"]
        supplied_path = directory / relative
        path = supplied_path.resolve()
        if not path.is_relative_to(directory) or path == manifest_path or relative in listed:
            raise ValueError(f"Invalid or duplicate bundle path: {relative}")
        listed.add(relative)
        if not path.is_file() or supplied_path.is_symlink():
            raise ValueError(f"Missing or linked evidence: {relative}")
        if file_record(path, directory) != entry:
            raise ValueError(f"Evidence hash/length mismatch: {relative}")
    actual = {path.relative_to(directory).as_posix() for path in directory.rglob("*") if path.is_file()}
    if actual != listed | {"bundle.json"}:
        raise ValueError("Unlisted or missing files in sealed bundle")
    if not {"run.json", "stdout.txt", "stderr.txt", "selection.json"}.issubset(listed):
        raise ValueError("Incomplete process evidence")
    report = read_json(directory / "run.json")
    if report["status"] not in {"REVIEW", "FAIL", "INCONCLUSIVE"}:
        raise ValueError("A process bundle cannot declare acceptance")
    if report["exit_code"] != 0 and report["status"] != "FAIL":
        raise ValueError("Nonzero child exit was not marked FAIL")
    selection = read_json(directory / "selection.json")
    if [case["id"] for case in selection["cases"]] != report["case_ids"]:
        raise ValueError("Selected cases differ from process report")
    return {"integrity": "VERIFIED", "status": report["status"], "scope": report["scope"],
            "bundle_sha256": sha256(manifest_path.read_bytes()), "case_ids": report["case_ids"]}


def stop_owned_process(process):
    if os.name == "posix":
        os.killpg(process.pid, signal.SIGTERM)
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait()


def run(args):
    catalog = load_catalog(args.catalog)
    cases = [select_case(catalog, case_id) for case_id in args.case]
    if len(set(args.case)) != len(args.case):
        raise ValueError("Duplicate case selection")
    argv = read_json(args.argv_file)
    if not isinstance(argv, list) or not argv or any(not isinstance(item, str) or not item for item in argv):
        raise ValueError("argv file must contain a nonempty JSON array of nonempty strings")
    if args.timeout <= 0:
        raise ValueError("timeout must be positive")
    directory = args.out.resolve()
    directory.mkdir(parents=True, exist_ok=False)
    write_json(directory / "selection.json", {"source_sha256": catalog["source"]["sha256"],
               "catalog_sha256": sha256(args.catalog.read_bytes()),
               "cases": [{"id": case["id"], "sha256": case["source"]["sha256"]} for case in cases]})
    env_names = BASE_ENV | set(args.inherit_env)
    env = {name: value for name, value in os.environ.items() if name in env_names}
    report = {"schema_version": 1, "origin": "project_local_evidence_runner", "started_at": now(),
              "scope": "process_execution_only", "case_ids": args.case, "argv": argv,
              "cwd": str(args.cwd.resolve()), "inherited_env_names": sorted(env),
              "source_sha256": catalog["source"]["sha256"], "timed_out": False,
              "exit_code": None, "missing_artifacts": [], "artifacts": [],
              "notice": "Child output is evidence, not trusted acceptance. Human review is not simulated."}
    started = time.monotonic()
    with (directory / "stdout.txt").open("wb") as stdout, (directory / "stderr.txt").open("wb") as stderr:
        try:
            process = subprocess.Popen(argv, cwd=args.cwd, env=env, stdin=subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, shell=False,
                                       start_new_session=os.name == "posix")
            try:
                report["exit_code"] = process.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                report["timed_out"] = True
                stop_owned_process(process)
                report["exit_code"] = process.returncode
        except OSError as error:
            report["launch_error"] = str(error)
    for number, source in enumerate(args.artifact):
        if not source.is_file():
            report["missing_artifacts"].append(str(source))
            continue
        artifact_dir = directory / "artifacts"
        artifact_dir.mkdir(exist_ok=True)
        destination = artifact_dir / f"{number + 1:03d}-{source.name}"
        destination.write_bytes(source.read_bytes())
        report["artifacts"].append({"source_path": str(source.resolve()), **file_record(destination, directory)})
    report["finished_at"], report["duration_seconds"] = now(), round(time.monotonic() - started, 3)
    report["status"] = "FAIL" if report["exit_code"] != 0 or report["timed_out"] else (
        "INCONCLUSIVE" if report["missing_artifacts"] else "REVIEW")
    write_json(directory / "run.json", report)
    write_json(directory / "bundle.json", {"schema_version": 1, "created_at": now(),
               "files": [file_record(path, directory) for path in sorted(directory.rglob("*")) if path.is_file()]})
    summary = verify_bundle(directory)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "REVIEW" else 1


def assess(args):
    catalog = load_catalog(args.catalog)
    case = select_case(catalog, args.case)
    check = case_checks(case).get(args.check)
    if not check:
        raise ValueError(f"Unknown check {args.case}/{args.check}")
    verified = verify_bundle(args.bundle)
    if args.case not in verified["case_ids"]:
        raise ValueError("Assessment case was not selected in this run")
    selection = read_json(args.bundle / "selection.json")
    if selection["source_sha256"] != catalog["source"]["sha256"]:
        raise ValueError("Assessment source does not match the frozen run")
    if args.status == "PASS":
        if verified["status"] != "REVIEW":
            raise ValueError("Cannot pass a check using a failed or incomplete run")
        if check["kind"] == "quality" and args.method != "human_review":
            raise ValueError("Reader quality acceptance requires a real human review")
        if check.get("automatic_pass_allowed") is False and args.method == "deterministic":
            raise ValueError("The source disallows automatic PASS for this check")
    if not args.note.strip() or not args.reviewer.strip():
        raise ValueError("Assessment needs a concrete note and an identified reviewer")
    bundle = args.bundle.resolve()
    if args.out.resolve().is_relative_to(bundle):
        raise ValueError("Assessment addenda must be outside the sealed bundle")
    evidence = []
    listed = {entry["path"] for entry in read_json(bundle / "bundle.json")["files"]}
    for relative in args.evidence:
        if relative not in listed:
            raise ValueError(f"Evidence is not in the verified bundle: {relative}")
        evidence.append(file_record(bundle / relative, bundle))
    write_json(args.out, {"schema_version": 1, "created_at": now(), "case_id": args.case,
               "check_id": args.check, "kind": check["kind"], "status": args.status,
               "method": args.method, "reviewer": args.reviewer, "note": args.note,
               "source_sha256": catalog["source"]["sha256"], "bundle": str(bundle),
               "bundle_sha256": verified["bundle_sha256"], "evidence": evidence,
               "notice": "Human-authored assessment claim; hashes prove provenance, not judgment correctness."})
    print(json.dumps({"assessment": str(args.out), "status": args.status}))
    return 0


def rollup(statuses):
    values = set(statuses)
    if not values or values == {"NOT_RUN"}:
        return "NOT_RUN"
    if "FAIL" in values:
        return "FAIL"
    if values == {"PASS"}:
        return "PASS"
    if "REVIEW" in values:
        return "REVIEW"
    if values == {"BLOCKED"}:
        return "BLOCKED"
    return "INCONCLUSIVE"


def native_directories(path):
    directories = [path] if (path / "events.jsonl").is_file() else sorted(
        item.parent for item in path.glob("*/events.jsonl"))
    if not directories:
        raise ValueError(f"No native case event streams found: {path}")
    return directories


def report(args):
    catalog = load_catalog(args.catalog)
    data = read_json(args.registry)
    if data["source_sha256"] != catalog["source"]["sha256"]:
        raise ValueError("Registry source hash mismatch")
    expected = registry(catalog)
    if set(data["cases"]) != set(expected["cases"]):
        raise ValueError("Registry changed the case denominator")
    for case_id, case in expected["cases"].items():
        for kind in ("hard", "semantic", "quality", "variants", "steps"):
            if set(data["cases"][case_id][kind]) != set(case[kind]):
                raise ValueError(f"Registry changed the check denominator for {case_id}/{kind}")
            # A mutable registry cannot create acceptance; only verified addenda can.
            for check in data["cases"][case_id][kind].values():
                if check["status"] not in {"NOT_RUN", "BLOCKED"}:
                    raise ValueError("Use separate assessments for measured results; do not edit registry statuses")
                if check["status"] == "BLOCKED" and not check.get("reason"):
                    raise ValueError("Blocked registry checks require a reason")
    conflicts = []
    applied = {}
    native_reports = []
    case_run_states = {}
    for run_path in args.native_run:
        for directory in native_directories(run_path):
            native = verify_native(directory, catalog)
            native_reports.append(native)
            case_id = native["case_id"]
            prior = case_run_states.get(case_id)
            case_run_states[case_id] = "FAIL" if "FAIL" in {prior, native["status"]} else native["status"]
            for check_id, measured in native["steps"].items():
                if measured == "NOT_RUN":
                    continue
                entry = data["cases"][case_id]["steps"][check_id]
                entry["status"] = "FAIL" if "FAIL" in {entry["status"], measured} else measured
    for path in args.assessment:
        claim = read_json(path)
        if claim["source_sha256"] != catalog["source"]["sha256"]:
            raise ValueError("Assessment source hash mismatch")
        verified = verify_bundle(claim["bundle"])
        if verified["bundle_sha256"] != claim["bundle_sha256"]:
            raise ValueError("Assessment bundle hash mismatch")
        if claim["case_id"] not in verified["case_ids"]:
            raise ValueError("Assessment case was not selected in this run")
        case = select_case(catalog, claim["case_id"])
        check = case_checks(case).get(claim["check_id"])
        if not check or check["kind"] != claim["kind"] or claim["status"] not in STATUSES:
            raise ValueError("Invalid assessment check/status")
        if claim["status"] == "PASS" and (verified["status"] != "REVIEW" or
                (check["kind"] == "quality" and claim["method"] != "human_review") or
                (check.get("automatic_pass_allowed") is False and claim["method"] == "deterministic")):
            raise ValueError("Assessment claims prohibited PASS")
        if not claim.get("evidence"):
            raise ValueError("Assessment lacks evidence")
        bundle = Path(claim["bundle"]).resolve()
        listed = {entry["path"] for entry in read_json(bundle / "bundle.json")["files"]}
        for evidence in claim["evidence"]:
            if evidence["path"] not in listed:
                raise ValueError("Assessment references evidence outside the sealed bundle")
            if file_record(bundle / evidence["path"], bundle) != evidence:
                raise ValueError("Assessment evidence changed")
        key = (claim["case_id"], claim["kind"], claim["check_id"])
        if key in applied and applied[key] != claim["status"]:
            conflicts.append({"case_id": key[0], "check_id": key[2], "statuses": [applied[key], claim["status"]]})
            status = "FAIL" if "FAIL" in {applied[key], claim["status"]} else "INCONCLUSIVE"
        else:
            status = claim["status"]
        applied[key] = status
        target = data["cases"][key[0]][key[1]][key[2]]
        if target["status"] == "FAIL" and status != "FAIL":
            conflicts.append({"case_id": key[0], "check_id": key[2], "statuses": ["FAIL", status]})
            status = "FAIL"
        target["status"] = status
    case_counts, primary_counts, ui_counts, check_counts, by_kind = Counter(), Counter(), Counter(), Counter(), {}
    for case_id, case in data["cases"].items():
        statuses = []
        for kind in ("steps", "hard", "semantic", "quality", "variants"):
            group = Counter(check["status"] for check in case[kind].values())
            by_kind.setdefault(kind, Counter()).update(group)
            check_counts.update(group)
            statuses.extend(check["status"] for check in case[kind].values())
        case_status = rollup(statuses)
        if case_run_states.get(case_id) == "FAIL":
            case_status = "FAIL"
        elif case_run_states.get(case_id) == "INCONCLUSIVE" and case_status != "FAIL":
            case_status = "INCONCLUSIVE"
        case_counts[case_status] += 1
        (ui_counts if case_id.startswith("UIX-") else primary_counts)[case_status] += 1
    result = {"source_sha256": catalog["source"]["sha256"], "cases": dict(case_counts),
              "primary_cases": dict(primary_counts), "ui_subcases": dict(ui_counts),
              "checks": dict(check_counts), "by_kind": by_kind, "conflicts": conflicts,
              "native_runs": native_reports,
              "inventory": inventory(catalog),
              "notice": "UIX are SYS-027 subcases, not 13 additional top-level capabilities. FT links are not passed requirements."}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("inventory", "init", "run", "assess", "report"):
        command = commands.add_parser(name)
        command.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
        if name == "init":
            command.add_argument("--out", type=Path, required=True)
        if name == "run":
            command.add_argument("--case", action="append", required=True)
            command.add_argument("--argv-file", type=Path, required=True)
            command.add_argument("--out", type=Path, required=True)
            command.add_argument("--cwd", type=Path, default=ROOT)
            command.add_argument("--timeout", type=float, default=3600)
            command.add_argument("--inherit-env", action="append", default=[])
            command.add_argument("--artifact", type=Path, action="append", default=[])
        if name == "assess":
            command.add_argument("--bundle", type=Path, required=True)
            command.add_argument("--case", required=True)
            command.add_argument("--check", required=True)
            command.add_argument("--status", choices=STATUSES[1:], required=True)
            command.add_argument("--method", choices=("deterministic", "model_review", "human_review"), required=True)
            command.add_argument("--reviewer", required=True)
            command.add_argument("--note", required=True)
            command.add_argument("--evidence", action="append", required=True)
            command.add_argument("--out", type=Path, required=True)
        if name == "report":
            command.add_argument("--registry", type=Path, required=True)
            command.add_argument("--assessment", type=Path, action="append", default=[])
            command.add_argument("--native-run", type=Path, action="append", default=[])
    verify = commands.add_parser("verify")
    verify.add_argument("--bundle", type=Path, required=True)
    native = commands.add_parser("verify-native")
    native.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    native.add_argument("--run", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "inventory":
            print(json.dumps(inventory(load_catalog(args.catalog)), ensure_ascii=False, indent=2))
        elif args.command == "init":
            write_json(args.out, registry(load_catalog(args.catalog)))
            print(json.dumps({"registry": str(args.out), "status": "NOT_RUN"}))
        elif args.command == "verify":
            print(json.dumps(verify_bundle(args.bundle), ensure_ascii=False, indent=2))
        elif args.command == "verify-native":
            catalog = load_catalog(args.catalog)
            results = [verify_native(directory, catalog) for directory in native_directories(args.run)]
            print(json.dumps({"cases": results}, ensure_ascii=False, indent=2))
            return 0 if all(result["integrity"] == "VERIFIED" for result in results) else 1
        else:
            return {"run": run, "assess": assess, "report": report}[args.command](args)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"benchmark runner: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
