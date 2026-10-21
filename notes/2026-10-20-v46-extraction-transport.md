# v4.6 对象提取的真实传输回归

本记录只验证结构、传输字节和审批绑定。Rust 运行时与 Go CodexCLI 适配器均为真实代码；模型输出及 CLI 子进程均为明确的固定合成测试，不访问凭据或模型服务，不是文学验收，也没有写入正式用户经历。

新增独立文件：`backend/internal/experience/narrative_extraction_transport_integration_test.go`。测试按 ordinary、experience-only、active-game 三种合法上下文运行实际 Rust memory → plan → evaluate → write → extract → review；仅 extract 通过真实 CodexCLI 启动临时 POSIX 假 CLI，复制实际 `--output-schema` 文件并返回固定 `item.completed` / `turn.completed` 事件。没有手写第二份 canonical schema，没有导出私有 schema 转换实现。Windows 原生测试显式跳过，当前在 WSL 运行。

每种载体只有一次假 CLI 调用、总计 6 次固定阶段返回，无修复或重试。完整 Candidate 经真实 `codexNormalizeOutput` 后与原对象逐字段相等；正文含真实 LF、字面 `\n`、引号、反斜杠、Unicode、HTML 样式文字、段首空格和 tab。两种 gameplay 载体另带 strict wire 的 `gameplay_update:null`，验证删除可空传输占位不会改变正文或域字段。随后独立 review 得到审批绑定，再调用 Go Apply。移除审批或将字面 `\n` 换成真实 LF 的负控在生产 `verifyNarrativeApproval` 门禁失败。

| 载体 | Rust 原 schema 字节 | CLI strict schema 字节 | 增量 |
|---|---:|---:|---:|
| ordinary | 8,571 | 9,096 | 525 |
| experience-only | 11,961 | 12,573 | 612 |
| active-game | 17,939 | 18,551 | 612 |

三个实际 schema 的 SHA 不同，增量均小于预留的 1 KiB；原始与 strict schema SHA 写入测试日志。测试不硬编码 40/52 KiB 总预算，也不从结构通过推出内容质量。

验证命令：`.validation/verify-extraction-transport-v46-20261020.sh actual /tmp/elselife-v46-runtime-SHGFY513/algorithm-runtime`，启用 `-race -tags=integration,codexlive`，`GOMAXPROCS=2`。运行时 SHA-256：`518b3e3fd8e4e805df68e2214880a618e79c64694eaf5c62667d16d42d4b719e`。最终 1 个顶层测试及 3 个子测试全部通过，Go 包耗时 2.056s。原日志：`.validation/extraction-transport-v46-actual-20261020.log`。

保留两个无效尝试以免误称产品红绿：

- 初次跨 PowerShell → WSL 内联 compile-only 命令的正则引号丢失，误执行 package tests；因未设置 PostgreSQL PATH 出现 `initdb` 不在 PATH 的环境错误。未启用 Rust/真实模型；这不是产品缺陷证据。固定脚本随后精确使用 `-run '^$'`，编译通过，0.014s，日志 `.validation/extraction-transport-v46-compile-20261020.log`。
- 首轮实际传输已经通过三 schema、对象原字、review 与 Apply；附加负控错误地要求通用 Apply 自身检查审批而失败。生产 `service.go` 在 Apply 前调用 `verifyNarrativeApproval`，测试已改为验证真实门禁，没有修改产品行为。该测试设计失败原日志保留为 `.validation/extraction-transport-v46-negative-control-placement-20261020.log`，不冒充已修产品漏洞。

同期只给币制补充实验的合成来源加了两处明确标题：初页“合成世界初始记录”、提交页“合成问答标题”，配合评估端严格来源标题绑定，没有改旧封存运行或逐字 fixture。

同一 v4.6 二进制下的币制 helper 回归也已通过：`.validation/verify-currency-v46-20261020.sh`，`-race`，3 个顶层测试加 9 个子测试通过，真实 Live 测试未授权输出目录而显式跳过；9.489s。原来源完整恢复 4 页，S05 仍为 BLOCKED，预检真实模型调用为 0。固定模型的成功 ask、模型失败保留、初始币制漂移阻止调用、原世界旧快照漂移检测均通过。日志 `.validation/currency-helper-v46-20261020.log`。真实币制补充实验仍待 root 统一封存源码后执行。
