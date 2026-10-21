# 有限上下文文学记忆实施计划

2026-10-20。用户已批准执行 [设计](../specs/2026-10-20-narrative-memory-design.md)。在现有未提交工作区实施，不另建会丢失这些改动的检出。

## 目标和实现边界

从完整的固定版本数据库状态取材，避免旧人物依据被生成视图裁掉；以有来源的局部记忆变化代替整本笔记重写；逐阶段重新编译有限材料，保留原始页并禁止作者摘要泄露给角色。数据库正式版本、分支、租约、提交与知情仍由 Go 负责。

第一版使用现有 PostgreSQL JSONB 版本快照保存派生文学索引，保持备份、分支和恢复的原子语义。索引不作为世界事实，不复制到读者视图或模型入口。索引同步随正式提交生效，因此水位与正式页一起推进，没有独立后台发布竞态。原始页保持不变，后续可将相同接口移至独立派生表。

## 固定接口

`State.literary_memory?: LiteraryMemory`：

- `version: 1`, `indexed_through_revision: integer`, `entries: MemoryEntry[]`
- 条目字段：`id`, `kind`, `subject_ids`, `target_ids`, `cue`, `summary`, `status`, `retrieval_keys`, `fact_ids`, `quote`, `source_revision`, `source_sha256`, `updated_revision`，以及可选完整旧来源链 `prior_sources`
- `kind`: `disposition | goal | relationship | episode | commitment | expression | object | thread`
- `status`: `active | resolved | revised`
- quote 为创建/更新时正式正文中的连续原句，Go 验证并写入 revision/hash；不接受模型授予可见性。索引全部作者可用；actor 只取正式 known_by 事实原文。

`Candidate.memory_changes?: MemoryChange[]`：条目字段去掉 Go 写入的 `source_revision/source_sha256/updated_revision`。每次最多 12 条，引用本页原句，局部按 ID 合并，没有更新的条目继续保存。更新不允许绑定另一组主体；允许记载反例和关系变化。历史快照保留旧版本。ask 禁止变化。旧 `narrative_update` 兼容；新 pipeline 提交 `memory_changes`，不再要求完整 notebook。

`ContextNeeds`：`participant_ids`, `relationship_targets`, `topics`, `open_questions`, `fact_ids`，各为有界 string 数组；memory 阶段 `SceneFrame.context_needs` 可选兼容旧记录。模型需求不授予访问权限，也不证明人物在场。

Go `ContextBundle`：`stage`, `actor_id?`, `base_revision`, `facts`（actor 使用安全 DTO）, `memories`（仅作者）, `coverage`（查询范围、返回/省略、未查询与不确定提示）。以当前 operation 固定的完整 state 为数据入口，原文补查沿用 SourceReader。每阶段按场景/候选重新选择、去重和计量，不沿用无限累计的回取文本。

实施复审补充：`MemoryMaterial.prior_source_count` 记录旧来源总数，`prior_source_revisions` 最多提供 32 个选中页定位；source 粒度也允许只装入部分完整旧原句，并用 `requires_source`/coverage 显式标明。需要复述或裁定的旧依据尚未提供时才补读，不机械要求重读每段旧文。持久来源链和归档验证保持完整，模型工作材料与数据库的大小限制分开。

Go 编译器选择实际消息，Rust 控制阶段与候选结构。Go 验证 actor.used_fact_ids 属于实际发送包；Rust 对完整当前视图继续验证可见 ID，对被省略且由 Go 注入的 ID 延迟到 Go 验证，不伪造回取记录。writer 和 reviewer 从各自需求构建材料。

## 工作包与所有权

1. **存储与合同**：新增 Go 文学记忆类型/验证/局部 apply 与源文 hash；扩充 JSON 合同并更新四端快照和 hash；剥离读者私有内容。先写原文不符、无更新保留、分支历史、ask 禁止、无权授予知情等回归。负责 `literary_memory.go/_test.go`、共享合同生成工具；修改 `types.go` 时只处理 Memory 字段与 apply 调用。
2. **取材编译与 Go 阶段接入**：新增 `context_materials.go/_test.go`，改 `generation_view.go`、`narrative_pipeline.go`，从完整 authority 获取 actor 自身/关系/约定依据，阶段预算、独立 reviewer、局部提取、输出引用绑定。先复现旧人物事实被裁掉。不修改 SourceReader/algorithm/合同。
3. **Rust 阶段协议与写作**：新增类型与验证、SceneFrame 需求、局部 memory_changes、阶段受限补查及调用预留；修改提示以目的/关系/情境组织自然表达，不强制回忆或口头禅。负责 algorithms/src 和 Rust 测试，不改合同生成/hash（由工作包 1 统一）。
4. **根代理整合**：源回取按阶段授权、原文读取与审计、DB/sqlc 定点查询、运行时容量与回取预算、跨层集成回归、前端合同兼容。保留用户改动，协调接口。

## 测试与验收

- Go：裁剪后仍取回旧自我依据；没有关键词重合的关系/未了事项；权限先过滤再排序/计数；未知不等于不存在；预算不足不截断句义；review 根据候选重新查证；不可跨分支/版本读取；旧笔记绝不成为 actor 知识。
- 存储：正式页提交才生效，局部更新、来源 hash/quote、ask、旧档兼容、恢复/分支保留；不把未采用意图写成既成事实。
- Rust：全部阶段形状、实际调用上限、必要后续阶段预留、非法补查失败、固定 draft、候选审稿绑定与现有 epistemic 回归。
- 合同：四端字节、hash、Go/Rust 类型与 JSON 拒绝未知字段一致；运行现有 Python 合同套件、Go/Rust 套件和相应前端检查。
- 真实模型：固定前史/输入/预算，对比现有与新材料，保存所有输出和材料来源、输入字节、调用数；失败照实报告。固定模型测试只证明工程行为，模型审稿不等于读者文学验收。
- 最后独立审查，解决来源/权限/预算/数据丢失问题，再报告实际完成范围及未验收项。

## 执行记录

实施前工作区已有大量未提交叙事引擎 v4.8 改动；不得以 git HEAD 差异认定全部为本次变更。现有环境通过 WSL Go/Cargo，数据库本地已启动。所有生成日志留在忽略的 `.validation/`。

实现与实际验证进展见 [实施记录](../../../notes/2026-10-20-narrative-memory-implementation.md)。独立复审补齐了跨阶段引用承接、原始来源链、摘要降级后的页定位，以及审稿重复证据的预算计量问题。作者索引关联不能合法用于 actor 排序；已知更正的遗漏风险与检索协议缺陷分别核查。
