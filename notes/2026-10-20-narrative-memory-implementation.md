# 有限上下文人物记忆实施与验证

2026-10-20。对应用户批准执行的[设计](../docs/superpowers/specs/2026-10-20-narrative-memory-design.md)及[计划](../docs/superpowers/plans/2026-10-20-narrative-memory.md)。生产源码已稳定；整合验证结果继续在本记录更新。源码实现、模型实际返回和文学验收分别记录。共享工作区的 v4.8 知识传播及 provider 诊断见[其独立记录](2026-10-20-source-knowledge-implementation.md)，不能把整个未提交 diff 归为本次工作。

## 查明的生成路径问题

旧正式快照仍保留人物依据，但入口容量裁剪先省略它们，actor 又只能使用入口已经物化的材料。结果是人物的近期任务容易保留，而早先的目标、关系与表达依据在角色决策前消失。完整笔记的整体携带和整体重写，又将“长期怎样待人”与“刚才在做什么”混在同一容量边界。

这能解释人物为何容易被眼前任务塑造成同一种说话方式，不能独自解释所有生硬对白。选择了正确材料，也不保证模型会写得自然；人物目的、场合、对象和表达方式仍需要连续内容验证。

## 已落地的结构

- 正式原文、世界事实和分支版本继续由 Go/PostgreSQL 管理。`State.literary_memory` 是现有 JSONB 快照中的派生索引，随正式提交生效；没有第二套事实库。
- `memory_changes` 按 ID 局部新增或修订人物倾向、目标、关系、经历、承诺、表达、物件意义和线索。未更新条目保留。原句必须来自本次采用的正文，页版本及 SHA256 由 Go 写入。作者摘要不授予任何角色知情。
- 同 ID 更新保留 `prior_sources`。数据库回取和归档校验完整来源链；普通分支继承，改写来源页使依赖记忆失效，事实编辑清除无法证明仍有效的派生索引。旧档无该字段仍可读取。
- Rust 先提出本场人物、关系、问题及事实需求；Go 从操作固定的完整 authority/数据库取材，逐阶段重组 `ContextBundle`，不被最初缩略视图限制。
- actor 只得到其 `known_by` 正式事实的安全表示。权限过滤发生在匹配、排序、计数和分页之前；作者摘要、隐藏目录和全知原页不进入 actor。作者使用的文学索引关联也不能暗中驱动 actor 排序。
- writer 根据已选方案重新获得相关材料，actor 台词是可修改草稿。review 从实际候选重新取证。actor、plan、evaluate 的引用绑定实际发送材料；被采用的引用向后续阶段承接。
- 原文、摘要和定位提示是读取粒度，未入选不等于历史不存在。原文按完整句义取舍，不截断否定或条件。历史原句链及定位目录也受本次材料预算限制，存储链保持完整。
- 仅因主体/对象相关而找到的 active commitment 是候选，不能全部变成本场硬性依赖；原规则会随人物历史累积，把所有场景阻断在容量检查。现在仅显式 `requiredMemoryIDs` 不可省略，其余按预算入选、计入 `budget_omitted`，提前预留“可能尚有其他未了约定”提示。`history_complete` 仍为 false，不能由未入选推断没有其他约定。这里没有改变 actor 排序或人物采信语义。
- 原有知情审稿补齐先验证固定版本及内容，再在每轮阶段重组后、字节计量前去除精确重复副本。异值和伪造 pin 仍拒绝。
- 实际模型载荷仍受原有上下文、schema、frame 和 12 次调用上限约束；阶段内可受限回取，不累积所有已读原文到以后每一次调用。

主要实现位于 `backend/internal/experience/{literary_memory,context_materials,memory_sources,memory_invalidation,narrative_pipeline}.go`、`source_reader.go`、`generation_view.go`、`algorithm.go`、SQL/sqlc 定点查询，以及 `algorithms/src/{literary_memory,narrative_pipeline}.rs`。共享合同由 `tools/update_narrative_contract.py` 同步四份字节及 hash。

