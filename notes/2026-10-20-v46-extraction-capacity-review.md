# v4.6 对象抽取与请求计量独立只读审查

日期：2026-10-20。审查者：独立 agent `benchmark_harness`，method=`code_review`。本轮只读生产与测试源，仅新增本记录及 `.validation` 字节计算脚本；未执行模型、未改封存历史，也未重跑正在由其他 agent 管理的整套回归。本结论不构成文学质量验收。

## 结论与边界

v4.6 的对象抽取核心未发现阻断：旧 `candidate_json` 字符串没有在产品路径被转译成成功；合法对象必须保留冻结 draft，经过共享 contract、Rust 状态机和独立 review 后才能成为正式候选。请求容量仍在每次实际调用前检查。HTTP native schema 与 JSON fallback 是两次请求，各携带一份 schema，按其中较大的载荷保留容量是合理的。

发现一项相邻、既有且可重现的 CLI 多消息计量缺口。当前深测固定世界的单 user 请求不走这一分支，因此它不是本轮这些 fixture 的直接阻断；带 AuthorWorld 的真实产品路径能走到它，不能把当前 guard 描述成对所有 CLI 输入的完整实际传输计量。

## 多消息计量缺口

`backend/internal/capability/model/codex_cli.go:81` 在包装 prompt 前，用原 `req.Messages` 和实际 strict schema 运行 `VerifyContextBudget`。`:140` 随后对多条 conversation 做 `json.Marshal(conversation)`，`:144` 再加入说明文字；用户内容中的反斜杠、引号、换行因此会再次转义。固定 256 字节与每消息 32 字节不能覆盖按正文大小增长的转义。`backend/internal/experience/algorithm.go:349`–`:355` 在 AuthorWorld 非空时附加第二条 user，提供真实可达入口。

独立复现命令（不调用 Go 服务、CLI 或模型）：

```text
wsl python3 /mnt/c/workspace/AI小说游戏/.validation/review-v46-cli-multimessage-bytes.py
```

脚本使用合成 system、含 10,000 个反斜杠的 JSON user、合成 author_world 第二 user，逐字重建当前 guard 与 CLI 包装公式。结果：原 guard bound 28,840 字节；实际 instructions + stdin + 单份 schema + output reserve，尚未加 framing 就达到 48,674 字节，至少少计 19,834 字节。原 user 内容 20,050 字节，包装后的 stdin 40,261 字节。脚本只证明字节上界核算不完整，不声称这些字符一定会耗尽真实模型 token 上限。

建议最小修复：CLI 完成实际 instructions/prompt/schema 构造后，按真正发送内容复验容量；保留单份 schema，不将 HTTP 的两个顺序 attempt 相加。测试应抓取假 CLI stdin/schema/instructions，覆盖单 user 原字、多 user 的转义增长和一字节越界拒绝。

## 已核对的防线

- `context_budget.go:18` 对每次请求累计 messages、role、schema、framing 和 output reserve；`provider_attempt.go` 的 native/fallback 单请求各一份 schema。`context_budget_attempt_test.go` 捕获两次真实 HTTP 请求，测量较大一次并验证少一字节拒绝，避免把顺序 fallback 错加成同一次双 schema。
- `narrative_pipeline.go:404` 保留 `json.RawMessage`，先检查 24 KiB，随后 `DecodeCandidate`，最后才 canonicalize。五个冻结字段 title/passage/story_time/outcome/suggestions 必须完全一致。不存在 map 解码后覆盖重复 key 再视为合法的捷径。
- Rust `narrative_pipeline.rs:416` 使用 `Box<RawValue>` 保存 candidate。shape 检查后的 `Candidate::decode` 仍接收原始 object 字节，而非重编码 Value；重复字段与语义错误仍由 typed decode/validate 拒绝。被冻结正文变化直接报 `extract_changed_draft`，不靠 repair 改故事。
- Rust 原始模型输出、candidate、schema、聚合 stage 内容均保留大小上限。`next_request` 以实际序列化 input/prompt/schema 加 strict schema 增长余量核验；过长转义 draft 失败关闭，没有截断。当前测试明确覆盖 ordinary/experience/game 三种载荷，最大冻结正文和转义膨胀。
- Go 和 Rust 的 `repair_extract`、`repair_review`、`revise` 共享同一 repair 计数；抽取修复只从首次失败 extract 进入，须保留后续 review 调用额度。语义引用错误不会在 Rust 被归为协议修复；Go 允许原始错误继续传给 Rust 时也不生成 candidate 或 approval。
- `codex_schema.go:98` 在 optional-null 正规化之前做递归唯一 key 校验，并用 `UseNumber` 保留数值精度。无效 JSON/重复字段不会被该桥修成有效对象；正规化只移除原 schema 可选且不允许 null 的 transport null，最终产品 contract 仍独立验证。
- `narrative_review_repair_integration_test.go:89` 的旧 envelope 转写仅是显式 test-only fixture 适配，先 StrictJSON 和 DecodeCandidate。封存文件不改，无效旧 inner JSON 无法被它修复；该测试没有被表述为新的真实叙事成功。
- 新 `narrative_extraction_transport_integration_test.go` 走真实 Rust 和 CLI adapter、仅替换 CLI 子进程的模型输出；三种 carrier 分别捕获 strict schema，检查单次 extract、原字 LF/字面斜杠 n/引号/Unicode/空白和最终 approval 绑定。其用途是工程边界，不是模型文学表现。

本轮仅独立执行上述本地字节复现，测试源已审读；其他 agent 的 green 报告应由其原日志与 parent 汇总，不在此冒充独立重跑。
