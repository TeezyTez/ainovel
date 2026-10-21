# v3 恢复投影与取消证据接线

作者：独立 benchmark_harness agent；方法为工程测试与模型辅助核验，不是真人评审或叙事验收。

## 公开记录版本迁移

产品新增可选 Information.recorded_revision 后，Service.Get 会按每版历史快照重新派生 Page.Reader，旧来源页不再与新公开投影直接相等。评估端现在写 evidence_version=3；旧 source-events.jsonl、source-root.sha256、source-fixture.json 原字保存。恢复先从 SQL 直接读完整 stored_pages，精确比较来源 Page；再核对每版 State，并用显式 information_recorded_revision_v1 迁移比较当前公开页及顶层 reader/information。

允许的唯一变化是在 reader.information 公开事实条目新增 recorded_revision。公开 ID 为 fact:<事实ID>，值来自同版 ReaderState 可见事实的 SourceRevision，不能使用当前页版本或首次公开版本。原正文和其他字段必须相同；旧错误值（含显式零）、隐私事实或隐藏主体、缺原 reader，以及被类型解码忽略的未知字段都拒绝。Python 使用完整对象复制比较，Go 先严格解码原始 source page 避免忽略未知字段。旧 v1/v2 证据保留原验证模式，不伪称其曾执行 v3 迁移。

测试先复现新合法投影被旧完整页比较拒绝，再修复。真实隔离 DB 回归验证旧 persisted Page 仍无此字段，而新 Get 的历史页增加正确 source_revision；发现并修复事实公开 ID 前缀映射。负控制覆盖正文、reader 其他字段、错误记录版本、stored 原件修改、缺迁移标签、初页/顶层投影漂移，以及事件顺序变化。

## SYS-005 S06

live 已调用独立 frontend_regression agent 的 runDeepRestoreCancel。只绑定 SYS-005/S06 原 harness 步骤，不把此能力泛化为其他原题控制。真实新 Service / DB 连接 RecoverExpired，保留全部已提交页和所有历史快照；真实空 read 在 review 模型返回之后暂停，真实 Cancel 后放行原返回。候选资格固定 not_established，不能将 review 暂停称为已经通过审批或可以提交。

Python 独立核对 control_request 与当前权威页/状态/全历史快照，恢复、pending、pause、issued、result 顺序，操作身份、原始模型 request/result 的事件序号和精确对象，唯一 user JSON candidate 原值，并比较取消后完整正式页、分支与全部历史 State。只有 operation/updated_at 调度元数据可变化。正式内容变化或未达 review 为 FAIL；缺来源或顺序则拒绝。S07 必须有成功 S06 才能执行。

源含 editorial 或取消控制这种非提交产物时，当前 Go/Python 都明确拒绝恢复，避免在后来最新段落/版本重做旧操作。SYS-005 fixture 的 omissions 暂保留第一次登记原字，以便 boundaries-v44 的完整 fixture 身份可精确恢复；当前能力变化以冻结源码、README 和实际事件为准，没有放宽 fixture 一致性。

## 验证

- Python 全测试：`python3 -m unittest discover -s tests -p test_*.py -q`，72 测试通过，14.855 秒。
- Go evaluator focused：`ELSELIFE_TEST_RUST_RUNTIME=.../20261020T025116Z-boundaries-v44/algorithm-runtime go test -tags=integration,codexlive ./internal/experience -run TestDeepBenchmark[PRCEFSLG] -race -count=1`，通过 12.841 秒；实际冻结 Rust runtime，非真实模型。该筛选排除了并行 agent 当时正在红阶段编写的 QuoteBridge，新 Live 因未给真实模型配置而跳过。
- 完整 Go TestDeepBenchmark 先遇并行新 QuoteBridge 的 `quote source reader not implemented` 红态，未将其隐藏或冒称全套通过。另一个 agent 随后完成该路径，root 负责统一全套验证。
- 对旧已封存 boundaries-v44 用新 Python native 再验，命令退出 0；结果另存 `.validation/boundaries-native-after-migration.json`，不修改原运行事件。工程完整性不改变原步骤 REVIEW/BLOCKED，也不产生叙事 PASS。

仍需真实新运行走到取消、独立候选内容审查与完整基准反事实；哈希链不是外部公证，也不替代真人读者验收。

## 恢复观察检查点追加修复

只读检查实际 SYS-005 来源发现：S02 原 source seq=26、revision=2；已提交前缀最新 revision=5。原恢复循环只跳过已提交步骤，会在 rev5 重执行 S02“核对最早停点15:20”，因此会错读检查点。该问题没有在新真实恢复运行前放行。

已新增 deepReplayObservation / restored_observation，保留完整原观察 data 与 source event_seq。live 在恢复循环中只登记原观察，不读取新当前版本来替代。Python 必须从独立核验的原 source 事件逐项比对恢复清单及标记；wrong seq、snapshot、current page 替换、重新执行/改判均拒绝；缺恢复标记 INCOMPLETE。Go 保留的是原 RawMessage 并核对原观察当时的全部正式页和状态，不能从晚些时候的状态重建。

另外复现 Go typed 解码对旧页额外显式 `recorded_revision:0` 的归零遗漏：Python 原字对象历史检查会拒绝，但 Go 原本可能将其解码为省略值。现所有 source 页面（含 observation）都先严格检查字段，显式值必须为正整数；该负控已先红后绿。

最终验证更新：完整 `TestDeepBenchmark -race`（明确使用冻结真实 Rust runtime，不配置真实模型 Live）全部通过，15.061 秒；Python 全 73 测试通过，16.346 秒。新增 QuoteBridge 单位测试已包含，不再排除。源码已告知 root 与 pipeline_review 稳定，后者接手完整后端包级 -race。旧 SYS005 source fixture 原字仍一致，来源 root 为 `c59d7da80a93c3cc17361fe5ebc988474f0df8cca42902478499b4ab57fe6296`，5 个原页均能独立推导 v3 允许的资料元数据。
