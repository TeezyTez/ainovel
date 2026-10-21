# 结构提取的单层 JSON 接口

## 原始失败与目标

NAR-017 的 `20261020T031340Z-reading-editorial` 第四步在两个提取结果后终止。独立事件链根 `8c6586c3507c737f272c2c78438dca7d45f33df073d894c7cecb2bcc16f98a97`，seq98/101 分别是 extract 与 repair_extract 的原始模型结果。外层 JSON 合法；`result.candidate_json` 解码后的 JSON 字符串在 passage 字段包含未转义 LF，字符位置为 319、320、692、693。内层长度分别为 10,994/10,829 UTF-8 字节，未达到 24 KiB 上限。正式历史止于第三步；两个坏结果都保留，不能容错解析后算作成功。

已有设计要求模型先输出结构化外层，再自己正确编码里面的整份候选。这增加了一层可失败的编码，与叙事质量、章节长度和事实合法性无关。v4.6 改成模型直接输出 `{"result":{"candidate":{...}}}`；JSON 字符串转义由一次结构化输出完成，不再要求模型构造字符串里的第二份 JSON。

## 边界

- Candidate 的共享 JSON 合同不改变；只有内部 extract/repair_extract 阶段的模型信封改变。Rust 对象字段使用原始 JSON，Go 使用 `json.RawMessage`，先验证再编码，防止先转 map 消除重复键。运行时最终 Candidate JSON/protobuf 接口仍保持。
- 结构化输出 schema 来自同一合同的 Candidate；该阶段额外要求完整 `narrative_update`。未启用 gameplay 时不要求生成该载体；存在载体时按已启用类型提供字段。解码、语义、引用、版本和知识权限检查继续执行。
- title/passage/story_time/outcome/suggestions 必须与冻结 draft 完全一致；单候选仍不超过 24 KiB、正文仍不超过 8192 UTF-8 字节。唯一结构修复仍与 revise/repair_review 共用一次预算，随后必须独立审稿。
- 不保留产品侧旧字符串信封兼容。封存的老模型结果不改字节；旧固定回放测试若需进入新阶段，只在测试适配层显式把**合法**旧内层 JSON 无损转录为对象并检查候选字段相等。该回放不再声称整个模型信封逐字未变。无效原内层 JSON 不获得转录豁免。

## 容量设计与限制

对象 schema 比原单字符串 schema 大。直接可达的完整 Candidate schema 实测 17,939 字节，经真实 Codex strict 转换后为 18,551 字节；普通叙事为 8,571/9,096 字节，仅 experience 载体为 11,961/12,573 字节。不能简单把全局 4 KiB schema 上限增为 20 KiB 后继续重复预扣。

extract 删除与 schema 重复的 candidate_format 指南以及不属于已发生事实的 selected_plan，保留权威 context 与冻结 draft。单 schema 上限为 20 KiB。最初按两份 schema 估算会让 active game 需要 52 KiB 开销，只留 3,174 字节上下文，连合法的 2048 字节最新页都可能失败。该预案经实际容量测试否决，没有作为可验收方案保留。

进一步检查真实传输：native 使用 response_format 的一份 schema；`jsonModeChat` 在新请求中把它替换为 json_object，再把一份 schema 放进额外 system 消息。两种是顺序独立请求，不会在同一请求携带两份。新增 HTTP 实际请求捕获测试覆盖这两个分支，量测各自消息/角色/schema 字节，以较大请求作为门槛，先红后绿；该门槛减 1 字节仍拒绝。Codex CLI 同样只传一份 output-schema；除了原请求预检，还在进程启动前按实际 instructions/prompt/strict schema/framing 再检查一次，覆盖多消息 JSON 包装的转义增长。CLI 不运行 HTTP fallback。

最终 pipeline 总阶段开销统一保留原先 36+4=40 KiB，包含一份 schema、2 KiB strict 转换/传输余量；Go 不再重复扣 schema。所有载体保留原有上下文预算，不增模型窗口、不缩短已提交正文、不删数据库事实、不截断完整笔记。Rust 按实际 JSON 序列化后的 content 计量；大量转义可能触及总量上限，届时明确失败而不改字。最终 provider 请求仍独立校验。完整边界测试和真实重跑完成前，本设计不构成基准通过结论。

## 已执行与待完成

Go 对象信封的真实换行、字面 `\n`、引号、反斜杠、中文、Unicode 回归先失败后通过。非法原始 LF、重复键、旧字符串字段、null/字符串候选仍拒绝；结构通过不能绕过 review。普通最大笔记与最新页容量回归及载体预算选择回归通过。

Rust 实现、跨进程测试和 strict schema 实测回归已完成。完整后端 race `.validation/backend-v46-20261020T040821Z` 为 540 pass、21 个明确 live/source/helper skip、0 fail；三载体真实 Rust → 假 CLI 子进程 → 独立 review/Apply 的结构回归实际执行。Rust full default 96 pass、no-default 90 pass，最终定向 pipeline 34 pass。跨进程固定结果不能评价文学质量。

真实模型恢复运行 `.validation/deep-benchmark/20261020T041218Z-v46-reading-resume` 正在进行，原 NAR-017 失败与正式前三步原字保留；只有新后续事件能验证本次模型传输表现，不能预先改判整例。
