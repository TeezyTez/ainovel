#!/usr/bin/env bash
# New project adapter for the supplied Markdown benchmark, not the missing ZIP runner.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
export PATH=/opt/elselife-tools/go/bin:/root/.cargo/bin:/usr/lib/postgresql/16/bin:/usr/bin:/bin
export GOWORK=off GOPROXY=off
: "${ELSELIFE_DEEP_RUNTIME_MODE:=source}"
: "${ELSELIFE_DEEP_GO_BIN:=go}"
: "${ELSELIFE_DEEP_CARGO_BIN:=cargo}"
: "${ELSELIFE_DEEP_BUILD_JOBS:=2}"
: "${ELSELIFE_DEV_CODEX_MODEL:=gpt-6.1-sol}"
: "${ELSELIFE_DEV_CODEX_TEMP_DIR:=$root/.codex-model-tmp}"
: "${ELSELIFE_DEEP_BENCHMARK_DIR:=$root/.validation/deep-benchmark/$(date -u +%Y%m%dT%H%M%SZ)}"
: "${ELSELIFE_DEEP_CASES:=SYS-001,NAR-009}"
# Model credentials are resolved by the configured CLI, never copied into evidence.
: "${ELSELIFE_DEV_CODEX_CLI_PATH:?configure the model CLI path}"
: "${ELSELIFE_DEV_CODEX_AUTH_HOME:?configure the model authentication home path}"
if [[ ! "$ELSELIFE_DEEP_BUILD_JOBS" =~ ^[1-9][0-9]*$ ]]; then
  printf 'ELSELIFE_DEEP_BUILD_JOBS must be a positive integer.\n' >&2
  exit 2
fi
case "$ELSELIFE_DEEP_RUNTIME_MODE" in
  source) ;;
  external)
    : "${ELSELIFE_TEST_RUST_RUNTIME:?external mode requires an explicit runtime binary}"
    : "${ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON:?external mode requires ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON}"
    if [[ ! "$ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON" =~ [^[:space:]] ]]; then
      printf 'ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON must explain why an external binary is needed.\n' >&2
      exit 2
    fi
    ;;
  *) printf 'Unknown runtime mode: %s\n' "$ELSELIFE_DEEP_RUNTIME_MODE" >&2; exit 2 ;;
esac
export ELSELIFE_DEV_CODEX_MODEL ELSELIFE_DEV_CODEX_TEMP_DIR
# Resolve once before changing working directories. The final mkdir is atomic:
# even an empty prior run is evidence and may never be reused or overwritten.
ELSELIFE_DEEP_BENCHMARK_DIR=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$ELSELIFE_DEEP_BENCHMARK_DIR")
export ELSELIFE_DEEP_BENCHMARK_DIR ELSELIFE_DEEP_CASES
mkdir -p -- "$(dirname -- "$ELSELIFE_DEEP_BENCHMARK_DIR")"
if ! mkdir -- "$ELSELIFE_DEEP_BENCHMARK_DIR"; then
  printf 'Refusing an existing or unavailable evidence directory: %s\n' "$ELSELIFE_DEEP_BENCHMARK_DIR" >&2
  exit 2
fi
source_manifest() {
python3 - "$root" "$1" <<'PY'
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2])
paths=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=root).split(b'\0')
items={}
for raw in sorted(set(paths)):
    if not raw: continue
    name=raw.decode('utf-8');p=root/name
    if p.is_file() and name.startswith(('algorithms/','backend/','contracts/','frontend/lib/','tools/')):
        items[name]=hashlib.sha256(p.read_bytes()).hexdigest()
