# ElseLife 本地基准执行与证据工具

用户提供的 Markdown 是本工具的唯一题库来源。原 ZIP 未提供；这里是项目新建的执行器与 Go 适配器，未复刻或声称通过原 ZIP 的 28 项自测。所有题库、核验条件、对照、读者评价材料只属于评估端。

`tests/benchmark/source.md` 保留上传文件的原始字节；SHA-256 为 `37a6ff7987fbc6ebacfadea70f6e8cdffc2abf0d2cfdb2ed1d2d3d729fd679d6`。`catalog.json` 保留每道题完整原文、分节、嵌套列表、步骤、断言、变体以及源行和哈希。没有原编号的项目获得本地稳定编号，例如 `SYS-001-SEM01`；`source_id: null` 明确区分新编号与原编号。

| 分组 | 主例/子例 | 步骤 | 硬约束 | 语义检查 | 质量轴 | 变体 |
|---|---:|---:|---:|---:|---:|---:|
| SYS / NAR / FUN 主例 | 78 | 738 | 289 | 179 | 127 | 184 |
| SYS-027 下的 UIX 子例 | 13 | 76 | 39 | 26 | 26 | 23 |

UIX 不增加顶级能力数量。关联 FT 编号只是来源链接，不是已通过覆盖。原文中的 authored 状态从未导入为产品运行结果。

## 命令

使用 Python 3.10+ 标准库，从仓库根目录运行；当前 Windows 环境通过 `wsl --exec python3` 调用。

```bash
python3 tools/benchmark/catalog.py path/to/source.md --out tests/benchmark
python3 tools/benchmark/runner.py inventory
python3 tools/benchmark/runner.py report --registry tests/benchmark/coverage.json
python3 -m unittest discover -s tests -p 'test_benchmark_*.py'
```

`coverage.json` 是完整分母的初始登记，不自动因代码存在、测试名称匹配或进程正常退出而改变。修改题库后须重新抽取；执行器会逐项重新抽取比较，拒绝手改 catalog 漏题。重新初始化使用新路径，工具拒绝覆盖旧文件。

Go 真实模型适配器由 `tools/run-deep-benchmark.sh` 启动，入口是 `backend/internal/experience/deep_benchmark_live_test.go`。它通过独立 PostgreSQL 合成前史建立 fixture，后续使用真实 Go Service、Rust pipeline、模型及提交链。合成前史不计作生成页；真实步骤输入必须与原题逐字一致。模型凭据由调用环境配置，不写进参数或证据。

启动器拒绝任何已存在的输出目录，包括空目录。默认从当前仓库源码以 `--locked --offline --features channel` 构建 Rust runtime，使用本轮输出目录下全新的 Cargo target；不会复用普通开发/`--no-default-features` 构建的可执行文件，也不会因环境已有 `ELSELIFE_TEST_RUST_RUNTIME` 就改用外部二进制。Rust 与 Go 构建前后源码清单必须一致才会启动模型。`rust-build.log`、`go-build.log`、工具版本、`binaries.sha256` 与 `runtime-build.json` 保留构建及绑定证据；失败目录同样保留。独立冷编译增加构建时间和磁盘占用，不能把这段耗时当成单次模型生成延迟。

确需测试外部 runtime 时，显式设置 `ELSELIFE_DEEP_RUNTIME_MODE=external`、`ELSELIFE_TEST_RUST_RUNTIME` 和非空 `ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON`。启动器复制并固定其原字节，但将源码对应关系记为 `unverified_external_binary`；仅有二进制哈希不能证明它由当前源码构建。构建工具可用 `ELSELIFE_DEEP_GO_BIN`、`ELSELIFE_DEEP_CARGO_BIN` 指向所需可执行文件；Cargo 默认并行 2 个构建任务，可用正整数 `ELSELIFE_DEEP_BUILD_JOBS` 调整。

```bash
python3 tools/benchmark/runner.py verify-native --run .validation/deep-benchmark/RUN_ID
python3 tools/benchmark/runner.py report --registry tests/benchmark/coverage.json \
  --native-run .validation/deep-benchmark/RUN_ID
```

此命令核对原始事件字节的哈希链、连续序号、收尾根哈希、初始读回、模型请求/响应配对、步骤绑定、冻结源码清单与 fixture 哈希。普通轨迹和恢复来源都逐页检查正式历史连续追加、旧页不可改写、请求版本与提交页对应，固定初页须对应 fixture 的 seed/opening/begin。当前冷路径的每次正式提交须有真实模型调用记录，观察须等于最近独立快照和完整历史。会独立重算 ask 前后领域快照是否相同，保留未跑、阻塞、失败和未触达步骤。退出 0 仅表示证据完整，结果仍可能为 `FAIL`；完整性与验收状态分别输出。进行中的证据标 `INCOMPLETE / INCONCLUSIVE`，不能作为已完成运行。

