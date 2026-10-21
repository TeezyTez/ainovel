# Codex CLI 安全失败诊断（2026-10-20）

已增加 model.CodexFailureMetadata(err) 与可序列化 CodexFailureDiagnostic；Generate 在准备、子进程启动/退出、CLI 已知失败事件、解析及归一化边界返回受限元数据。Error() 保持原通用文本，errors.Is 保持原 sentinel / context 取消语义。没有重试、提示改写或输出归一化变化。

包装器只保存已知 sentinel，不保留原 OS/ExitError、stderr、prompt、路径或凭据。公开字段仅闭集 phase/category、可选 exit_code、error/turn.failed 已知 event_type 及 stdout/stderr 的 captured 字节数；这些计数是已保留缓冲区，不能声称完整接收总量。未知 stderr 不作推断，exit137/信号不自动解释为 OOM。返回的 ExitCode 独立复制；JSON 序列化拒绝未知标签及超界计数。既有私有 diagnostic raw 回调仍仅在显式 live 测试中使用，没有扩权，不能当公共诊断安全接口。

真实假 CLI 子进程测试覆盖准备失败、缺失可执行文件、exit7、已知/未知事件、坏 JSON、无最终消息、归一化重复键、取消/超时、捕获超限、敏感文本不进入诊断、单次调用及成功无诊断。用途为错误边界工程回归，不是模型质量验收。

测试先红后绿：.validation/codex-diagnostic-red-exit-20261020T034058Z.log（首次 API 缺失）、protocol 034219Z、cancel 034340Z；完整 model 包 race 日志 .validation/codex-diagnostic-full-race-20261020T034435Z.jsonl，64 PASS / 2 明确 live 配置缺失 SKIP / 0 FAIL，包 6.719s。未调用真实模型。frontend_regression 独立只读复核未发现泄密或兼容阻断。

此前 NAR014 memory / NAR001 evaluate 已封存的 model: request failed 不含这些元数据，无法追溯判定具体原因。本改动只改善下一次失败的可诊断性；由深度基准记录 failure_details 时仍须保留原错误/空 Result，不能据 phase/category 推断文学内容通过或资源 OOM。

后续独立检查发现多 conversation 消息被 JSON 包装后会增加转义字节，原请求预检不能准确计入。已在 codex_cli.go 最终 prompt/instructions 构造后、exec 前补实际载体检查：一次 strict schema、最终两份内容、输出预留及角色/framing；原请求预检仍保留，single user 不重编码，multi 保持角色/顺序。4096 窗口多 slash/quote 测试先红（原逻辑启动成功），后绿（prepare/capacity，0 子进程）；再从假 CLI 实际捕获 stdin、instructions、schema 验证 single/multi 精确边界通过、少 1 字节拒绝且无重试。日志 `.validation/codex-final-prompt-capacity-red-20261020.log`、`codex-final-prompt-boundary-ready-20261020.log`。最终 model 全包 race `.validation/codex-diagnostic-full-race-20261020T040738Z.jsonl` 为 69 PASS / 2 live-config SKIP / 0 FAIL，6.740s；并不意味着此前未覆盖的完整后端集成开关已经验收。
