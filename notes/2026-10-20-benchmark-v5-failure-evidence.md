# 2026-10-20：v5 失败独立读回与未应用润色恢复

作者：benchmark_harness agent。此记录描述评估端取证和负控制，不是叙事验收、真人盲评或全例 PASS。未调用模型、未改生产世界逻辑、未重写任何旧运行事件。

## 已复现的取证缺口

v4 deep live 只在 GenerateAccepted 返回 nil 后执行 Service.Get。错误分支的 operation_failure.public_view 可能只是调用前缓存；即使与最后提交页相等，也不能据此证明失败后正式页、标题或私有状态未变。两例真实审查已更正于 `.validation/next-fixture-drafts/v46-nar014-017-review.md`。

Python 原核验器可接受重封链后的缺少失败读回、旧页/私有旧快照/旧标题/分支状态/偏好漂移和错误 seq/scope/method 等 12 种负控制。Go 先以缓存基线 stub 复现：7 种真实隔离 DB 漂移/不可读都被错误认证无写入；修复后这些控制均失败关闭。

## v5 具体边界

`deep_benchmark_failure_test.go` 为每次普通 operation 创建 fresh Service 与新数据库连接，只读调用 Get、每版 snapshot 查询、全部 SQL 分支/正式页/状态/每版标题及偏好快照。它不拥有 Generator，不执行 RecoverExpired、Cancel、Advance 或应用候选。SQL 读取直到最大 revision，孤立的未来页也不能隐藏在当前 branch revision 之后。

operation_request 增 `authority_before` 与 `authority_method=fresh_service_new_connection_v1`。基线必须与前一次 View / State 一致。若基线无法读回，记录 authority_before_failure，操作不触发。

失败事件把旧缓存明确命名 cached_public_view。随后 failure_readback 绑定原 request_event_seq、failure_event_seq 及完整 request，并在脱离已取消 context 的 30 秒审计窗口中独立读回。正式页、所有版本 State、SQL 标题、分支世界状态与偏好必须前后相等。只排除 Operation 和 View.UpdatedAt 生命周期字段；SQL fence 不作为世界事实比较。

`readback_error` 必须明确记录读回失败；不能用默认空 State 冒充成功。`read_only_verified` 是读回一致性断言，Python 会重新计算，不能自证。缺失 v5 failure_readback 使完整性为 INCOMPLETE；真实读回失败或漂移仍是 FAIL。无论无写入是否成立，原 operation_failure 都保持 FAIL。

操作查询是另一维度：若 operation_lookup_error 非空而完整历史确实相同，可以证明读取的正式历史未变，但操作状态未知。native 单列 operation_lookup_unverified_steps；不把它伪称已读取 failed 状态。

v1–v4 旧失败保留原字节、原根与原 FAIL。native 新列 legacy_unverified_steps，不追认无写入。只读重验 v46：NAR014 root `2286b1d6535f17a4a59d1679548074b64f9294ce36b0dc3c58a737c03dd8ecdb` 的 S07，NAR017 root `f3306ffdff22e58b85e8ef490c2300728a23d1bc439bf0d397231e51e4f7fab7` 的 S05；两者 VERIFIED/FAIL、failure_no_writes.verified=0。

## 未应用润色与嵌套来源

与 pipeline_review 的 Go decoder 合作，live 现在复制完整已验证祖先资产并输出 restored_editorial。它保存原 source_root、request/result event seq 及完整 data，不重新 Assist、不改指向新页、不采用候选。

native 使用固定 source- 前缀逐层读取 events.jsonl/root.sha256/fixture.json，深度上限 16，并逐层核验原根、字节摘要、fixture、正式页/快照/标题、原观察和润色条目；缺祖先、篡改、循环/过深或不完整源拒绝。不得通过 manifest 提供任意文件路径。

允许恢复的 editorial 必须未应用、read_only_verified、error 为空、原页/状态/偏好/视图完全相同，并有唯一成功模型结果。实际模型 user JSON 必须恰好绑定原段 original 与原 request；原模型回复解码得到的 text 必须等于 AssistResult.Text。已应用、失败、未知或未完成的 editorial 与取消控制来源继续拒绝。

继承条目保留最初来源根和序号，直接父层 manifest 逐条核对已验证祖先，不将旧候选改标成当前轮新结果。NAR014 v46 的原 S06 真实候选通过上述只读 source 检查，seq38/41。

## 验证

- `python3 -m unittest discover -s tests -p 'test_benchmark_*.py' -v`：67 顶层测试全部通过，17.588 秒。新增失败证据、两层来源、原模型输入/候选字节负控制；旧 editorial-only 无正式提交前缀测试保留拒绝，更新其旧 blanket-rejection 文案预期。
- `go test -race -tags=integration,codexlive ./internal/experience -run '^TestDeepBenchmarkFailureIndependentReadback$' -count=1 -v`：1 顶层 / 8 子例通过，7.638 秒。日志 `.validation/failure-readback-green-20261020.log`。
- root 独立全 Python discovery：83 测试通过，18.147 秒（其报告 session 58758）。收到该结果后我方未修改 source/tests。
- pipeline_review 独立 Go nested/editorial tests 与两份真实 source 0 模型 preflight：PASS，日志 `.validation/editorial-resume-20261020T043607Z.log`。其 Go 源由该 agent 维护。
- root 最终完整 v47 后端回归：602 PASS / 21 明确 SKIP / 0 FAIL，exit 0；已独立读取 `.validation/backend-v47-20261020T044401Z/summary.json` 核对。首轮仅旧容量压力测试的预期随 v4.7 预算增加而失效，root 保留旧 40 KiB 负控制、拆开默认全量留存与合成压力回取后复测通过。该回归已清除真实模型启用环境，不能视为 live 验收。

链完整性只证明本地保留根下的一致性，不是外部公证。固定模型和合成 DB 测试仅证明取证分支能识别篡改，不能证明文学质量、客户同意、结局自然或完整基准通过。