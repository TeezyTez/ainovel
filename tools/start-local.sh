#!/usr/bin/env bash
# Local development launcher. Does not initialize/drop databases or read auth files.
set -euo pipefail
mode=${1:-check}
root=${2:?repository path required}
cli=${3:-}
auth=${4:-}
# Transport Windows paths as WSL paths so wsl.exe cannot consume backslashes.
if [[ $auth == /mnt/* ]]; then auth=$(wslpath -w "$auth"); fi
model=${5:-gpt-6.1-sol}
proxy=${6:-}
node=${7:-}
cache=/root/.cache/elselife-local
rust_target=/root/.cache/elselife-cargo-target
go_bin=/opt/elselife-tools/bin/elselife-product-dev-local
rust_bin=$rust_target/debug/algorithm-runtime
web=$root/frontend/build/web
export PATH="/opt/elselife-tools/go/bin:/root/.cargo/bin:/usr/lib/postgresql/16/bin:/usr/sbin:/usr/bin:/bin:$PATH"

check_port() {
 python3 - "$1" "$root" "$go_bin" "$rust_bin" <<'PY'
import hashlib,json,os,re,subprocess,sys,urllib.request
port=int(sys.argv[1]);root=sys.argv[2]
lines=subprocess.check_output(['ss','-ltnp',f'sport = :{port}'],text=True).splitlines()[1:]
if not lines:sys.exit(10)
if len(lines)!=1 or '127.0.0.1:'+str(port) not in lines[0]:raise SystemExit('Refusing occupied/non-loopback port '+str(port))
match=re.search(r'pid=(\d+)',lines[0])
if not match:raise SystemExit('Cannot identify listener '+str(port))
pid=match.group(1);args=open('/proc/'+pid+'/cmdline','rb').read().split(b'\0');args=[v.decode() for v in args if v]
if port==18081:
 if not os.path.basename(args[0]).startswith('elselife-product-dev'):raise SystemExit('Unknown Go-port process; leave it unchanged')
 with urllib.request.urlopen('http://127.0.0.1:18081/healthz',timeout=3) as r:health=json.load(r)
 with urllib.request.urlopen('http://127.0.0.1:18081/v1/meta',timeout=3) as r:meta=json.load(r)
 expected=hashlib.sha256(open(root+'/contracts/experience/v1/contract.json','rb').read()).hexdigest()
 if health.get('service')!='elselife-product-dev' or meta.get('experience_contract')!=expected:raise SystemExit('Running Go identity/contract mismatch; leave it unchanged')
 expected_binary=sys.argv[3]
elif port==18083:
 if os.path.basename(args[0])!='algorithm-runtime' or '--insecure-plaintext' not in args:raise SystemExit('Unknown Rust-port process; leave it unchanged')
 expected_binary=sys.argv[4]
else:
 expected_binary=None
 if 'http.server' not in args or '--directory' not in args or args[args.index('--directory')+1]!=root+'/frontend/build/web':raise SystemExit('Unknown web-port process; leave it unchanged')
 with urllib.request.urlopen('http://127.0.0.1:18080/index.html',timeout=3) as r:served=r.read()
 if served!=open(root+'/frontend/build/web/index.html','rb').read():raise SystemExit('Web root mismatch; leave it unchanged')
if expected_binary and os.path.isfile(expected_binary):
 def digest(p):
  h=hashlib.sha256()
  with open(p,'rb') as f:
   for block in iter(lambda:f.read(1<<20),b''):h.update(block)
  return h.digest()
 if digest('/proc/'+pid+'/exe')!=digest(expected_binary):raise SystemExit('Running binary differs from current build on port '+str(port)+'; stop that known old process explicitly before restarting')
print('verified port '+str(port))
PY
}

if [[ $mode == build ]]; then
 mkdir -p "$cache/logs" /opt/elselife-tools/bin
 (cd "$root/backend"; GOWORK=off GOPROXY=off go build -o "$go_bin" ./cmd/product-dev)
 (cd "$root/algorithms"; CARGO_TARGET_DIR="$rust_target" cargo build --locked --offline --bin algorithm-runtime)
 echo 'Go and Rust builds complete; Flutter web build is supplied separately.'
 exit 0
fi

if [[ $mode == check ]]; then
 for port in 18083 18081 18080; do check_port "$port"; done
 exit 0
fi
[[ $mode == start ]] || { echo 'mode must be check, build or start' >&2; exit 2; }
[[ -x $node && -x $cli && -n $auth && -f $web/index.html ]] || { echo 'Missing installed Codex executable, auth-home path or frontend/build/web/index.html' >&2; exit 2; }
[[ -d $root/tools/artifact-compiler/node_modules ]] || { echo 'Install artifact compiler dependencies first: run npm ci in tools/artifact-compiler.' >&2; exit 2; }
mkdir -p "$cache/logs" "$root/.codex-model-tmp"
chmod 1777 "$root/.codex-model-tmp"

# Validate every occupied port before starting anything; never stop an unknown process.
missing=()
for port in 18083 18081 18080; do
 if check_port "$port"; then :; else code=$?; [[ $code == 10 ]] || exit "$code"; missing+=("$port"); fi
done
for port in "${missing[@]}"; do
 if [[ $port == 18081 && ! -x $go_bin || $port == 18083 && ! -x $rust_bin ]]; then echo 'Build first with -Build; dependency download is not automatic.' >&2; exit 2; fi
done
for port in "${missing[@]}"; do
 case $port in
  18083) nohup setsid "$rust_bin" --listen 127.0.0.1:18083 --insecure-plaintext >"$cache/logs/rust.log" 2>&1 </dev/null & ;;
  18081)
   export ELSELIFE_DEV_DATABASE_URL='postgres:///elselife_product_dev?host=/var/run/postgresql'
   export ELSELIFE_DEV_ARTIFACT_NODE="$node"
   export ELSELIFE_DEV_ARTIFACT_VALIDATOR="$(wslpath -w "$root/tools/artifact-validator/validate.mjs")"
   export ELSELIFE_DEV_ARTIFACT_COMPILER="$(wslpath -w "$root/tools/artifact-compiler/worker.mjs")"
   runuser -u postgres -- "$go_bin" --migrate-artifacts
   export ELSELIFE_DEV_ALGORITHM_ADDR='127.0.0.1:18083'
   export ELSELIFE_DEV_MODEL_PROVIDER=codex
   export ELSELIFE_DEV_CODEX_CLI_PATH="$cli" ELSELIFE_DEV_CODEX_AUTH_HOME="$auth" ELSELIFE_DEV_CODEX_TEMP_DIR="$root/.codex-model-tmp"
   export ELSELIFE_DEV_CODEX_MODEL="$model" ELSELIFE_DEV_CODEX_PROXY="$proxy"
   export ELSELIFE_DEV_MODEL_CONTEXT_TOKENS=65536 ELSELIFE_DEV_MAX_OUTPUT_TOKENS=8192 ELSELIFE_DEV_MODEL_BYTE_TOKEN_BOUND_VERIFIED=true
   unset ELSELIFE_DEV_MODEL_BASE_URL ELSELIFE_DEV_MODEL_NAME ELSELIFE_DEV_MODEL_API_KEY
   nohup setsid runuser -u postgres -- "$go_bin" --listen 127.0.0.1:18081 >"$cache/logs/go.log" 2>&1 </dev/null & ;;
  18080) nohup setsid python3 -m http.server 18080 --bind 127.0.0.1 --directory "$web" >"$cache/logs/web.log" 2>&1 </dev/null & ;;
 esac
done
printf 'Local processes dispatched. Logs: %s/logs\n' "$cache"
# Let each detached service establish its listener before the WSL launcher exits.
for port in "${missing[@]}"; do
 ready=false
 for attempt in $(seq 1 50); do
  if check_port "$port" >/dev/null 2>&1; then ready=true; break; fi
  sleep 0.1
 done
 [[ $ready == true ]] || { echo "Service did not start on port $port; inspect $cache/logs" >&2; exit 1; }
done
