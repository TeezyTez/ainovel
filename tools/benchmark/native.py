"""Verify Go adapter event bytes and derive limited facts from independent reads.

Hash chains detect accidental alteration against a retained root. They are not
external notarization, and do not prove model quality or a trustworthy runner.
"""
from __future__ import annotations

from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import statistics


def digest(data):
    return hashlib.sha256(data).hexdigest()


PROJECTION_MIGRATION = "information_recorded_revision_v1"
TITLE_BINDING = "source_public_view_title_v1"
SYNTHETIC_INITIAL_TITLE = "合成世界初始记录"


def source_title(view, revision, evidence_version):
    title = view.get("title")
    if isinstance(title, str) and title.strip():
        return {"title": title, "title_provenance": "source_public_view_title"}
    if revision == 1 and evidence_version < 4:
        return {"title": SYNTHETIC_INITIAL_TITLE, "title_provenance": "legacy_initial_title_unrecorded"}
    raise ValueError(f"Source title is missing at revision {revision}")


def validate_restored_titles(data, pages):
    expected = [{"revision": p["page"]["revision"], "title": p["title"]} for p in pages]
    latest = pages[-1]["title"]
    if (data.get("title_binding") != TITLE_BINDING or data.get("stored_titles") != expected or
            data.get("branch_title") != latest or data.get("public_view", {}).get("title") != latest):
        raise ValueError("Restored SQL page/branch/current-view title differs from source")
    return ("VERIFIED_COMMITTED_INITIAL_LEGACY_UNRECORDED" if
            pages[0]["title_provenance"] == "legacy_initial_title_unrecorded" else "VERIFIED")


def migrate_information_page(page, state, *, add=True):
    """Preserve every original field; derive only public fact-record metadata."""
    result = copy.deepcopy(page)
    reader = result.get("reader")
    if not isinstance(reader, dict):
        if add:
            raise ValueError("Source page has no reader projection to migrate")
        return result
    information = reader.get("information")
    if not isinstance(information, list):
        raise ValueError("Source reader information is missing")
    visible_entities = {e["id"] for e in state.get("entities", []) if e.get("known") is True}
    visible = {"fact:" + f["id"]: f.get("source_revision", 0) for f in state.get("facts", [])
               if f.get("known") is True and (not f.get("subject_id") or f["subject_id"] in visible_entities)}
    for item in information:
        if not isinstance(item, dict):
            raise ValueError("Invalid source information item")
        revision = visible.get(item.get("id"), 0)
        if "recorded_revision" in item and (type(item["recorded_revision"]) is not int or
                revision <= 0 or item["recorded_revision"] != revision):
            raise ValueError("Recorded revision does not match visible source fact")
        if add and revision > 0:
            item["recorded_revision"] = revision
    return result


def validate_projection_view(view, pages):
    reader = pages[-1]["reader"]
    if view.get("pages") != pages or view.get("reader") != reader or view.get("information") != reader["information"]:
        raise ValueError("Resume projection readback differs from explicit metadata migration")


def control_view(view):
    # Only scheduling metadata is allowed to change in a cancellation control.
    return {key: value for key, value in view.items() if key not in {"operation", "updated_at"}}


def validate_failure_authority(data, history=None, snapshots=None, titles=None):
    """Independently check fresh SQL history against the prior event prefix."""
    if not isinstance(data, dict) or not {"scope", "public_view", "snapshots", "branches", "preferences"} <= data.keys():
        raise ValueError("Failure authority lacks complete independent readback")
    view, scope = data["public_view"], data["scope"]
    if (not scope.get("account_id") or scope.get("experience_id") != view.get("id") or
            scope.get("branch_id") != view.get("branch_id") or not isinstance(data["preferences"], list)):
        raise ValueError("Failure authority scope or preferences missing")
    branches = data["branches"]
    if not isinstance(branches, list) or not branches or len({b["id"] for b in branches}) != len(branches):
        raise ValueError("Failure authority branch inventory invalid")
    projected_branches = []
    current = None
    for branch in branches:
        required = {"id", "name", "title", "revision", "parent_branch_id", "parent_revision", "state", "pages"}
        if not required <= branch.keys() or not branch["pages"] or len(branch["pages"]) != branch["revision"]:
            raise ValueError("Failure authority SQL history incomplete")
        projected = {key: branch[key] for key in ("id", "name", "revision")}
        for key in ("parent_branch_id", "parent_revision"):
            if branch[key] is not None:
                projected[key] = branch[key]
        projected_branches.append(projected)
        for revision, row in enumerate(branch["pages"], 1):
            if (not {"revision", "page", "state", "title"} <= row.keys() or row["revision"] != revision or
                    row["page"].get("revision") != revision or not isinstance(row["title"], str) or not row["title"].strip()):
                raise ValueError("Failure authority SQL page/title invalid")
        last = branch["pages"][-1]
        if branch["state"] != last["state"] or branch["title"] != last["title"]:
            raise ValueError("Failure authority branch differs from last SQL page")
        if branch["id"] == scope["branch_id"]:
            current = branch
    if current is None or projected_branches != view.get("branches"):
        raise ValueError("Failure authority branch inventory differs from public view")
    rows = current["pages"]
    projected_pages = [migrate_information_page(row["page"], row["state"]) for row in rows]
    expected_snapshots = [{"revision": row["revision"], "state": row["state"]} for row in rows]
    if (view.get("revision") != len(rows) or view.get("title") != current["title"] or
            data["snapshots"] != expected_snapshots):
        raise ValueError("Failure authority snapshot or title projection differs")
    validate_projection_view(view, projected_pages)
    if history is not None and (view["pages"] != history or expected_snapshots != snapshots):
        raise ValueError("Failure authority baseline differs from prior formal history/snapshots")
    if titles is not None and [row["title"] for row in rows] != titles:
        raise ValueError("Failure authority baseline SQL titles differ from prior source titles")


def same_failure_authority(before, after):
    a, b = copy.deepcopy(before), copy.deepcopy(after)
    a["public_view"] = control_view(a["public_view"])
    b["public_view"] = control_view(b["public_view"])
    return a == b


