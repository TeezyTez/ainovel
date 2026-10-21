# SYS-005 取消恢复：独立证据审读

2026-10-20。对已封存真实模型运行作只读独立核验，没有采用生成器 review 作为叙事验收，也没有新增模型调用。

运行 `.validation/deep-benchmark/20261020T032059Z-sys005-cancel-resume/SYS-005`，38 条事件根 `d23e3f4739860ded53f60c9bd2558384db2b44b8cc3a7a87f55c8c75195228ae`；events SHA-256 `a79e21cc433465f16ff1aa90ad968b97221a8f40d37ce2fd0b7191ee097507b1`。源树 `8803384a8463344af8a4f8962cd08d465c6ba6358cf8ef781da6a433c59d818c`，运行时 `0f08f42796ccf4ce2073ab021340b941933ce3d1328fee3bf20447157832898a`。事件链与末条根重新计算一致；run_end=REVIEW，不是全案例人工 PASS。

源是 `20261020T025116Z-boundaries-v44/SYS-005`，根 `c59d7da80a93c3cc17361fe5ebc988474f0df8cca42902478499b4ab57fe6296`，events SHA `efd02a23259348ed381a8623e928ca2c680ab83b70b42eeb0ba51dc07d1014eb`。新目录复制的 source-events、source-fixture、source-root 均与旧文件逐字节相同。seq2 的五组 page/state 等于旧 initial/r1 与原正式 S01/r2、S03/r3、S04/r4、S05/r5；seq3 的五个 stored_pages 逐对象等于旧原页，五个 SQL snapshot 逐对象等于对应原 State。seq11 恢复后、seq36 取消后全部五版 snapshot 仍一致，没有只检查最新一版。

原 S02 observation 没有在 r5 重执行：新 seq6 指向 source event_seq=26，包含其完整原 data，并仍是 r2。其 public_view、snapshot、step 与 source26 全部相等。

公开投影迁移仅在五页的 reader.information、当前 Reader/Information 为可见 fact 加入 recorded_revision=对应该版 Fact.SourceRevision；逐页重建预期后完全相等。正文、建议、时间、既有信息文字与关联、record 展示值没有其他变动；当前 Reader 等于最后页 Reader，当前 Information 等于其 information。**整个顶层 View 并非逐字恢复**：恢复器重建 updated_at、未导入旧 operation，并将经历 title 从“收起的文书”重设为“合成世界初始记录”。这属于本回放恢复壳层的已发现差异，不应混写成“整个 View 只变 recorded_revision”，也没有影响原五个正式页和状态。后续 control 内部 title 不再变化。

取消控制因果顺序可核对：

- seq10 记录 r5 前置历史及 read 请求；seq11 使用新 Service、新 DB 连接实际执行 RecoverExpired 并读回五版历史。明确 process_restart=false；不是杀进程或离线恢复实测。
- seq12 新操作 pending，base_revision=5。真实模型按 memory→actor→plan→evaluate→write→extract→review 共 7 调用。
- seq32 review 原输出 approved=true、issues=[]；独立检查 4 条 facts 和 11 条 knowledge 支持完整唯一、均为精确正文子串。此时仍未完成 Go/Rust 候选审批，seq34 正确保留 candidate_commit_eligibility=not_established。seq34 的候选与 seq29 原提取一致，request/result 与 seq31/32 一致，没有替换成预制内容。
- StageObserver 在 `deep_benchmark_cancel_test.go:250` 的 pipeline.after/answerModel 前阻塞；seq34 operation=generating。seq35 通过真实 Service.Cancel 得到 cancelled 后，源码273才放行原模型响应继续执行。seq36 在该新 Service 上再次读回全部历史，operation=cancelled 且无 committed_revision，所有正式页/状态仍 r1–r5。control 内 View 只更新 operation/updated_at，其他字段不变。
- seq37 S07 是对 seq36 已完成实际读回的 view/state 原样记录，二者相等。S07 自身没有另启 Service 或再发 SQL；实际新 Service 读取发生在 S06 helper 的取消后核验（源码300），不能将 observation 标记当成另一轮恢复实验。

本次取消候选标题“柜台前的茶香”，正文只写熟客问绿茶/红茶及浓淡，表示先看看，**尚未下单、未冲泡、未收付**；现金仍 4 枚，故事仍 16:00。候选新事实是茶品答复、浓淡询问、泡淡答复与未交易状态，均未进入正式历史。没有预设签字或收款，也没有为了满足测试构造此类模型输出。因此，这次覆盖真实候选生成后取消且正式历史不变；“候选实际写出签字/收款后仍不得提交”的内容分支未由这次真实样本覆盖。相关固定候选工程测试可验证机制，但不能替代该真实内容分支或全文文学质量验收。

S06 记录耗时 133422 ms、7 次模型调用；S07 为读回 observation，无新增模型调用。原前缀真实模型成本不重复算作本次新增成本。保留原 run_end=REVIEW 与完整来源，不将恢复成功、精确支持引用或模型 approved 宣称为全基准 PASS。
最小后续修复建议（本轮未改共享恢复代码）：在 deepReplayPage 显式保留并校验每条源 initial/operation_committed 的 View.Title；创建对应 SQL page 时写该版本真实标题，恢复最新 branch/experience 标题时用末条原 View.Title。对原标题不同的多个版本增加读取/恢复回归，证明标题没有统一回退初始文案。updated_at 是新数据库生命周期时间，旧 operation 是旧运行活动记录，二者应在恢复 manifest 明确列为重建差异；不要为追求字面相同复制旧 pending/generating/committed operation。该标题修复不应扩大 recorded_revision 迁移白名单，也不更改正式正文或 State。