当前合同 SHA256：`4c52a8d9a9968320d545e14d1e0a511bc00d212e7a42b160d905f17f59ab98c7`。新增字段说明明确实体 ID 与自然语言关系描述的区别；此前来源窗口版本为 `718afb9922e1758fc5dca5f970cd9ea60b0273064ae2c302dcec2d18e89a1a00`。旧来源总数与至多 32 个选中页码分别表示；不把全量历史目录当成固定大小的材料。

最终 `context_materials.go` SHA256：`248688d2aa755390e40a642f7acde64570f870f921c011ecda92af8bac8cadb6`。包含有限原句/页码窗口、候选约定的容量处理和单次计量前去重接线。源码取材尾项落地后经验模块全套再次通过，1.025 秒。

## 真实模型材料对照

证据目录：`.validation/memory-comparison-qctLoW1g/`。同一个固定晚归场景，同一个 writer 提示及模型 `gpt-6.1-sol`，每组材料上限 8192 字节，无失败重抽或择优输出。

| 材料组 | 实际材料字节 | 观测 |
| --- | ---: | --- |
| 只保留近期情境 | 502 | 模型成功返回 |
| 人工选择原文依据 | 1747 | 模型成功返回 |
| 系统选择材料 | 1850 | 模型成功返回 |
| 相同系统材料改为摘要 | 1779 | 模型成功返回 |

四组总耗时约 99.8 秒。结果均留存。两个原文组明确重述“晚归发消息，不是固定归家钟点”的区别；摘要组通过“你发一句，我就先吃了”承接告知用途，与没有固定钟点相容，但未明确重述全部条件。仅近期材料组也写出了可读场景，不能据此宣布文学质量显著提升。

这是取材控制实验，未经过 actor、规划、正式数据库提交，也不是旧引擎逐字重放。实际输入字节不同，只是共同容量上限相同。模型适配器未提供可用 token 用量；结果中的零值不是实际零消耗。此前 `.validation/memory-comparison-W3EH78Jp/` 因 Windows CLI 临时路径配置失败，未产生模型调用，同样保留。

独立文学细读见 `.validation/memory-comparison-qctLoW1g-literary-review.md`。可观察到共同知识带来的省略和接话，也有将约定解释得过齐的风险；三组都提陶碗是同一吃饭场景的备选输出，不能认定连续机械重演。这不是盲评，也未证明跨场景稳定声音。未凭这一个场景修改生产写作提示。

## 完整真实流水线尝试

`.validation/memory-pipeline-ql2UIy7j/` 使用上述冻结 Rust 运行文件、固定 NAR-014 合成前史、实际 Codex CLI 和隔离 PostgreSQL。预定按 act→read→ask 执行，失败即停止。

实际只发生第一步 memory 调用：输入请求报告 13891 字节，约 10063 毫秒后返回 `model_failed`，正式操作失败，零新正式页、零已提交新记忆；第二步未执行。`memory-chain-audit.json` 明确 `write_then_retrieval_observed=false`。这次没有验证真实模型写入→后续取回链，不把 `LiteraryMemory!=nil` 或工程测试通过当作替代证据。

`live.json` 保留调用返回，`memory-live-0-inputs.json` 保存数据库原始审计，`memory-live-0-inputs-readable.json` 从实际保存的 ModelCallRequest protobuf 解码，而不是从全局 Context 推测阶段输入。`production-files.json` 绑定本轮关键生产文件。没有自动重试、换故事或挑选成功输出。

该次测试沿用的记录器只保存通用错误字符串，未持久保存底层安全诊断元数据，因此具体失败原因仍 unknown，不能断言进程退出、限流、网络或内存问题。后续已在本测试的模型装饰器中接入现有 `CodexFailureMetadata` 白名单记录，不改调用/重试逻辑，也不能反补本次丢失的诊断信息；该记录器仅完成编译检查，未以新模型调用覆盖原失败。

