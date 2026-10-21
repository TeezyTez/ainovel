# 未应用润色与嵌套恢复的证据边界

原 v4.6 阅读恢复运行 `.validation/deep-benchmark/20261020T041218Z-v46-reading-resume` 已封存。NAR-014 S05 正式到 r6，S06 真实 polish 产生未应用候选，S07 在零模型调用时因容量失败；NAR-017 正式到 r5，随后 S05 同样容量失败。直接恢复原正式前缀此前被两项限制阻挡：不支持 editorial 证据，以及源本身含 `resume_manifest`。

新增 Go 恢复逻辑位于 `deep_benchmark_resume_test.go` 与三个 `deep_benchmark_editorial_resume*_test.go`；这些都是评估器代码，不改变产品 Assist、正式页或模型协议。Python native 和 live 接线由另一代理负责，须在统一回归中验证。

`deepReplay.Editorials` 保存 `step`、原始 `source_root`、`source_request_event_seq`、`source_result_event_seq`、`request_data`、`result_data`。只有正式来源已封口、原步骤确为 polish、`applied=false`、`read_only_verified=true`、无错误、原页/快照/偏好/完整公有 view 前后相同的候选可恢复；目标版本、分支及逐字指令必须相符。还核对实际 model_request 的原文与指令、model_result 的候选原文与最终 AssistResult，保留原 data。已应用、未知、未配对、失败或取消控制来源仍拒绝。live 应只写 `restored_editorial` 并标记步骤完成，不再调用 Assist。

祖先布局只使用固定文件名：当前 `events.jsonl/root.sha256/fixture.json`，上一层 `source-` 前缀，再上一层 `source-source-`，最多16层来源。逐层校验链、封口根、同一 fixture 及其已记录的原文件 SHA；拒绝缺层、循环/重复根、未知路径字段、篡改 manifest 或 restored 条目。每层既有初始页、提交页、snapshot、title 及独立恢复读回继续核实。只允许已有 `information_recorded_revision_v1` 展示元数据迁移，不改 stored 原页。

`copyDeepReplaySource(directory, caseID, destination)` 重新验证完整链，按固定前缀复制已读取的原字节，使用 `O_EXCL` 拒绝覆盖。它不复制 runtime、构建缓存或任意 manifest 路径。继承的 editorial 保留最初产生候选那层的 root/seq/data，由直接父层精确引用并通过递归定位；不会将旧候选重新贴到新版本。

验证分为两个先红后绿的切片：未应用编辑原先被直接拒绝；允许该受限分支后，嵌套回放仍在 `noncontiguous replay` 处失败。最终日志 `.validation/editorial-resume-20261020T043607Z.log` 为 `-race` PASS，4.861s；包含17种 editorial 负控、5种祖先缺失/变更/循环负控、10种嵌套数据绑定负控、复制原字节/禁止覆盖/深度界限，以及两份真实封存资料的零模型预检。固定合成测试只验证工程证据，不能作为新模型叙事结果。

实际预检确认 NAR-014 root `2286b1d6535f17a4a59d1679548074b64f9294ce36b0dc3c58a737c03dd8ecdb` 可恢复6页及 S06 原 seq38/41；NAR-017 root `f3306ffdff22e58b85e8ef490c2300728a23d1bc439bf0d397231e51e4f7fab7` 可恢复5页，无虚构 editorial。两例各有6份固定原资产（当前三件及上一层三件），复制到临时目录后逐字相等且能重新验证。全过程0模型调用、0数据库操作，旧 FAIL 不改写，后续成功也只代表受控恢复的新尝试。
