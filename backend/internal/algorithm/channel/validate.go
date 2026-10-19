// 文件职责：校验 Envelope 帧——协议版本、类型方向、payload 尺寸、content type 与 frame_id。
// 主要依赖：生成 DTO algorithmv1.Envelope 与 frames.go/errors.go。
// 调用边界：被 server.go / client.go 在收发帧时调用；纯函数，不读写流。
// 状态边界：无状态；Validator 只持有一个可配置的 payload 上限。
// 安全边界：拒绝原因只回显稳定分类码，绝不回显 payload 字节或正文。

package channel

import (
	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Validator 校验入站/出站帧；MaxPayloadBytes 小于等于 0 时回落到默认上限。
type Validator struct {
	MaxPayloadBytes int
}

// maxPayload 返回生效的 payload 上限：未显式配置时使用 DefaultMaxPayloadBytes。
func (v Validator) maxPayload() int {
	if v.MaxPayloadBytes <= 0 {
		return DefaultMaxPayloadBytes
	}
	return v.MaxPayloadBytes
}

// Validate 校验一帧并核对其类型是否匹配预期流向。
//
// 校验顺序：nil 帧 → 协议版本 → frame_id → 类型已知 → 方向匹配 → content type → payload 尺寸。
// 任一不满足即返回携带分类码的 *FrameError，调用方据此审计并拒绝，不回显任何正文。
func (v Validator) Validate(env *algorithmv1.Envelope, expected Direction) error {
	if env == nil {
		return &FrameError{Reason: ReasonUnknownType}
	}
	if env.ProtocolVersion == "elselife.experience.v1" {
		return v.validateExperience(env, expected)
	}
	if env.ProtocolVersion != ProtocolVersion {
		return v.reject(ReasonVersionMismatch, env)
	}
	if env.FrameId == "" {
		return v.reject(ReasonInvalidFrameID, env)
	}
	direction, known := DirectionOf(env.Type)
	if !known {
		return v.reject(ReasonUnknownType, env)
	}
	if direction != expected {
		return v.reject(ReasonWrongDirection, env)
	}
	if env.ContentType != ContentTypeProtobuf {
		return v.reject(ReasonInvalidContentType, env)
	}
	if len(env.Payload) > v.maxPayload() {
		return v.reject(ReasonPayloadTooLarge, env)
	}
	return nil
}

// validateExperience has a separate closed allowlist; legacy task frames are
// never permitted in an experience channel, including failure/reverse paths.
func (v Validator) validateExperience(env *algorithmv1.Envelope, expected Direction) error {
	if env.FrameId == "" {
		return v.reject(ReasonInvalidFrameID, env)
	}
	direction := DirectionBackendToAlgorithm
	content := "application/json"
	switch env.Type {
	case "request.experience":
	case "decision.experience":
		direction = DirectionAlgorithmToBackend
	case "request.model":
		direction = DirectionAlgorithmToBackend
		content = ContentTypeProtobuf
	case "result.model":
		content = ContentTypeProtobuf
	case "request.experience_read":
		direction = DirectionAlgorithmToBackend
	case "result.experience_read":
	case "result.frame":
		// Experience termination may be initiated by either side, scoped to
		// one root/callback. No legacy task frame is admitted by this exception.
		direction = expected
		content = ContentTypeProtobuf
	default:
		return v.reject(ReasonUnknownType, env)
	}
	if direction != expected {
		return v.reject(ReasonWrongDirection, env)
	}
	if env.ContentType != content {
		return v.reject(ReasonInvalidContentType, env)
	}
	if len(env.Payload) > v.maxPayload() {
		return v.reject(ReasonPayloadTooLarge, env)
	}
	if env.ConversationId == "" || env.TurnId <= 0 || env.EventSeq < 0 {
		return v.reject(ReasonInvalidFrameID, env)
	}
	if env.Type != "request.experience" && env.CorrelationFrameId == "" {
		return v.reject(ReasonInvalidFrameID, env)
	}
	return nil
}

// reject 构造携带类别与帧 ID 的拒绝错误，供审计日志安全回显低基数字段。
func (v Validator) reject(reason Reason, env *algorithmv1.Envelope) *FrameError {
	category, _ := CategoryOf(env.Type)
	return &FrameError{Reason: reason, Category: category, FrameID: env.FrameId}
}
