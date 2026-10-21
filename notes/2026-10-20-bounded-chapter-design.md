# 明确章节请求的有界响应：设计与 v4.5 实施证据

此记录先完成只读设计；协调者批准下述最小方案，并在 NAR-001 全轨迹、SYS-005 恢复取消的 v4.4 构建及 v4.4 全 backend 回归结束后明确解冻，随后开始正式源码红→绿。真实 NAR-017 提供改动前 baseline。采用 codebase-design 的接口审查方式，把表达范围、预算和验证放在已有叙事 Module 内，不为题号设置分支，也不增加一个拥有世界事实的客户端 Agent。

## 现状与已证实的限制

明确的阅读请求没有在传递中丢失。`deep_benchmark_live_test.go` 把 continue/read 的逐字输入放进 `AdvanceRequest.ReadingRequest`，Mode=read、Input为空；Service 持久化 reading_request，构建 Context 时原字回填。Rust `context_view` 把它送到 memory/plan/evaluate/write/extract/review/revise，actor 仍使用独立权限投影。正式客户端的临时“下一段要求”也进入同一字段。非空 ReadingRequest 不消费默认预生成候选，避免取到另一个范围的既有短场景。

限制集中在 `algorithms/src/narrative_pipeline.rs`：

- `Draft::validate`（约647行）统一要求非空、passage不超过8192 UTF-8字节、按双换行分隔为1至3段。4段的正常章节会失败，分类为 narrative_stage_invalid；代码没有把第4段及以后静默裁掉。
- memory prompt 明确使用“短场景objective”；write 要求“1–3段完整短场景”；revise 再次要求1–3段。它们把一次明确章节请求放入固定短场景框架。
- plan 的 beats 在 schema 和 validator 两处限制1至3，每个方案最多2048字节；总模型调用最多12、角色提案最多2、修复最多1。3个因果转折不必等于3个文字段落，也不必等于3次提交。
- passage 8192字节并不排除900至1400汉字；约1400个常用汉字仅正文约4200字节。不能把 observed短文断言成8192字节硬截断。真正已证实的是固定的短场景指令和段落形态限制；真实文字是否压缩仍须量化并读正文。

现有“长/舒展”能力是表达偏好。Portal 提供“简短/适中/舒展”，开局时写入 seed 的“篇幅”文字；已确认内容偏好是任意 dimension/value 的显式参考，随 Context.preferences 传递；NarrativeStyle.detail/pace 保存表达线索。当前没有 `long` 枚举驱动的独立章节预算，也没有按篇幅偏好切换 Draft 验证上限。临时 ReadingRequest 应优先于相冲突的默认偏好，不应因一次“慢写这一章”改写长期偏好。

原 NAR-017 明确给用户“写第一章”“继续第二章”“第四章慢一点”“第六章收束”等请求，开局授权约六章阶段完整故事与普通行动；900至1400汉字位于“仅评估方可见”的 length_plan，且原文明确偏离只记录、不按字数直接判文学质量。因此应满足“章节”这个合法产品意图，不能把该评估数字投给模型。

## 建议先做的最小通用版本

保持 `Advance/Context/Candidate` 接口形状、一次 operation 和一次最终 commit；仅 read 可按明确阅读请求使用较多自然段。默认仍是短场景，Begin/Act/Ask 保持原1至3段。章节仍是本次用户请求的叙述单位，不是循环代操多次 Advance。

1. 现有 memory/write/revise 使用同一规则：默认短场景；read若有明确本次阅读要求，按原始 ReadingRequest、确认偏好和作品上下文理解叙述单位、节奏与展开程度，不把完整章节强制压成3段。段落服务动作、对白与场景转折，不使用 `strings.Contains("章")`、题号或固定关键词路由。Act/Ask/Begin 不扩大段落边界。
2. `Draft::validate` 中 read 允许1至24个非空自然段；其余模式保持1至3。所有模式仍保留8192 UTF-8字节，24只是安全上限，不是最小段数或填充目标。短场景不因此被要求拉长，章节也不靠把所有句子塞成3个长段绕过规则。换行计数沿用双换行自然段与CRLF正规化，最终提交仍保留正文原字。
3. 第一轮可保留 plan 的1至3个因果 beats，把它们明确定义为推进/关系/信息的关键变化而非文字段落数。一个有界章节可围绕少量关键变化展开。暂不增加 actor数量、模型调用数或阶段数；只有 baseline 显示计划确实欠缺才考虑有界扩展 beats，并同步 schema/validator/2048字节容量检查。
4. 所有非问答正文仍需 extract 原字复制 draft、review 连续原字引文、Go 完整 Apply、fence 和一次正式提交。章节长度不授权新的借贷、婚姻、身份变更或角色全知；遇到未授权重大决定应停在 awaits_player，允许本次章节未完成。既有合法 ending 不因“下一章”自动开新危机。
5. 章节内部的普通连续动作可在一份候选中表达，但不能把开章时各角色的认知投影视为后续所有时点都已更新。新知情仍必须由本章真实正文过程支撑，review 检查观察/传递先后；角色提案只是当时的意图，不能充当后来已经作出选择的事实。仍不新增模型提案成为权威的旁路。

