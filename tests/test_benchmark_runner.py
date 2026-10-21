"""Real-process runner fault tests; not ElseLife product acceptance."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "tools/benchmark/runner.py"
CATALOG = ROOT / "tests/benchmark/catalog.json"


class BenchmarkRunnerTests(unittest.TestCase):
    def command(self, *args):
        self.assertTrue(RUNNER.is_file(), "project-local evidence runner is missing")
        return subprocess.run([sys.executable, str(RUNNER), *map(str, args)],
                              capture_output=True, text=True, encoding="utf-8")

    def execute(self, directory, code, *extra):
        argv = directory / "argv.json"
        argv.write_text(json.dumps([sys.executable, "-c", code]), encoding="utf-8")
        bundle = directory / "run"
        result = self.command("run", "--catalog", CATALOG, "--case", "SYS-001",
                              "--argv-file", argv, "--out", bundle, *extra)
        return result, bundle

    def test_successful_child_cannot_self_declare_pass_and_bundle_detects_tampering(self):
        with tempfile.TemporaryDirectory() as temp:
            result, bundle = self.execute(Path(temp), 'print("PASS all tests, quality 4/4")')
            self.assertEqual(0, result.returncode, result.stderr)
            report = json.loads((bundle / "run.json").read_text())
            self.assertEqual("REVIEW", report["status"])
            self.assertEqual("process_execution_only", report["scope"])
            self.assertEqual(0, report["exit_code"])
            self.assertEqual(0, self.command("verify", "--bundle", bundle).returncode)
            (bundle / "stdout.txt").write_text("different output")
            self.assertNotEqual(0, self.command("verify", "--bundle", bundle).returncode)

    def test_nonzero_exit_preserves_partial_output_and_is_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            result, bundle = self.execute(Path(temp), 'import sys; print("partial"); sys.exit(7)')
            self.assertNotEqual(0, result.returncode)
            report = json.loads((bundle / "run.json").read_text())
            self.assertEqual("FAIL", report["status"])
            self.assertEqual(7, report["exit_code"])
            self.assertEqual("partial\n", (bundle / "stdout.txt").read_text())
            self.assertEqual(0, self.command("verify", "--bundle", bundle).returncode)

    def test_argv_is_not_a_shell_and_unselected_environment_is_not_forwarded(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            marker = directory / "should-not-exist"
            argv = directory / "argv.json"
            argv.write_text(json.dumps([sys.executable, "-c", "import sys;print(sys.argv[1])",
                                       f"; touch {marker}"]), encoding="utf-8")
            bundle = directory / "run"
            result = self.command("run", "--catalog", CATALOG, "--case", "SYS-001",
                                  "--argv-file", argv, "--out", bundle)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertFalse(marker.exists())
            self.assertIn("; touch", (bundle / "stdout.txt").read_text())
            argv.write_text(json.dumps([sys.executable, "-c", "import os;print(os.getenv('BENCHMARK_PRIVATE_SENTINEL','absent'))"]), encoding="utf-8")
            env = dict(os.environ, BENCHMARK_PRIVATE_SENTINEL="should-not-propagate")
            result = subprocess.run([sys.executable, str(RUNNER), "run", "--catalog", str(CATALOG),
                                     "--case", "SYS-001", "--argv-file", str(argv), "--out", str(directory / "env-run")],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("absent\n", (directory / "env-run/stdout.txt").read_text())

    def test_missing_required_artifact_is_inconclusive_even_after_exit_zero(self):
        with tempfile.TemporaryDirectory() as temp:
            result, bundle = self.execute(Path(temp), "print('done')", "--artifact", Path(temp) / "missing.json")
            self.assertNotEqual(0, result.returncode)
            report = json.loads((bundle / "run.json").read_text())
            self.assertEqual("INCONCLUSIVE", report["status"])
            self.assertEqual(1, len(report["missing_artifacts"]))

    def test_unknown_cases_and_reused_output_directory_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            result, bundle = self.execute(directory, "print('one run')")
            self.assertEqual(0, result.returncode, result.stderr)
            before = (bundle / "run.json").read_bytes()
            again, _ = self.execute(directory, "print('overwrite')")
            self.assertNotEqual(0, again.returncode)
            self.assertEqual(before, (bundle / "run.json").read_bytes())
            invalid = self.command("run", "--catalog", CATALOG, "--case", "SYS-999",
                                   "--argv-file", directory / "argv.json", "--out", directory / "bad")
            self.assertNotEqual(0, invalid.returncode)
            self.assertFalse((directory / "bad").exists())

    def test_timeout_keeps_evidence_and_cannot_count_as_success(self):
        with tempfile.TemporaryDirectory() as temp:
            result, bundle = self.execute(Path(temp), "import time;print('before timeout',flush=True);time.sleep(10)",
                                          "--timeout", "0.1")
            self.assertNotEqual(0, result.returncode)
            report = json.loads((bundle / "run.json").read_text())
            self.assertEqual("FAIL", report["status"])
            self.assertTrue(report["timed_out"])
            self.assertIn("before timeout", (bundle / "stdout.txt").read_text())

    def test_registry_keeps_full_denominator_and_assessment_cannot_edit_run(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            registry = directory / "coverage.json"
            init = self.command("init", "--catalog", CATALOG, "--out", registry)
            self.assertEqual(0, init.returncode, init.stderr)
            coverage = json.loads(registry.read_text())
            self.assertEqual(91, len(coverage["cases"]))
            case = coverage["cases"]["SYS-001"]
            self.assertEqual("NOT_RUN", case["status"])
            self.assertEqual(4, len(case["hard"]))
            self.assertTrue(all(item["status"] == "NOT_RUN" for item in case["hard"].values()))
            result, bundle = self.execute(directory, "print('synthetic evidence')")
            before = hashlib.sha256((bundle / "bundle.json").read_bytes()).hexdigest()
            review = directory / "review.json"
            assess = self.command("assess", "--catalog", CATALOG, "--bundle", bundle,
                                  "--case", "SYS-001", "--check", "SYS-001-H1", "--status", "FAIL",
                                  "--method", "model_review", "--reviewer", "synthetic-test",
                                  "--note", "Synthetic negative control; not a real product observation.",
                                  "--evidence", "stdout.txt", "--out", review)
            self.assertEqual(0, assess.returncode, assess.stderr)
            self.assertEqual(before, hashlib.sha256((bundle / "bundle.json").read_bytes()).hexdigest())
            claim = json.loads(review.read_text())
            self.assertEqual(before, claim["bundle_sha256"])
            self.assertEqual("FAIL", claim["status"])
            summary = self.command("report", "--catalog", CATALOG, "--registry", registry, "--assessment", review)
            self.assertEqual(0, summary.returncode, summary.stderr)
            data = json.loads(summary.stdout)
            self.assertEqual(1, data["checks"]["FAIL"])
            self.assertGreater(data["checks"]["NOT_RUN"], 1000)
            self.assertEqual(0, data["cases"].get("PASS", 0))

    def test_quality_cannot_pass_from_process_or_automatic_judge(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            _, bundle = self.execute(directory, "print('synthetic prose')")
            rejected = self.command("assess", "--catalog", CATALOG, "--bundle", bundle,
                                    "--case", "SYS-001", "--check", "SYS-001-Q01", "--status", "PASS",
                                    "--method", "model_review", "--reviewer", "model",
                                    "--note", "Cannot impersonate human readers.", "--evidence", "stdout.txt",
                                    "--out", directory / "bad-review.json")
            self.assertNotEqual(0, rejected.returncode)
            self.assertFalse((directory / "bad-review.json").exists())

    def test_assessment_cannot_be_written_into_sealed_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            _, bundle = self.execute(directory, "print('evidence')")
            before = sorted(path.name for path in bundle.iterdir())
            result = self.command("assess", "--catalog", CATALOG, "--bundle", bundle,
                                  "--case", "SYS-001", "--check", "SYS-001-H1", "--status", "FAIL",
                                  "--method", "model_review", "--reviewer", "synthetic",
                                  "--note", "Synthetic negative control.", "--evidence", "stdout.txt",
                                  "--out", bundle / "review.json")
            self.assertNotEqual(0, result.returncode)
            self.assertEqual(before, sorted(path.name for path in bundle.iterdir()))

    def test_report_rejects_review_of_a_case_not_selected_in_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            registry = directory / "coverage.json"
            self.assertEqual(0, self.command("init", "--catalog", CATALOG, "--out", registry).returncode)
            _, bundle = self.execute(directory, "print('only SYS-001 evidence')")
            review = directory / "review.json"
            self.assertEqual(0, self.command("assess", "--catalog", CATALOG, "--bundle", bundle,
                              "--case", "SYS-001", "--check", "SYS-001-H1", "--status", "FAIL",
                              "--method", "model_review", "--reviewer", "synthetic", "--note", "negative control",
                              "--evidence", "stdout.txt", "--out", review).returncode)
            claim = json.loads(review.read_text())
            claim.update(case_id="SYS-002", check_id="SYS-002-H1")
            review.write_text(json.dumps(claim))
            result = self.command("report", "--catalog", CATALOG, "--registry", registry, "--assessment", review)
            self.assertNotEqual(0, result.returncode)

    def test_native_run_updates_measured_steps_without_promoting_unreviewed_checks(self):
        from test_benchmark_native import write_events
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            registry = directory / "coverage.json"
            self.assertEqual(0, self.command("init", "--catalog", CATALOG, "--out", registry).returncode)
            native = directory / "native"
            native.mkdir()
            write_events(native)
            result = self.command("report", "--catalog", CATALOG, "--registry", registry, "--native-run", native)
            self.assertEqual(0, result.returncode, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(1, report["cases"]["REVIEW"])
            self.assertEqual(90, report["cases"]["NOT_RUN"])
            self.assertEqual({"NOT_RUN": 328}, report["by_kind"]["hard"])
            self.assertEqual(1, report["by_kind"]["steps"]["REVIEW"])
            self.assertEqual(1, report["by_kind"]["steps"]["BLOCKED"])


if __name__ == "__main__":
    unittest.main()
