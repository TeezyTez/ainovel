# Rust 产品算法源码抽取（2026-10-15）

## 交付状态

`algorithms/` 是可独立 Cargo 构建的产品源码闭包。已在**导出目录**实际完成 check、test、build（全部 exit 0），默认配置 35 个测试通过，另以 no-default-features 验证 32 个测试，包括无 channel 时 runtime fail-closed。不需要原仓、sundries checkout、Git object 或外部模型/服务。构建仍需 Rust/Cargo、系统链接工具与 **protoc**，及 crates.io 依赖（在线下载或本机已有 Cargo registry cache）。这不是 vendor/offline 依赖发行包。

原仓：`/opt/cs/elselife/algorithms`，HEAD `6d32d4cbc1fea759531179d3f3e0e949ae4cca58`。抽取前后 `git status --porcelain` 均为空；未修改原仓、未 commit、未改其他仓。

## 实际源码闭包，而不是旧 lib 的重导出集合

- `src/bin/algorithm-runtime.rs`：正式入口；内嵌 `mod channel`，仅监听 loopback 的 RuntimeChannel gRPC。它以 `#[path = "../experience_channel.rs"]` 载入新经历编排。
- `src/experience_channel.rs`：`request.experience` 验证、reverse model/read 调用、坐标/预算/截止和回调校验，最终 bare Candidate。导出保留原字节。
- `src/experience.rs` → `src/experience_recall.rs`：canonical typed context/candidate、prompt、校验、reader projection、read receipt 与 coverage；全部原字节。
- `src/capacity.rs` → `src/capacity_profile.rs` → `src/capacity_profile_generated.rs`：真实被 import 的容量/协商依赖，全部原字节；保留 `CAPACITY.md`。这些共同文件仍有历史常量/命名，但没有历史业务执行入口，未为“清名字”改动它们。
- `src/bin/algorithm-runtime-probe.rs`：原有正式 wire fixture probe，原字节；其编译时依赖的四份 experience JSON fixture 随包携带。
- `tests/experience_semantics.rs`、`experience_recall.rs`、`experience_runtime_wire.rs`、`experience_model_failure_wire.rs`、`experience_no_channel.rs`：正式测试原字节。没有拷历史 compiler/kernel/route/goal/graph/verify/intelligence 回归测试。

旧 lib 的海量历史 reexports、旧 dispatcher、kernel/route/goal/graph/verify/intelligence 实现和历史 runtime/peer binaries **不在导出源码中**，而非通过 dormant feature 隐藏。新的 lib 没有 tonic 监听或旧业务出口。运行时 dep-info 已核没有原仓路径或旧实现模块，见 `algorithms/verification/compiled-source-identity.txt`。

**CONTRADICTS（继承假设）**：本次 HEAD 的正式 runtime 已是 experience-only，不需要从 runtime 切除旧 root；`channel` 是 runtime 文件内联模块，并不存在独立 `src/channel.rs`。不要为修一个不存在的依赖去拷历史 channel。

## 合同来源及不变性

### runtime.proto

从当前 `sundries/contracts/algorithm/v1/runtime.proto` 取得字节，复制前实算 SHA256，匹配 algorithms 的原 pin：

- `.sundries-revision`：`060671c11d0cd67260f68352d05348accb2f0622`
- `.sundries-sha256`：`4a7f66d6e1f5be0fe974388aaff6a275014761cfd23a01bd20ef5c99c2587646`
- 包内文件：`contracts/algorithm/v1/runtime.proto`

两份 sundries pin 文件原字保留。`contract_input.rs` 只从 manifest 根下固定相对路径读取，拒绝绝对路径、路径穿越和 canonicalize 后逃出包的路径；读取字节后仍以原 SHA256 核验，随后从拥有的已校验 bytes 建立私有 OUT_DIR snapshot 再执行 protobuf 编译。无环境变量选外部文件、无 checkout/Git fallback。`ELSELIFE_SUNDRIES_PROTO` 现在不参与输入选择。

