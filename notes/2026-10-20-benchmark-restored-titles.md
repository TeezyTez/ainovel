# 恢复证据的逐版标题与 legacy 边界

原缺陷：`seedDeepFixture` 把来源每一版 SQL page.title 与最新 branch.title 都写为“合成世界初始记录”。正文/快照相同并不意味着标题被忠实恢复。新增真实隔离数据库测试先复现 latest title 被替换，再验证恢复两版不同标题、初页独立读回、旧 SQL title 漂移与最新 branch title 漂移拒绝。

新的评估证据版本为 v4。`deepReplayPage` 的 title 与 title_provenance 从各源 `initial_readback.public_view.title` / `operation_committed.public_view.title` 取得，已提交版本必须有原标题，不能从正文猜测。seed 写入逐版 title 及最新 branch title；`readDeepRestored` 独立 SQL 读取所有 page.title 与 branch.title，并核对当前 View.Title，记录 `stored_titles`、`branch_title` 与 `title_binding=source_public_view_title_v1`。状态、原始页与公开资料 metadata 迁移规则保持严格。

新初页 helper 直接读取 SQL revision 1 的标题；没有复制当前最新 View.Title、UpdatedAt 或 Operation 生命周期。旧 v3 初页投影缺失标题时，只允许 revision 1 使用当时初始化器的固定标题，并明确 `title_provenance=legacy_initial_title_unrecorded`。这是假设性恢复值，不冒称源已记录。未来 v4 缺初版 title 也拒绝。

独立 Python核验按新源事件重算 title/provenance，要求 manifest 的每一页、SQL titles、SQL branch/current View 及初页独立读回一致。错误源标题、改写旧 SQL title、占位最新标题、分支 title、缺绑定与缺已提交 title 均有负控制。旧 v1/v2/v3 的原字证据不修改，其既有核验兼容，但 `resume_titles=LEGACY_NOT_VERIFIED` 且明确提示历史标题可能仍为合成占位，不能追认已通过新核验。初版源缺失的新恢复返回 `VERIFIED_COMMITTED_INITIAL_LEGACY_UNRECORDED`，保留局限。

SYS-014 的独立币制 supplement 也调用同一标题核验，以确保原世界恢复副本没有标题丢失。它仍不把 S05 旧 BLOCKED 改成通过，算术语义仍需新正文独立审读。
