// 文件职责：通道审计日志——只记 frame/category/conversation ID 与分类原因，绝不记 payload 字节。
// 主要依赖：标准库 context、log/slog 与 errors.go。
// 调用边界：被 server.go / client.go 在帧接受或拒绝时调用。
// 状态边界：无状态，仅向注入的 *slog.Logger 追加安全字段。
// 安全边界：字段白名单为 category/frame_id/conversation_id/reason 四类低基数安全值。

package channel

import (
	"context"
	"log/slog"
)

// auditFrame 记录一条帧审计事件。
//
// level 区分接受（Info）与拒绝/异常（Warn）；event 是有界标签（如 channel.frame.accepted），
// 字段只含 category、frame_id、conversation_id 与 reason 等低基数安全值，空值字段被省略；
// logger 为 nil 时静默丢弃，绝不 panic。
func auditFrame(l *slog.Logger, level slog.Level, event string, category, frameID, conversationID string, reason Reason) {
	if l == nil {
		return
	}
	attrs := make([]any, 0, 8)
	if category != "" {
		attrs = append(attrs, "category", category)
	}
	if frameID != "" {
		attrs = append(attrs, "frame_id", frameID)
	}
	if conversationID != "" {
		attrs = append(attrs, "conversation_id", conversationID)
	}
	if reason != "" {
		attrs = append(attrs, "reason", string(reason))
	}
	l.Log(context.Background(), level, event, attrs...)
}
