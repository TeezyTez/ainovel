# NAR-017 抽取编码失败与 v4.6 架构复核（2026-10-20）

已封存 `.validation/deep-benchmark/20261020T031340Z-reading-editorial/NAR-017`，根 `8c6586c3507c737f272c2c78438dca7d45f33df073d894c7cecb2bcc16f98a97`：S04 seq98 / seq101 的外层 JSON 合法，result.candidate_json 解码后分别 10994 / 10829 UTF-8 字节，内层字符串的字符位置 319、320、692、693 是原始 LF，JSON 拒绝。两次均未到 24KiB 上限。旧 Extracted.candidate_json:String 及 Go 再解一次 JSON，给模型增加了可避免的编码任务；这不是长度故障，也不是应通过归一化原文掩盖的问题。

推荐模型输出改为 result.candidate 对象；共享 candidate 合同作本阶段 $ref，派生定义仅追加 narrative_update 必需约束。Rust 用 serde_json 的 raw_value + Box<RawValue>，先保留原始对象字节再执行既有 shape / Candidate::decode，避免 Value→marshal 吞掉重复键；Go 用 RawMessage + DecodeCandidate。双方继续将 title/passage/story_time/outcome/suggestions 与冻结 draft 精确比较，运行时最终 candidate_json 字节接口及正式合同不变。共享一次修复预算、引用逐字证据和权限验证不变，不兼容旧坏内层 JSON。

delta 对象由程序复用 draft 也可行：Go 已在 narrativeRun.draft（:64，:398）保存五字段，Rust 同样保存。但需新增 delta DTO/派生 schema/双方组装与等价验证；本轮完整 candidate 对象更接近既有状态机和审批绑定，delta 可后续考虑。

容量必须同时修正，不能只把 schema 上限从 4096 调大。用现 codexTransportSchema 实际函数独立编译量测（仅临时副本，无模型）：
| 提取范围 | 原 schema | strict schema |
|---|---:|---:|
| 无 gameplay，省略 gameplay_update | 8571 B | 9096 B |
| experience 活跃，game:null | 11961 B | 12573 B |
| game 活跃 | 17939 B | 18551 B |

初审沿旧 budget 的双 schema 计数，发现 active game 需约 52KiB、会压缩上下文。进一步核实 provider_attempt.go：native 与 JSON-mode fallback 是两个不同请求，各只携带一份 schema；fallback 明确清掉原 response_format.json_schema。CLI 同样只用一次 output-schema 文件。最终按一次 schema 加实际 fallback 前缀/role 开销计量，根代理用真实 HTTP 捕获测试验证，未增加模型配置或削减事实。

v4.6 已落实对象载体、派生闭包 schema，移除 extract 的重复 candidate_format 和 selected_plan，精简重复提示。Rust 单 schema 上限 20KiB，所有 carrier 总 overhead 统一 40KiB（包括 2KiB strict 转换/transport 余量），与 Go 同步。最大普通字符 draft 的五字段为 11099 B；实际 extract 增量（含余量）普通 / experience / game 为 24780 / 28170 / 34125 B，repair_extract 更小，均通过。合法字节上限的极端转义文本仍可能超实际序列化总预算；测试确认明确 context_budget_exceeded，原文不截断、不归一化，不能声称所有转义组合必定容纳。

strict 转换会将 optional 变 required nullable、oneOf→anyOf、const→enum、移除条件/集合约束；域验证仍权威。须覆盖 null 还原、完整 $ref 闭包、重复/未知字段、错误类型与原始 LF、字面反斜杠 n/引号/伪指令的精确保留、改 draft 拒绝、提取/语义/审稿三种修复共享一次预算和调用计数。Rust/Go 本轮 stage wire 同升 v4.6；封存 fixture 不改字节，旧合法 string 录制若用于新结构回归，只能在显式测试转录器内解码为对象并校验相等，标注不再是原字节流水线重放。新结构测试不替代新真实模型叙事验收。

量测脚本：`.validation/measure-extraction-strict.cjs`、`measure-extraction-variants.cjs`、`nar017-schema-analysis.cjs`。Rust 全 default 96 / no-default 90 测试通过（日志 `.validation/extraction-v46-full-20261020T040100Z-*`）；随后新增原故障 fixture 和加强重复键合法性负控，最终 pipeline 34 项通过（`extraction-v46-final-targeted-20261020.log`），无生产变化。固定运行时 `/tmp/elselife-v46-runtime-SHGFY513/algorithm-runtime` SHA-256 `518b3e3fd8e4e805df68e2214880a618e79c64694eaf5c62667d16d42d4b719e`。

新 `algorithms/tests/fixtures/benchmark-nar017-s04-invalid-extraction.json` 仅复制两个原输出与来源，不改旧 fixture；SHA-256 `7f6cb9e0d5a86f818b4924f6f2ab3fb5f0152c9df8a7a41a6a4a4f3c516295ba`，源 events SHA-256 `f96a129b64612aebe2c356a7a69aa57d6546b9f378bf2e15e6286f40330589b8`。回归核对 raw SHA、outer/inner 解码边界与长度，保留失败，未修坏 JSON 来冒充成功。
