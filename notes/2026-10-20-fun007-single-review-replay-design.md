# FUN-001/07 固定首稿、首审稿阶段配对实验设计

作者：benchmark_harness 独立 agent。状态：独立 evaluator 已实现并通过来源、等值、固定配对控制及实际 v4.4 Rust 零模型调用预检。没有改产品源码、运行正式故事或调用新模型。真实两次调用须等待 v4.5 与 evaluator 同时冻结。

## 观测对象与实际来源

来源目录：`.validation/deep-benchmark/20261020T025916Z-countercontrol-v44/FUN-001`。167 个事件完整哈希链、终结事件及 root 已逐行核对；root=`d9d249b6ac607519a3e4342d2d7903cc1057615cbc791cab29039db0a7a88f58`，events 文件 SHA256=`aac912428579801a96227cafedf0fb3a487d5de59c5e727903e669dbf20d535a`。原正式历史只提交至 06/revision 7，07 失败；实验不能改变此状态。

| 内容 | 原事件 | 字段 |
|---|---|---|
| 06 正式最新页与权威快照 | seq 134 | `data.public_view`、`data.snapshot` |
| 07 玩家本步授权与 before | seq 135 | `data.request.input/mode/expected_revision`、`data.before` |
| memory 上下文和 scene | seq 136/137，call 41 | request 唯一 user JSON；result.text 解码的 `result` |
| actor 输入与提议 | seq 139/140，call 42 | 角色受限投影；result.text 的 `result` |
| 计划与评估 | seq 142/143，call 43；145/146，call 44 | 原 plans 和 evaluations，供当前 Rust 同算法选计划 |
| 原首稿 | seq 148/149，call 45 | `result.text.result` 的 draft 五个正文元字段 |
| 原结构候选 | seq 151/152，call 46 | `result.text.result.candidate_json` 原字符串、解码 Candidate |
| 首次审稿输入与原结果 | seq 154/155，call 47 | request 原系统指令、唯一 user、schema、model、max_output_tokens；result 原字 |
| 后续失败保留 | seq 158、163/164、166/167 | 原 revise、第二审稿、operation_failure、run_end，仅历史证据 |

来源提取脚本 `.validation/fun007-stage-source-map.py` 已独立验证：seq154.context 精确等于 seq136.user 删除 read_budget 后的对象；scene 等于 seq137；actors 唯一项等于 seq140；candidate 等于 seq152；candidate 的 title/passage/story_time/outcome/suggestions 等于 seq149；selected_plan 在 seq143 原 plans 中。seq136 的可见 state 对象是 seq135.before 的逐项子集，历史只有 1 页、history_complete=false，完整权威状态不得偷塞到 review 输入。

用户 07 原话：“调柜旁走廊记录，核对余是否真的一直待在办公室。”scene 明确“本段不擅自开筒”；selected_plan 明确“开筒及后续归责留待下一步”“文件筒仍未打开”。actor `investigator` 却提议“依批准范围尝试打开其防潮文件筒”。seq155 报 `actor_action_not_executed`，要求实现该提议；seq158 修订确实开筒；seq164 又用 `selected_plan_scope_violation` 拒绝。后者未获正式提交。

不能把问题表述为“此前没有主管批准”：r7 已有 `tube-search-approved-r7` 正式事实。实验检验的是“有世界内许可”是否被误当作“玩家本步选择执行”，以及 actor 提议是否被错误升格为上位命令。原首稿也有独立问题：主管直接复述此前否认，未展示知情传递。新审稿合理结果可以仍是 approved=false，不能把通过设为目标。

## 最小实现路径

优先复用 `narrative_review_repair_integration_test.go` 的 `recordedReviewReplayModel` / `recordedReviewAudit` 模式：当前真实 Rust runtime 与 Go `Algorithm.GenerateWithReads`，前六个阶段使用封存的原 `model.Result.Text`，不重新生成。每个新请求核对 stage/actor/唯一 user/schema/model/输出预算；只允许当前产品生成的 system 指令发生变化，并把新旧 system 原字和哈希单独保存。

捕获当前 Rust 生成的第一个 review 请求时，先比较 `candidate/actors/context/scene/selected_plan` 与 seq154 完全相等，再有意终止这次 Algorithm 捕获调用。随后在同一当前修复版 CLI 上按预登记顺序先调用原 v4.4 request 一次，再调用捕获的当前 request 一次。旧结果的 approved/拒绝/无效正文均不改变新调用是否执行；只有底层连接、完整性或证据写入失败才中止。审稿结果不送回 Algorithm，因此不会启动 revise/repair_review/第二次审稿。整个实验不构造 Service、不打开 DB、不调用 Apply 或正式提交。

这比 `narrative_engine_replay_live_test.go` 更小且适合本目标：后者只支持另一个固定场景的四版历史，会重建展示元数据、写隔离 DB、运行 preparation/read/ask，不能直接称作 FUN 原首稿单阶段对照。`deep_benchmark_quote_bridge_live_test.go` 可复用完整源链验证、独占输出文件、源字节副本、一次 CLI 及事件写法；其固定 NAR001 seq25/call8 的解码器和“必须通过 approval”判定不能直接复用。

