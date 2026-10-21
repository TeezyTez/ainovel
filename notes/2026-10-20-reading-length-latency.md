# 2026 年 10 月 20 日阅读篇幅与耗时验证

本轮把默认继续阅读的目标改为约 **1200–1800 汉字**，并让结构提取只输出状态变化，避免再次复制已经冻结的正文。本次真实模型默认阅读正式提交了 **1290 汉字、12 段**，冷读仍耗时 **220855ms**。篇幅结果与提取输出缩减已有单次证据，尚不能据此声称总体延迟目标已经达到。

## 行为与边界

- `reading_request` 优先，其次是 `source=explicit` 的已确认篇幅偏好，再参考 seed 中明确的单段长度。明确要求简短或具体字数会覆盖默认；仍限制最多 24 段、正文不超过 8192 UTF-8 字节。1200–1800 汉字是写作目标，不是硬性最低字数，不因篇幅不足单独拒绝或循环补写。实现见 [阅读提示](../algorithms/src/narrative_reading.rs)。
- `extract` / `repair_extract` 的 `result.candidate` 只返回状态变化；`title`、`passage`、`story_time`、`outcome`、`suggestions` 由程序从冻结草稿补回。兼容旧全量候选时，这五项必须完全匹配，不能借提取改写正文。
- 独立 `review` 仍接收完整 Candidate，正式提交仍需绑定该候选的批准。固定模型测试覆盖长正文原字提交、一次提取修复、移除批准后不能提交，属于传输与权威边界验证，不是叙事质量评分。入口见 [集成测试](../backend/internal/experience/narrative_reading_efficiency_integration_test.go)。
- 普通空输入 `read` 可以认领同版本、同偏好及配置下正在运行的下一段准备。受理立即返回，生成 worker 在数据库事务外等待原任务；不取消它后重新生成。显式阅读要求仍使用自己的生成路径。准备失败、失效或丢失原 worker 时，该次已绑定请求失败，不暗中重做。
- 认领保留原来源句柄、回取预算和审计，仅允许被绑定操作的 `baseFence + 1`；准备与正式操作分别续租。取消会唤醒等待，不依赖模型及时响应。入口见 [准备接续测试](../backend/internal/experience/narrative_preparation_join_integration_test.go)，其中固定阻塞生成器用于验证控制流，不代表真实模型速度。

## 一次真实默认阅读

入口为 [TestNarrativeReadingEfficiencyLive](../backend/internal/experience/narrative_reading_efficiency_live_test.go)。使用固定合成茶铺前史、隔离临时 PostgreSQL 和真实 Rust 运行时；前史由固定生成器提交，真实模型只执行一次空 `input`、空 `reading_request` 的普通 `read`。没有真实模型 begin、背景准备或为达到篇幅而重跑。

模型为 `gpt-6.1-sol`，共 7 次模型调用，无 repair；r1 的合成前史后正式提交 r2。正文总字符数为 1507，Unicode Han 字符数为 1290，按空行划分 12 段。总等待时间为 220855ms。阶段耗时来自阶段观察器，包含相应处理开销：

| 阶段 | 耗时 ms |
| --- | ---: |
| memory | 19325 |
| actor | 15425 |
| plan | 36312 |
| evaluate | 15782 |
| write | 56709 |
| extract | 30407 |
| review | 46644 |

正文保留在本地证据目录，本记录不复制。合成前史与一次成功提交不构成生产安装、用户经历、连续长程叙事或总体文学质量验收。

## 同一冻结草稿的提取对照

另用一次隔离模型请求，对同一冻结 draft 和 context 要求输出完整 Candidate；只改变提取输出 schema 及对应的正文复制指令。该对照不访问业务数据库、不提交正式故事、不重试。compact 是前述真实阅读中的那一次提取，不是再次生成的样本。

| 提取方式 | 模型调用耗时 ms | 模型输出 UTF-8 字节 |
| --- | ---: | ---: |
| full-copy 完整候选对照 | 52305 | 7788 |
| compact 状态变化 | 30401 | 3338 |