精确的完整 proto 仍声明历史传输 message（包括旧 Route/Goal 等），因为删它们会改变指定合同的字节与 hash。这些消息类型不等于历史业务实现，也不授予旧入口执行权；正式 wire tests 证实旧请求在正常/失败/并发场景均被拒绝。`telos.algorithm.v1` 是原 transport identity，不改成另一个 wire family。

### canonical experience

以下三份均原字节，build.rs 原有 byte hash 与硬编码 source digest/revision 校验未改：

- `contracts/experience/v1/contract.json`
- `.experience-sha256`：`af4d178596cffc470f408b0924f04f93d104ca8047539c0d6a219bd3c6667121`
- `.experience-revision`：`685758b9009c647f0b6b0da2dbe1769ea6964a71`

**来源澄清**：上述 685758/af4d 是 experience 合同来源，不是 runtime.proto 的 SHA/revision。当前源 build.rs 对 experience 本来就读包内 JSON 并校验 pin，并不调用 Git；无需改其校验。

## 完整改写清单

1. `Cargo.toml`：仅两个正式 binaries；删除历史 bins/tests/features、OCR、无产品闭包引用的直接 regex 依赖；保留 channel 开关及正式所需 serde/json/sha2/prost/tonic/tokio/tokio-stream/build deps。添加空 `[workspace]` 确保不被上层 Cargo workspace 吸入。
2. `Cargo.lock`：从原 lock 起步，由导出 manifest 的 `cargo metadata --offline` 裁掉不再使用依赖；后续 check/test/build 全部 `--locked`。没有 path/git 依赖，无原仓绝对路径。
3. `src/lib.rs`：重建为 experience + capacity + capacity_profile 的窄模块声明，仅保留原容量 reexport；不复制历史大 lib。
4. `contract_input.rs`：原显式绝对路径环境输入改为包内相对路径、路径边界检查；SHA 校验、owned bytes、snapshot 机制保留。没有修改 prompt、typed、validation 或 read orchestration。
5. `build.rs`：rerun 触发改为包内 proto 路径；编译输入身份改记包内相对路径，而非旧 checkout 的绝对地址。另路径共用 Cargo target 时实际发现旧 build-script 元数据残留，已修复并在另路径重测；experience 校验、prost/tonic 生成逻辑原样。
6. 新增 `contracts/algorithm/v1/runtime.proto`：经 pin 核验的完整原合同字节。
7. 新增 `tests/contract_input.rs`：仅 standalone source-mapping 的 pin/缺失/路径/漂移/owned snapshot 验证；没有复制 `tests/proto_sot.rs`，因它的“禁止本仓 proto”与历史 wire assertions 属原仓布局约定，不适用于用户明确要求自含 proto 的本导出。原 proto 字节校验没有被取消。
8. 新增 `README.md`：可移植构建依赖、精确 runtime 参数与测试边界。新增 `verification/`：命令、日志、metadata 与源身份核对报告，不含 target/cache/binaries。新增本说明。`verification/` 仅本机工作证据，最终发布打包应排除（其中含本机绝对路径）；包不需要它才能编译。

`algorithms/verification/source-integrity.json` 列出 23 份与原仓逐字节相同的文件，及所有改写/新增文件。核心五文件 SHA256：

```text
3512f931773340aa2b24186d0104327572b05f78f80c03b9bc564e72cd817e68 src/experience.rs
0a6a036f0b5bae040b42abadf3d9adfa30284c371c82b0bf8ea6c58a3f743fda src/experience_recall.rs
21a638b3888b40d945a307d7755c6108b3e4274a74c04aa9d85c4e79196f7b88 src/experience_channel.rs
871e094e56758447649dba2c665a2025fa5fbbeaccac5313c3f3d80021260b7a src/bin/algorithm-runtime.rs
fc6109c87591cf32fa97b26d1b3b5def1a0a468331b071c87e3efcef033f1e71 src/bin/algorithm-runtime-probe.rs
```

