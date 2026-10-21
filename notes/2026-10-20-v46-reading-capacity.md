# v4.6 阅读续写的容量失败：独立封存回放

来源 `.validation/deep-benchmark/20261020T041218Z-v46-reading-resume`。两场前一失败步骤均已生成并正式提交：NAR-014 S05→r6（9 次模型、249885ms），NAR-017 S04→r5（8 次模型、239166ms）。下一世界步骤分别在 S07、S05 以 `context_capacity` 失败，均 0 次模型、13ms；这不是新抽取格式失败或模型内容拒绝。

NAR-014 S06 的 polish 使用 1 次真实模型，17880ms，`applied=false`、`read_only_verified=true`、偏好仍为空。它没有把改写稿写回正式页，下一步仍使用 S05 的原正式正文与 r6 snapshot。

| 来源 | root SHA-256 | events 文件 SHA-256 |
|---|---|---|
| NAR-014 | `2286b1d6535f17a4a59d1679548074b64f9294ce36b0dc3c58a737c03dd8ecdb` | `c6c0165fdfed92aaf0a5972f625cd8e4e7dfeec3f181e6b071d8eab962fc9c47` |
| NAR-017 | `f3306ffdff22e58b85e8ef490c2300728a23d1bc439bf0d397231e51e4f7fab7` | `b56029d5824f8466fb58b499ee55152c238ce62c0d6b913272ee34e0be71bc06` |

`narrative_recorded_capacity_diagnostic_test.go` 读取并校验这些固定 SHA，从原 memory 请求取得原 seed/偏好/身份，再使用正式提交 snapshot、所有原 HistoryPage 与失败步骤的实际 AdvanceRequest 重建 `Service.buildContext` 同等输入，并明确补回该构造器设置的 `Pipeline{1,2,1}`。没有使用候选、polish 稿或压缩正文。测试调用与 `Service.buildGeneration` 同样的最小必要证据探针：当前 authority 作为未变化边界、recent=当前版本。

| 序列化组件（字节） | NAR-014 r6 → S07 | NAR-017 r5 → S05 |
|---|---:|---:|
| 完整正式 State（诊断 Python 紧凑 JSON） | 21797 | 16204 |
| 完整笔记（Go 序列化） | 7660 | 5901 |
| 最低投送 State（Go，含完整笔记） | 13082 | 11065 |
| 其中必需 facts | 4186 | 4181 |
| 最新完整 HistoryPage | 2822 | 5577 |
| 其中正文 UTF-8 | 2767 | 5502 |
| coverage 元数据 | 263 | 263 |
| 最低完整 Pipeline Context | **16696** | **17605** |
| 65536 窗口 / 8192 输出预留下的旧40KiB编译容量 | **15522** | **15522** |
| 超出 | **1174** | **2083** |
| v4.7 34KiB预留的真实容量 | **21666** | **21666** |
| 新路径实际保留 Context（含更多完整旧页） | **21086** | **19820** |

根因在模型调用前的容量分配：流水线对每一阶段统一保留 40KiB，扣除输出、包裹与传输后仅余 15522 字节。即使已经采用最小必要证据，最新整页、完整笔记、规则/秘密、开放线索前提和最新版本事实仍放不下。最近窗口自适应不可能补救这一最小边界失败；不能靠截断正文、改笔记、删除权威事实或增加模型窗口使回放通过。

准确对照 `.validation/recorded-capacity-green-20261020T042639Z.log`：旧40KiB共享预留在两例均严格复现 `context_capacity`；当前34KiB真实路径均通过，`-race` 1.390s。测试另断言完整 authority 不变、笔记和最新页逐字段不变，全部已加载事实和知识边原值不变，必需事实仍在。运行方式为设置 `ELSELIFE_RECORDED_CAPACITY_ROOT` 指向上述目录，再执行 `go test ./internal/experience -run '^TestRecordedV46ReadingContinuationCapacity$' -count=1 -v`。缺少本地封存资料时明确 SKIP，不声称已运行。

保留诊断更正：最初 `042237Z` 红测、`042501Z` 的所谓 green 尝试漏掉 Pipeline，因为 Rust 的 memory 投送视图不包含该内部配置，误走 legacy 32KiB+9000 路径。因此此前 14855/16640/17549 数字不能作为 narrative pipeline 的实际计量。另一随后新增断言误把输入“订单”当作完整实体名“迟交订单”，超出了当前精确字面识别规则，已移除；不是为付出容量而从生产删除事实。已封存的真实零调用失败不依赖这两处诊断构造错误。测试现在显式断言 Pipeline 非空，旧40KiB对照使用当前容量扣回6144字节；默认512KiB carrier与1MiB frame远大于模型窗口限制，不改变绑定项。

根代理正在量测的最小修复方向是去掉 review/repair_review 输入里的 scene、actor proposals、selected_plan；保留原请求、完整权威 Context、完整冻结 Candidate 和独立审稿。提案不是必须发生的事件，删除这些重复、非权威提案本身没有发现语义阻断，但已发生事实、承诺、知识来源及授权必须继续由 Context/Candidate 提供。新统一预留只能建立在全部阶段、各 carrier、strict 转换及最大合法输入的实际容量证据上，不能仅因本表两例需要多约 3KiB 就降低常数。

本记录只验证结构/容量边界，尚不表示修复后真实下一章能够生成，更不表示两整例或文学质量已通过。
