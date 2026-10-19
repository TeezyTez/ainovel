//! CAP-AGENT 进程内硬顶。不拥有 Job，不签发 `run_`。
//! 全局准入在 backend；本仓只防止单 runtime 进程被打穿。

/// 单 runtime 进程同时处理的帧上限（设计预算，不是压测结果）。
pub const MAX_INFLIGHT_FRAMES: usize = 64;
/// 单 runtime 同时进入模型调用的上限（预算；模型执行在 backend）。
pub const MAX_INFLIGHT_MODEL: u32 = 32;
/// 单 runtime 同时进入工具调用的上限（预算；工具执行在 backend）。
pub const MAX_INFLIGHT_TOOL: u32 = 128;
/// 单帧 payload 上限。模型编译 JSON 与最终 reverse Envelope 同源核对，超限失败、不裁正文。
pub const MAX_FRAME_BYTES: usize = crate::capacity_profile::generated::FRAME_MAX_BYTES;
/// runtime.proto RouteRequest/GoalRequest 的既有 ≤4 Intent 视图合同；不是会话 Intent 总量。
/// 超限请求拒绝，不能把末尾 Intent 静默裁掉。
pub const MAX_OPEN_INTENT_CONTEXT: usize = 4;
/// 既有 ModelCallRequest.max_output_bytes 载波硬顶（backend 同值），不是 token 数。
/// 输出 token 预留仍由已发布模型的 RuntimeFacts.OutputTokenReserve 决定。
pub const MAX_MODEL_OUTPUT_BYTES: usize =
    crate::capacity_profile::generated::MODEL_OUTPUT_MAX_BYTES;
/// 模型输出解码的 UTF-8/JSON 字节预算；小决策不因大图放宽而增加输出 token 预留。
pub const MAX_ROUTE_INFERENCE_BYTES: usize = 4096;
pub const MAX_GOAL_INFERENCE_BYTES: usize = MAX_MODEL_OUTPUT_BYTES;
pub const MAX_GRAPH_INFERENCE_BYTES: usize = MAX_MODEL_OUTPUT_BYTES;
pub const MAX_VERIFY_INFERENCE_BYTES: usize = 4096;
pub const MAX_ROUTE_TURN_INFERENCE_BYTES: usize = 8192;
pub const MAX_VERIFY_LEDGER_INFERENCE_BYTES: usize = MAX_MODEL_OUTPUT_BYTES;
/// VerificationDecision.answer_text 的合同硬顶，同 DirectDecision.text 载波（model_output_max_bytes）。
/// 实际正文还受所在 verify 模型输出预算约束（无账本 MAX_VERIFY_INFERENCE_BYTES，有账本
/// MAX_VERIFY_LEDGER_INFERENCE_BYTES）；两层不同，不为长回答放宽推理预算。
pub const MAX_ANSWER_TEXT_BYTES: usize = MAX_MODEL_OUTPUT_BYTES;
/// answer_evidence 条数上限：capacity_profile_v1 evidence_items（legacy 与 bounded 同值）。
pub const MAX_ANSWER_EVIDENCE: usize = crate::capacity_profile::generated::LEGACY_EVIDENCE_ITEMS;
/// JSON Schema maxLength 的单位是 Unicode scalar value（字符），不是 UTF-8 字节。
pub const MAX_OBJECTIVE_CHARS: usize = 2000;
pub const MAX_CRITERION_CHARS: usize = 1000;
/// Graph string fields are Unicode scalar values, matching provider JSON Schema maxLength.
pub const MAX_GRAPH_INSTRUCTION_CHARS: usize = 4000;
pub const MAX_GRAPH_INPUT_CHARS: usize = 4000;
pub const MAX_GRAPH_PARAM_VALUE_CHARS: usize = 16000;
pub const MAX_VERIFY_REASON_CHARS: usize = 2000;
/// runtime.proto 既有账本合同；纯 Goal 不是一本账，不再套用这些 item count。
pub const MAX_LEDGER_OBLIGATIONS: usize = crate::capacity_profile::generated::LEGACY_LEDGER_RECORDS;
pub const MAX_LEDGER_UNCLOSED: usize = crate::capacity_profile::generated::LEGACY_LEDGER_UNCLOSED;
pub const MAX_LEDGER_TEXT_BYTES: usize = crate::capacity_profile::generated::LEGACY_TEXT_UTF8_BYTES;
pub const MAX_LEDGER_QUOTE_BYTES: usize =
    crate::capacity_profile::generated::LEGACY_QUOTE_UTF8_BYTES;
pub const MAX_LEDGER_REASON_BYTES: usize =
    crate::capacity_profile::generated::LEGACY_REASON_UTF8_BYTES;
pub const MAX_LEDGER_EVIDENCE_PER_ITEM: usize =
    crate::capacity_profile::generated::LEGACY_EVIDENCE_ITEMS;
pub const MAX_LEDGER_COGNITION_BYTES: usize =
    crate::capacity_profile::generated::LEGACY_COGNITION_UTF8_BYTES;
/// 旧 public 常量的同值别名，仅指账本未关闭责任；纯 Goal 不以它设门。
pub const MAX_SUCCESS_CRITERIA: usize = MAX_LEDGER_UNCLOSED;
/// 单帧本地硬顶（毫秒）。
///
/// Envelope **没有** remaining deadline 字段（CONTRACT GAP）。
/// backend workflow 默认 RPC timeout 是 5s；本值是进程内 ceiling。
/// Listen 超时发 `deadline_exceeded`，不静默丢帧让对端空等到 5s。
pub const HANDLE_TIMEOUT_MS: u64 = 2_000;

#[cfg(test)]
mod tests {
    #[test]
    fn frozen_caps() {
        assert_eq!(super::MAX_INFLIGHT_FRAMES, 64);
        assert_eq!(super::MAX_INFLIGHT_MODEL, 32);
        assert_eq!(super::MAX_INFLIGHT_TOOL, 128);
        assert_eq!(super::MAX_FRAME_BYTES, 1 << 20);
        assert_eq!(super::MAX_OPEN_INTENT_CONTEXT, 4);
        assert_eq!(super::HANDLE_TIMEOUT_MS, 2000);
    }
}