## 在另一台机器构建与运行

验证环境：Debian 12，rustc 1.98.0、cargo 1.98.0、libprotoc 3.21.12。本次未测最低 Rust/protoc 版本，不声称旧工具链兼容。Debian 的 protoc 可由 `apt-get install protobuf-compiler` 提供；需正常 Rust toolchain、C compiler/linker（如 build-essential）。

```sh
cd algorithms
protoc --version
cargo check --locked
cargo test --locked
cargo build --locked
# 仅本机 loopback；使用原有参数，不添加新 bypass：
./target/debug/algorithm-runtime --listen 127.0.0.1:18083 --insecure-plaintext
```

可在另一终端运行原有 fixture probe：

```sh
./target/debug/algorithm-runtime-probe 127.0.0.1:18083
```

probe 是原有固定 wire/校验测试客户端，不是可供产品使用的模型或假生成器。生产叙事生成仍需 Go 端处理 reverse model/read 请求；**单独启动 Rust 不会自行产生小说**。不带 insecure flag 则按原配置要求 TLS；非 loopback 地址一律拒绝。具体 TLS 环境名见原 `src/bin/algorithm-runtime.rs`，未改认证接线。

可选 fail-closed 验证：`cargo test --locked --no-default-features`；之后再次 `cargo build --locked` 恢复默认 channel binaries。

## 本轮实际验证及边界

下表是抽取时实际执行记录；`verification/` 下的本机日志在最终交付前移出源码包，不是接收方需要寻找或复制的依赖。可携带的最终逐文件身份见根目录 `SOURCE_MANIFEST.json`，独立重建汇总见根目录 `验证记录.md`。

| 导出目录内执行命令 | exit | 日志 |
|---|---:|---|
| `cargo metadata --offline --format-version 1` | 0 | `metadata.json`、`metadata.log` |
| `cargo check --locked --offline` | 0 | `check.log` |
| `cargo test --locked --offline` | 0 | `test.log`（35 passed） |
| `cargo build --locked --offline -v` | 0 | `build.log` |
| `cargo test --locked --offline --no-default-features` | 0 | `no-channel-test.log`（32 passed） |
| `cargo build --locked --offline` | 0 | `final-build.log` |

本轮设 `CARGO_TARGET_DIR=/opt/cs/tmp/elselife-product-extract-rust-target`，该共享编译缓存不在包内；上面的新机器命令不需要此变量。未下载外部模型、未启动外部服务。wire tests 自己启动所构建 runtime 的随机 loopback 端口，使用原 probe 验证经历模式、隐私、拒绝旧入口、模型失败清洗、同流独立 root 不阻塞等，再 kill/wait 回收进程。no-channel 配置中 wire tests 为 cfg-disabled，不能把它的零测试当成第二次 wire 验证；wire 证据来自默认配置。

metadata 确认唯一非 registry 源是导出包自身，没有 path dependencies；所有 root targets 的 src_path 在导出目录。没有符号链接；运行时/probe `.d` dep-info 没有原仓或历史实现。日志里的绝对路径只是本机验证位置，不是 Cargo 源码依赖。保留原 dead_code/unused_mut 等 warnings，未为消 warning 改核心文件。

**UNKNOWN / 未覆盖**：未在空 registry cache 的另一物理机器重建；未测最小工具链版本；未做 Go 集成、真实 provider 生成或生产 TLS 握手。本次证明的是自含源码闭包、合同 pin、独立 Cargo 编译以及原 semantic/recall/loopback wire 行为，不把 fixture probe 成功冒充真实模型质量。没有运行或带出历史体系测试；原仓规则要求的 historical-tests 全仓回归属于原仓开发验证，本次不改原仓且明确只交付产品闭包。