逐字步骤可附加评估器专用 `requires_steps` 和 `evidence_gate`；它们不进入模型输入。依赖只接受实际完成的正式步骤或读回观察，`BLOCKED` 不满足依赖。门禁默认阻塞：FUN-001 的 10 步在 `search-approval` 前停止，11–13 步依赖 10；提交第 09 步申请不等于主管批准。结局后仍可执行 ask/observe；harness 按其真实能力决定是否 BLOCKED，无明确 epilogue 标记的推进操作保持停止。ask 页不会重置此前的故事结局。

独立审读正式正文与同版权威快照后，可在新的恢复运行设置 `ELSELIFE_DEEP_GATE_DECISIONS=/path/to/decisions`，读取 `CASE-STEP.json`（如 `FUN-001-10.json`）。当前只接受 `method=model_review`，这是独立模型辅助判断，不是真人盲评或整题 PASS。无文件维持 BLOCKED；`deny` 保存审读证据并保持阻塞；错误源根、引用或原字节会使运行失败。普通非恢复运行不能消费决策。当前恢复工具只支持有完整原始前史的单层恢复，不能借此省略多层来源。

决策格式示意（必须替换成真实已审读来源；示例本身不是批准）：

```json
{
  "version": 1,
  "source_root": "原运行root.sha256的完整根",
  "case_id": "FUN-001",
  "step_id": "10",
  "gate_id": "search-approval",
  "decision": "allow",
  "reviewer": "独立评估者标识",
  "method": "model_review",
  "note": "解释具体许可、适用范围及不确定性",
  "citations": [
    {"event_seq": 123, "step_id": "09", "revision": 10, "kind": "prose", "quote": "真实正式正文的精确引用"},
    {"event_seq": 123, "step_id": "09", "revision": 10, "kind": "snapshot", "pointer": "/facts/0/text", "quote": "该快照字段的精确引用"}
  ]
}
```

至少一对正文/快照引用必须来自同一已提交前置步骤；snapshot 的 `pointer` 是相对于原事件 `data.snapshot` 的 JSON pointer，必须解析到文本。Go 在恢复时校验来源字节与原链，将决策原字节保存为 `gate-STEP.json`，并以哈希及完整决策写入事件链；Python 再独立核对。引用匹配只保证来源真实，许可语义仍由评估者负责，不能用无关引用宣称获准。决策不进入模型 prompt，不修改世界事实、fixture 或逐字输入。

`editorial_request` 现在通过真实 `Service.Assist(kind=polish)` 生成当前正式页的润色候选，保留逐字请求、原页、实际模型调用、候选以及前后独立正文/快照/偏好。`editorial_result` 的 `applied=false` 只是声明；Python 另行比较完整 view、领域状态和偏好是否相同，变化或错误均保留为 FAIL。候选不自动应用或开新分支，不把临时表达转为长期偏好。润色品质和事实保持仍需独立审读。当前恢复工具明确拒绝包含 editorial 事件的来源：未提交候选不能像正式页那样恢复，不能在后来最新页上重跑“只这一段”冒充原段编辑。

新记录采用 `evidence_version:3`。旧来源的 `source-*.jsonl/json/sha256` 原字不改；恢复事件另存 SQL 直接读回的 `stored_pages`，必须等于原正式页。`projection_migration:information_recorded_revision_v1` 只允许在历史页 `reader.information` 的公开事实条目新增 `recorded_revision`，值须等于该页独立快照里可见事实的 `source_revision`（公开条目使用 `fact:` ID 前缀）。当前派生页及顶层资料/reader 都独立核对，正文、其他元数据、快照不得变化；无原 reader、已有错误记录版本、未知字段丢失均拒绝。v1/v2 原证据按旧规则保留，不追认其曾执行这项迁移。

原来源中的观察步骤用 `restored_observation` 显式复用：`event_seq` 和完整原 `data`（snapshot/public_view）必须与已核验的 source 事件完全一致。恢复到后来的最新页后不重新执行此前观察；例如 SYS-005 S02 原本读 revision 2，恢复到 revision 5 时仍引用原 source seq 26，不把 revision 5 的读回冒充该检查点。缺这类标记为 INCOMPLETE，改来源序号、快照或视图，以及对原观察重新执行/改判均拒绝。旧 v1/v2 恢复若未保留原观察则显式标 `LEGACY_NOT_PRESERVED`。