def validate_control_operation(operation, prior, status=None):
    request, view = prior["request"], prior["public_view"]
    if (operation.get("request_id") != request["request_id"] or operation.get("experience_id") != view.get("id") or
            operation.get("branch_id") != request["branch_id"] or operation.get("base_revision") != request["expected_revision"]):
        raise ValueError("Cancellation operation identity differs from original request")
    if status and (operation.get("status") != status or operation.get("committed_revision") is not None):
        raise ValueError("Cancellation operation has an unexpected status or committed revision")


def validate_cancel_pause(event, prior, events):
    data, step = event["data"], event["step"]
    if data.get("candidate_commit_eligibility") != "not_established":
        raise ValueError("Review pause must not claim candidate commit eligibility")
    seqs = [data.get("review_request_event_seq"), data.get("review_result_event_seq")]
    if any(type(seq) is not int or not 0 < seq < event["seq"] for seq in seqs) or seqs[0] >= seqs[1]:
        raise ValueError("Cancellation review references invalid source event sequences")
    request_event, result_event = (events[seq - 1] for seq in seqs)
    call = data.get("model_call")
    if (request_event["kind"] != "model_request" or result_event["kind"] != "model_result" or
            request_event["step"] != step or result_event["step"] != step or
            request_event["data"].get("call") != call or result_event["data"].get("call") != call or
            result_event["data"].get("error") or request_event["data"].get("request") != data.get("model_request") or
            result_event["data"].get("result") != data.get("model_result")):
        raise ValueError("Cancellation review request/result differs from original model events")
    stages = [e for e in events[seqs[1]:event["seq"] - 1] if e["step"] == step and e["kind"] == "stage"]
    if not stages or stages[-1]["data"].get("stage") != "review" or stages[-1]["data"].get("error"):
        raise ValueError("Cancellation was not paused at the actual review observer")
    candidates = []
    for message in data["model_request"].get("messages", []):
        if message.get("role") != "user":
            continue
        try:
            content = json.loads(message.get("content", ""))
        except (ValueError, TypeError):
            continue
        if isinstance(content, dict) and "candidate" in content:
            candidates.append(content["candidate"])
    if (len(candidates) != 1 or not isinstance(candidates[0], dict) or candidates[0] != data.get("candidate") or
            not isinstance(candidates[0].get("passage"), str) or not candidates[0]["passage"].strip()):
        raise ValueError("Cancellation candidate is not the unique original review input")
    validate_control_operation(data.get("operation", {}), prior, "generating")


def validate_fixture(fixture, catalog):
    case = next((item for item in catalog["cases"] if item["id"] == fixture["id"]), None)
    if not case:
        raise ValueError(f"Fixture names an unknown case: {fixture['id']}")
    if fixture["source_sha256"] != catalog["source"]["sha256"]:
        raise ValueError("Fixture source hash differs from the original benchmark")
    if fixture["source_line"] != case["source"]["start_line"]:
        raise ValueError("Fixture source line does not identify the case heading")
    expected = {step["id"]: step for step in case["steps"]}
    actual = fixture["steps"]
    if len({step["id"] for step in actual}) != len(actual):
        raise ValueError("Duplicate fixture step IDs")
    if [step["id"] for step in actual] != list(expected):
        raise ValueError("Fixture steps omit or reorder benchmark checkpoints")
    prior = set()
    for step in actual:
        original = expected[step["id"]]
        if step["input"] != original["input"] or step["mode"] != original["operation"]:
            raise ValueError(f"Fixture changed benchmark input/mode at {fixture['id']}/{step['id']}")
        if set(step) - {"id", "mode", "input", "epilogue", "requires_steps", "evidence_gate"}:
            raise ValueError("Unexpected extra fixture step fields")
        if "epilogue" in step and not isinstance(step["epilogue"], bool):
            raise ValueError("Epilogue marker must be boolean")
        if "requires_steps" in step:
            dependencies = step["requires_steps"]
            if (not isinstance(dependencies, list) or not dependencies or
                    any(not isinstance(item, str) or item not in prior for item in dependencies) or
                    len(set(dependencies)) != len(dependencies)):
                raise ValueError("Dependencies must name unique earlier benchmark steps")
        if "evidence_gate" in step and (not isinstance(step["evidence_gate"], str) or not step["evidence_gate"].strip()):
            raise ValueError("Evidence gate must have a nonempty identifier")
        prior.add(step["id"])
    return case


def validate_step_policy(step, completed, gates=None):
    if any(dependency not in completed for dependency in step.get("requires_steps", [])):
        raise ValueError("Dependency lacks actual completed step evidence")
    if step.get("evidence_gate") and (gates or {}).get(step["id"], {}).get("decision") != "allow":
        raise ValueError("Evidence gate has no supported source-bound approval decision")


def pointer_text(snapshot, pointer):
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ValueError("Gate snapshot citation needs a JSON pointer")
    value = snapshot
    for token in pointer[1:].split("/"):
        i = 0
        while i < len(token):
            if token[i] == "~":
                if i + 1 == len(token) or token[i + 1] not in "01":
                    raise ValueError("Invalid gate pointer escape")
                i += 1
            i += 1
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict) and token in value:
            value = value[token]
        elif isinstance(value, list) and token.isascii() and token.isdecimal() and str(int(token)) == token and int(token) < len(value):
            value = value[int(token)]
        else:
            raise ValueError("Gate snapshot citation pointer is missing")
    if not isinstance(value, str):
        raise ValueError("Gate snapshot citation must address a text field")
    return value


