//! Shared read-mode writing guidance, not a minimum-length validator or retry policy.
use super::{Mode, Stage};

const READ_PROMPT: &str = "read篇幅：默认目标约1200–1800汉字的完整阅读片段，自然分段，最多24段且passage<=8192 UTF8字节。reading_request优先，其次preferences中source=explicit的已确认篇幅，再参考seed明确的每段长度要求；明确简短或具体字数请求覆盖默认。旧seed或偏好中的适中/medium沿用此默认，不解释为短场景；作品总长不是每段篇幅要求。展开有作用的行动、对白反应和结果，到自然停点，带来具体推进或新的理解，不重复现场后立即停问。篇幅不扩张玩家授权，重大保留决定前可停下。目标不是硬门槛，不凑字、不循环补写、不因字数不足单独拒绝。";

pub(super) fn append(prompt: &mut String, mode: Mode, stage: Stage) {
    // Review already receives the original reading request and preferences.
    // Keep its full-candidate evidence budget for those binding requirements.
    if mode == Mode::Read
        && matches!(
            stage,
            Stage::Memory | Stage::Plan | Stage::Evaluate | Stage::Write | Stage::Revise
        )
    {
        prompt.push('\n');
        prompt.push_str(READ_PROMPT);
    }
}