SYS-005 S06 现在绑定真实新 `Service`、新 DB 连接与 `RecoverExpired`；按同一历史启动空 read，在真实 review 返回后、流水线处理该返回之前暂停，调用真实 `Cancel`，再放行同一模型结果。事件保留原模型 request/result 的序号和原候选，`candidate_commit_eligibility=not_established`，没有强造签字/收款。Python 独立验证请求身份、恢复、暂停和取消顺序、所有正式页和每版快照均未变；S07 只在 S06 成功后执行。这不是进程 kill，真实模型候选内容仍须审读。当前拒绝恢复包含这种非提交控制事件的来源，避免把旧取消在后来版本重做。SYS-005 原 fixture 的 omissions 保持首次登记原字以供旧运行精确恢复；当前绑定能力以冻结源码、此说明和实际事件为准。

通用进程包装器接受显式 JSON argv 数组，不使用 shell。示例 argv 文件：`["python3", "my_adapter.py"]`。不要把凭据放进 argv。只继承平台启动所需环境名；额外环境逐项使用 `--inherit-env NAME` 授权，清单只保存环境变量名。

```bash
python3 tools/benchmark/runner.py run --case SYS-001 --argv-file private-argv.json \
  --artifact .validation/adapter-output.json --out .validation/benchmark/run-001
python3 tools/benchmark/runner.py verify --bundle .validation/benchmark/run-001
```

包装器保存全部 stdout/stderr、原始退出码、超时、显式产物及哈希。进程退出 0 只产生 `REVIEW`；非零、启动失败或超时产生 `FAIL`；缺必需产物产生 `INCONCLUSIVE`。输出目录必须是新目录。断言写进 stdout 的“PASS”没有判定权。

单项评审写到独立文件，并绑定不可变 bundle 哈希及其中的实际证据：

```bash
python3 tools/benchmark/runner.py assess --bundle .validation/benchmark/run-001 \
  --case SYS-001 --check SYS-001-H1 --status REVIEW --method model_review \
  --reviewer evaluator-name --note 'S01 有前后快照；私笔记路径仍缺证据。' \
  --evidence artifacts/001-adapter-output.json --out .validation/review-001.json
python3 tools/benchmark/runner.py report --registry tests/benchmark/coverage.json \
  --assessment .validation/review-001.json
```

评审不会修改原 bundle。评价轴 PASS 必须由实际真人评审登记；模型评审不能冒充真人。原题禁止自动 PASS 的硬/语义项不能通过 `deterministic` 绕过。工具核对证据存在与来源，不能替代独立评估者判断；`human_review` 是登记者对真实评审身份的声明，不是凭空创造真人评价。不同评审冲突会保留，失败不会被后来的通过悄悄覆盖。

## 当前可运行范围与缺口

| 范围 | 可用入口 | 仍须完成的证据 |
|---|---|---|
| SYS-001、NAR-001、NAR-009 | 逐字 fixture、真实 Go/Rust/模型链、独立 DB 读回 | 基线运行、失败修复后复测、合法条件分支、正控制/反事实、独立语义及读者评审 |
| SYS-005 | 精确停点世界 fixture，正式操作/观察；S06 真实恢复与 review 处取消，S07 前置核验 | 尚须真实完整轨迹、候选语义与反事实；无进程 kill，含非提交控制来源暂不支持再恢复 |
| SYS-006 | 时间与信息权限 fixture，S01–S03 及独立授权等待 S06 | S04 真实离线/服务端时钟控制未接入，S05 依赖它而阻塞；S07 旧节点/原文展开未接入 |
| FUN-001 | 固定真相与合法线索世界，01–09 逐字行动，源根绑定的外部许可审读恢复入口 | 10 与下游 11–13 默认阻塞；有真实审读决策才能继续，完整谜题、变体与读者体验没有验收 |
| NAR-014 | 逐字 fixture；S06 真实润色候选与不写入正式历史/偏好的独立读回 | 候选尚须事实与声音审读；未自动应用、不代表已经改善后续声音；含 editorial 来源暂不支持恢复 |
| NAR-017 | 六章步骤与结局后只读 ask/显式后记 fixture | 单次短场景字数与原题章长存在适配差异；完整轨迹、延后记忆任务与目标真人评审尚未验收 |
| SYS-007 / SYS-016 人物知识边界 | `benchmark_actor_test.go` 的输入投影回归 | 只检验结构权限；真实 NPC 反应和误信来源仍须整条轨迹 |
| SYS-017 资料/导出泄漏 | `benchmark_boundary_integration_test.go` 公共读取、历史、导出、分支与隔离键核验 | 浏览器搜索/目录侧信道及完整秘密揭示轨迹仍须对应证据 |
| SYS-018 幂等 | 同文件真实并发 Service 调用和 SQL 读回 | 固定候选只验正式提交；网关重投、真实客户端恢复尚未等价覆盖 |
| SYS-019 / SYS-025 输入与恢复 | Flutter widget/controller 回归，可注入 composition 区间 | widget 注入不能代表真机拼音/软键盘；设备、后台切换、跨设备与读者任务需实测 |
| SYS-020 崩溃提交边界 | `TestBenchmarkSYS020RealProcessDeathPreservesAtomicDelivery` 真实结束独立 Go 子进程并读回独立 PostgreSQL | before_commit / after_commit_before_preparation 两个实际边界；没有异步知识索引，不能冒称完成队列/outbox 重建 |
| SYS-021–024 断流、预备与负载 | 既有 Go authority/preparation 故障注入和真实模型计时 | 客户端断流需真实网络注入；八种负载、固定到达率、冷暖分层、客户端首合格内容及真人质量未完成 |
| NAR 其他 20 题、FUN 24 题 | 已有通用 read/act/ask、历史、分支、gameplay、artifact 入口 | 每题初始化权限投影、条件玩家策略、独立规则 oracle 和全程读者评审尚须逐题接入，不能把整份题目塞入模型 |
| UIX 13 子题、SYS-026/027 | Go artifact 意图/状态/规则接口与 Flutter 展示入口 | 必须真实生成、浏览器控件与网络/状态证据，不能拿固定组件或正文替代未触达的控件路径 |
| SYS-031 外围功能 | 仓库 AGENTS 与实际本地工作区范围核验 | 账号、套餐、支付、运营不在本源码包范围；保留范围声明与未支持记录，不重新接回旧业务，不计已通过 |