此处 compact 的 30401ms 是模型适配器计时，与上表 extract 阶段的 30407ms 口径不同。单次先后请求具有模型与服务波动，不能从这组差值推算平均速度、整条流水线提速比例或总体质量；对照记录的质量结论是 `NOT_EVALUATED`。

## 可追溯证据与检查

以下证据保存在 Git 忽略的 `.validation/reading-efficiency/`，不会作为正文、凭据或构建缓存加入版本控制。

| 证据 | 内容 |
| --- | --- |
| `live/reading-efficiency.json`、`live/test.log` | 默认 read 的阶段、调用、正式提交、长度与耗时；1 个真实阅读测试通过 |
| `live/extract-request.json` | 第一次提取的冻结请求；不可序列化的 context token limit 65536 另保存在调用报告 |
| `comparison-input/manifest.json`、`comparison-input/provenance.json` | 单次 full-copy 请求及其与 compact 请求的来源约束 |
| `comparison-output/01-full-copy.result.json`、`comparison-output/run.json` | 52305ms、7788 字节及请求/结果哈希；仅 1 次对照调用 |
| `comparison-test.log` | 1 个固定请求研究测试通过，不给出产品或文学质量结论 |
| `rust-tests.log` | 汇总 **120 passed、0 failed**，含 0 项测试的文档测试段 |
| `go-integration.log` | `internal/experience` 本次执行的集成测试通过，48.701s；该日志没有逐项计数，不据此声称全部 Go 测试已通过 |
| `final-go-unit.log` | 接续修改完成后运行 `go test ./... -count=1`，全后端单元测试通过 |
| `final-go-integration.log` | 最终 `-race -tags=integration` 的 Narrative、ActualRustReading、ActualRustExtractionCLI、ActualRustNarrative 回归通过，136.255s |
| `final-contracts.log` | `tools/verify_project.py` 通过；共享合同字节未因本轮改变 |

准备接续的单独竞态检查另存于 `.validation/preparation-join-race-20261020-clean.jsonl`，26 个测试/子例通过、0 失败，67.717s。初次红控观察到提前点击多调生成器、失败准备被替代内容提交；原工具输出的明确转录保存在 `.validation/preparation-join-red-transcript-20261020.txt`，不是伪装成原始日志的重建结果。

关键 SHA-256：

- 真实阅读运行时：`ec2d406d7bf20bc44a51ed81df0392e7caee77317386d0a2e32b35b629f80e35`
- `live/reading-efficiency.json`：`8d6e8961ab663a1c3c36970a59c9d3d66dff1e172cf68a6ae9cf92af107017fe`
- compact 请求：`d60434917cbf38b0e06469c22aea44ab3a713573cf46a72fca9516170ddde2fd`
- full-copy 请求：`584873756059e1ef2e5d020b5c743c959f18190af673aa45dffd7eab8a06c6c1`
- full-copy 结果文件：`b34661861d5a67d7dc290df1d26a6d6ed76ed3503336a05abbfb27b6c53446a8`

## 本地运行状态与剩余限制

进行中准备的接续与失效检查已通过上述回归。本机 Go / Rust 服务已切换至 v4.10；切换前确认没有 pending / generating 操作，并在工作区外私有目录备份旧二进制和数据库。`restart.json` 保存实际进程、二进制哈希与备份位置。运行中 Rust 哈希与上面的真实阅读运行时一致，Go SHA-256 为 `28191b88b1e1a3e02e36b5777d3bc6e211b7108c57ada977cb7608da71591739`。

原启动器 `check` 已验证 18080 / 18081 / 18083 三个端口的服务身份和对应产物；协作浏览器刷新页面后，经历列表、经历详情、准备状态及模型状态接口均返回 200，无新增控制台错误。本次未重建前端，也未向用户已有经历追加测试正文。

冷生成仍需完整叙事阶段与独立审稿，本次实测约 3 分 41 秒。接续可以避免已有后台工作被丢弃，不等于首次生成秒出。既有 ready 候选在 consume 验证偏好后到最终 commit 之间的偏好复核窗口未在本轮扩大修改；等待期间发生的偏好变更已测试为失效且不重做。