Context 从 seq136 原 memory user 严格恢复：校验并去掉派生 `next_revision`；`historical_recalls` 必须为 []，映射到 `recalls:[]`；保留原 `read_budget`、partial state、source_handle、短 history、preferences、input。`AuthorityState` 取 seq135.before，只供 Go 原 actor 投影/本地校验，不能改 review 可见 context；必须等于 seq134.snapshot。原流没有同操作回取，若新捕获需要 ReadRequest 则 BLOCKED，不补猜历史。pipeline(version1/maxActors2/maxRepairs1)、ContextTokenLimit65536、输出8192与调用预算12须从源 manifest+当时冻结 live evaluator 声明绑定；它们属于显式评估重建的未序列化配置，不声称原完整 Context DTO 已被录下。

## 记录与判定

使用独占新目录与冻结测试二进制/runtime/source-manifest，保存完整 source 原字、每个关键原事件 hash、六个 replay 输出原字、原/新完整模型 request、逐字段比较结果、新旧 system 文本及 hash、两份独立真实 model_result、耗时与错误、parse/schema/quote 检查。区分 `replayed_prefix_results:6` 和 `live_model_calls:2`；不能把重放计成六次新模型证据。

本实验结束状态是 REVIEW 或执行失败，不自动 PASS，也不要求 approved。独立审读比较：是否仍要求执行 input 未选择的 actor 提议；是否保留真正的知情来源等缺陷；是否把一般许可、旧目标或 actor 愿望升格成本步玩家决定。比较所有 issues 的语义及精确引用，不能靠 `actor_action_not_executed` 字符串消失就判修复。

模型只收到生产 system 与封存 user/schema。原错误 review、目标结论、基准期望、评分、未来步骤、这个设计文件都不能进入模型上下文。原失败全保留。原源失败使用旧 CLI bridge，不能直接把新旧差别归因于提示词。因此新增同一修复版 CLI 上 old→new 固定顺序配对，唯一实验变化为产品 system prompt。仅有一对随机模型输出且顺序固定，仍不能证明提示修改的统计因果或完整 FUN 轨迹已修复。

## 最小回归

完整源链/根/终结、case-step-call-stage、请求返回对应、原 candidate 与 extract/draft 一致、authority snapshot 与前一正式页一致均先做正负控制。捕获路径测试原前缀的第七次请求确为 review，且除 system 外全部相等；candidate/context/actor/selected_plan/schema/预算任何漂移均禁止真实调用。乱序、额外演员、ReadRequest、第三次 real call、现有输出目录都拒绝。每个 variant 的 review 无论 approved true/false 都只记录一次，不得触发 revise 或 DB。实际结果再另做 model_review，不冒称真人盲评。

## 实现与零调用验证

实现独立于产品：`backend/internal/experience/deep_benchmark_stage_replay_live_test.go`。来源解码的 portable 合成事件只测试证据管道，不是叙事质量样本。RED 阶段的 prefix/pair stub 已复现六个预期失败；实现后正负控制全绿。固定 prefix 第七次请求有意返回错误，原 review result 从未回放，任何第八次请求及新增历史读取都拒绝。两个 live variant 在调用前一次性比较，旧响应即使明确拒绝或包含无效正文仍会执行新调用，不选择性留样。

`-race -tags=integration,codexlive -run TestDeepBenchmarkStage -count=1 -v` 加显式原来源目录及实际冻结 v4.4 Rust SHA `5a742da141fad59e2ab99c234f63716b1a97fa876498965d34cd6dbbf7ef7007` 已通过，日志 `.validation/stage-replay-preflight-v44.log`。实际原源重建 7 阶段、回放 6 结果，所有非 system 数据等值；`system_changed=false` 是使用原 v4.4 Rust 的预期结果，新 live 入口会拒绝相同 system 而不消费模型调用。真实 v4.5 runtime 还需要新冻结后预检。没有据此判断新 prompt 语义效果。

Live 使用 `ELSELIFE_STAGE_REPLAY_SOURCE` 指向原 FUN-001 目录；`ELSELIFE_STAGE_REPLAY_DIR` 必须指向尚不存在的证据子目录，父启动器先冻结源清单/测试二进制/runtime，不能预建该子目录。需要 `ELSELIFE_TEST_RUST_RUNTIME`、`ELSELIFE_STAGE_REPLAY_SOURCE_SHA256`；可提供 `ELSELIFE_STAGE_REPLAY_RUNTIME_SHA256` 作为额外实测 hash 对照。evaluator 流式复制 runtime 到证据目录并实测 SHA，随后只从该副本启动。源 root 和事件 SHA 在 live 路径额外固定为本设计注册值。新旧 system 原文分别写入 `old-system.txt`/`new-system.txt`，完整 source 原字、capture 请求、配对请求/结果、诊断和 sealed root 均保留。

单独 `TestDeepBenchmarkStageReplaySourcePreflight` 不调用模型；live 入口是 `TestDeepBenchmarkStageReplayLive`。其他全套回归务必清空所有 `ELSELIFE_STAGE_REPLAY_*` 环境，避免误开启显式实验。预检仅使用既有原源；不得把本设计、原审稿错误、评价准则或未来步骤拼入任一模型请求。完成状态 `COMPLETED_REVIEW_PAIR` 只表示两份结果完整留存，不等于 case PASS 或 approved。
