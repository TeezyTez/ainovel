# ElseLife Rust 产品算法端

来自 `6d32d4cbc1fea759531179d3f3e0e949ae4cca58` 的 experience-only 源码闭包；不含旧 kernel、task dispatcher、route/goal/graph/verify/intelligence 实现或其历史测试。prompt、typed contract、校验、read orchestration、正式 runtime/probe 与 experience 测试保持原字节。

## 构建

需要 Rust/Cargo、系统 C compiler/linker 和 **protoc**。本轮验证使用 rustc/cargo 1.98.0、libprotoc 3.21.12（未声称最低版本兼容）。Debian 可安装 `build-essential protobuf-compiler`。依赖通过 crates.io 获取；本包不是 vendored registry cache。

```sh
cd algorithms
protoc --version
cargo check --locked
cargo test --locked
cargo build --locked
```

无需原 Git 仓库、sundries checkout、`ELSELIFE_SUNDRIES_PROTO` 环境变量或原机绝对路径。包内 `contracts/algorithm/v1/runtime.proto` 对 `.sundries-sha256` 强校验，experience JSON 的 canonical byte hash/revision 校验同样保留。

## 独立 loopback gRPC runtime

```sh
./target/debug/algorithm-runtime --listen 127.0.0.1:18083 --insecure-plaintext
```

这是原有准确参数；不支持非 loopback 地址。`--insecure-plaintext` 仅用于明确选择本机明文连接，不传该参数时 runtime 要求原有 TLS 配置（`ELSELIFE_ALGORITHM_CERT`、`ELSELIFE_ALGORITHM_KEY`、`ELSELIFE_ALGORITHM_CLIENT_CA`）。未验证生产 TLS 握手。

原 wire fixture probe（另一终端）：

```sh
./target/debug/algorithm-runtime-probe 127.0.0.1:18083
```

probe 是校验测试客户端，不是产品模型。Rust 只验证和提议；Go 仍负责模型调用、冻结资料读取、授权与持久化。没有 Go 回调方/模型配置时，单独 Rust runtime 不会生成小说。包没有添加模型或假生成器。

## 验证范围

在导出目录实际执行 `cargo check --locked --offline`、`cargo test --locked --offline`、`cargo build --locked --offline` 全部 exit 0。默认配置 **35 tests passed**，包括 semantic、recall、真实 loopback gRPC 的正常/拒绝/模型失败/并发行为。另执行 `cargo test --locked --offline --no-default-features`，**32 tests passed**，包括不开 channel 时 exit 2 的 fail-closed；该配置的 wire tests 被 cfg 关闭，不冒充 wire 验证。之后恢复默认 channel build。

未运行历史体系回归、外部模型或服务，未在空 registry cache 的另一物理机器重建。所有直接和间接依赖均是 registry 包，无 path/git 依赖。核心源码与原仓逐字节相同；原仓始终 clean。

完整改写清单、合同 pins 与边界见 `../notes/algorithms-extraction.md`。本机工作日志已从交付包移出；最终来源清单见根目录 `SOURCE_MANIFEST.json`，验证汇总见 `../验证记录.md`。不携带 target/cache/binaries。