这一版本不需要给模型注入900至1400、保证归还成功、指定六章事件列表或评分词。可以用“请接着写一整节”“这一回展开人物相处”“完整章回”“只给一小段后记”等自然迁移表达测试同一规则；不得只验证带“章”的一个词。

## 容量与接口收敛

先保留现有 passage=8KiB、candidate=24KiB、notebook=12KiB、单阶段 schema<=4096字节、模型输出8192 token、最多12次模型调用等硬上界。扩大段落形态不等于扩大正文字节预算，因此无需立即抬高输入/输出额度。整份 candidate 包含正文、事实、知情与笔记；章节多事件会挤占24KiB空间，不能只计算正文。现有 Go `narrativeContextCapacity` 为 pipeline预留36KiB stage overhead与额外schema，Rust又实测完整stage input，必须保留双侧检查。

此次不新增结构化 `NarrationBudget`、章节生成入口或完成状态字段。一次原文请求、一次有界候选已足够验证主要缺口；若未来需求超出现有字节预算，须另做有证据的容量设计。章序也不能用 revision（可能包含ask）冒充。

引擎策略变化应更新 narrativeEngineVersion，并使现有 preparation pin 的 engine/config失效；不要读取旧短场景候选充作新章节。ReadingRequest 非空绕过缓存的当前行为保留；用户改变临时节奏不重置世界时间，不清空后果。

已列出的活动源码版本标识只有两处：`backend/internal/experience/narrative_pipeline.go` 的 `narrative-engine.v4.4`，以及 `algorithms/src/narrative_pipeline.rs` COMMON_PROMPT 的 `elselife.narrative.v4.4`。解冻后同步升v4.5并复查全树；不重写旧封存证据、旧notes或外部runtime来源记录。共享JSON结构不变，无需通过新增合同字段扩充功能。

## 验证顺序与判读

先保留当前真实前两章作为 baseline，记录每页UTF-8字节、汉字数、双换行段数、各阶段调用数/耗时、是否自然出现段内/章内变化、停点理由、原章请求。900至1400只在评估记录里比较偏离，不写入产品材料，也不自动判通过/失败。

已只读量得当前v4.4运行 `20261020T031340Z-reading-editorial/NAR-017` 的S01 write候选（seq17，03:21:42Z）：841 Unicode码点、716汉字、2515 UTF-8字节、3个自然段。该观察时来源仍在运行未封存，统计本身只指候选，不证明正式提交。记录在 `.validation/reading-chapter-baseline-observed.json`。这也说明不能把短篇幅归因于8KiB硬容量已用尽；三段形态限制与提示偏向才是本次修改对象。

实现前红控应证明：现有合法4段文本被拒绝；短请求与章节请求收到同一硬3段约束。实现后固定模型验证4段以上有界文本可走完整Rust/Go/extract/review提交，而超字节、伪造引文、重复/未知事实和ask越权仍拒绝。使用短请求、不同措辞章节请求、long偏好但临时短请求、未授权重大决定、已ending后的短后记等并列场景检查迁移。

冻结期已准备 `.validation/chapter_read_scope_tests.rs.fragment` 和 `.validation/narrative_read_scope_integration_test.go.draft`：Rust覆盖read1/3/4/24/25段、Begin/Act/Ask三段边界、CRLF及8192/8193多字节边界；实际Rust+固定模型覆盖短read、展开read、24段read、唯一revise仍允许展开、25段拒绝及Act/Ask四段拒绝，并逐字核对正式提交与原ReadingRequest。草稿尚未落正式源或作为已执行测试宣称通过。

最后用相同封存世界和逐字用户输入做新的真实运行，保留原失败；独立审读内容是否从“标签叫一章的一个短场景”变成有合理起承变化的阅读单位，并检查长文是否引入状态漏提取、知情先后错误或等待显著上升。固定测试证明结构和范围，真实语义/文学仍需要引用正文及读者判断。

这与原改造方案第4/5/6/7/8方向一致：场景承担变化、表达留空间、临时要求不改长期偏好、速度与关键检查共同设计、以连续阅读证据判断。没有为追求长文本放宽已有权威、可取消性或隐私规则。

## 同批v4.5的授权优先规则

协调者根据独立审读另批准同一Rust文件的最小prompt修复：actor/plan是可以不采纳的提议，不是已经发生或必须执行的任务；input与明确read委托界定玩家授权，世界允许某行为不代表玩家本轮已作决定；memory不替玩家主体生成未授权自主决定。review不能仅因正文未执行actor.action就判错；revise须先核对issue与原input及世界依据，不能跟随越权的纠正建议。保留原actor知识投影，绝不为让它知道限制而把玩家私人input广播给所有NPC；不加调用、字段或放宽引用。

这是对真实失败的生成指导修正，固定模型测试只验证传输和校验边界，不能证明模型以后一定遵守。需用原失败的逐字输入重跑并保留每阶段提案/计划/审稿/正文，确认合法拒绝提案不会再被误当成待补执行动作。

## v4.5 实施与红控记录