2026-10-20 08:59 UTC 完成一次独立 provider 诊断，目录 `.validation/memory-provider-probe-20261020/`。从上述保存的 protobuf 请求重建消息和 schema，模型请求为 13891 字节、SHA256 `76b3c330b9154d6b2b53586397f4ba21a467fb99e36f04a8c53a3780e65d988b`；原 model.Request 序列化未另存，因此不称为原始字节逐字重放。预先冻结 manifest，仅调用一次 Generate，未运行剧情提交。结果 `OBSERVED`，21594 毫秒，返回 memory 阶段结构；run seal 中五个证据文件的 hash 已逐项核对。Token 用量未观测，不能把适配器零值当实际用量。失败没有复现，原失败原因仍 unknown；这次只证明该请求能够独立返回，不能替代正式记忆写入→后续取回验证。已通知共享主线程结束信号，不并发追加调用，随后由其直接运行 NAR009/010/017 真实原题。

独立审查发现早期审计脚本只核对 ID、来源版本/hash 及可选原句，可能把“来源标记不变但摘要被反转”误判为取回成功。`.validation/analyze-memory-live.py` 现按 cue/summary/source 粒度验证全部保留字段、完整当前原句、旧来源原样子集及目录、数量与 `requires_source`；来源标记匹配和材料保真分别报告。10 项合成控制通过，先红日志 `memory-auditor-red.log` 保留。原失败目录只读复核且未修改，结论仍为 false。这些控制检验审计器，不证明真实模型记忆或文学质量。

## 首批连续原题及实体引用修正

`.validation/deep-benchmark/20261020T090058Z-memory-v49-serial/` 使用 085909Z 独立源码快照，三例串行、无追加抽样。共 23 次模型调用均成功返回；NAR-009 提交 S01/S02 两页，S03 失败；NAR-010 提交 S01 一页，S02 失败；NAR-017 首步失败。三例均为 `narrative_stage_invalid`，不能把 3 张正式页称为原题通过。

最终只读记忆审计在 `.validation/memory-deep-audits/20261020T090058Z-memory-v49-serial/audit-final.json`，三份事件 hash 链和封口均有效。NAR-009 的 S01 正式产生 `memory-chair-inspection-r2`，当前来源版本 2、页 SHA256 `161375d8579da5837667e03e89e90f7f4884df6970fed74119c02b7024325abf`、原句均有效；S02 的 plan/evaluate/write/extract/review 五份实际模型材料与该条目逐字段保真，模型均返回且 S02 正式提交。这证明该局部写入→后续取回→后续提交链被真实执行，不证明整例通过、模型确实据此决策、actor 召回或文学改善。NAR-010 只观察到写入→下一步保真请求，下一步未提交；NAR-017 没有建立链路。审计器的 8 项合成控制覆盖种子排除、同 ID 修订、失败/取消、时间顺序和分支边界，不替代真实结果。

三次失败均返回了自然语言 `relationship_targets`，而其类型语义是已有实体 ID。实际请求已提供相关实体，不能归因于 ID 不可见。旧共享 schema 仅声明非空字符串数组，memory 提示只称“关系对象”，未明确区分关系描述与对象 ID。`.validation/nar009-memory-reference-repro/` 在封存源码上重建 Go 入口并重放 NAR-009 S03：原返回 1188 字节被 Rust 拒绝为 `unknown_reference`，公开码为 `narrative_stage_invalid`；仅把 `relationship_targets` 改为 `["fq"]` 后可进入 actor。入口为完整的 16 facts/3 entities/3 pages，7187 字节；实际发送的阶段投影不完整，不可用其 coverage 代替 Rust 持有的入口状态。原 `request.experience` wire 没有单独保存，回放明确标为依据封存 authority/request/pages 的确定性重建。

最小修正包括：共享 schema 和 memory 提示明确 `participant_ids`/`relationship_targets` 使用实体 ID、自然语言关系放 `topics`；Go 对两个实体引用数组都以固定 authority 完成校验，补上 Rust 在入口不完整时延迟检查的边界。拒绝未知、错类型及仅存在于非权威入口的 ID，允许合法但被入口省略的 ID；不做姓名猜配，不增加重试、不扩大预算、不授予角色知情。生产 `narrative_pipeline.go` SHA256 `2c7913b02677eb8450f96a1a73807ecd9721a26d0822e8c6bc3529ab85bf5d9a`，Rust 同名文件 SHA256 `6b034e7842fb9d08aafdd320cfa78d7bf0f32c94ffb9246876ddc24320e8994e`。Go 12 子例中 8 个负控先红后绿、actor 定向通过；Rust pipeline 46 项与容量 5 项通过；Python 91 项通过。该修正尚待下一批真实原题验证，不把录制结果的单字段正控当作新模型结果。

