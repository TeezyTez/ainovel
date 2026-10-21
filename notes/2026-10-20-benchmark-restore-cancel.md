# SYS-005 S06 真实恢复与取消绑定

本轮仅增加评估侧 `backend/internal/experience/deep_benchmark_cancel_test.go`；不改产品 Service、Algorithm 或 Rust，不把 harness 原文当成角色行动输入，也不修改模型候选来制造签字、付款或收款情节。

`runDeepRestoreCancel` 先读取当前正式 View 和该分支从 revision 1 到当前 revision 的全部 State 快照，再用隔离测试数据库的 DSN 新开 serving 连接池、创建新的 Service，运行真实 `RecoverExpired` 和独立读回。证据明确记录 `new_service=true`、`new_db_connection=true`、`process_restart=false`。这覆盖新服务实例读回与恢复入口；没有杀进程，也没有声称覆盖操作系统或设备崩溃恢复。DSN 不进入证据。

随后以真实 `Advance(Mode=read, Input="", ReadingRequest="")` 接受一个新操作并执行 `GenerateAccepted`。helper 保留直接 `*Algorithm` 类型，复制配置后只包装既有 StageObserver，保留容量和 ReadingGenerator 路径。首次真实 review 的模型响应返回后，在 `pipeline.after` 与向 Rust 转发前暂停；模型请求、响应原文、调用编号和原证据 seq 全部保存。候选仅从原 review 请求唯一 user JSON 的 `candidate` 取得，不补写。候选不存在、null、歧义或没有对应响应时不能获得通过。

暂停点调用真实 `Service.Cancel`，读回操作 cancelled，然后释放同一响应，等待原 GenerateAccepted 返回，再独立读取操作、完整 View 与所有历史快照。成功必须为实际 cancelled、无 committed_revision、无正式页或 State 变化。时间戳、进行中操作等调度元数据允许变化；正式正文、页数、分支 revision、投影和每个历史 State 都必须相同。取消前还没有执行 review 审批验证，因此证据使用 `candidate_commit_eligibility=not_established`；真实 review 可以是拒绝结果，不能把这类轨迹声称为“已合法批准的候选被拦截”。

事件合同为 control_request、restore_readback、cancel_pending、原 model_request/result、cancel_pause、cancel_issued、cancel_result。cancel_pause 的 request/result 对原 seq 精确绑定，cancel_result 保存完整读回、实际调用数、返回错误和只读核验；native 必须独立重算，不信任单个只读布尔值。仅对 SYS-005 S06 接线，其余未接入 harness 不因此放行。S07 仍依赖 S06 的真实成功；若实际候选没有签字/收款内容，只能保留“未观察到该特定内容”的边界。

## 红绿验证

先运行未实现 helper：合法固定模型不取消的实际 Rust 正控制成功提交；5 个 helper 控制在 stub 上预期失败。之后加入独立原始证据负控，先复现 null candidate 被接受，再补齐空正文/空候选拒绝。

最终 `.validation/verify-cancel-helper-20261020.sh final` 使用真实 Rust 二进制 SHA-256 `5a742da141fad59e2ab99c234f63716b1a97fa876498965d34cd6dbbf7ef7007`，隔离 PostgreSQL，`go test -race -tags=integration,codexlive -count=1 ./internal/experience -run '^TestDeepBenchmarkRestoreCancel' -v` 退出 0。结果包括两个顶层测试及10个子例：

- 不取消的合法固定批准候选提交成功；相同路径取消后不提交。
- 原 review 拒绝结果保持原字，取消后无额外修订模型调用或正式页。
- 提取语义错误、未验证容量声明在到达 review 前失败，不能冒充取消成功。
- 原 StageObserver 仍逐阶段收到通知；`experience_model_inputs` 审计行数与实际模型调用一致，证明 ReadingGenerator 路径保留；原 Algorithm 指针和容量声明不被改写。
- 用测试专属 admin 连接只改 revision 1 隐藏事实，当前正文/投影不变；helper 仍因历史快照漂移失败。
- null / 缺失 / 重复候选与缺失响应分别拒绝；暂停证据的 request/result 和 seq 对应原记录逐字段相同，候选与实际提取值一致。

日志：`.validation/cancel-helper-red-20261020.log`、`cancel-helper-capture-red-20261020.log`、`cancel-helper-final-20261020.log`。中间一次编译等待另一个协作者补齐投影迁移 helper；另一次负控最初改 story_time 导致可见投影也变化，已改为纯旧私有事实漂移，以明确验证全部 State 而不依赖显示差异。

随后独立运行整个 `^TestDeepBenchmark` 的 `-race` 集合，退出0（13.138s），包括 editorial、所有11份夹具、源恢复、门禁、结束后 ask 以及投影来源迁移。真实模型 `TestDeepBenchmarkLive` 因未配置本次实跑目录/模型凭据而显式 SKIP，没有将该次集合回归解释成真实模型验收。完整日志 `.validation/deep-cancel-suite-20261020.log`；脚本 `.validation/verify-deep-cancel-suite-20261020.sh`。

以上固定模型回归验证故障调度、证据和提交边界，不证明真实模型叙事质量或完整 SYS-005 通过。真实模型 live/native 接线和来源恢复策略由 harness 负责人维护，正式结果需绑定冻结源码、真实请求/响应与独立事件链校验。
