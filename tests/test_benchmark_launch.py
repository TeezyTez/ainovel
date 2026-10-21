"""Real Bash launcher controls with synthetic compilers, never model acceptance."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "tools/run-deep-benchmark.sh"


@unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "launcher runs under Linux/WSL")
class BenchmarkLaunchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="benchmark-launch-")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "project with spaces"
        for path in ("tools", "algorithms/src", "backend/internal/experience", "fixture-tools"):
            (self.project / path).mkdir(parents=True, exist_ok=True)
        shutil.copyfile(LAUNCHER, self.project / "tools/run-deep-benchmark.sh")
        (self.project / ".gitignore").write_text(".validation/\n.cache/\n")
        (self.project / "algorithms/src/runtime.txt").write_text("source-channel-runtime\n")
        (self.project / "backend/source.go").write_text("package probe\n")
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        self.output = self.project / ".validation/run"
        self.shared = self.project / "fixture-tools/shared-runtime"
        self.shared.write_text("#!/bin/sh\nexit 2\n")
        self.shared.chmod(0o700)
        fake = self.project / "fixture-tools/compiler.py"
        fake.write_text(textwrap.dedent(r'''
            #!/usr/bin/env python3
            import hashlib,json,os,pathlib,sys
            tool=sys.argv[1]; args=sys.argv[2:]
            root=pathlib.Path(os.environ["TEST_PROJECT"])
            output=pathlib.Path(os.environ["ELSELIFE_DEEP_BENCHMARK_DIR"])
            if args in (["--version"], ["version"]):
                print(tool+" synthetic-compiler 1.0");sys.exit(0)
            with (root/"fixture-tools/invocations.jsonl").open("a") as f:
                f.write(json.dumps({"tool":tool,"args":args,"target_env":os.environ.get("CARGO_TARGET_DIR")})+"\n")
            if tool=="cargo":
                target=pathlib.Path(args[args.index("--target-dir")+1])
                p=target/"debug/algorithm-runtime";p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text("#!/bin/sh\n# "+(root/"algorithms/src/runtime.txt").read_text()+"exit 0\n")
                p.chmod(0o700)
            else:
                p=pathlib.Path(args[args.index("-o")+1])
                p.write_text("#!/usr/bin/env python3\nimport hashlib,json,os,pathlib,subprocess,sys\n"
                    "p=pathlib.Path(os.environ['ELSELIFE_TEST_RUST_RUNTIME'])\n"
                    "out=pathlib.Path(os.environ['ELSELIFE_DEEP_BENCHMARK_DIR'])\n"
                    "(out/'executed.json').write_text(json.dumps({'runtime':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))\n"
                    "sys.exit(subprocess.run([str(p)]).returncode)\n")
                p.chmod(0o700)
            if os.environ.get("TEST_MUTATE_AT")==tool:
                with (root/"algorithms/src/runtime.txt").open("a") as f:f.write("changed during compilation\n")
            if os.environ.get("TEST_FAIL_AT")==tool:sys.exit(19)
        ''').lstrip())
        fake.chmod(0o700)
        for tool in ("cargo", "go"):
            wrapper = self.project / "fixture-tools" / tool
            wrapper.write_text("#!/bin/sh\nexec " + self.shell_quote(sys.executable) + " " + self.shell_quote(str(fake)) + " " + tool + ' "$@"\n')
            wrapper.chmod(0o700)
        # The old launcher resets PATH. Shell functions also let the negative
        # control exercise its original commands without compiling the product.
        env_script = self.project / "fixture-tools/shell-env.sh"
        env_script.write_text('go() { "$ELSELIFE_DEEP_GO_BIN" "$@"; }\ncargo() { "$ELSELIFE_DEEP_CARGO_BIN" "$@"; }\n')
        self.env = {**os.environ, "BASH_ENV": str(env_script), "TEST_PROJECT": str(self.project),
                    "ELSELIFE_DEEP_BENCHMARK_DIR": str(self.output),
                    "ELSELIFE_DEEP_GO_BIN": str(self.project / "fixture-tools/go"),
                    "ELSELIFE_DEEP_CARGO_BIN": str(self.project / "fixture-tools/cargo"),
                    "ELSELIFE_TEST_RUST_RUNTIME": str(self.shared),
                    "ELSELIFE_DEV_CODEX_CLI_PATH": "/unused/synthetic-cli",
                    "ELSELIFE_DEV_CODEX_AUTH_HOME": "/unused/synthetic-auth"}
        for name in ("ELSELIFE_DEEP_RUNTIME_MODE", "ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON", "ELSELIFE_DEEP_RESUME_RUN",
                     "TEST_MUTATE_AT", "TEST_FAIL_AT"):
            self.env.pop(name, None)

    @staticmethod
    def shell_quote(value):
        return "'" + value.replace("'", "'\"'\"'") + "'"

    def launch(self, **env):
        return subprocess.run(["bash", str(self.project / "tools/run-deep-benchmark.sh")],
                              env={**self.env, **env}, capture_output=True, text=True, timeout=30)

    def test_existing_output_is_rejected_before_any_evidence_is_rewritten(self):
        self.output.mkdir(parents=True)
        marker = self.output / "source-manifest.json"
        marker.write_bytes(b"retained first attempt\n")
        result = self.launch()
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(b"retained first attempt\n", marker.read_bytes())
        self.assertEqual(["source-manifest.json"], sorted(p.name for p in self.output.iterdir()))
        self.assertFalse((self.project / "fixture-tools/invocations.jsonl").exists())

    def test_default_runtime_is_built_with_channel_and_bound_to_recorded_source(self):
        shared_target = self.project / "fixture-tools/ordinary-target"
        shared_target.mkdir()
        sentinel = shared_target / "other-build.txt"
        sentinel.write_text("concurrent no-default-features target")
        result = self.launch(CARGO_TARGET_DIR=str(shared_target))
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        calls = [json.loads(s) for s in (self.project / "fixture-tools/invocations.jsonl").read_text().splitlines()]
        self.assertEqual(["cargo", "go"], [c["tool"] for c in calls])
        cargo = calls[0]["args"]
        self.assertEqual("channel", cargo[cargo.index("--features") + 1])
        self.assertIn("--locked", cargo)
        self.assertIn("--offline", cargo)
        private_target = Path(cargo[cargo.index("--target-dir") + 1])
        self.assertNotEqual(shared_target, private_target)
        self.assertTrue(private_target.is_relative_to(self.output))
        self.assertEqual([sentinel], list(shared_target.iterdir()))
        runtime = self.output / "algorithm-runtime"
        self.assertIn(b"source-channel-runtime", runtime.read_bytes())
        self.assertNotEqual(self.shared.read_bytes(), runtime.read_bytes())
        executed = json.loads((self.output / "executed.json").read_text())
        provenance = json.loads((self.output / "runtime-build.json").read_text())
        self.assertEqual("source", provenance["mode"])
        self.assertEqual(executed["sha256"], provenance["runtime_sha256"])
        self.assertEqual(hashlib.sha256(runtime.read_bytes()).hexdigest(), provenance["runtime_sha256"])
        source = (self.output / "source-manifest.json").read_bytes()
        self.assertEqual(hashlib.sha256(source.removesuffix(b"\n")).hexdigest(), provenance["source_tree_sha256"])
        self.assertEqual(source, (self.output / "source-manifest-after-build.json").read_bytes())
        self.assertTrue((self.output / "rust-build.log").is_file())
        self.assertTrue((self.output / "go-build.log").is_file())

    def test_source_change_during_rust_build_prevents_any_benchmark_execution(self):
        result = self.launch(TEST_MUTATE_AT="cargo")
        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertFalse((self.output / "executed.json").exists())
        self.assertIn("Source changed", result.stderr)
        self.assertNotEqual((self.output / "source-manifest.json").read_bytes(),
                            (self.output / "source-manifest-after-build.json").read_bytes())

    def test_source_change_during_go_build_prevents_any_benchmark_execution(self):
        result = self.launch(TEST_MUTATE_AT="go")
        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertFalse((self.output / "executed.json").exists())
        self.assertIn("Source changed", result.stderr)

    def test_explicit_external_runtime_requires_a_reason(self):
        for reason in ("", "  "):
            with self.subTest(reason=reason):
                result = self.launch(ELSELIFE_DEEP_RUNTIME_MODE="external", ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON=reason)
                self.assertNotEqual(0, result.returncode)
                self.assertFalse((self.output / "executed.json").exists())
                self.assertIn("EXTERNAL_RUNTIME_REASON", result.stderr)

    def test_external_runtime_is_pinned_and_recorded_without_claiming_source_correspondence(self):
        self.shared.write_text("#!/bin/sh\nexit 0\n")
        result = self.launch(ELSELIFE_DEEP_RUNTIME_MODE="external", ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON="Synthetic transport-only control")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        provenance_path = self.output / "runtime-build.json"
        self.assertTrue(provenance_path.is_file(), "external artifact provenance was not recorded")
        provenance = json.loads(provenance_path.read_text())
        self.assertEqual("external", provenance["mode"])
        self.assertEqual("unverified_external_binary", provenance["source_correspondence"])
        self.assertEqual("Synthetic transport-only control", provenance["reason"])
        self.assertEqual(self.shared.read_bytes(), (self.output / "algorithm-runtime").read_bytes())

    def test_failed_compiler_preserves_log_and_does_not_launch_benchmark(self):
        result = self.launch(TEST_FAIL_AT="cargo")
        self.assertNotEqual(0, result.returncode)
        self.assertFalse((self.output / "executed.json").exists())
        self.assertTrue((self.output / "rust-build.log").is_file())

    def test_benchmark_process_failure_remains_nonzero_with_sealed_binary_identity(self):
        result = self.launch(ELSELIFE_DEEP_RUNTIME_MODE="external", ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON="Synthetic no-channel exit control")
        self.assertEqual(2, result.returncode)
        self.assertTrue((self.output / "executed.json").is_file())
        self.assertTrue((self.output / "process.log").is_file())
        self.assertTrue((self.output / "runtime-build.json").is_file())


if __name__ == "__main__":
    unittest.main()