data=json.dumps(items,ensure_ascii=False,sort_keys=True,indent=2).encode()
out.write_bytes(data+b'\n')
print(hashlib.sha256(data).hexdigest())
PY
}
ELSELIFE_DEEP_SOURCE_SHA256=$(source_manifest "$ELSELIFE_DEEP_BENCHMARK_DIR/source-manifest.json")
export ELSELIFE_DEEP_SOURCE_SHA256
printf 'Evidence: %s\n' "$ELSELIFE_DEEP_BENCHMARK_DIR"
runtime_source=""
rust_build_command=()
if [[ "$ELSELIFE_DEEP_RUNTIME_MODE" == source ]]; then
  # Never share the ordinary Cargo target directory: a concurrent
  # --no-default-features build can otherwise replace its runtime executable.
  rust_target=$(mktemp -d "$ELSELIFE_DEEP_BENCHMARK_DIR/rust-target.XXXXXXXX")
  rust_build_command=("$ELSELIFE_DEEP_CARGO_BIN" build --locked --offline --features channel --jobs "$ELSELIFE_DEEP_BUILD_JOBS" --bin algorithm-runtime --target-dir "$rust_target")
  "$ELSELIFE_DEEP_CARGO_BIN" --version > "$ELSELIFE_DEEP_BENCHMARK_DIR/cargo-version.txt"
  (cd "$root/algorithms"; "${rust_build_command[@]}") 2>&1 | tee "$ELSELIFE_DEEP_BENCHMARK_DIR/rust-build.log"
  runtime_source="$rust_target/debug/algorithm-runtime"
else
  runtime_source=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve(strict=True))' "$ELSELIFE_TEST_RUST_RUNTIME")
fi
# Pin this attempt's runtime before any cases start, including queued subtests.
cp -- "$runtime_source" "$ELSELIFE_DEEP_BENCHMARK_DIR/algorithm-runtime"
chmod 500 "$ELSELIFE_DEEP_BENCHMARK_DIR/algorithm-runtime"
export ELSELIFE_TEST_RUST_RUNTIME="$ELSELIFE_DEEP_BENCHMARK_DIR/algorithm-runtime"
cd "$root/backend"
"$ELSELIFE_DEEP_GO_BIN" version > "$ELSELIFE_DEEP_BENCHMARK_DIR/go-version.txt"
"$ELSELIFE_DEEP_GO_BIN" test -c -tags=integration,codexlive -o "$ELSELIFE_DEEP_BENCHMARK_DIR/benchmark.test" ./internal/experience 2>&1 | tee "$ELSELIFE_DEEP_BENCHMARK_DIR/go-build.log"
after=$(source_manifest "$ELSELIFE_DEEP_BENCHMARK_DIR/source-manifest-after-build.json")
if [[ "$after" != "$ELSELIFE_DEEP_SOURCE_SHA256" ]]; then
  printf 'Source changed during compilation; no model calls made. Preserve this directory and start a fresh run.\n' >&2
  exit 2
fi
sha256sum "$ELSELIFE_DEEP_BENCHMARK_DIR/benchmark.test" "$ELSELIFE_TEST_RUST_RUNTIME" > "$ELSELIFE_DEEP_BENCHMARK_DIR/binaries.sha256"
python3 - "$ELSELIFE_DEEP_BENCHMARK_DIR" "$ELSELIFE_DEEP_RUNTIME_MODE" "$runtime_source" "$ELSELIFE_DEEP_SOURCE_SHA256" "${ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON:-}" "${rust_build_command[@]}" <<'PY'
import hashlib,json,pathlib,sys
out=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
runtime_hash=hashlib.sha256()
with (out/'algorithm-runtime').open('rb') as runtime:
    for block in iter(lambda:runtime.read(64*1024),b''):
        runtime_hash.update(block)
record={
    'schema_version':1,'mode':mode,'runtime_source':sys.argv[3],
    'runtime_sha256':runtime_hash.hexdigest(),
    'source_tree_sha256':sys.argv[4],
    'source_correspondence':'source_manifest_stable_during_build' if mode=='source' else 'unverified_external_binary',
    'reason':sys.argv[5] if mode=='external' else None,
    'cargo_argv':sys.argv[6:] if mode=='source' else None,
    'notice':'Build provenance is local evidence, not external attestation or narrative acceptance.',
}
with (out/'runtime-build.json').open('x',encoding='utf-8') as f:
    json.dump(record,f,ensure_ascii=False,indent=2);f.write('\n')
PY
cd "$root/backend/internal/experience"
"$ELSELIFE_DEEP_BENCHMARK_DIR/benchmark.test" -test.count=1 -test.timeout=120m -test.parallel=2 -test.run '^TestDeepBenchmarkLive$' -test.v 2>&1 | tee "$ELSELIFE_DEEP_BENCHMARK_DIR/process.log"
