# v4.4 完整后端工程回归

2026-10-20 03:23:44–03:26:37 UTC（173 秒）。使用源码稳定窗口，未启动任何真实模型。命令：`go test -race -json -tags=integration,codexlive -p 1 -count=1 ./...`，Go 1.26.0 linux/amd64。`-p 1` 仅串行包以限制内存，race 仍开启。

结果 exit 0，455 项 PASS、17 项预期 SKIP、0 FAIL（含子测试）；7 包 PASS，6 个无测试包 SKIP，无非 JSON 构建错误。17 项跳过分为 12 个明确缺少真实模型启用配置、2 个缺少显式来源的辅助证据检查、3 个仅由专门父测试启动的子进程入口。每项名称与原因见 summary，不能把跳过当通过。

实际 Rust 运行时使用 `.validation/deep-benchmark/20261020T025116Z-boundaries-v44/algorithm-runtime`，SHA-256 `5a742da141fad59e2ab99c234f63716b1a97fa876498965d34cd6dbbf7ef7007`，启动前校验。覆盖实际 Rust 流水线/回取/一次修复、历史与取消恢复、SYS006 公开资料历史投影、CLI 单 user 编码及负控制。固定模型测试仅证明工程约束，不证明文学质量或真实模型基准通过。

日志：`.validation/full-backend-recorded-v44-20261020T032344Z.jsonl`，SHA-256 `a4fff554ef9f50acc292609dad4ebbed883cba2c46df27d30e49d43067c38d0a`。同名前缀 `.metadata.txt` 与 `.summary.json` 保存命令、时间、运行时与全部 SKIP/FAIL 明细。脚本 `.validation/full-backend-recorded-v44-20261020.sh` 在运行前清除真实模型启用环境，并使用不覆盖既有日志的新时间戳。

包耗时：algorithm/channel 1.879 秒，capability/model 6.543 秒，experience 137.578 秒，experience/devhttp 1.850 秒，operations/pgtool 1.022 秒，platform/pgerr 1.020 秒，platform/testpostgres 3.932 秒。此结果属于下一轮 v4.5 修改前的 v4.4 工程基线，不能用于声明随后源修改已经通过完整回归。