正式修改仅触及 `algorithms/src/narrative_pipeline.rs` 的 Draft 段数校验、现有 prompt 和测试，以及 `backend/internal/experience/narrative_pipeline.go` 的活动引擎版本；新增 `narrative_read_scope_integration_test.go` 验证真实 Rust 与 Go Service。Read 上限改为24个非空自然段，Begin/Act/Ask仍为3；所有模式仍限制8192 UTF-8字节。没有修改 JSON 字段、模型调用预算、actor知识投影、plan的beats限制、候选逐字比较或引用验证。只有两个活动版本标识同步为v4.5；封存来源和专用于v4.4来源的回放检查保留原版本。

实现前先落测试，执行结果如下：

- `.validation/reading-scope-rust-red.log`：两个新Rust测试均按旧 `invalid_scene_beat` 失败，包含4/24段与CRLF展开段落。
- `.validation/reading-scope-go-red.log`：实际v4.4 Rust SHA `5a742da141fad59e2ab99c234f63716b1a97fa876498965d34cd6dbbf7ef7007`，7个子例中展开read、24段read和展开修订3例在write后停止，仅4次调用，未进入预期extract/review；短read、25段拒绝、Act四段拒绝、Ask四段拒绝4例通过。它使用固定模型，证明结构和提交路径限制，不声称模型会写出好章节。
- 此前第一次并发Go尝试在读取runtime时发生 `cannot allocate memory`，当时另一个Flutter web构建占用内存。该次没有执行产品断言，不作为产品红控。原tee路径被后续重跑复用，现以明确标注“工具输出转录”的 `.validation/reading-scope-go-allocation-attempt.txt` 单独保留，不能冒充原始日志。
- 修改后 `.validation/reading-scope-rust-green.log` 两个测试已通过，验证read 1/3/4/24段允许、25段拒绝；Begin/Act/Ask仍3段允许4段拒绝；8192字节允许8193拒绝、空白拒绝、CRLF段落允许。

独立pipeline审查者只读复核授权prompt：明确允许NPC依据目标/知情自行行动与已授权普通后续；memory不硬编码玩家身份、actors可以为空；Review/RepairReview仍指出真正无来源知情；Revise不因一条issue无据而忽略其他真实问题。actor载体仍只接收已批准trigger及known_by知识，不接收完整input/reading_request/private scene。此结论只是源码审查，新真实运行前不能宣称FUN-001已修复或NAR-017文学质量改善。

## 最终绿色验证与稳定源点

2026-10-20T03:37:37Z汇总的验证使用v4.5实际Rust运行时 SHA `fc2131a65c2c567987dc88ffb15dee2cb3ac7d734ca0b636ebf883e12c5e7826`，独立保存于 `.validation/reading-scope-runtime-v45`，避免Cargo不同feature构建覆盖它。`summarize-reading-scope-20261020.py` 独立核对最终所有actualRust日志中的SHA与该文件一致，并生成 `.validation/reading-scope-validation-summary.json`，其中包含三个修改源码及结果日志的SHA。

- 定向Go绿控：7/7子例通过，整组8.414s。短read3段、展开read4段、最大read24段和一次revise后的4段正文经过实际Rust流水线与Go正式提交，正文逐字保留；阅读要求逐字传至memory/answer；旧正式页不变。25段read、Act四段、Ask四段仍拒绝且不新增正式版本。
- 全Rust `cargo test --locked --offline --no-default-features`：88 PASS、0 FAIL。包括新增边界、共享stage容量、引文原字、actor隐私、候选不可改写和单次修订上限。`.validation/reading-scope-rust-regressions.log`。
- Go `-race -tags=integration,codexlive -count=1 ./internal/experience -run '^Test(ActualRustNarrative|ActualRustReadingScope|DeepBenchmark|Narrative)'`：169 PASS（含子测试）、12 SKIP、0 FAIL，41.388s。跳过项均要求明确的真实模型/封存来源实验配置；本次没有启用新模型调用。实际Rust的容量、提取修复、准备/询问、恢复取消控制均通过。`.validation/reading-scope-go-regressions.log`。

两次验证脚本中间尝试不计入上述通过：第一轮全Rust无channel测试覆盖了共享Cargo目标里的runtime，导致5个actualRust测试以 `requires --features channel` 失败，原始日志保留在 `.validation/reading-scope-go-regressions-runtime-overwrite.log`。修正时又在Bash尚在读取脚本期间编辑脚本，导致一次后续脚本语法错误与未配置runtime的测试尝试，保留在 `.validation/reading-scope-go-regressions-script-edit-incomplete.log`；该次wrapper最终退出1，不能以其中普通测试的PASS充当完整回归。随后停止修改脚本，独立固定channel运行时，从头执行上述Go命令退出0。生产源码未因这些工具问题改变。

已向协调者报告SOURCE STABLE，可用同一正式源码冻结后续paired review与真实故事运行。这里只证明段落范围与既有安全/提交边界，不证明模型遵守新增授权规则、不证明章节已经更好看，也不把24段当填充目标或把评估端900–1400汉字建议送进产品。