def validate_gate(decision, fixture, step, resume, source_events):
    fields = {"version", "source_root", "case_id", "step_id", "gate_id", "decision", "reviewer", "method", "note", "citations"}
    if not isinstance(decision, dict) or set(decision) != fields or resume is None or not step.get("evidence_gate"):
        raise ValueError("Gate decision requires exact schema and a restored source")
    if (type(decision["version"]) is not int or decision["version"] != 1 or decision["source_root"] != resume["source_root"] or
            decision["case_id"] != fixture["id"] or decision["step_id"] != step["id"] or decision["gate_id"] != step["evidence_gate"] or
            decision["decision"] not in {"allow", "deny"} or decision["method"] != "model_review" or
            any(not isinstance(decision[name], str) or not decision[name].strip() for name in ("reviewer", "note"))):
        raise ValueError("Gate decision identity/method differs from the restored source")
    citations = decision["citations"]
    if not isinstance(citations, list) or not 2 <= len(citations) <= 16:
        raise ValueError("Gate decision requires prose and snapshot citations")
    paired = {}
    for citation in citations:
        required = {"event_seq", "step_id", "revision", "kind", "quote"}
        if (not isinstance(citation, dict) or not required <= set(citation) or set(citation) - required - {"pointer"} or
                type(citation["event_seq"]) is not int or not 1 <= citation["event_seq"] <= len(source_events) or
                not isinstance(citation["quote"], str) or not citation["quote"].strip()):
            raise ValueError("Invalid gate citation location/quote")
        event = source_events[citation["event_seq"] - 1]
        view = event["data"].get("public_view", {})
        if (event["kind"] != "operation_committed" or event["step"] != citation["step_id"] or
                event["step"] not in step.get("requires_steps", []) or type(citation["revision"]) is not int or
                view.get("revision") != citation["revision"]):
            raise ValueError("Gate citation is not a committed prerequisite revision")
        if citation["kind"] == "prose" and not citation.get("pointer"):
            text = view["pages"][-1]["text"]
        elif citation["kind"] == "snapshot":
            text = pointer_text(event["data"]["snapshot"], citation.get("pointer"))
        else:
            raise ValueError("Unsupported gate citation kind/pointer")
        if citation["quote"] not in text:
            raise ValueError("Gate citation quote absent from exact source")
        paired.setdefault(citation["event_seq"], set()).add(citation["kind"])
    if not any(kinds == {"prose", "snapshot"} for kinds in paired.values()):
        raise ValueError("Gate citations lack prose and snapshot from the same prerequisite")


def validate_history(data, history, fixture, request=None):
    """Check the independent read, not an adapter's success assertion."""
    view = data.get("public_view", {})
    pages = view.get("pages", [])
    revision = len(history) + 1
    if view.get("revision") != revision or len(pages) != revision:
        raise ValueError("Official history is not contiguous or its readback is missing")
    page = pages[-1]
    migrate_information_page(page, data.get("snapshot", {}), add=False)
    if page.get("revision") != revision or pages[:-1] != history:
        raise ValueError("Official history rewrote prior pages")
    if request is None:
        if history or (page.get("mode"), page.get("input"), page.get("text")) != ("begin", fixture["seed"], fixture["opening"]):
            raise ValueError("Initial official page differs from the synthetic fixture")
    elif (request.get("expected_revision") != revision - 1 or
            page.get("mode") != request["mode"] or page.get("input", "") != request.get("input", "")):
        raise ValueError("Committed page differs from its request or expected revision")
    return pages


def validate_request(request, step):
    mode, text, reading = step["mode"], step["input"], ""
    if mode in {"continue", "read"}:
        mode, text, reading = "read", "", text
    elif mode == "player":
        mode = "act"
    if (request.get("mode"), request.get("input", ""), request.get("reading_request", "")) != (mode, text, reading):
        raise ValueError("Actual operation request differs from registered benchmark input/mode")


def replay_pages(events, fixture, *, titles=False):
    """Read only a contiguous, unchanged official history from a verified source."""
    pages, requests, projected_history = [], {}, None
    for event in events:
        kind, step, data = event["kind"], event["step"], event["data"]
        if kind == "resume_manifest":
            pages = copy.deepcopy(data["pages"])
            if not titles:
                pages = [{k: v for k, v in p.items() if k not in {"title", "title_provenance"}} for p in pages]
        elif kind == "resume_readback":
            projected_history = data["public_view"]["pages"]
        elif kind == "operation_request":
            requests[step] = data["request"]
        elif kind in {"initial_readback", "operation_committed"}:
            history = validate_history(data, (projected_history or [p["page"] for p in pages]) if kind == "operation_committed" else [], fixture,
                                       requests[step] if kind == "operation_committed" else None)
            page = history[-1]
            if kind == "initial_readback":
                if data["snapshot"] != fixture["state"]:
                    raise ValueError("Resume source initial fixture differs")
                if pages:
                    if projected_history is None or page != projected_history[0]:
                        raise ValueError("Nested resume initial page differs from verified ancestor projection")
                    continue
            entry = {"step": step, "page": page, "state": data["snapshot"]}
            if titles:
                entry.update(source_title(data["public_view"], page["revision"], events[0]["data"].get("evidence_version", 1)))
            pages.append(entry)
            projected_history = history
    if len(pages) < 2:
        raise ValueError("Resume source has no committed prefix")
    return pages