以上是入口和缺口盘点，不是通过清单。完整 91 条定义与全部检查持续保留在覆盖分母。保留题、外部运行登记、目标真人盲评并不因本地工具可运行而自动存在。

Go 边界实验的详细范围和原始日志位置见 `notes/2026-10-19-benchmark-backend.md`。源码清单哈希只绑定所记录的清单；若编译期间工作树仍在改变，不能据此断言该二进制完全对应清单。正式比较应保存独立测试二进制哈希，并检查编译前后源码快照一致。

## 工具自身的边界

自测使用合成 fixture/子进程验证抽取、原字节保存、漏题、重复 ID、超时、非零退出、注入字符串、环境隔离、产物缺失、篡改、跨案例评审、根哈希缺失、模型调用失配和自报 PASS 冲突。这些测试只证明工具对应机制，不证明 ElseLife 文学质量。

本地哈希链没有外部签名或第三方时间戳；能发现相对已保存根的字节变化，不能防止同时重写整条链及根的恶意操作者。正式验收需独立评估方保存冻结根、全量运行登记和真实读者评审。
# 独立 SYS-014 S05 币制补充证据

新增独立入口，不改变旧运行中 S05 的 `BLOCKED`：

```sh
python3 tools/benchmark/supplement.py verify-currency --run .validation/currency-control/<run>/supplement
```

该入口要求完整 source events/root/fixture/build-manifest 原字副本、当前 build manifest 与固定 runtime 字节、预登记及新币制 fixture，并核对原 S05 原句。原世界是从封存来源恢复的隔离副本，完整正式页、每版状态、当前分支和偏好必须在补充操作前后相同；不能声称还连接着旧运行数据库。新世界只正式建立贝币、岚币和 3 贝兑换 1 岚的规则，然后走一次真实 `ask`。预登记输入只问 2 岚能换多少贝，不初始化答案或兑换成交。

独立核验要求模型请求/结果/阶段完整，模型看见的公开状态与问题保持原字，正式答页绑定原模型草稿和审稿候选；ask 不改变领域状态或时间。它也核对源文件的末次原字读回。保留失败模型结果；不重新调用至正确答案。

结构成功只输出补充 `REVIEW`，原 `source_step_status` 仍为 `BLOCKED`。期望量由评估端 `Fraction(2) * Fraction(3)` 独立计算，既不送给模型，也不搜索正文中的数字 `6` 判通过。计算方向、等价中文表达、无手续费和未成交等语义仍需针对新 root 与正式回答原句做独立审读。合成单元测试包括故意算错的回答，证明结构核验不会替代 H3 判定；hash 一致也不等于外部证明数据库隔离或真实模型来源。
# v4 恢复标题

v4 将来源逐版 `public_view.title` 绑定到 `resume_manifest.pages[].title/title_provenance`，恢复后独立 SQL 校验每版 `stored_titles` 和最新 `branch_title`，并核对当前 View.Title。新初页直接读取 SQL revision 1 标题。已提交页缺标题拒绝恢复；旧 v3 初页没有标题的唯一兼容是固定初始标题，并显式标记 `legacy_initial_title_unrecorded`，不称来源已验证。

旧 v1/v2/v3 原字记录仍按旧证据核验，报告 `resume_titles=LEGACY_NOT_VERIFIED` 和标题可能被占位值替换的限制。新规则不能追认旧恢复已保存标题。合成前史与来源有记录的标题区分明确，未复制旧 Operation/UpdatedAt 生命周期。
