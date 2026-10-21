"""Synthetic projection provenance controls, not narrative acceptance."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_benchmark_native import CATALOG, load_native, replay_records, resume_records, seal_events


def projected_resume(directory):
    source = replay_records()
    state = source[0][2]["fixture"]["state"]
    state["facts"].append({"id": "projection-visible", "kind": "fact", "text": "Earlier fact.",
                           "known": True, "source_revision": 1, "known_by": []})
    for index in (1, 5):
        for page in source[index][2]["public_view"]["pages"]:
            page["reader"] = {"revision": page["revision"], "information": [
                {"id": "fact:projection-visible", "kind": "fact", "text": "Earlier fact."}], "records": []}
    records = [(kind, step, copy.deepcopy(data)) for kind, step, data in resume_records(directory, source, version=3)]
    readback = records[3][2]
    readback["stored_pages"] = copy.deepcopy(readback["public_view"]["pages"])
    readback["projection_migration"] = "information_recorded_revision_v1"
    for page in readback["public_view"]["pages"]:
        page["reader"]["information"][0]["recorded_revision"] = 1
    latest = readback["public_view"]["pages"][-1]["reader"]
    readback["public_view"].update(reader=copy.deepcopy(latest), information=copy.deepcopy(latest["information"]))
    initial = records[2][2]["public_view"]
    initial["pages"] = copy.deepcopy(readback["public_view"]["pages"][:1])
    initial.update(reader=copy.deepcopy(initial["pages"][0]["reader"]),
                   information=copy.deepcopy(initial["pages"][0]["reader"]["information"]))
    return records


class ProjectionTests(unittest.TestCase):
    def test_v4_restored_titles_are_bound_to_source_and_sql_readbacks(self):
        module = load_native(self)
        for mutation in ("valid", "legacy_initial", "source_title", "stored_title", "latest_title", "branch_title", "missing_binding", "missing_committed"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                records = projected_resume(directory)
                source = [json.loads(line) for line in (directory / "source-events.jsonl").read_bytes().splitlines()]
                source[1]["data"]["public_view"]["title"] = "Original title"
                source[5]["data"]["public_view"]["title"] = "Question title"
                if mutation == "legacy_initial":
                    del source[1]["data"]["public_view"]["title"]
                if mutation == "missing_committed":
                    del source[5]["data"]["public_view"]["title"]
                seal_events(directory, [(e["kind"], e["step"], e["data"]) for e in source], prefix="source-")
                import hashlib
                records[0][2]["evidence_version"] = 4
                resume = records[1][2]
                resume["source_root"] = (directory / "source-root.sha256").read_text().strip()
                resume["events_sha256"] = hashlib.sha256((directory / "source-events.jsonl").read_bytes()).hexdigest()
                first_title = "合成世界初始记录" if mutation == "legacy_initial" else "Original title"
                for index, title in enumerate((first_title, "Question title")):
                    resume["pages"][index].update(title=title, title_provenance="legacy_initial_title_unrecorded" if index == 0 and mutation == "legacy_initial" else "source_public_view_title")
                records[2][2]["public_view"]["title"] = first_title
                readback = records[3][2]
                readback.update(title_binding="source_public_view_title_v1", branch_title="Question title", stored_titles=[{"revision": 1, "title": first_title}, {"revision": 2, "title": "Question title"}])
                readback["public_view"]["title"] = "Question title"
                records[4] = ("restored_step", "S01", copy.deepcopy(resume["pages"][1]))
                if mutation == "source_title": resume["pages"][1]["title"] = "Changed source claim"
                elif mutation == "stored_title": readback["stored_titles"][0]["title"] = "Rewritten SQL title"
                elif mutation == "latest_title": readback["public_view"]["title"] = "Old synthetic placeholder"
                elif mutation == "branch_title": readback["branch_title"] = "Rewritten branch title"
                elif mutation == "missing_binding": del readback["title_binding"]
                seal_events(directory, records)
                if mutation in {"valid", "legacy_initial"}:
                    result = module.verify_native(directory, CATALOG)
                    self.assertEqual("VERIFIED", result["integrity"])
                    self.assertEqual("VERIFIED_COMMITTED_INITIAL_LEGACY_UNRECORDED" if mutation == "legacy_initial" else "VERIFIED", result["resume_titles"])
                else:
                    with self.assertRaises(ValueError): module.verify_native(directory, CATALOG)

    def test_v3_keeps_explicit_legacy_title_limitation(self):
        module = load_native(self)
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            records = projected_resume(directory)
            records[3][2]["public_view"]["title"] = "Old overwritten synthetic placeholder"
            seal_events(directory, records)
            result = module.verify_native(directory, CATALOG)
            self.assertEqual("VERIFIED", result["integrity"])
            self.assertEqual("LEGACY_NOT_VERIFIED", result["resume_titles"])

    def test_restored_observation_binds_original_event_and_is_not_rerun_at_latest_revision(self):
        module = load_native(self)
        for mutation in ("valid", "seq", "changed_snapshot", "current_page", "rerun", "missing"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                records = projected_resume(directory)
                source = [json.loads(line) for line in (directory / "source-events.jsonl").read_bytes().splitlines()]
                observation = {"snapshot": source[1]["data"]["snapshot"], "public_view": source[1]["data"]["public_view"]}
                source_records = [(event["kind"], event["step"], event["data"]) for event in source]
                source_records.insert(2, ("observation", "S02", observation))  # Original revision 1, latest restored revision 2.
                seal_events(directory, source_records, prefix="source-")
                import hashlib
                manifest = records[1][2]
                manifest["source_root"] = (directory / "source-root.sha256").read_text().strip()
                manifest["events_sha256"] = hashlib.sha256((directory / "source-events.jsonl").read_bytes()).hexdigest()
                original = {"step": "S02", "event_seq": 3, "data": observation}
                manifest["observations"] = [copy.deepcopy(original)]
                if mutation == "seq":
                    manifest["observations"][0]["event_seq"] = 2
                elif mutation == "changed_snapshot":
                    manifest["observations"][0]["data"]["snapshot"]["story_time"] = "another time"
                elif mutation == "current_page":
                    original = copy.deepcopy(original)
                    original["data"]["public_view"] = records[3][2]["public_view"]
                if mutation == "rerun":
                    records.insert(-1, ("observation", "S02", {"snapshot": records[3][2]["snapshots"][-1]["state"], "public_view": records[3][2]["public_view"]}))
                elif mutation != "missing":
                    records.insert(-1, ("restored_observation", "S02", original))
                seal_events(directory, records)
                if mutation == "valid":
                    result = module.verify_native(directory, CATALOG)
                    self.assertEqual("RESTORED", result["steps"]["S02"])
                    self.assertEqual("VERIFIED", result["integrity"])
                elif mutation == "missing":
                    self.assertEqual("INCOMPLETE", module.verify_native(directory, CATALOG)["integrity"])
                else:
                    with self.assertRaises(ValueError):
                        module.verify_native(directory, CATALOG)

    def test_v3_only_explicit_metadata_migration_and_original_storage_are_allowed(self):
        module = load_native(self)
        for mutation in ("valid", "order", "stored", "prose", "other_reader", "wrong_revision", "missing_marker", "top", "initial"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                records = projected_resume(directory)
                data = records[3][2]
                if mutation == "order":
                    records[2], records[3] = records[3], records[2]
                elif mutation == "stored":
                    data["stored_pages"][0]["reader"]["information"][0]["recorded_revision"] = 1
                elif mutation == "prose":
                    data["public_view"]["pages"][0]["text"] += " rewritten"
                elif mutation == "other_reader":
                    data["public_view"]["pages"][0]["reader"]["unexpected"] = "ignored?"
                elif mutation == "wrong_revision":
                    data["public_view"]["pages"][1]["reader"]["information"][0]["recorded_revision"] = 2
                elif mutation == "missing_marker":
                    del data["projection_migration"]
                elif mutation == "top":
                    data["public_view"]["information"] = []
                elif mutation == "initial":
                    records[2][2]["public_view"]["reader"]["information"] = []
                seal_events(directory, records)
                if mutation in {"valid", "order"}:
                    result = module.verify_native(directory, CATALOG)
                    self.assertEqual("VERIFIED", result["resume_readback"])
                    self.assertEqual("information_recorded_revision_v1", result["projection_migration"])
                else:
                    with self.assertRaises(ValueError):
                        module.verify_native(directory, CATALOG)

    def test_migration_rejects_wrong_old_metadata_missing_reader_and_hidden_subject(self):
        module = load_native(self)
        state = {"entities": [], "threads": [], "facts": [
            {"id": "visible", "known": True, "source_revision": 1},
            {"id": "hidden", "known": False, "source_revision": 1},
            {"id": "subject", "known": True, "subject_id": "unknown", "source_revision": 1}]}
        for mutation in ("wrong", "zero", "hidden", "subject", "missing_reader", "bool"):
            with self.subTest(mutation=mutation):
                page = {"reader": {"information": [{"id": "fact:visible"}]}}
                if mutation == "missing_reader":
                    page["reader"] = None
                elif mutation in {"hidden", "subject"}:
                    page["reader"]["information"][0].update(id="fact:" + mutation, recorded_revision=1)
                else:
                    page["reader"]["information"][0]["recorded_revision"] = {"wrong": 2, "zero": 0, "bool": True}[mutation]
                with self.assertRaises(ValueError):
                    module.migrate_information_page(page, state)


if __name__ == "__main__":
    unittest.main()
