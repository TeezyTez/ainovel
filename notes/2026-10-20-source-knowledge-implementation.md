# 来源受限知识传播：实施与验证记录

**Goal:** 保证知情审核实际获得被授予的完整记录，并减少部分告知导致的整条事实传播，同时保留合法交流及后续利用。

**Spec:** [机制设计](2026-10-20-source-scoped-knowledge-prototype.md)、[根因研究](2026-10-20-root-cause-research-and-design.md)。

**Architecture:** Go保留同一操作的完整权威状态，负责构造审稿证据和提交；Rust保留有界生成阶段。先独立修复证据缺失，再用三臂真实实验决定语义处理，不预设增加结构或模型调用有益。

## 约束与裁定

- 继续当前 `codex/narrative-generation-2026-10-19` 工作区；大量现有修改尚未提交，不复制到从旧commit开始的空worktree，不覆盖前序工作，不自动提交。
- 不修改原benchmark、原失败输出、旧正式历史或通过标准。新增控制标明代理编写，不作真人金标准。
- 正式Candidate与世界合同先保持不变；内部消息如变化，必须在Go/Rust一致验证。新增输入计入实际发送预算，超限停止，不扩大模型窗口。
- 不从词表推定含义，不把听闻自动变成相信，不拒绝所有传播，不补抽直到成功。
- 本轮只实现知识传播相关机制；整份笔记替换是已确认的独立问题，不在同一实验混改。

Ruling: `Candidate::validate`允许省略目标ID，Go最后全状态Apply只保证其存在；当前review不保证看过完整目标。因此审稿证据补齐是程序性修复，不依赖语义模型实验是否获胜。

## 任务1：审稿完整证据

文件：`backend/internal/experience/narrative_pipeline.go`、新增聚焦的review证据helper/test；`algorithms/src/narrative_pipeline.rs`说明新增只读输入。

接口：在`before(review/repair_review)`已确认同一冻结candidate后，从该操作`AuthorityState`提取旧知情目标，作为独立的只读review证据；已有当前原对象避免重复，缺目标/错误主体不能凭模型补造。不得改candidate、StateCoverage或角色输入。

- [x] 先写并运行RED：旧目标从工作context省略时，实际审稿消息缺全文；错误/未来/错主体数据不应被当作来源。
- [x] 实现绑定完整目标的最小输入补齐；保持原context与冻结candidate。
- [x] GREEN：缺目标补齐，已有完整目标不重复，不混入无关秘密、其他分支或历史旧值；重审同样补齐。
- [x] 实际模型边界预算负控：新增证据不能绕过发送前容量校验，失败不启动模型。

## 任务2：三臂机制对照与选择

目录：`.validation/source-knowledge-20261020/`。复用现有固定请求研究执行器，不新增服务或测试框架。

三类输入：实际错误候选；同正文下代理修正的窄传播正例；完整传播的合成正例。均在调用前固定，目标事实完整可见，评估标签不进入模型。

三臂：A当前review；B同等语义要求的简单提示；C显式来源与覆盖范围判断。每格一次，共9次初始调用，固定预算与顺序，无重试/修复/选择性停止。结果是开发实验，不是文学或总体错误率结论。

- [x] 冻结候选、原请求、三个处理与hash。
- [x] 运行并审阅全部结果；分别记录错放行、误拒绝、未决、结构失败和遗漏的正确传播。
- [x] 若B与C效果相当，优先简单方案；若均无效，不以加字段冒充修复，继续定位后再改。
- [x] 将获支持的最小机制接入产品，使用无案例编号/词表的通用语义规则，并同步版本、修复路径和测试。

## 任务3：回归与真实benchmark

- [ ] Go/Rust定向红绿与跨进程验证；完整受影响后端、Rust默认及无默认特性测试。
- [ ] 独立代码审查，特别检查输入重写、全文遗漏、预算增长、正常告知和修复预算。
- [ ] 从头真实运行NAR-010、NAR-017，并以NAR-009正常任务完成作正控制；先核原fixture/执行器适用性再冻结集合。
- [ ] 阅读全部正式页和失败候选：记录知情是否正确、角色是否实际利用、普通目标是否完成；执行PASS不当作内容PASS。

## 执行记录

