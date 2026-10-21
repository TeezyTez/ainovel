# 两次 model_failed 的只读诊断：原因未判定

2026-10-20。只读事件、公开 process.log 和 CLI 错误处理；未运行模型、未打开凭据或 CLI 私有文件、未重启 WSL 或终止其他进程。

| 已封存运行 | 失败阶段与计时 | 正式历史 |
|---|---|---|
| `20261020T031340Z-reading-editorial/NAR-014` | S05，seq96 request / seq97 result，call29，memory。模型耗时10093 ms，stage10107 ms；操作总10521 ms、1次调用。seq97时间03:27:40.000015679Z。 | S01–S04已正式提交至r5；seq99失败读回所有页与seq94完全相同，没有S05页。 |
| `20261020T031911Z-nar001-bridge/NAR-001` | S04，seq71 request / seq72 result，call21，evaluate。模型耗时10112 ms，stage10143 ms；操作总63773 ms、4次调用，前面memory/actor/plan已成功。seq72时间03:27:58.354579163Z。 | S01–S03已正式提交至r4；seq74失败读回所有页与seq60完全相同，没有S04页。前三步成功不等于18步通过。 |

NAR-014 根 `a350b4b4226e2ad3e6103e92f2011d43dedc8de9a0593cf6221be47913eeb11c`，events SHA-256 `74d95c0813e1afb68ee503bcf192d8325515a8fa11bdd5f165ea63e57fccd307`，源树 `de298b7ad7c87d4ada39d647e0c160b4742459195d461fbe40fe93e3c312d30d`。NAR-001 根 `bc3cbd5a101d2de0ee307737fde934adeaa4f7c37565a98204ec84e65394f65a`，events SHA-256 `5bae88223240477c68448a55a99e5395a0212d1a4e312979e8960ddec8d5bbaf`，源树 `8803384a8463344af8a4f8962cd08d465c6ba6358cf8ef781da6a433c59d818c`。两条哈希链均重新核对完整。两次都是v4.4引擎、已含单user直送的CLI版本，不能归为旧双层JSON导致quote错误。

两条 model_result 都只保留 `error="model: request failed"`、空 text/model 和零usage；不存在本次失败调用返回的候选、审稿或结构JSON可供评价。操作对应 `error_code=model_failed`，run_end=FAIL。NAR-014 尚在 memory，NAR-001 尚在 evaluate：这不是正文/提取/语义审稿拒绝，不能标为已观察到的文学内容错误。NAR-001的63773 ms是整步耗时，不能误写成失败的第21次模型调用耗时；该调用约10秒，与另一失败调用相近。

`backend/internal/capability/model/codex_cli.go` 有意不把子进程原始输出放入错误。临时目录/文件写入失败（82–114）、`cmd.Run`非零或启动失败（174–185）、CLI事件`error`/`turn.failed`（318–340）等都会收敛为同一 ErrRequestFailed。生产没有设置第29行的test-only diagnostic回调，公开process.log仅有阶段摘要和最终失败，没有子进程exit code、signal、stderr、系统OOM、WSL互操作失败或网络/服务诊断。上下文超时与输出超限另有不同返回分支；目前记录不是这些明确错误，但也不能仅凭错误名反推出cmd.Run的具体原因。

共同资源干扰是值得保留的假设：Root报告同时有约82.9秒Flutter web构建，前端曾遇读取运行时ENOMEM；本审查者在同期尝试启动只读WSL Python时确实遇到`Wsl/Service/0x8007274c`连接超时，并改用Windows Node读取封存文件。这些观察没有共同进程退出码、资源曲线或内核事件绑定，**不足以把两次模型失败定为OOM、WSL故障或构建所致**。也仍可能是CLI启动/临时文件/网络/上游服务失败等其他原因；现有证据无法细分。

当前分类：模型调用基础链路失败，子类别未判定；原FAIL保留。源码改动或新测试均未由本审查触发。后续在全局最多两个真实case、重构建串行的隔离条件下重跑可检验资源竞争假设，但不能通过成功重跑改写旧失败或单独证明原因。若需进一步诊断，可另行设计不含凭据/参数/正文的静态错误类别、启动/退出阶段及exit code记录；不要把原始CLI输出无筛选公开。