# 单 user CLI 桥接：封存原审稿请求的单次真实重放

来源为 `.validation/deep-benchmark/20261020T025916Z-countercontrol-v44/NAR-001` 的完整封存失败记录。完整32事件、连续 seq、每条 previous_sha256 和最终 root 已独立检查；来源 root 为 `cb07a80a250451bca050b535d214e932ceecbcfc6d25cb6e3036e0decc4286f9`。取 seq25 / call8 的原 `model.Request`，其唯一 user JSON 中 candidate 与 seq23 / call7 extract 的 candidate_json 解码后完全相同。没有重新运行故事前置，也没有从未封存的片段拼接请求。

新文件 `backend/internal/experience/deep_benchmark_quote_bridge_live_test.go` 仅用于 evaluator，编译标签为 integration && codexlive。先执行 stub 红阶段，再完成来源与引文检查，`-race` 测试通过：精确原字引文通过，字面量反斜线 n 不能代替换行；候选漂移、多 user、错误调用编号、错误题目、错 root 与未完整封存字节全部拒绝。原真实来源预检也通过，独立 `verifyNarrativeApproval` 复现 `narrative_evidence_missing`。

原请求包含 system + 单 user，原 MaxOutputTokens=8192，schema / messages / model 全部保留。`Request.ContextTokenLimit` 的 JSON 标记为 `-`，故按原运行声明恢复为65536，并同时记录恢复理由。恢复后再次比较全部可序列化字段，证明没有改 prompt、候选、schema 或输出预算。CLI 路径/AuthHome/proxy 与已授权 `.validation/run-deep-local.sh` 相同；未读取凭据文件。没有补充引文、追加纠错指令或进行重试。

## 实际结果

在 `.validation/quote-bridge/20261020T031240Z-original-review` 执行**一次**真实 `CodexCLI.Generate`，耗时32202ms：返回 approved=true，解析成功，引文不匹配0条，独立 `verifyNarrativeApproval` 成功。原 review 有3条不匹配，分别是 supports 中的 r2-yu-inspection、r2-yu-assessment、r2-north-departure-cancelled；三条原引文均含字面量 `\n`，不含实际换行。

编译前后源清单一致：`de298b7ad7c87d4ada39d647e0c160b4742459195d461fbe40fe93e3c312d30d`。固定测试二进制 SHA-256 为 `048203f0a7e47650b76b10c3cba6ebf7d979fceacd00e3740145d1f87144b2ab`。实验事件 root 为 `bd16cb7daf40b3547b5a73be056edae86ed11c61e95980933991063d79fd08dd`，结尾状态为 `STRUCTURAL_APPROVAL_ONLY`。

另用 `.validation/check-quote-bridge-evidence-20261020.py` 独立验证两条完整链、归档源字节、原请求相等、候选相等、调用数恰好1、每条新引文是原候选 passage 子串、返回的批准结果、编译前后清单相同；退出0。结果保存为实验目录下 `independent-check.json`，完整 request/result 与原始来源副本均已保留。

该结果验证修复后的桥接可以在这个固定请求上产出精确引文。一次随机模型重放不能保证所有后续引文，也不能单独量化桥接变化的因果效应。它没有调用世界 Service、接数据库或提交任何正式页；原 NAR-001 失败记录保持原样，整个叙事轨迹、语义与文学质量仍需后续真实运行和审读。不得把此处结构批准计为 NAR-001 全例通过。
