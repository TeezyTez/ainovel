// 文件职责：定义通道传输错误的稳定分类码与类型化错误，错误体只含低基数安全字段。
// 主要依赖：无（纯类型定义）。
// 调用边界：被 validate.go / authorizer.go / server.go / client.go 返回或判定。
// 状态边界：错误是纯值，不携带事务或流状态。
// 安全边界：Error() 只回显稳定机器码 reason，绝不携带 payload 字节、正文或 raw peer 错误。

package channel

// Reason 是通道拒绝/审计帧的稳定分类码，供日志与 errors.Is 分类使用。
type Reason string

const (
	// ReasonVersionMismatch 表示帧的协议版本与 ProtocolVersion 不一致。
	ReasonVersionMismatch Reason = "version_mismatch"
	// ReasonUnknownType 表示帧 type 不在 V0.1 冻结类型表内。
	ReasonUnknownType Reason = "unknown_type"
	// ReasonWrongDirection 表示帧 type 的合法流向与当前收发方向不符。
	ReasonWrongDirection Reason = "wrong_direction"
	// ReasonPayloadTooLarge 表示帧 payload 超过配置上限。
	ReasonPayloadTooLarge Reason = "payload_too_large"
	// ReasonInvalidContentType 表示帧 content_type 不是 application/protobuf。
	ReasonInvalidContentType Reason = "invalid_content_type"
	// ReasonUnauthorizedConversation 表示帧引用的 Conversation 未通过授权。
	ReasonUnauthorizedConversation Reason = "unauthorized_conversation"
	// ReasonInvalidFrameID 表示帧缺少用于幂等/关联的 frame_id。
	ReasonInvalidFrameID Reason = "invalid_frame_id"
	// ReasonHandlerError 表示帧已通过协议校验但业务处理器返回错误。
	ReasonHandlerError Reason = "handler_error"
)

// FrameError 是通道帧被拒绝时的类型化错误，携带分类码与安全审计字段。
// Category 与 FrameID 分别是帧类别与帧 ID（低基数安全值），供审计日志回显。
type FrameError struct {
	Reason   Reason
	Category string
	FrameID  string
}

// Error 返回不含敏感内容的稳定文本：仅包含分类码，不携带 payload 或正文。
func (e *FrameError) Error() string {
	if e == nil {
		return "channel frame rejected"
	}
	return "channel frame rejected: " + string(e.Reason)
}