def replay_editorials(events, source_root):
    """Retain exact original, unapplied artifacts; never retarget to latest page."""
    entries, pending, model_results, model_inputs = [], {}, {}, {}
    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("Duplicate editorial model JSON field")
            value[key] = item
        return value
    for event in events:
        kind, step, data = event["kind"], event["step"], event["data"]
        if kind == "restored_editorial":
            entries.append(copy.deepcopy(data))
        elif kind == "editorial_request":
            pending[step] = event
        elif kind == "model_request" and step in pending:
            model_inputs.setdefault(step, []).append(data)
        elif kind == "model_result" and step in pending:
            model_results.setdefault(step, []).append(data)
        elif kind == "editorial_result":
            prior = pending.pop(step, None)
            if prior is None:
                raise ValueError("Noncommitting editorial has no original request")
            before = prior["data"]
            inputs = model_inputs.get(step, [])
            replies = model_results.get(step, [])
            if len(inputs) != 1 or len(replies) != 1 or replies[0].get("error") != "":
                raise ValueError("Noncommitting editorial requires one successful original model result")
            try:
                users = [m["content"] for m in inputs[0]["request"]["messages"] if m.get("role") == "user"]
                if len(users) != 1:
                    raise ValueError("Editorial model request needs one original user payload")
                payload = json.loads(users[0], object_pairs_hook=unique_object)
                if payload != {"original": before["original_page"]["text"], "request": before["request"]["request"]}:
                    raise ValueError("Editorial model input differs from original paragraph/request")
                candidate = json.loads(replies[0]["result"]["text"], object_pairs_hook=unique_object)
            except (KeyError, TypeError, json.JSONDecodeError) as error:
                raise ValueError("Noncommitting editorial model reply is not the original structured candidate") from error
            if not isinstance(candidate, dict) or set(candidate) != {"text"} or candidate["text"] != data.get("result", {}).get("text"):
                raise ValueError("Noncommitting editorial candidate differs from original model result")
            if (data.get("applied") is not False or data.get("read_only_verified") is not True or data.get("error") != "" or
                    data.get("snapshot") != before.get("before") or data.get("public_view") != before.get("public_view") or
                    data.get("original_page") != before.get("original_page") or
                    data.get("after_preferences") != before.get("before_preferences") or
                    before.get("request", {}).get("kind") != "polish"):
                raise ValueError("Noncommitting editorial is not an independently unchanged unapplied proposal")
            entries.append({"step": step, "source_root": source_root, "source_request_event_seq": prior["seq"],
                            "source_result_event_seq": event["seq"], "request_data": before, "result_data": data})
        elif kind.startswith("editorial_"):
            raise ValueError("Unsupported noncommitting editorial artifact")
    if pending:
        raise ValueError("Unsettled noncommitting editorial cannot be restored")
    return entries


