# NAR-001 审核引用转义失败与 v4.4 有界补审

原始失败保留于 `.validation/deep-benchmark/20261020T023454Z-fresh-v43/NAR-001/events.jsonl`，根 `f5c1d3115b82e53baa609b0b50e49650f0fc9c59b2c52424f4c718f4af1d2936`。S01 用了 174754 ms、8 次模型调用，最终 operation.status=failed、error_code=`narrative_evidence_missing`；公共历史仍为合成初始 r1，没有把候选视为正式页。

解码后的 write（seq20）、extract candidate（seq23）和实际 review 输入（seq25）passage 字节完全相等，SHA-256 都为 `5c62e49073fa8cff6c1ec73acaac4d93e3e86f0784d3fa422aa7b6c58241a94e`。句子“抢回来。”后的码点为 `[8221,10,10,21457,…]`，即右引号后两个真正 LF。只有 seq26 审稿的 `supports[yu-inspection-r2].quote` 变成 `[8221,92,110,92,110,21457,…]`，即两次字面反斜杠 n；其余五条 fact supports 与十五条 knowledge supports 都能逐字匹配。不能把 JSON 日志中的显示转义误判成 draft 本来就有字面反斜杠 n。

Go 的原字拒绝是正确行为。CodexCLI 适配器的 event 解码与 synthetic-null normalizer 只作 JSON 解码/再编码和可选 null 去除，没有将内部 LF 换成字面序列的代码。新增测试经过这两个实际函数，分别保留真实 LF 和字面反斜杠 n 两类字符。真实运行没有留存 CLI 原始 stdout，故证据能定位为返回给产品的审稿结果引用有误，不能声称已逐字核查过 CLI 内部原始响应；也没有证据支持放松产品匹配规则。

v4.4 增加 `repair_review`，规则为：先检查整个审稿的批准状态、引用 ID、类型、去重、非空、完整覆盖。只有这些全部合法而 quote 不是正文精确连续子串时，才允许在原候选冻结的前提下重新独立审稿一次。它与语义 revise、结构 repair_extract 共用原来的一次修复预算，也受原 12 次模型调用上限控制。已有任一种修复后不能再补审；没有剩余调用则失败。补审仍可明确拒绝，同样必须通过全部原字与语义审核约束；不能改 passage/candidate、归一化 quote、制造支持引用或继续重试。

Go 在每次 review/repair_review 请求前重新绑定 candidate 到原 extracted canonical 字节，提交仍只接受最终严格批准；Rust 内部保留同一 candidate 并单步转移。原失败尝试不替换，补审是额外第九次真实传输调用。提示补充了选择足以支持事实的最短连续原句、优先段内引用，以及 JSON 解码后再判断原字关系；不要求模型为了通过改变批准结论。

冻结回归 `algorithms/tests/fixtures/benchmark-nar001-s01-review.json` 保存原八次输出、各自 SHA 和源链身份，目的仅是结构重放。红灯证据为 `.validation/review-quote-go-red2-20261020.jsonl` 与 `review-quote-rust-red-20261020.log`。绿色控制人为选取真实连续跨度，只验证结构行为，不将其称为新的叙事审稿或质量通过。

覆盖包括：真实 LF 与字面序列双向不混淆；未知/缺失/重复 fact、knowledge、reveal 引用不可借 quote 错误掩盖；原候选不能替换；已花费 extraction/semantic 预算、零预算、调用耗尽；补审可拒绝、可再次失败但不得再修。真实 Rust→Go 传输保留全部原八次响应及第九次请求/响应和顺序审计，成功控制最后经过完整 Go Apply；失败控制不产生批准候选。

Rust 全 default/no-default 测试通过并最后重新 default build。隔离 runtime 为 `/tmp/elselife-review-v44.s1Evuw/algorithm-runtime`，SHA-256 `80654095db497ea7197f94ecc6784f03e9375f1ef06b61d0601aba3e2f4ba525`。聚焦 Go `-race -tags=integration` 通过，日志 `.validation/review-v44-go-focused-20261020T024901Z.jsonl`；Rust 日志同前缀 `review-v44-rust-{default,no-default,build}-20261020T024901Z.log`。这些是结构与集成证据；真实 v4.4 叙事运行及独立文学评审另行留存。

全后端 `go test -race -json -tags=integration -count=1 ./...` 已完成，377 个测试/子测试通过、3 个预期 helper 跳过、0 失败，exit 0；日志 `.validation/review-v44-go-full-20261020T024954Z.jsonl`，experience 包 123.559 秒。Rust default 共 92、no-default 共 86 个测试通过，流水线文件 32/32。另一子 agent 对 Go/Rust 候选绑定、完整引用分类、共享预算、ask 排除和失败停止进行了只读独立审查，未发现本补丁的生产阻断问题；这些结果不把合成回归升级成真实叙事验收。

后续真实运行 `20261020T025916Z-countercontrol-v44/NAR-001` 在一次补审后仍因3处同类quote转义错误失败。进一步审查发现CLI的**输入**路径又将已JSON序列化的user content放入messages JSON封套；上文关于输出event解码/normalizer保持字节的结论不代表输入没有额外编码层。新证据、固定候选身份与最小桥接修复边界见 `2026-10-20-cli-review-double-json-diagnosis.md`。原两次真实失败均保留，v4.4的工程回归通过没有解决或覆盖这次真实失败。
