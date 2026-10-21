# 公开事实的历史记录版本

本次问题来自真实模型 SYS-006 运行，而非假设：`.validation/deep-benchmark/20261020T025116Z-boundaries-v44/SYS-006`，根 `63d1d3a8183a9cf2a507b964e8acc1df283163212150a9d41386ae68dbc0ea83`。正文已经正确接信、获知离城日期并等到霜月12日；资料却把旧“当前为10日”“尚未阅读”与新事件并列，未说明旧表述所属记录。完整独立审读见 `2026-10-20-sys005-sys006-v44-model-review.md`。

## 修复范围

- Go 的公开 `Information` 增加可选 `recorded_revision`，只在通过原有 `ReaderState` 权限投影后，携带事实原本的 `SourceRevision`。旧事实原文、世界状态、已提交页均不重写。
- Flutter 用“记录版本 N”或无版次时的“历史记录”标注事实；详情解释“记录版本不代表获知时间；历史表述需结合后续正式记录理解”。不会从旧表述推断最新状态或把仍有效的规则判为失效。
- `recorded_revision` 与公开原文的 `source_version` 分开。隐藏事实原建档于版本1、版本3才被发现时，不能拿1冒充读者已看到的原文来源。游戏资料覆盖层双向保留新字段。
- 这是 Go→Flutter 的公开展示 DTO 增量。模型共享 JSON 定义没有 `Information`，本次不修改候选、权威 State 或 protobuf 字节。
- 基准恢复对旧页的派生 reader 投影作显式、受限迁移；原来源事件、存储页和快照仍保留并校验。只有与各版可见事实原始 `source_revision` 相符的新字段可增加，其他变化仍拒绝。

## 验证

Go 的历史记录版本用例先失败于实际投影缺字段，再通过；负控制覆盖隐藏主体及没有可靠版次的旧记录。Flutter 五个新用例覆盖隐藏记录首次公开的页码、旧API、游戏资料覆盖、资料简表和浏览器两种展示，先红后绿。

前端完整测试 **302 passed**，日志 `.validation/fact-history-flutter-full-green.log`。之前的全量记录 `.validation/fact-history-flutter-full.log` 保留了一个旧展示断言失败：它仍期待无历史标注的文字；调整为新展示文案后完整重跑，未删除对象范围、分支、版本或引用断言。静态分析为0 error/warning；首次分析161条info中的一条是新增测试的可空语法提示，已按Dart写法修正。

独立真实 PostgreSQL 回放使用封存 SYS-006 的全部5个正式版本，包含原始 page/state JSON 字符串、哈希与来源根。`Service.Get`、`ExportReader` 和在旧节点的真实 `Fork` 均确认：当前是12日，旧日期带记录版本1；信的建档版本为1，但版本1旧页/旧分支没有这条秘密，版本3才可见。读操作和分支创建前后，原分支入库后的 JSONB 页/快照字节完全相同。日志 `.validation/reader-history-replay-20261020T030718Z.jsonl`。这属于真实生成材料的工程回放，不是重新生成的文学质量证据，也不补足离线72小时或原题霜月2日节点等未执行步骤。