## 工程验证记录

固定内容/模拟模型的测试只检验权限、结构、容量和持久化，不能作为文学验收。

- 来源链、普通分支、来源页改写、父分支不变、归档、固定 pin 和 actor 权限的实际 PostgreSQL 集成测试：通过，3.126 秒（来源链尾项补充后）。
- 最终合同下 Python 全套：91 项通过，23.118 秒，包含四端字节、hash 与材料粒度边界。
- Flutter 叙事阶段及读者上下文两组定向测试：20 项通过，`.validation/memory-frontend.log`。本次未修改客户端权威或新建客户端记忆系统。
- 独立来源窗口回归：cue/summary 保留旧页定位；72 个来源在 4096 字节预算内提供当前完整原句和有限目录；review/repair_review 的真实 before 路径不因累积旧原句而永久失败；持久原文链不变。4 个顶层测试还覆盖 40 条非必需 active 约定的有限选取，以及显式必需原句过大仍失败的负控。
- 实体引用语义修正前，Rust 默认完整套件及无默认功能 lib/pipeline 均通过，pipeline 46 项。当时冻结运行文件 `/tmp/elselife-memory-runtime-IyUeQlM4`，SHA256 `7072412cfdb3fa3ba43f9ac6ab3dc00e169e10c33fefedfef802ab2ec0a310aa`，内置旧合同 `718afb99…`；不能与新 `4c52a8d9…` 合同混配。未扩大容量或调用上限。
- 共享主线程中间快照完整离线回归：Rust 110/104 两套通过；Go 806 PASS、25 SKIP、7 FAIL（含父测试），失败证据 `.validation/backend-v49-20261020T082506Z/`。三组失败涉及原入口省略假设及旧 40KiB 对照的容量期望；主线程负责忠实迁移 `narrative_capacity_replay_integration_test.go`、`narrative_recorded_capacity_diagnostic_test.go`，不改变生产阈值或封存失败。最终整合结果尚待补记，不能把局部绿或中间快照结果称为最终全套通过。

## 已知边界

- 当前索引存在版本快照中，不是独立后台重建服务；老历史没有完成索引时明确标记缺口，不把水位推进到未检查的旧页。没有全面回填或向量语义检索。
- 来源定位只提供本次选中的页码；不宣称完整目录或所有语义相关旧事都已被发现。原页仍保存在数据库，必要时通过固定来源句柄补查。
- 自身日常事实可能在预算下挤掉其他已知消息。但作者索引将两条事实关联，不足以合法影响 actor 检索；明确请求与正式实体关联须单独检验。不能把所有 statement 升为高优先级，也不能以作者 `status=revised` 代替人物获知或改信。
- 共享主线程的独立 overlay 在 1800 字节材料预算下验证：明确请求 A+B、已有正式 `Entity.RelatedIDs` 关联 A+B 均取齐；未知关联不授知情；未授权与不存在引用同错误；三种私有记忆变化不改变实际 actor 输入。5 子例通过且源文件 hash 未变，见 `.validation/actor-belief-controls-20261020/findings.md`。这只是路由与非干扰控制。当前 Candidate 只能追加实体，不能更新旧实体的 `RelatedIDs`，也不能预埋未来事实 ID；动态关联仍依赖语义选择及受限回取，已有固定关联通过不代表长期更正召回得到保障。本轮未扩展该协议。
- `source_revision` 是事实记录版本，`known_by` 是当前授权集合，未新增“人物首次获知时间”字段。不同时间/分支通过正式历史和固定快照约束，不能凭当前集合倒推准确获知时刻。
- 源回取仍受单次与整段预算约束；超大的必要证据会显式失败，不截断原句或自动重试到合意结局。
- 本轮未进行长篇盲评或用户文学验收，未重启共享产品运行实例，未做生产部署。