- 开始：零新产品变更、零本轮真实模型调用。已有研究发现四份冻结抽取均有复合事实过授，保留为起点。
- 首轮 RED：`go test ./internal/experience -run '^TestNarrativeReview' -count=1 -v`，省略全文的 review/repair_review、8 种无效/错版本来源和发送预算共 11 个检查失败；完整已有目标的正控制通过。最初测试 spy 缺 Stream 导致的编译失败不计为 RED。
- 首轮 GREEN：Go 添加 `narrative_review_context.go`，只读补齐当前操作的旧目标及必要接收者；重跑以上测试通过。容量负控是计数假模型的程序边界测试，无真实模型调用，不是叙事质量验收。
- 包级回归暴露旧 quote-repair 测试的 candidate-only 请求夹具不含实际 Rust context；独立审查正在将夹具升级为真实形状，保留原引用/修复次数断言，并追加无传播边、重复载体、当前/历史回取与新实体边界。
- 三例固定输入位于 `.validation/source-knowledge-20261020/inputs/`；9 次实验协议、顺序、模型预算与失败策略先保存在 `experiments/protocol.md`。代理编写的两例正控制不作人类金标准；三例的目标原本均已完整可见，实验不混入输入补齐的信息优势。
- 独立审查补充 RED/GREEN：无传播边也须绑定 version/next_revision/mode/experience/branch/revision/source_handle/audience；拒绝重复 JSON 键、重复对象 ID 和额外消息载体。旧 quote-repair 全部保留原断言并改用真实 Rust context_view 夹具。独立红绿日志保存在 `.validation/review-hydration-independent-*.jsonl`。
- 补齐范围包含接收者及被授予记录的直接 SubjectID 身份，解决 statement/belief 中“他说”无法映射主体的问题；不递归 known_by 或 related_ids，不补不相关新记录。ask 显式禁止借非法传播边补隐藏材料；正常 ask 无变更正控制保持原消息。
- Go 包级复测通过：`go test ./internal/experience -count=1`（2026-10-20，1.461s）。这是程序检查，不含真实模型质量验收。
- A/B/C 请求先按准备时 v4.7 源码固定并核验。之后产品升级 v4.8，加入上述输入补齐及 review/repair_review 的只读材料说明；实验仍使用封存的 v4.7 基线，不重新生成请求。差异由独立审查发现并在首调前记录，不能把此实验称为 v4.8 完整产品比较。
- 独立程序边界收口：78 项定向 race 检查（含子测试）通过；各轮真实 RED 均保留。不是 78 个 benchmark 通过。
- 九次固定调用全部完成且封口，无 ERROR、NOT_RUN 或重试；九份 JSON/schema/引用集合/原字子串均通过，仅属结构结果。4 条明确旧事实过授的逐条诊断 A 为 3/4，B/C 均 4/4；隐藏记录的全称否定风险 A 漏、B/C 指出。三臂仍均漏掉新增记录中的分食份额及两书专名受众问题，C 在其中 3 条边上给出错误 full，不能将该标签作为证明。
- 完整传播合成正控：三臂均允许 6 条合法边，包括可信完整报告；不是 C 的独有收益。反事实正控三臂均因 12:58 精度问题拒绝，时间来自冻结 writer.story_time，但是否可赋给具体尾部事件有争议，因此不记为确认误杀或整体正控 PASS。A 另要求把仅部分公开的复合 secret 整条 reveal/告知，这一补救会暴露正文未支持的部分；B/C 未提出。
- 选择 B，不上线 C 的 scope/source_mode/prior_evidence_ids schema。B 原字保存为 `algorithms/src/narrative_knowledge_review.txt`（SHA256 `9783d1f3e07ef38e6db2c79cd3425182530dff73b87d0d1e436dcebe99669a64`），接入 review 与 repair_review。仅一次开发探索，不推总体错误率。
- 抽取侧同时新增 `narrative_knowledge_extract.txt`：按来源及实际知情范围组织记录；部分交流保留窄 statement/观察，不能整包授权；局部公开复合隐藏事实不连带 reveal 全文；五个 draft 字段仍冻结。该抽取规则不属于九次 review 对照的处理，不能借九次结果宣称有效；接下来的完整产品 benchmark 验证的是组合改动。
- 已确认但本轮未改的独立问题：语义拒绝仍统一进入 `revise → extract → review`，可能为纯状态抽取错误重写合法正文。只删过授边会丢失部分合法交流，不能据此冒称修好。未来需有类型的错误定位、冻结正文的状态修复及正/负控制，沿用共享一次修复和总调用上界；当前不新增重试。
- 首次完整回归 `.validation/backend-v48-20261020T063819Z/` **失败**：Rust 默认及无默认特性均在原最大 game extraction 容量测试触发 `stage_content_capacity`；runtime 构建完成后，源码冻结又检测到三个并行前端文件变化，Go 未运行。保留整次失败，没有覆盖或当作通过。
- 容量诊断：原测试的最大未转义 game extract 实测 35,847 字节，超过旧阶段预留 34,816 字节。仅增加测试构建的数值诊断，不输出模型资料；Go/Rust 同步将阶段预留从 34KiB 改为 36KiB，**模型窗口及输出预留不变**，代价是前置生成视图可用空间减少 2KiB。五个原容量测试通过，包括 44,039 字节转义增长仍须拒绝的负控；两项跨语言容量一致性检查通过。未删除检查、压低输入极值或放宽最终发送预算。
- 并行前端改动保留，三文件属于阅读笔记功能，不是本轮知识传播修改。第二次完整回归重新固定最新源码，仍保留整套源码漂移检查，不沿用第一次混合清单。
- 第二次完整回归 `.validation/backend-v48-20261020T064450Z/`：Rust 默认 98 项、无默认特性 92 项均通过，runtime 构建成功；运行中 `reader_position.dart` 又发生并行变化，冻结检查拒绝继续，Go **未运行**。两次失败证据均保留，不豁免文件或关闭检查。
- 为避免验证被工作区继续开发打断，创建一次性的当前源码验证副本 `.validation/source-knowledge-20261020/source-freeze-20261020T065300Z/source/`：652 个当前受版本控制或未忽略的源码文件，以及 Windows Node 实际使用的 129 个 artifact compiler 依赖文件；复制前后与副本逐文件 SHA 相同。副本有独立 Git inventory，没有 commit，也没有更改主工作区内容。源码清单 SHA256 为 `044850fad296b962df649a300fbc0dc885c5a88d5a72926bfa8f230952e20ab5`，完整来源记录在上一层 `freeze-status.json`。后续结论只适用于该固定版本，不包括随后并行前端修改。
- 第三次完整回归 `.validation/backend-v48-20261020T065521Z/` 已在上述副本启动；验证脚本、证据输出与原 sealed 容量录制分别固定来源，仍运行原 source/runtime 漂移检查、完整 Rust 默认/无默认特性、Go race/integration/codexlive。模型调用选项全部关闭；不是叙事质量验收。
- 第三次完整回归自然结束：Rust 默认 98 / 无默认 92 通过，channel build 通过；Go **674 pass / 23 skip / 1 fail**。唯一失败为 `TestArtifactSnapshotFreezesLocalStateAndForkOrigin` 在初始 `setupGameplay` 报 `initial source ledger missing`（11.08s）；其余真实 Rust、容量回放、hydration、review、CLI、artifact 用例已执行。源码与 runtime 哈希稳定。整轮仍为 **FAIL**，不能因主改动相关检查通过而记整套绿。
- 同源码/runtime/配置只做一次单例复现 `.validation/v48-artifact-single-20261020T070529Z/`，2.92s 通过，实际走完历史状态、分支隔离、导出导入断言。原代码在 worker 10s 期限后将子进程错误折叠为 `invalid_artifact` / `invalid_gameplay`，原日志不能区分期限、进程退出或其他原因；原数据库已清理，不能事后确证超时。独立诊断仅增加 elapsed/context/exit 观测，不改期限或输入，不能回写原失败。
- 在保留整轮 FAIL 的前提下，开始三例不使用 `Artifacts` 的叙事取证，与上述独立 worker 诊断并行。该决定依据所有受影响叙事回归已通过、单例已实际走通共用提交/Fork/归档，**不是**取消失败测试或声明全系统通过。
- 一次仅观测的独立诊断 `.validation/v48-artifact-instrumented-20261020T070725Z/` 通过（3.96s）：13 次原 validator 子进程耗时 136–316ms，context 错误均为空、退出码均为 0，初始 operation committed。诊断用外部 Go overlay，只增加安全数值观测，没有修改快照、输入、10s 期限、重试或断言；源码/runtime 前后不变。这只能说明新样本正常，**不能反推原失败就是超时**。永久类型化 worker 诊断是独立待办，本轮未混入产品。
- 新的原题完整轨迹 `.validation/deep-benchmark/20261020T070639Z-source-knowledge-fresh/` 已启动，使用上述固定源码，三例 26 个原步骤、没有 resume。原 runner 的 417 文件源码清单 SHA256 为 `4f2da8600a9a2aaf125a577e30f34c3be725aed9b0cac00300ee6bfb6d96cf21`，与 652 文件完整快照是不同口径。各例全部原始输出保留，结束前不填写内容 PASS。
- 该唯一 fresh 已全封口，**三例均 FAIL**，没有重试或重抽：26 步中 4 个正式生成步骤待内容审阅、3 个失败、19 个未执行，共 39 次真实模型调用。NAR009 S01 提交 r2，S02 extract 失败；NAR010 S01–S03 提交至 r4，S04 actor 失败；NAR017 S01 evaluate 失败，没有新正式页。三个 native 证据链均 VERIFIED，三次独立 v5 失败读回均证明正式历史未变，二进制 SHA 运行后仍一致。完整记录见 `.validation/source-knowledge-20261020/fresh-execution-final.json` 与 `fresh-native-final.json`。
- 三次失败均为子进程 exit 1。前两次保留 `event_type=error`、stdout 858 字节；第三次 stdout 0、stderr 65 字节，没有事件类型。不能据字节数或退出码将它们归为同因、网络、限流、OOM 或叙事政策错误。模型执行稳定性已阻断完整长程验证；不得以 4 个已提交步骤替代整例通过。
- 本机 CLI 四个独立 loopback 合成错误探针（`.validation/codex-loopback-errors-20261020T071758Z/`）各只发一次本地请求，测试 401/429/500/418，完全独立空 auth home、假 key、0 真实模型。实证 exec JSONL 仅输出文字错误，没有结构化 code/status/codexErrorInfo；500 连状态数字也没有保留。第一轮只保存了安全形状/长度，未保存纯合成 message，因此不足以直接实现消息分类。下一步补充单独、明确用途的本地模板观测，原四例不覆盖；任何新增诊断只能表示 CLI 报告，不能当根因或自动重试许可。
- Fresh 独立逐字审读完成：4 个正式页中 30 条新事实、70 条知情边，没有确认新的复合事实过授；NAR009 仅把实际展示的椅子检查窄信息传给芳茜，NAR010 茶壶口味已完整告知并在后两页继续使用。样本太少且提前失败，不能声称长期问题解决。尤其 S02/S03 的 actor 都是秦姨，没有“阿穆被纠正后再次独立推理”的输出；旧误信历史保留本身不等于角色回退。未提交的 NAR009 S02 初稿跳至隔夜胶水固化，需单独评估原行动的时间范围，不能视为已正式完成修理。全文审读见 `.validation/source-knowledge-20261020/fresh-content-review-frontend.md`。
- 执行环境只读调查发现：07:26 Windows commit 约 93%，07:20:49 WSL 内核发生 vmbus 通道内存分配失败，07:21:20 出现 vsock 接受连接超时，时间接近 NAR010 第 23 次调用失败。但没有进程绑定，部分时间锚也不一致，不能确认因果或解释前两次错误。无 OOM-kill 证据；未终止其他线程、重启 WSL 或修改全局配置。证据在 `.validation/source-knowledge-20261020/environment-diagnostic-20261020/`。
- 独立合成模板观测 `.validation/codex-loopback-templates-20261020T072531Z/` 证实两段完整 CLI 错误文本。新增 `reported_reason` 闭集只识别 `retry_limit_429` / `high_demand`，未知、冲突、重复键、错误形状、截断尾不归类，不记录原文/URL；取消和捕获超限仍优先，未改模型、配置、重试或错误 sentinel。标签只表示 CLI 报告过该文案，不证明实际 HTTP 状态、重试次数或退出根因，不能回填旧失败。
- 安全诊断 TDD 与独立审查通过：模型包 race 113 项、真实适配器到基准事件写入的合成子进程集成 6 项通过，0 真实模型、0 数据库；红测和完整日志在 `.validation/codex-reported-reason-20261020T0730/`。四文件精确 SHA 绑定于 `summary-with-integration.json`。这项改动增加观测能力，本身不改善生成质量或 provider 可用性。
- 三个旧失败请求的单次串行诊断已预注册在 `.validation/provider-diagnostic-20261020/`：严格保持原请求字节，固定 017 evaluate → 009 extract → 010 actor，120 秒单条/480 秒整批，最多 3 次 `Generate`，无应用层重试、无数据库提交。既有 CLI 内部 HTTP 重试没有改动或计数，不能将其称为最多三次 HTTP。诊断源码由 065300Z 快照加上述四个文件构成，653 文件清单 SHA `a68d0e1d6ae91a5caa08832d9fa2325c6381618ce6a2b0efc86bcdec552c6605`，二进制 SHA `83d95734e4bd697f5e5071ec85068e1055799612d967bbad96a27fd2acaeb41f`。
- 唯一诊断批次已完成并核验全部 11 个封口文件及原三例事件链：3 OBSERVED / 0 ERROR / 0 NOT_RUN，单次耗时 15,398 / 36,672 / 13,970 ms，usage 全部未知。未复现旧退出故障，没有新的 `reported_reason`；只能说明此次串行请求都获得了响应，不能据此认定并发是原因、旧故障已修复或原案例通过。原三例 FAIL 不变。详见 `.validation/provider-diagnostic-20261020/report.md`，run.json SHA `ab4a0e9aef83671a847b7083d4e7c643058c7f2186dd387d6128f43140fadf99`。
- 已确认另一用户授权线程正在同一工作区实现 v4.9 文学记忆设计（`docs/superpowers/specs/2026-10-20-narrative-memory-design.md`），包括按需取材、局部记忆写回及出处链。本轮不覆盖或重复实现这些变更；旧 v4.8 验证结果不能代表 v4.9 已验收。后续整合验证需等其源码稳定并独立冻结。
- v4.9 窄整合审查未发现知识目标丢失或原 pin/权限/最终预算绕过，但确认材料重组会重复携带知识目标：原缺省目标先进入 `review_evidence`，随后又作为必需事实进入 `context.state`。将保留重组前原始载体校验，在重组后仅消除全文完全相等的重复目标和身份，避免同一证据双计容量；冲突不能静默选一份。另一线程负责阶段接入，本线程负责独立 helper 与红绿证据，原基准不变。
- 整合修复已完成：保留重组前 `hydrateReviewEvidence` 校验原始输入，再在 `compileStageCall` 每轮重组后、预算测量前调用 `reconcileReviewEvidence`。仅从 sidecar 移除与最终工作材料及完整权威记录均相等的对象，保留独有证据和顺序；候选、版本、分支和接收者绑定不变，冲突或重复 ID 拒绝。根代理完成这一处接线，另一线程其余编译器代码保留。
- 原重复容量 RED 为两份长目标共 7,906B 超过 6,436B。独立审查另发现无 sidecar 时提前返回会漏掉最终 state 重复 ID，新增 RED 后已修为先严格解码、检查重复再返回。最终真实 `before` 路径验证 `review` 4,587B 可发送／4,586B 拒绝，`repair_review` 4,594B 可发送／4,593B 拒绝；118 项定向 race 检查（含子测试）通过，0 模型调用。红测、中途测试 helper 编译失败及各轮绿测全部保存在 `.validation/review-evidence-reconcile-20261020/`。
- 最终独立只读复核无剩余阻塞：helper SHA256 `56c1fef65638a23fead23469b76c155f0a5f52bf2800a703b15b9e3b55289239`，测试 `059cfcd2270756d1b72b601acc41d1b8c29ad73ec8e67f64b77c2a347d97d8f9`，接线文件 `d75bb38467eb198ae62be85536ce22ca3c252b683043ffe8291c40044c1c1151`。复核检查了实际接线、失败原子性、权威全文及缺失证据双向核对；未新增运行，不能据此证明模型审稿语义正确。
- actor 更正关联的两轮只读探针见 [角色更正依据与检索边界](2026-10-20-actor-correction-evidence.md)：显式正式关联和显式 needs 均能保留已知更正，作者私有索引变化不会改变角色包；旧人物的新动态关联仍依赖语义需求选择。没有用私有作者索引或“最新优先”排序强行让测试通过。
- 下一轮完整原题使用单案例并发作为资源配置。外部 `.validation/run-memory-v49-serial.sh` 仅派生原 launcher 的两处变化：固定快照根路径及 `-test.parallel=2` 改为 `1`；原文件 SHA256 `54f0d341598d2b821e41b097e236ce15c5f4a70b23f0991a7d16bae7532bdaea` 不变，启动时记录原/派生 SHA 与逐行差异。原题、步骤、评分标准、120 分钟时限、源码构建和事件审计不变，无恢复或人工 gate 覆盖。串行执行不能用于证明先前故障由并发引起。
- 中间 v4.9 快照 `source-freeze-20261020T082152Z` 固定 672 个文件及 129 个 artifact 依赖，源码清单 SHA256 `05da2cae7f92965566fe983e9e6182f6339e00417c856929c667f4ae6d5d792c`。复制前后、构建及测试前后源码稳定。该快照不含随后落地的有限历史原句窗口及非必需约定的有限入选，不能当作最终 v4.9 结果。
- 中间快照完整回归 `.validation/backend-v49-20261020T082506Z` **FAIL**：Rust 默认 110／无默认 104 项通过；Go 806 PASS、25 SKIP、7 FAIL（含父测试，实际三组回归）。Python 全套另在 `.validation/python-v49-20261020T082152Z/` 通过 91 项，67 个相关文件前后 hash 相同。没有新增真实模型调用。此前 artifact 启动失败此次未复现，旧失败记录不变。
- 三组 Go 失败位于历史容量回放测试：旧 59,392 窗口不再必然省略入口事实；把“旧 40KiB 预留”施于**新**编译器也不再复现旧编译器超限。根因是 v4.9 不再将整本 `Narrative`／`LiteraryMemory` 装入入口 view，完整状态仍保存在 Go 权威侧，并在模型发送前再次按阶段取材。原测试将入口 view 当作最终模型材料、将预留数值当作旧算法，已不成立。迁移必须保留历史封存失败、来源哈希、实际预算负控、事实及知情全文、完整原页与正式 authority；不能只删除失败断言，也不能改原 benchmark 或生产窗口。
- 最终材料版本首次真实批次 `.validation/deep-benchmark/20261020T090058Z-memory-v49-serial/` 使用 `source-freeze-20261020T085909Z` 独立快照（673 源码文件和 129 依赖文件），串行运行同三例原题。23 次请求／响应完整配对，provider error 全为空；NAR009 S01、S02 提交至 r3，S03 失败；NAR010 S01 提交至 r2，S02 失败；NAR017 S01 失败。合计 3 个正式页、3 步 FAIL、20 步 NOT_RUN，三例仍全为 FAIL。
- 该批三例原 native 完整性核验均 VERIFIED，三次 v5 独立失败读回均证明正式历史未写入。源清单与 Go/Rust 二进制运行后保持相同；核验只证明证据和失败边界，不等于内容通过。封口汇总见 `.validation/source-knowledge-20261020/v49-live-execution-summary.json`，原核验为 `v49-live-native-final.json`。
- 共同失败发生在成功返回的 memory 输出之后，操作错误为 `narrative_stage_invalid`。模型将 `context_needs.relationship_targets` 填成“许舟与外婆方芹”“季砚与餐馆店主的借还往来”等关系描述；Rust 按实体 ID 校验，而原共享 schema 仅声明字符串数组，memory 提示也没有明确 ID 含义。实体本身在实际请求中可见。这是新的字段契约缺口，不能归为 provider 故障。另一用户授权线程负责精确原输入回放、补字段语义，以及 Go 对固定完整 authority 的实体引用校验；不将中文猜成 ID、不放宽引用检查、不新增重试。
- 三页逐字独立审读见 `v49-live-content-review.md`：009 S02 在当日 13:25 实际旋紧螺钉、按压和试坐测试后归位，普通修理有真实进展；010 S01 完整说明杯色与口味，阿穆当场改按口味服务。16 条新事实的 39 条新知情边及 2 条旧事实增授未见已证实的过授，但样本少且提前中断。阿穆下一轮独立 actor 未运行，不能声称跨步纠正已保持；三例均无完整结局。009 S01 新记忆确实在 S02 后续阶段取回且 S02 提交，但事实和前文同时存在，不能将行为改善单独归因于记忆。
- 容量迁移的 085028 定向运行保留 8 PASS／1 FAIL：实际 Rust 的 memory→plan→evaluate→write→extract 均保留回取事实全文，旧 spy 仍要求独立 review 携带无关计划事实而报错。最后修正 spy：当固定候选没有事实、知情、公开或记忆变更时，允许独立 review 不选择该无关事实；如果事实出现，仍须全文一致，候选非空变更会让此控制失败。随后 `.validation/recorded-pipeline-migration-20261020T091911Z/` 在首例运行中被用户中断，无退出结果，记为 INTERRUPTED，不能算绿。新合同 pin 已变化，后续须配套新源码构建的 runtime，不能混用旧二进制。该零模型工程检查不再作为真实原题启动前置。
- ContextNeeds 最小修正已进入新的独立快照 `source-freeze-20261020T093547Z`（676 源码／129 依赖），真实批次 `.validation/deep-benchmark/20261020T093747Z-memory-v49-serial/` 已开始。Go/Rust 生产文件分别为 `2c7913b02677eb8450f96a1a73807ecd9721a26d0822e8c6bc3529ab85bf5d9a`／`6b034e7842fb9d08aafdd320cfa78d7bf0f32c94ffb9246876ddc24320e8994e`，四端合同 `4c52a8d9a9968320d545e14d1e0a511bc00d212e7a42b160d905f17f59ab98c7`；原始材料编译器 `248688d2…` 不变。新永久录制回归保留原失败输出及确定性重建的 Rust 入口，单独更改关系目标为合法 ID 即能进入 actor；重建入口不冒称原保存 wire。独审报告 `context-needs-independent-review.md` 无限定范围内阻断；真实遵循及完整剧情尚待本批验证。
- 新批构建与快照来源均已独立核验：434 项构建清单前后相同并与完整快照绑定，Go 二进制 `761efd9d2e4bf2c175889780addaa91bed319ea089d3c661a70d3ae263c6b5d3`，Rust `dafc5cb80063d4098e5dae339b3efcf6e03233c2caecd67a9ea827003fc64507`。原三例 26 步未改，启动器仍仅固定根和串行两处差异。来源记录为 `v49-context-needs-live-provenance.json`，不覆盖前批证据。
- 使用此同源 Rust 运行时，`.validation/recorded-frozen-migration-20261020T094127Z/` 完成两容量迁移定向回归：9 PASS／0 FAIL／0 SKIP，13.618 秒、0 真实模型。包含真实 Rust 同操作回取 1 次／7 阶段、完整 Fact/known_by 和权威 Apply、审计 fence、容量恰好可容／少一字节拒绝。原失败和中断记录全部保留。独审 `capacity-migration-independent-review.md` 明确 review 例外依赖固定 producer 的空变更前提，不能泛化为任意候选审稿证据充分性，更不是文学质量验收。
- 对同一 093547 冻结源运行完整后端／Rust 工程回归 `.validation/backend-v49-20261020T094811Z/` 已自然退出 0：Rust 默认 111／无默认 105 项通过，channel runtime 构建通过；Go 全后端 race＋integration,codexlive 标签 838 PASS、25 SKIP、0 FAIL（含子测试），源码及二进制前后稳定。25 个 skip 包含必须显式开启的真实模型测试和子进程 helper，本次所有模型 opt-in 已清除，没有额外真实模型调用。前次容量回放与 artifact 失败记录不改；此结果不包含前端真机或叙事质量验收。
- 新真实批次的 NAR009 S02 已提交至次日 14:12：模型在 plan 自选胶合，writer 首次引入瓶标 24 小时并跨日，随后实际拆夹和承重试验完成维修。原“通常一下午可修”条件在各阶段完整可见，不能归为记忆漏取；同时不能将“通常”升格为原题绝对截止时间，也无证据指认新增留宿承诺。独立分析 `v49-context-needs-time-scope-review.md` 将问题限定为作者新选条件与推进授权的依据混用，后续应核查新条件为何可扩大本轮范围，不能用禁胶、硬编码一下午或忽略真实固化时间取代修正。S03 已实际坐椅喝水，S04转向近况，尚未观察到重新施工或时间回滚；全例及其余两例仍在运行。
- 上述批次 NAR009 后续 S01–S06 共 6 页正式提交，S07 经原一次修复后仍因 `narrative_review_rejected` 失败，S08 未运行；49 次真实调用的 provider 均成功。165 事件封口 root `018a5196248caf48525c28829dc4b5fe51cf2f367c4355a6f3d8ebaab00ba5a7`，不改写为成功。新记忆 6 条来源有效、123 份后续材料无字段漂移，其中 75 份随后续成功操作提交；份数不是模型调用或独立记忆条数。
- S07 的独立错误是把许舟独处经历捆入记录并授予外婆知情。记忆摘要涉及休息、返回厨房等事件在完整正文中确实存在；短 quote 只覆盖摇扇，属于摘录支持范围问题，不能称这些事件虚构，也不能靠整页 hash 证明摘录充分。只读契约审查见 `.validation/memory-deep-audits/20261020T093747Z-memory-v49-serial/quote-semantics-review.md`。
- 已确认修复职责错配：seq148 与 157 的整个 extract 请求相同，user content SHA256 均 `64324c500adb64f0fb1212a343b98209a57d1767368ed4b0041e7536ffaf8960`；revise 后五个草稿字段完全相同。具体问题只传给输出草稿的 revise，能修改事实、知情边和记忆的 extract 未收到原候选及反馈。根因报告为 `v49-state-repair-root-cause.md`。这不是 provider 故障，也不是简单放宽引用即可解决的问题。
- 已按[状态修复设计](../docs/superpowers/specs/2026-10-20-narrative-state-repair-design.md)实施 v4.11：显式 `repair_scope` 将纯状态问题导向冻结正文的 `repair_state → review`；正文/混合/未确定及旧录制缺字段走 `revise → extract → review`，但第二次 extract 绑定原被拒状态和意见。两端保留一次共享修复、总调用和原容量限制。显式非法类型、被替换候选或意见、五字段变化不进入正式提交。
- 此轮在另一用户线程已完成的 v4.10 阅读篇幅、compact extraction 和准备接续修改之上整合，已协调该线程停止写相关文件。当前真实批次仍使用独立冻结 v4.9，不能以它验收 v4.10/v4.11；本地运行服务未因本次修复切换。
- `.validation/state-repair-20261020/` 保存新红绿证据：Rust 首轮 6 个失败包含 legacy 真路径反馈丢失；后续 9 个路由/冻结/预算/续读用例以及容量检查已纳入整套测试。中途容量回归两项失败如实保留，修复采用去除重复提示，未增容量或删检查；无默认特性完整套件 124 项通过。Go 定向及整个 experience race 已有绿测，跨端与最终源码核验仍待完成。全部为固定输入的工程验证，本轮尚无 v4.11 真实模型验收。
- 语义独核的两项静态 P2 已修正：审稿提示显式列出 title/passage/story_time/outcome/suggestions，避免把错误 story_time 路由为冻结状态修复；“context 只释指代”改为“可释指代”，避免排除合法旧来源。最终 Rust 默认 130／无默认 124 项通过，runtime `608ed8ec3501f8dc93db0bd7469e0c03c9cdee332d8a01e332d2e3749249db66`；最终三文件前后稳定。另有 53 项 algorithms/contracts 独立构建清单及固定运行时，证据为 `.validation/state-repair-20261020/independent/runtime-binding-20261020T104436Z/`。这些结果不证明模型一定正确分类或修复。
- 首次真实 Rust＋Go＋固定 provider 跨端回归 `transport-20261020T104522Z` **17 子例通过、2 子例失败**：mixed/legacy 在第 6 次调用后的 revise 前被 `narrative_review_evidence_invalid` 拦截。原完整 context 可见的无 subject 旧 target 在普通 revise 取材中被移除，来源校验正确拒绝；不能修改 fixture 或放宽校验消除失败。独立审查还确认混合后 extract 只按旧候选正文选身份材料，漏掉修订正文新提及的既有主体。两处将以旧目标保留、新草稿检索线索并集的定向红绿修复，正式权威及预算不变。`source-freeze-20261020T104317Z` 是保留这次中间实现的 688 源码／129 依赖快照，不用于最终真实运行。
- 冻结 v4.9 的 NAR017 已自然封口，179 事件 root `b961c0b1…`，8 步全部提交，但 `run_status=REVIEW` 不等于叙事质量通过。只读记忆窄审确认 12 次新写均有完整页依据，187 份后续材料来自 40 个请求并无字段漂移；其中 11 条有后续取回，最后 S08 新写没有后续步骤。seq149 `mem-r7-correspondence` 的双方通信承诺摘要有全文依据，但 quote 只保留季砚一侧，漏掉陆棠“安顿后寄地址”的承诺和条件；后续 source / requires_source=false 不证明摘录充分。此项作为实际记忆质量缺口保留，不称虚构、也不因执行成功而隐去。
- NAR017 记忆窄审已收尾为 `nar017-memory-semantic-review.md`：12 条均有全文及所引事实依据，11 episode／1 commitment，未见永久人格化、statement 升格或完成目标复活。三项主要摘录风险分别是通信承诺另一方及条件、诗选修补仍缺角、门口交流另一方立场，另有冬夜船声摘录未覆盖安顿的范围观察。通信事实虽未进入 S08 的六阶段材料，r8 ask 回顾仍有安排概述；未观察到错误履约或知情升级，不能称整个 bundle 无依据。S06 确有 ReadRequest 回取预算、房租与留岛决定原事实。actor 窄审覆盖 017 全 179 事件及 010 固定 seq1–62，9 请求／47 fact 投影均与操作前 authority 及 known_by 匹配，trigger 来自授权原文，无作者 memory／整页／profile；仅证明输入隔离，不验证原始 known_by 语义或输出不臆造。报告均在 `.validation/memory-deep-audits/20261020T093747Z-memory-v49-serial/`。
- 两处 Go 取材修复已完成：revise 保留普通场景／方案需求并加入原被拒候选的必要权威目标；仅有 repairSource 的后续 extract 同时使用当前采用正文作既有实体检索线索，不能把草稿转成权威事实。`context_materials.go` SHA256 `d7d74f007c20a4ddc0cc75727b16b1f0cd20578745005c28833e7c013fc5a7f2`；有效独立红绿与最终 experience race 436 PASS／0 FAIL／1 明确 skip 见 `.validation/state-repair-20261020/go/materials-summary.json`。初始未配置 materialBudget 的控制没有实际进入编译器，不计作机制 RED；第二次抽取在前置 revise 即失败的控制也不计作抽取 RED。原记录全部保留。独立 actual Rust 跨端测试仍在复测，包级通过不代替跨端通过。
- 原 19 个真实 Rust→Go→SQL 合成控制最终在 `independent/transport-20261020T105811Z` 全部通过（连同 2 个顶层测试共 21 PASS／0 FAIL／0 SKIP），源码及同一 `608ed8…` runtime 前后稳定，0 真实模型调用。第二轮已越过原取材错误，但测试 spy 将 JSON 对象键序误认为被拒状态变化；完整结构树与 issues 对照相等，只有 new_facts／knowledge_changes 对象成员顺序不同。最小修改测试为严格解码后完整结构比较，继续拒绝重复键、字段增删、数组顺序及值变化；没有更改原 19 场景、生产断言、共享修复预算或提交条件。错误比较的两轮记录及第一次实际生产缺陷记录分别保留。所有源码与永久测试停止编辑，下一步复制最终验证快照并运行全后端。
- 最终快照 `source-freeze-20261020T105937Z` 固定 688 源码／129 依赖，源码清单 SHA256 `8d344fbee51dd42fdede2e765260ed19ac87f375531c2e9bbc30e1e61fe7675d`。对应完整 Go `.validation/backend-v411-go-20261020T110134Z` 自然退出 0：974 PASS／26 明确 SKIP／0 FAIL，13 包均有唯一终态（7 通过／6 无测试）。原容量回放、artifact 和两组状态修复跨端测试实际通过；独立核验全部冻结源码、依赖、53 项算法／合同输入与运行时来源。Rust 使用先前已通过 130／124 项的同源实现，未把重用的结果记为又跑一遍。证据 `.validation/state-repair-20261020/independent/full-go-review.json`。
- 093747 旧 v4.9 三例自然封口：174 次请求和返回、无 provider 错误；009 为 49 次调用／6 步提交／S07 FAIL／S08 未执行，010 为 72 次调用／10 步提交／REVIEW，017 为 53 次调用／8 步提交／REVIEW。三例由原冻结 runner 核验 native integrity VERIFIED，009 失败后独立读回证明正式历史未写入。共 24 次提交不代表 24 次质量通过；原结果未覆盖。最终执行及完整性记录为 `v49-context-needs-execution-final.json`、`v49-context-needs-native-final.json`。
- 完整全文审阅分别写入 `nar017-content-review.md` 与 `nar010-content-review.md`。017 四书、留岛、告别及后记实际完成，但 S05 为修状态在小说中新增“陆棠并没有看见”的审计式旁白，前四章反复核账及部分边界式对白仍有文学风险。010 早问清杯色是合法分支，之后没有恢复错信，完成上菜及收席；S09 同输入二抽生成不同候选后获批，不能把批准单独归因于换 quote：cue／summary／检索词／事实数也改变。其后 S10 有完整原页和回应事实，不能把相容输出归因于短摘录。两例均保留目标读者盲评、反事实等未覆盖项，不盖文学 PASS。
- 新唯一真实批次 `.validation/deep-benchmark/20261020T110759Z-state-repair-v411-serial` 从最终 105937 快照重新构建并启动，旧进程已退出；仍同三例 26 步、串行、无 resume／gate override。新构建 444 文件清单前后相等并与冻结源绑定，tree SHA256 `ceadc0ce1c50314a226cb95e67ac03cf8bfe76390c0f65d5b3c3660431579e8d`，Go test 二进制 `c2b22fa63024f535cdf7b90dc53d18f80ab715631844cc406af0205f41d0fc9e`，本次源码构建 Rust 二进制 `0eb162953ad024a8e8df65c0b13f4645a04b1ee2596b91a88add39517205ce3c`，不同于工程验证缓存构建的字节指纹，各自来源分别核验。新运行 provenance 见 `.validation/state-repair-20261020/independent/v411-live-provenance.json`；本批 v4.11 包含 v4.10 篇幅／紧凑抽取等整合改动，不作单因素因果比较。
- 新批 NAR-009 已独立封口核验：181 事件，root `68ccbb1ee5943a5ddc7bc7f1d79cba7ff24fb9fee1e6cdf248c2607c2bed5306`，54 次实际请求／返回且 provider error 均空，8 步提交至 r9。冻结 runner 的个例 native verify 为 VERIFIED／REVIEW，不是文学 PASS；两次 `repair_state` 分别是 S06 的 seq125–134、S08 的 seq171–180，各 8 calls／1 次共享修复，无 revise。两次拒绝都正确区分“正文已有事件”与“保存的 quote 范围不足”，修复只改记忆 quote；原五个草稿字段、其他状态与独立复审后的正式提交逐值绑定。标题取 `public_view.title` 核对，page 本身没有 title 字段。独立记录 `independent/v411-nar009-sealed-repairs.json`、`v411-nar009-sealed-native.json` 与 `v411-nar009-content-review.md`。
- S06 修复后的记忆已在 S07 五个实际请求中以 summary 粒度取回并随 seq154 提交；五处都没有发送扩展后的 quote。因此证据是“真实引用修复＋后续摘要取回”，不能称修后摘录已再次投送。S08 为最后一步，无后续取回见证。两次都是引用范围问题，没有实际触发 knowledge_scope 修复；冻结正文的工程保障不能代替知情语义有效性证明。
- 新009内容实现当日 14:20 修好并试用、17:10 正式结尾及几天后仍可用的后记，未把未答复的晚饭邀请升级为承诺。此次薄木片方案无需跨夜，不能据此宣称旧时间授权缺口已修复。扩充篇幅是已整合需求，长本身不判为缺陷；文学待审集中于不同段落中处理食材、让开空间、收拾和水声等相似结构是否增加新意味，保留后记剥豆教学与对白的新意。017／010 此时尚未完成；不从009推断三例或全基准通过。
- 新批 NAR-017 已封口 **FAIL**：73 事件、root `21c9478a5c0a2c8bc1260597d5e94add846b3fc84ff10e3e5f83514e3cc2c147`，21 次请求／返回且 provider error 均空，仅 S01/02 正式提交至 r3。两步各修一次记忆 quote 后批准；S03 seq69 写作结果可解析、4682 UTF-8 字节、32 个按双 LF 分隔的非空段，Rust `Draft::validate` 的 read 上限为 24，seq71 返回 `narrative_stage_invalid`，未到 extract/review/repair。逐谓词检查只发现段数不合法；这是已绑定实际运行与静态谓词的归因，未另行 Rust 复演。不能把尚未提交的第三本交接当进展。seq58 前态与 seq72 新服务/新连接读回的 snapshots、branches、正式 pages、preferences 全相同；operation 生命周期和 updated_at 的变化单列，不称整个 public_view 原字不变。原报告 `v411-nar017-content-review.md` 保存草稿全文及哈希。
- 新017记忆审计确认两条新写 source 有效：12 个带记忆请求共16份后续材料，字段保真；只有 S02 的8份属于后续成功提交链，S03 的8份处于失败操作。两个 ID 都实际后来取回，只有第一条进入后续提交闭环。当前缺少 writer 草稿结构的修复入口，单操作尚有预算不意味着系统已有该路径。独立合同审查将24段定位为既定生成策略，并未找到第25段损害事实/性能的实证；1200–1800汉字与24段也不矛盾。下一步比较将分段约束表达进生产者 schema 与类型化格式修复，暂不扩大上限、调用数或把失败改成通过。
- v4.11 三例全部自然封口，观察器也已退出：009 为 REVIEW／8 commit／54 calls；017 为 FAIL／2 commit／21 calls；010 为 FAIL／5 commit／41 calls。合计 116 次请求与返回、provider error 均空；26 个计划步骤中 15 提交、2 失败、9 未执行。三例原生完整性均 VERIFIED；不把执行完成或模型批准改为文学 PASS。010 S06 seq135 为 4740B／31 个非空段，seq137 `narrative_stage_invalid`，未抽取、审稿或修复；seq138 新连接读回正式域保持 r6。原报告与所有失败均保留。
- 本批记忆审计封口：19 次新写来源有效，18 个不同 ID 后续实际取回，其中16个进入后续提交链；81个请求中349份材料字段保真，310份进入后续成功提交链，39份失败步骤材料严格排除。5次 `repair_state`（009两次、017两次、010一次）均仅修 quote，不改变五个草稿字段；这是实际引用状态修复证据，尚不是知情修复有效性证明。
- 下一项选择在生成端表达已有分段约束：Read 最多24段，其余模式最多3段，保留单换行诗行、CRLF及非空行缩进。新输出采用明确分段格式；不重写历史，不合并或截断模型正文，不增加修复/调用预算，不改变8192 UTF-8字节消费限制或共享合同。相对于草稿数组迁移或另增格式修复阶段，该方案只修改内部生成 schema；需要验证 provider 实际接受并遵守，静态支持不等于 decoder 已验收。
- 真正 RED 保存于 `.validation/draft-shape-20261020/go/20261020T121541Z-controls/`：旧实际 Rust writer schema 及实际 Codex transport schema 均错误接受017原32段、010原31段；实际 Rust→Go 服务拒绝017原稿且不提交；仅调空白分隔到24段的工程正控通过6阶段后正式提交。编译/运行器无误，0产品模型调用。独立 v2 模式探针59输入×2上限×2引擎236判断一致，37,449短串未发现被模式接受却段数越界；它不验证8KiB或叙事质量。此后开始 v4.12 最小实现，尚待转绿及真实模型。
- v4.12 最小生产修改稳定：Rust 仅新增 Draft passage schema helper、接入 Write/Revise/Answer 和版本更新；Go 只同步 engine 版本。Rust 默认135／无默认129项全通过，新增录制消费控制保持32/31段拒绝与仅分隔24段接受，8KiB／空白／CRLF边界保持。算法及合同构建前后清单相同，独立 runtime SHA256 `99d64b765d4ba45280e1de182d6d1922d2274232a25c502bb661fc267cb6cd97`，证据 `.validation/draft-shape-20261020/rust/validation-20261020T122428Z/`。schema 原字节计入既有容量校验，没有增加窗口或输出预算。
- 实际 Rust→Go 及 Codex schema transport 转绿：`.validation/draft-shape-20261020/go/20261020T122814Z-green-controls/` 两命令 exit0、无 skip。Read schema 拒绝两份原超段录制，24段工程正控实际提交；Act schema 拒绝超段，合法单LF诗行实际提交，3段允许／4段拒绝。实际 Read/Act 请求中的 pattern 与独立 v2 探针逐字相同；转换及规范化保持约束与正文，既有 reading-scope 七项控制仍绿。所有这些使用固定 provider，尚未执行 v4.12 产品模型；下一步冻结源码、完成后端回归，再用未改原题 NAR-010/NAR-017 与跨场景 NAR-014 验证。
- 最终 v4.12 冻结 `source-freeze-20261020T122957Z` 为694源码／129依赖，源码清单 SHA256 `28ca084ee56aafe8a73af893eeb4bb2325090e37091590df11b82a675963ca7e`。对105937新增6个测试/fixture文件；另 `narrative_extraction.rs` 和 `narrative_reading.rs` 因本轮 cargo fmt 产生换行缩进及等价尾逗号变化，独审确认字符串和行为未变，保留已验证快照。不能笼统说只有一个Rust文件字节变化。
- 完整后端 `.validation/backend-v412-go-20261020T123154Z` exit0：981 PASS／28明确SKIP／0FAIL，13包均终态（7PASS／6无测试）；源码前后稳定、运行时哈希一致、实际Rust跨端/容量/artifact控制通过。28跳过中包含两个依赖实际schema导出目录的transport测试，其独立定向GREEN另有证据，不算本次又执行。独立核验全部694源码、129依赖和57算法/合同构建输入，0产品模型调用。
- 新唯一产品批次 `.validation/deep-benchmark/20261020T123757Z-draft-shape-v412-serial` 已从122957冻结源独立构建并串行运行原NAR010／014／017，26步、无resume/门禁覆盖，session81295。450项构建清单前后一致；本次cold-build runtime指纹为 `1337a459224b69eb2e7867b66854dd1397082302416eecb37d26bed27e8e6a13`，来源与工程缓存构建分别绑定，不要求二进制字节相等。只读记忆observer87067写独立新audit目录；旧observer不重启，任何失败取材仍排除于成功提交链。
- 截至新010 S01正式提交，实际act正文3段／871B；S02写作候选24段／4041B已进入后续审稿。两实际请求schema的pattern与v2精确一致，输出通过Node文法检查；不据此证明provider内部decoder机制、整例完成或文学质量。正文及来源后续结果分别保存在 `.validation/draft-shape-20261020/` 的内容审阅与live证据文件。
- 新010推进至S07正式提交，原题条件分支未强造错配或另一套误信；S07实际完成剩余菜，回备菜处核对大盆已空、待端盘子已清。全文审读保留一个跨页风格问题：多次以主持者终于能吃饭／不用安排收束；S01/S03这种总结由writer新增，S02拟人结尾已有选中plan依据，后两页都收到前文完整结尾，不能归因历史遗漏。它不是禁止日常动作或固定词语的理由，也不从有限样本推总体质量。
- 新010 S06暴露结构合规与内容质量的实际区别：seq144原稿24段／4286B，含孤立“曜日”1行和“月”4行，生成pattern接受，随后原字进入extract和review。seq150按mixed拒绝异物与两条记忆引用范围不足；现有一次revise→extract→review在seq153产出18段／4255B修订稿，seq159批准、161正式提交r7，9calls／383741ms。正式五字段逐值等于修订稿，未由程序删字合段；旧原稿保留，不能算首次生成无缺陷。原始CLI/provider流未封存，只能直接绑定到适配器返回，不能凭一次样本认定regex导致杂质。独立终态记录为 `live-nar010-s06-terminal.json`。
- S06再提取并非quote-only：两条episode摘要收窄，6条候选事实变为4条，去掉当次两条口味表达并收窄何叔条目；其余3条事实原值、knowledge_changes为空。两条正式记忆绑定修订稿SHA `247d7da9e75a946bab5c9376a704dbd0771008612af93868ecab01b6f84f2294`，不是原稿；现有摘要及知情范围有修订正文依据。被省略的细节仍在正式原页，后续可回取性尚须实际请求证明。独立审计保留158未提交与161已提交两个前缀，不能混成同一个成功状态。
- 只读机制研究保存于 `.validation/draft-shape-20261020/shape-quality-primary-research.md`：结构约束的分布影响有一手研究依据，另有结构约束提高下游准确率的相反实证，均不能代替当前模型的因果诊断。paragraphs[]只是一项待验证的内部表示候选，需要Go/Rust一致装配和原字归属，未实施、不扩段数、不追加重试。本批仍按既定冻结源继续。
- v4.12 NAR-010 已自然封口：278 事件，events SHA256 `1bbc599ef745a4832797b7ff9858845e4f1e1d73c31d97a77be1033ecb4eb264`，root `1e873f47e95740ff72ac356c8e778f3cb6923e6ad4c009859012d7c97c2b09b7`。85 请求／85 返回、10 步正式提交，0 provider／stage error；17 次 review 为10批准／7拒绝，6次 repair_state 与1次 mixed revise。156项机械检查无失败，11份写作／修订的实际 pattern 与 v2 一致且正文匹配；native VERIFIED、运行 REVIEW，未评文学 PASS。报告 `.validation/draft-shape-20261020/live-nar010-sealed-summary.json` 与 `live-nar010-content-review.md`。
- 010 全文审读：正确茶规则后没有恢复原误会；S07 完成剩余上菜，S08 回响既有口味／传菜细节，S09 私下感谢没有公开羞辱，S10 实际收席清理并结束。保留主人终于吃上饭、腾空间和细碎动作重复的文学风险；S06 草稿杂质经过真实修订，不掩盖首次生成问题。逐值核实6次状态修复只改 quote，S08改两条；不将此外推为知情状态修复成功。
- 独立 memory 审计 `.validation/memory-deep-audits/20261020T123757Z-draft-shape-v412-serial/nar010-final-memory-closure.json` 与同一 sealed hash 对齐：15条新写来源有效，13个不同ID后来取回并用于成功提交；70个带记忆请求、377份材料保真且进入后续提交链。S10最后两条无下一请求，不算取回成功。材料份数不是模型调用数。
- 017 已正式越过 v4.11 S03 的结构失败位置：S01／S02／S03 分别提交《潮汐表》《田野札记》《沿岸草木》的收回与归架，至12:30仍剩《旧诗选》，去留未定。S01状态修复只收窄summary，非扩quote，交接事实仍保留；S02／S03则只扩记忆quote。三章正式五草稿字段与各自原稿相等，不能将审稿批准或结构合规当成完整六章质量通过。当前仍继续原题。
- 下一项核心改造写成 `docs/superpowers/specs/2026-10-20-memory-index-evidence-separation.md`：检索索引、Go权威来源与当前实际证据分开。新候选使用显式v2 memory_delta，review直接审已提供的正文／正式页／完整事实，通过Go目录绑定实际依据；旧quote保留为locator、旧档不追授新批准。完整来源、知情、条件、否定、原子提交及预算仍保留，准备／恢复边界正在只读反审。本段仅记录设计工作，未修改产品源码或正在运行的冻结批次。
- v4.12 全批已自然退出（81295 exit1；只读 observer87067 exit0，均未重启）：146 次请求／145 次无错误返回，26原定步骤中15提交、2失败、9未运行。010为10提交／REVIEW；017在4本书均已正式归还后，S05末审稿触发操作期限，留岛决定及新记忆没有提交；014为S01提交，S02审稿批准后因同ID记忆 target_ids 加入 inspector 被既有身份校验拒绝，正式状态仍r2。两失败均有 fresh readback 证明正式域未变，operation/updated_at变化另记。报告 `live-nar017-content-review.md`、`live-nar014-content-review.md` 保留候选与正式内容的区别，不将超时判为语义拒绝。
- 独立批次记忆封口见 `.validation/memory-deep-audits/20261020T123757Z-draft-shape-v412-serial/batch-final-memory-closure.md` 及 JSON（SHA256 `95fd780e2a084765ad245f0ef12e91b115ba11da1eefe777bc4bfbe3a1e206cc`）：26新记忆来源有效，24不同ID后取回，其中20进入后续成功提交；109请求545材料实例字段保真，480进入后续提交链，65属于失败操作单列。12次状态修复中11只quote、017S01只summary；017S05复审超时，所以仅11次修复正式采用。另010S06 mixed单列。这不是文学质量总通过，也未证明新v2收益。
- v2设计边界已获接受并进入分工实施，计划 `docs/superpowers/plans/2026-10-20-memory-index-evidence-separation.md`。首次required缺页须保留原补读机会，硬门槛落review/repair_review批准前；修后完整candidate重算，不能追溯要求extract输入含其刚输出ID的页。页内容放不下与连续selector／剩余读取预算无法取得分开报告，预算不扩。当前只有离线协议开发和固定输入验证，没有追加产品模型调用，也未切换服务。
- v2 已完成四端闭合表示、索引与实际证据目录、完整候选/实际请求批准绑定、准备任务原身份交接、事务内来源复核、归档 v2 与作者改写边界。旧记忆和旧录制保留 v1 解码；新流水线输出 `memory_delta`，review 选择当前目录的 `source_ids`，不再复写一个必须覆盖全部含义的 quote。来源 ID/hash 仍不证明摘要语义，actor 权限没有随作者来源扩大。
- 工程验证记录在 `.validation/memory-evidence-v2-20261020/`。`binding-boundaries-red` 精确复现 JSONB 重排 schema 格式导致合法 preparation 被拒，以及发送前证据错误经模型错误闭集变为 `algorithm_protocol`；分别以同值 canonical schema 比较和原 Go 错误直返修正。原 protobuf 字节 pin、完整候选绑定、无 provider 调用的失败边界保留。
- `author-stages-red` 复现非 review 作者阶段缺目录/loaded 不实；目录现按各阶段最终实际内容生成，draft 仅候选、非 review 不签批准或设置 required，actor/ask 原隔离路径保留。泛化中的 map 别名曾把阶段外层复制进 nested context，既有候选唯一性/去重控制拒绝，失败记录保留；修正后原大正文/全 authority 容量例在未改预算下通过，外置 `capacity-diagnostic-first` 记录各组件字节。不声称旧失败层次已有完整载荷录制。
- 独审两项 P2 已用 `reentry-cache-red` 复现：review 一次补读耗尽后，经 repair_state 更换缺页旧 ID 仍发无解请求；普通 fact ID 重装缓存全部旧版本，多带 834B/412B（此复现不宣称溢出）。现缺页检查当前 stage 已用读额度及全局读数；缓存选择固定 as-of/完整记录 hash，普通 fact ID 只需要当前版本，旧条目依赖只取精确引用版本。原 receipt 不改，修后同一对照字节差为零。
- `all-memory-second-green` 在稳定源码上 50 顶层/156 含子例全通过、零跳过。包括当前 review 真实 ReadRequest→DB Read→同阶段恢复批准后，再改旧页或旧 fact.known_by，提交事务正确拒绝且无新正式页/state/index/批准；ready/preparing 原身份交接、取消/租约/fence/重启/偏好故障、真实 Fork→Polish→Export/Decode 也覆盖。`python-full` 全 104 项通过、零跳过，36 输入文件前后稳定。全部为固定内容/协议/数据库工程验证，不是模型语义或文学验收。
- Go/Rust 引擎常量现同步 v4.13，以隔离旧批准与新记忆语义。同步前完整 Rust 151 项通过并构建实际 runtime，非空 v2 经真实 Rust→Go→SQL 两次提交保留当前采用页和上次正式页引用；旧录制用于新管线时只作显式测试转录，不主张 v1/v2 记忆语义等价。版本同步后的完整回归、最终源码冻结和真实原题仍待执行；没有新增产品模型调用、服务切换或旧批重跑。