def verify_native(directory: Path, catalog: dict, *, _source=False, _depth=None, _seen_roots=()) -> dict:
    directory = Path(directory)
    depth = (1 if _source else 0) if _depth is None else _depth
    if depth > 16:
        raise ValueError("Resume ancestry exceeds 16 source layers")
    prefix = "source-" * depth
    events_path = directory / f"{prefix}events.jsonl"
    if events_path.is_symlink() or events_path.stat().st_size > 32 << 20:
        raise ValueError("Invalid fixed resume event asset")
    raw = events_path.read_bytes()
    if not raw:
        raise ValueError("Empty native event stream")
    lines = raw.splitlines()
    events, previous = [], ""
    for index, line in enumerate(lines, 1):
        event = json.loads(line)
        if event.get("seq") != index or event.get("previous_sha256") != previous:
            raise ValueError(f"Broken native event chain at sequence {index}")
        if not isinstance(event.get("kind"), str) or not isinstance(event.get("data"), dict):
            raise ValueError(f"Malformed event at sequence {index}")
        previous = digest(line)
        events.append(event)
    if events[0]["kind"] != "manifest" or sum(e["kind"] == "manifest" for e in events) != 1:
        raise ValueError("Exactly one initial manifest is required")
    manifest = events[0]["data"]
    fixture = manifest["fixture"]
    case = validate_fixture(fixture, catalog)
    fixture_bytes_status = "LEGACY_NOT_RECORDED"
    fixture_path = directory / f"{prefix}fixture.json"
    if fixture_path.is_file():
        fixture_bytes = fixture_path.read_bytes()
        if digest(fixture_bytes) != manifest.get("fixture_sha256") or json.loads(fixture_bytes) != fixture:
            raise ValueError("Fixture bytes do not match the manifest hash and object")
        fixture_bytes_status = "VERIFIED"
    elif manifest.get("evidence_version", 1) >= 2:
        raise ValueError("Fixture bytes are missing from v2 evidence")
    endings = [event for event in events if event["kind"] == "run_end"]
    if len(endings) > 1 or (endings and endings[0] is not events[-1]):
        raise ValueError("run_end must occur once at the end")
    if endings and endings[0]["data"].get("status") not in {"REVIEW", "FAIL"}:
        raise ValueError("Native run cannot declare whole-case acceptance")
    root_path = directory / f"{prefix}root.sha256"
    if previous in _seen_roots:
        raise ValueError("Repeated resume ancestor root")
    if root_path.is_symlink():
        raise ValueError("Invalid fixed resume root asset")
    if root_path.is_file() and root_path.read_text().strip() != previous:
        raise ValueError("Native root hash mismatch")
    incomplete = not endings or not root_path.is_file() or not raw.endswith(b"\n")
    source_manifest_status = "NOT_PROVIDED"
    source_manifest = directory.parent / "source-manifest.json"
    if depth == 0 and source_manifest.is_file():
        data = source_manifest.read_bytes()
        if digest(data.removesuffix(b"\n")) != manifest.get("source_tree_sha256"):
            raise ValueError("Build source manifest hash mismatch")
        entries = json.loads(data)
        fixture_path = f"backend/internal/experience/testdata/deep_benchmark/{fixture['id']}.json"
        if entries.get(fixture_path) != manifest["fixture_sha256"]:
            raise ValueError("Fixture hash does not match frozen build source manifest")
        source_manifest_status = "VERIFIED_HASH_BINDING"
    steps = {step["id"]: "NOT_RUN" for step in case["steps"]}
    required_steps = {step["id"]: step for step in fixture["steps"]}
    requests, results, operations, editorials, controls, settled = {}, set(), {}, {}, {}, set()
    blocked, failures, latencies = [], [], []
    ask_checks = {"verified": 0, "failed": 0, "scope": "Exact before/after domain snapshot equality only"}
    editorial_checks = {"verified": 0, "failed": 0, "scope": "Proposal only; exact page/view, domain snapshot and preference equality. No style/semantic acceptance."}
    cancel_checks = {"verified": 0, "failed": 0, "scope": "Fresh service/DB restore and real cancellation at review; exact formal history and every snapshot unchanged. Candidate eligibility not established; no process kill or narrative acceptance."}
    failure_checks = {"verified": 0, "failed": 0, "legacy_unverified_steps": [], "operation_lookup_unverified_steps": [],
                      "scope": "v5 fresh service/connection readback of formal pages, all snapshots/SQL titles, branch state and preferences; operation lifecycle may change. Legacy cached failure views do not prove no writes."}
    operation_sequences, failure_sequences, audited_failures = {}, {}, set()
    history_titles = []
    readbacks = []
    restored = {}
    restored_observations = {}
    restored_editorials = {}
    editorial_restore = "NOT_APPLICABLE"
    observation_restore = "NOT_APPLICABLE"
    resume = None
    resume_source = None
    resume_readback = "NOT_APPLICABLE"
    resume_titles = "NOT_APPLICABLE"
    resumed_history, projection_migration = None, None
    last_snapshot, history, snapshots, completed, gates = None, [], [], set(), {}
    for event in events:
        kind, step, data = event["kind"], event["step"], event["data"]
        if step and step not in required_steps:
            raise ValueError(f"Event references unknown fixture step {step}")
        if step in restored_observations and kind not in {"restored_observation", "run_end"}:
            raise ValueError("Original observation cannot be rerun or relabelled at the restored latest revision")
        if step in restored_editorials and kind not in {"restored_editorial", "run_end"}:
            raise ValueError("Original editorial cannot be rerun or retargeted at the restored latest revision")
        if kind == "resume_manifest":
            if resume is not None or readbacks or operations or editorials:
                raise ValueError("Duplicate resume manifest")
            source_prefix = prefix + "source-"
            source_raw = (directory / f"{source_prefix}events.jsonl").read_bytes()
            source_root = (directory / f"{source_prefix}root.sha256").read_text().strip()
            if digest(source_raw) != data.get("events_sha256") or source_root != data.get("source_root"):
                raise ValueError("Resume source evidence digest mismatch")
            resume_source = verify_native(directory, catalog, _depth=depth+1, _seen_roots=(*_seen_roots, previous))
            if resume_source["integrity"] != "VERIFIED":
                raise ValueError("Unsealed resume source")
            source_events = [json.loads(line) for line in source_raw.splitlines()]
            if any(e["kind"] == "control_request" for e in source_events):
                raise ValueError("Resume of noncommitting control artifacts is not supported; cannot rerun a prior cancellation at a different revision")
            if source_events[0]["kind"] != "manifest" or source_events[0]["data"]["fixture"] != fixture:
                raise ValueError("Resume fixture differs")
            title_bound = manifest.get("evidence_version", 1) >= 4
            source_pages = replay_pages(source_events, fixture, titles=title_bound)
            if data.get("pages") != source_pages:
                raise ValueError("Resume changed committed source pages or snapshots")
            resume = data
            snapshots = [{"revision": p["page"]["revision"], "state": p["state"]} for p in source_pages]
            history_titles = [p["title"] for p in source_pages] if title_bound else []
            resume_readback = "MISSING" if manifest.get("evidence_version", 1) >= 2 else "LEGACY_NOT_RECORDED"
            resume_titles = "MISSING" if title_bound else "LEGACY_NOT_VERIFIED"
            restored = {page["step"]: page for page in source_pages if page["step"]}
            original_observations = [({"step": e["step"], "event_seq": e["seq"], "data": e["data"]}
                                     if e["kind"] == "observation" else e["data"])
                                     for e in source_events if e["kind"] in {"observation", "restored_observation"}]
            original_editorials = replay_editorials(source_events, source_root)
            if original_editorials or "editorials" in data:
                if data.get("editorials") != original_editorials:
                    raise ValueError("Resume editorial manifest differs from exact source artifacts")
                restored_editorials = {entry["step"]: entry for entry in original_editorials}
                editorial_restore = "SOURCE_BOUND"
            if manifest.get("evidence_version", 1) >= 3:
                if data.get("observations", []) != original_observations:
                    raise ValueError("Resume observation manifest differs from original source events")
                restored_observations = {entry["step"]: entry for entry in original_observations}
                observation_restore = "SOURCE_BOUND" if original_observations else "NONE_IN_SOURCE"
            elif original_observations:
                observation_restore = "LEGACY_NOT_PRESERVED"
        elif kind == "resume_readback":
            if resume is None or resume_readback == "VERIFIED" or operations or editorials or settled:
                raise ValueError("Unexpected resume history readback")
            view = data.get("public_view", {})
            pages = resume["pages"]
            expected_snapshots = [{"revision": p["page"]["revision"], "state": p["state"]} for p in pages]
            expected_pages = [p["page"] for p in pages]
            if manifest.get("evidence_version", 1) >= 3:
                if data.get("projection_migration") != PROJECTION_MIGRATION or data.get("stored_pages") != expected_pages:
                    raise ValueError("Resume readback lacks exact original stored pages and explicit migration")
                expected_pages = [migrate_information_page(p["page"], p["state"]) for p in pages]
                validate_projection_view(view, expected_pages)
                projection_migration = PROJECTION_MIGRATION
                resumed_history = expected_pages
                history = expected_pages
                for initial in readbacks:
                    validate_projection_view(initial["data"]["public_view"], expected_pages[:1])
            if (view.get("revision") != len(pages) or view.get("pages") != expected_pages or data.get("snapshots") != expected_snapshots):
                raise ValueError("Resume history readback differs from immutable source")
            if manifest.get("evidence_version", 1) >= 4:
                resume_titles = validate_restored_titles(data, pages)
            resume_readback = "VERIFIED"
        elif kind == "restored_step":
            if step not in restored or data != restored[step] or steps[step] != "NOT_RUN":
                raise ValueError("Restored step lacks matching immutable source evidence")
            steps[step] = "RESTORED"
            completed.add(step)
        elif kind == "restored_observation":
            if step not in restored_observations or data != restored_observations[step] or steps[step] != "NOT_RUN":
                raise ValueError("Restored observation lacks exact original event/snapshot/public view")
            steps[step] = "RESTORED"
            completed.add(step)
        elif kind == "restored_editorial":
            if step not in restored_editorials or data != restored_editorials[step] or steps[step] != "NOT_RUN":
                raise ValueError("Restored editorial lacks original source root/sequences and exact request/result")
            steps[step] = "RESTORED"
            completed.add(step)
        elif kind == "gate_decision":
            if resume is None or step in gates or steps[step] != "NOT_RUN" or step in operations or step in editorials or step in restored:
                raise ValueError("Unexpected or duplicate gate decision")
            if data.get("file") != f"gate-{step}.json":
                raise ValueError("Gate decision file is not bound to the current step")
            decision_raw = (directory / (prefix + data["file"])).read_bytes()
            if len(decision_raw) > 65536 or digest(decision_raw) != data.get("decision_sha256") or json.loads(decision_raw) != data.get("decision"):
                raise ValueError("Gate decision raw bytes differ from recorded hash/object")
            validate_gate(data["decision"], fixture, required_steps[step], resume, source_events)
            gates[step] = data["decision"]
        elif kind == "initial_readback":
            initial_history = validate_history(data, [], fixture)
            if manifest.get("evidence_version", 1) >= 4:
                initial_title = source_title(data["public_view"], 1, 4)
                if resume and initial_title["title"] != resume["pages"][0]["title"]:
                    raise ValueError("Initial SQL title differs from restored source title")
                if not resume:
                    history_titles = [initial_title["title"]]
            history = (resumed_history or [p["page"] for p in resume["pages"]]) if resume else initial_history
            if resumed_history is not None:
                validate_projection_view(data["public_view"], resumed_history[:1])
            readbacks.append(event)
            if data["snapshot"] != fixture["state"]:
                failures.append({"step": step, "kind": "initial_fixture_readback_mismatch"})
            last_snapshot = resume["pages"][-1]["state"] if resume else data["snapshot"]
            if not resume:
                snapshots = [{"revision": 1, "state": data["snapshot"]}]
        elif kind == "control_request":
            if step in operations or step in editorials or step in controls or step in settled or steps[step] != "NOT_RUN" or step in restored:
                raise ValueError("Duplicate control request for one benchmark step")
            if fixture["id"] != "SYS-005" or step != "S06" or required_steps[step]["mode"] != "harness" or data.get("kind") != "restore_cancel" or data.get("step") != required_steps[step]:
                raise ValueError("Cancellation control is not the registered SYS-005 S06 harness step")
            validate_step_policy(required_steps[step], completed, gates)
            request, view = data.get("request", {}), data.get("public_view", {})
            if (request.get("mode") != "read" or request.get("input", "") or request.get("reading_request", "") or
                    request.get("expected_revision") != len(history) or not request.get("request_id") or
                    not request.get("branch_id") or request["branch_id"] != view.get("branch_id")):
                raise ValueError("Cancellation request must be empty read at the current branch/revision")
            if (not history or data.get("before") != last_snapshot or data.get("before_snapshots") != snapshots or
                    view.get("pages") != history or view.get("revision") != len(history)):
                raise ValueError("Cancellation control before history differs from independent evidence")
            controls[step] = {"request": data, "phase": "requested", "paused": False, "issued": False}
        elif kind in {"restore_readback", "cancel_pending", "cancel_pause", "cancel_issued", "cancel_result"}:
            if step not in controls or step in settled:
                raise ValueError("Cancellation event lacks an active control request")
            control = controls[step]
            prior = control["request"]
            if kind == "restore_readback":
                if (control["phase"] != "requested" or data.get("new_service") is not True or data.get("new_db_connection") is not True or
                        data.get("process_restart") is not False or data.get("recovery_method") != "RecoverExpired"):
                    raise ValueError("Cancellation restore provenance is missing or out of order")
                same = control_view(data.get("public_view", {})) == control_view(prior["public_view"]) and data.get("snapshots") == prior["before_snapshots"]
                if not same or data.get("error"):
                    failures.append({"step": step, "kind": "control_restore_failed"})
                    steps[step] = "FAIL"
                    settled.add(step)
                control["phase"] = "restored"
            elif kind == "cancel_pending":
                if (control["phase"] != "restored" or data.get("request") != prior["request"] or data.get("snapshot") != prior["before"] or
                        control_view(data.get("public_view", {})) != control_view(prior["public_view"])):
                    raise ValueError("Cancellation pending readback differs from original control")
                validate_control_operation(data.get("operation", {}), prior, "pending")
                control["phase"] = "pending"
            elif kind == "cancel_pause":
                if control["phase"] != "pending":
                    raise ValueError("Cancellation pause is missing pending operation or duplicated")
                validate_cancel_pause(event, prior, events)
                control["phase"], control["paused"] = "paused", True
            elif kind == "cancel_issued":
                if control["phase"] not in {"pending", "paused"}:
                    raise ValueError("Cancellation issuance is duplicated or out of order")
                validate_control_operation(data.get("operation", {}), prior, "cancelled")
                control["phase"], control["issued"] = "issued", True
            else:
                required = {"operation", "snapshot", "public_view", "snapshots", "model_calls", "error", "review_reached", "read_only_verified"}
                if not required <= set(data):
                    raise ValueError("Cancellation result lacks independent history or outcome fields")
                call_count = sum(owner == step for owner in requests.values())
                if data["model_calls"] != call_count or (not data["error"] and (not control["paused"] or not control["issued"] or not call_count)):
                    raise ValueError("Cancellation result lacks original review, issued cancellation or actual model calls")
                validate_control_operation(data["operation"], prior)
                same = (data["snapshot"] == prior["before"] and data["snapshots"] == prior["before_snapshots"] and
                        control_view(data["public_view"]) == control_view(prior["public_view"]))
                cancel_checks["verified" if same else "failed"] += 1
                passed = (same and not data["error"] and data["review_reached"] is True and data["read_only_verified"] is True and
                          data["operation"].get("status") == "cancelled" and data["operation"].get("committed_revision") is None)
                settled.add(step)
                steps[step] = "REVIEW" if passed else "FAIL"
                latencies.append(data.get("elapsed_ms", 0))
                if passed:
                    completed.add(step)
                else:
                    failures.append({"step": step, "kind": "restore_cancel_failed"})
        elif kind == "model_request":
            if (step not in operations and step not in editorials and step not in controls) or step in settled:
                raise ValueError("Model call has no active product operation")
            if step in controls and controls[step]["phase"] not in {"pending", "paused", "issued"}:
                raise ValueError("Cancellation model call preceded the actual pending operation")
            call = data["call"]
            if not isinstance(call, int) or call < 1 or call in requests:
                raise ValueError("Invalid or duplicate model request call ID")
            requests[call] = step
        elif kind == "model_result":
            if (step not in operations and step not in editorials and step not in controls) or step in settled:
                raise ValueError("Model result has no active product operation")
            call = data["call"]
            if call not in requests or call in results or requests[call] != step:
                raise ValueError("Model result has no matching request in this step")
            results.add(call)
        elif kind == "operation_request":
            if step in operations or step in editorials or step in controls or step in settled or steps[step] != "NOT_RUN" or step in restored:
                raise ValueError("Duplicate operation request for one benchmark step")
            if required_steps[step]["mode"] not in {"act", "ask", "continue", "read", "player"}:
                raise ValueError("Harness/observation was sent as a product operation")
            validate_request(data["request"], required_steps[step])
            validate_step_policy(required_steps[step], completed, gates)
            if last_snapshot is None or data.get("before") != last_snapshot:
                raise ValueError("Operation before snapshot differs from prior independent state")
            if data["request"].get("expected_revision") != len(history):
                raise ValueError("Operation expected revision differs from independent history")
            if manifest.get("evidence_version", 1) >= 5:
                if data.get("authority_method") != "fresh_service_new_connection_v1":
                    raise ValueError("Operation lacks fresh independent authority baseline")
                validate_failure_authority(data.get("authority_before"), history, snapshots, history_titles)
                if data["authority_before"]["scope"]["branch_id"] != data["request"].get("branch_id"):
                    raise ValueError("Operation branch differs from independent authority baseline")
            operations[step] = data
            operation_sequences[step] = event["seq"]
        elif kind == "editorial_request":
            if step in operations or step in editorials or step in controls or step in settled or steps[step] != "NOT_RUN" or step in restored:
                raise ValueError("Duplicate editorial request for one benchmark step")
            if required_steps[step]["mode"] != "editorial_request":
                raise ValueError("Editorial request cannot replace another registered mode")
            validate_step_policy(required_steps[step], completed, gates)
            request, view = data.get("request", {}), data.get("public_view", {})
            if (request.get("kind") != "polish" or request.get("request") != required_steps[step]["input"] or
                    request.get("expected_revision") != len(history) or not request.get("branch_id") or
                    request["branch_id"] != view.get("branch_id")):
                raise ValueError("Editorial request differs from registered input or pinned revision/branch")
            if (not history or data.get("before") != last_snapshot or data.get("original_page") != history[-1] or
                    view.get("revision") != len(history) or view.get("pages") != history or "before_preferences" not in data):
                raise ValueError("Editorial original page or independent before readback differs")
            editorials[step] = data
        elif kind == "editorial_result":
            if step not in editorials or step in settled:
                raise ValueError("Editorial result has no unsettled request")
            prior, result = editorials[step], data.get("result", {})
            if not {"snapshot", "public_view", "original_page", "after_preferences", "model_calls", "applied", "read_only_verified", "error"} <= set(data):
                raise ValueError("Editorial result lacks required independent readbacks")
            call_count = sum(owner == step for owner in requests.values())
            if data["model_calls"] != call_count or (not data["error"] and not call_count):
                raise ValueError("Editorial result lacks matching actual model calls")
            if not data["error"] and (result.get("kind") != "polish" or result.get("base_revision") != len(history) or
                    result.get("branch_id") != prior["request"]["branch_id"] or not isinstance(result.get("text"), str) or
                    not result["text"].strip() or result.get("proposal") is not None):
                raise ValueError("Editorial result is not a nonempty polish proposal at its original revision")
            same = (data["snapshot"] == prior["before"] and data["public_view"] == prior["public_view"] and
                    data["original_page"] == prior["original_page"] and data["after_preferences"] == prior["before_preferences"] and
                    data["applied"] is False)
            editorial_checks["verified" if same else "failed"] += 1
            settled.add(step)
            steps[step] = "REVIEW"
            latencies.append(data.get("elapsed_ms", 0))
            if data["error"] or not same or data["read_only_verified"] is not True:
                steps[step] = "FAIL"
                failures.append({"step": step, "kind": "editorial_failed" if data["error"] else "editorial_changed_authority"})
            else:
                completed.add(step)
        elif kind in {"operation_committed", "operation_failure"}:
            if step not in operations or step in settled:
                raise ValueError("Operation result has no unsettled request")
            settled.add(step)
            if kind == "operation_failure":
                steps[step] = "FAIL"
                failures.append({"step": step, "kind": kind})
                failure_sequences[step] = event["seq"]
                if manifest.get("evidence_version", 1) < 5:
                    failure_checks["legacy_unverified_steps"].append(step)
                elif data.get("model_calls") != sum(owner == step for owner in requests.values()):
                    raise ValueError("Failed operation model call count differs from evidence")
                continue
            steps[step] = "REVIEW"
            history = validate_history(data, history, fixture, operations[step]["request"])
            if manifest.get("evidence_version", 1) >= 4:
                history_titles.append(source_title(data["public_view"], len(history), 4)["title"])
            call_count = sum(owner == step for owner in requests.values())
            if not call_count or data.get("model_calls", call_count) != call_count:
                raise ValueError("Cold-path committed operation lacks matching actual model calls")
            completed.add(step)
            last_snapshot = data["snapshot"]
            snapshots.append({"revision": len(history), "state": last_snapshot})
            latencies.append(data.get("elapsed_ms", 0))
            if operations[step]["request"].get("mode") == "ask":
                same = operations[step]["before"] == data["snapshot"]
                ask_checks["verified" if same else "failed"] += 1
                if not same:
                    steps[step] = "FAIL"
                    failures.append({"step": step, "kind": "ask_changed_domain_snapshot"})
        elif kind == "failure_readback":
            if (manifest.get("evidence_version", 1) < 5 or step not in failure_sequences or step in audited_failures or
                    data.get("request_event_seq") != operation_sequences[step] or
                    data.get("failure_event_seq") != failure_sequences[step] or
                    data.get("request") != operations[step]["request"] or
                    data.get("method") != "fresh_service_new_connection_v1"):
                raise ValueError("Failure readback does not bind its original request/failure events")
            if not {"authority_after", "operation", "operation_lookup_error", "readback_error", "read_only_verified"} <= data.keys():
                raise ValueError("Failure readback missing explicit results/errors")
            if not isinstance(data["readback_error"], str) or not isinstance(data["operation_lookup_error"], str) or type(data["read_only_verified"]) is not bool:
                raise ValueError("Failure readback has malformed error/verification fields")
            audited_failures.add(step)
            same = False
            if not data["readback_error"]:
                after = data["authority_after"]
                validate_failure_authority(after)
                same = same_failure_authority(operations[step]["authority_before"], after)
                if not data["operation_lookup_error"]:
                    operation = data["operation"]
                    validate_control_operation(operation, {"request": data["request"], "public_view": after["public_view"]})
                    if operation.get("committed_revision") is not None or operation.get("status") == "committed":
                        same = False
                else:
                    failure_checks["operation_lookup_unverified_steps"].append(step)
            if data["read_only_verified"] is not same:
                raise ValueError("Failure no-writes claim disagrees with independent authority readback")
            failure_checks["verified" if same else "failed"] += 1
            if not same:
                failures.append({"step": step, "kind": "failure_readback_failed_or_changed"})
        elif kind in {"blocked_step", "coverage_unreached"}:
            if step in settled or step in operations or step in editorials or step in controls or steps[step] != "NOT_RUN" or step in restored:
                raise ValueError("An executed operation cannot be relabeled as blocked")
            steps[step] = "BLOCKED"
            blocked.append({"step": step, "kind": kind, "reason": data.get("reason")})
        elif kind == "observation":
            if step in operations or step in editorials or step in controls or steps[step] != "NOT_RUN" or step in restored:
                raise ValueError("An executed or restored step cannot be relabeled as observation")
            if required_steps[step]["mode"] != "observe":
                raise ValueError("Observation cannot replace a registered action or harness operation")
            validate_step_policy(required_steps[step], completed, gates)
            view = data.get("public_view", {})
            if (data.get("snapshot") != last_snapshot or view.get("revision") != len(history) or
                    view.get("pages") != history):
                raise ValueError("Observation differs from current independent history or snapshot")
            steps[step] = "REVIEW"
            completed.add(step)
        elif kind == "assertion" and data.get("passed") is False:
            failures.append({"step": step, "kind": "adapter_assertion_failed", "id": data.get("id")})
        elif kind == "authority_before_failure":
            if step in operations or step in settled or steps[step] != "NOT_RUN":
                raise ValueError("Unexpected pre-operation authority failure")
            steps[step] = "FAIL"
            failures.append({"step": step, "kind": kind})
    if len(readbacks) != 1:
        if endings and not failures and endings[0]["data"]["status"] != "FAIL":
            raise ValueError("Completed nonfailed run lacks exactly one fixture readback")
        incomplete = True
    if requests.keys() - results or operations.keys() - settled or editorials.keys() - settled or controls.keys() - settled:
        incomplete = True
    if resume and (resume_readback == "MISSING" or any(steps[step] != "RESTORED" for step in restored)):
        incomplete = True
    if any(steps[step] != "RESTORED" for step in restored_observations):
        incomplete = True
    if any(steps[step] != "RESTORED" for step in restored_editorials):
        incomplete = True
    if manifest.get("evidence_version", 1) >= 5 and failure_sequences.keys() - audited_failures:
        incomplete = True
    failed = bool(failures) or bool(endings and endings[0]["data"]["status"] == "FAIL")
    status = "FAIL" if failed else "INCONCLUSIVE" if incomplete else "REVIEW"
    return {"case_id": fixture["id"], "variant": fixture.get("variant"), "integrity": "INCOMPLETE" if incomplete else "VERIFIED",
            "status": status, "events": len(events), "root_sha256": previous,
            "source_sha256": fixture["source_sha256"], "source_manifest": source_manifest_status,
            "fixture_bytes": fixture_bytes_status,
            "resumed_from_root": resume.get("source_root") if resume else None,
            "resume_source": resume_source, "resume_readback": resume_readback,
            "resume_titles": resume_titles,
            "title_limitations": (["Legacy restoration did not preserve or independently verify per-revision SQL titles; synthetic placeholder titles may remain."] if resume_titles == "LEGACY_NOT_VERIFIED" else
                                  ["Original initial title was not recorded; the synthetic initializer title is an explicit fallback, not source-verified."] if resume_titles == "VERIFIED_COMMITTED_INITIAL_LEGACY_UNRECORDED" else []),
            "projection_migration": projection_migration,
            "resume_observations": observation_restore,
            "resume_editorials": editorial_restore,
            "gate_decisions": gates,
            "model_calls": len(requests), "unpaired_model_calls": sorted(requests.keys() - results),
            "steps": steps, "step_counts": dict(Counter(steps.values())), "blocked": blocked, "failures": failures,
            "independent_checks": {"ask_snapshot_unchanged": ask_checks, "editorial_no_writes": editorial_checks, "restore_cancel_no_writes": cancel_checks, "failure_no_writes": failure_checks},
            "latency_ms": {"count": len(latencies), "min": min(latencies) if latencies else None,
                           "median": statistics.median(latencies) if latencies else None,
                           "max": max(latencies) if latencies else None},
            "unreviewed_checks": {kind: len(checks) for kind, checks in case["checks"].items()},
            "notice": "No whole-case PASS. Chain integrity is not external notarization. Initial prehistory is synthetic; semantic, variant and reader review remain separate."}
