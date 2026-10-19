# 容量（C-ALG / C-ALG-RT）

目标架构：[跨仓容量与可靠性设计](https://git.xn--2hv367j.cn/telos/sundries/-/blob/main/docs/%E8%AE%BE%E8%AE%A1/%E5%AE%B9%E9%87%8F%E4%B8%8E%E5%8F%AF%E9%9D%A0%E6%80%A7.md)。本档只填 **算法仓** 数字。禁止回答 Valkey/PG/SSE 的恢复路径——那些不在本仓。

平面：`CAP-AGENT`。消费方：`C-ALG`（库）、`C-ALG-RT`（`algorithm-runtime`）、`C-AGENT`（backend Dial）。

| 问题 | 值 | 来源 |
|------|----|------|
| 100k online 时本进程 QPS | 不服务用户；只吃 backend 帧 | DESIGN |
| 连接 | 一条 `RuntimeChannel` 流（backend 一侧） | DESIGN |
| 状态存在哪 | **none**。无 PG、无 Valkey、无作业表 | AGENTS.md |
| 每帧字节硬顶 | `MAX_FRAME_BYTES` = 1 MiB；模型编译 JSON 全量序列化核对，真实 `request.model` 的 schema/system/history/memories/recovered context 全部注入后再核对完整 Envelope；超限 `TooLarge / model_input_budget_exceeded`（确定性超限终态，不重试同输入），不删字段或裁正文 | `src/capacity.rs`；`cognition::cap_model_payload` / Runtime intelligence |
| inference JSON 字节 | Route/Verify 4096，Goal 16384，Graph 65536 | `src/capacity.rs` 的 `MAX_*_INFERENCE_BYTES` |
| verify 回答正文 answer_text / 引用 answer_evidence | 正文合同顶 = model_output_max_bytes（262144）；实际还受所在 verify 输出预算约束（无账本 4096，有账本 262144），不另放宽；引用 ≤ evidence_items（16） | `src/capacity.rs` 的 `MAX_ANSWER_TEXT_BYTES`、`MAX_ANSWER_EVIDENCE` |
| Goal 输出 | objective 2000 字节；criteria 至多 16 条、每条 1000 字节；constraints 至多 16 条 | `src/capacity.rs` |
| 输入 Intent 视图 | `MAX_OPEN_INTENT_CONTEXT` = 4；沿用 proto 的 Route/Goal 请求合同，不代表会话最多 4 个 Intent；超限 `InvalidContext`，不裁尾。合法视图的 problem/obligation 文字完整保留 | `src/capacity.rs`；sundries `runtime.proto` 的 RouteRequest / GoalRequest |
| Route 输出言语行为/歧义数 | 以 `ROUTE_TURN.properties.{acts,ambiguities}.maxItems` 为唯一模型输出合同；越界失败，不把成功前缀冒充全输出。与“一轮最多问一个澄清”无关 | `src/intelligence_schemas.rs` / `split_route_output` |
| 在途帧 | `MAX_INFLIGHT_FRAMES` = 64，超限 `resource_exhausted` | 同上；Listen 信号量 |
| 模型在途 | `MAX_INFLIGHT_MODEL` = 32 | 预算；模型调用在 backend |
| 工具在途 | `MAX_INFLIGHT_TOOL` = 128 | 预算；工具在 backend |
| graph 节点 | `MAX_NODES` = 100 | `src/graph/validate.rs` |
| PG 连接占用 | 0 | 本仓无 DB |
| 队列最大深度 | 0。本仓不排队；满则拒绝，由 backend QUEUE | DESIGN |
| Admission | 本仓只有硬上限。ACCEPT/QUEUE/DEGRADE/REJECT 在 backend | backend `admission.Controller` |
| 实例被 kill | 无本地事实。backend 按 outbox/`frame_id` 重投 | Listen 重放窗：`conversation_id+turn_id+type+payload` |
| Valkey 挂 | **不适用**（禁止客户端） | — |
| PG 短暂不可用 | **不适用** | — |
| 慢客户端 | 不适用。SSE 慢消费是 backend | — |
| 流量 ×10 | 64 满则拒；backend 负责 shed | DESIGN |
| 100k 压测 | **NOT RUN** | — |

远端 CI 检查命令（列出命令不代表本次已执行或已通过）：

```bash
cargo test --offline --locked
cargo build --features channel --bin algorithm-runtime
```

历史 fixture 联测与当前生产验收分开看，证据边界见 [STATUS.md](STATUS.md)。真实模型质量与生产容量仍未完成验收；不能用 fixture 或单元测试证明。
