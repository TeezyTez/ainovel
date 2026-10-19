// 文件职责：定义 Conversation 授权 seam 与 fail-closed 默认实现。
// 主要依赖：标准库 context 与 errors.go。
// 调用边界：被 server.go / client.go 在收到携带会话 ID 的入站帧时调用。
// 状态边界：授权器是无状态函数 seam，不持有会话或业务状态。
// 安全边界：默认拒绝一切会话，未显式注入授权逻辑前绝不放行任何帧。

package channel

import "context"

// ConversationAuthorizer 判定后端是否有权为某 Conversation 收发帧。
//
// 返回 nil 表示授权通过；返回错误表示拒绝，通道据此审计并中止该帧。
// 实现必须只依据 conversationID 与 context 判定，不得依赖帧 payload 或正文。
type ConversationAuthorizer interface {
	AuthorizeConversation(ctx context.Context, conversationID string) error
}

// DenyAllAuthorizer 是 fail-closed 的默认授权器：未注入真实授权逻辑前拒绝一切会话。
// 它保证缺配置时通道绝不伪造授权，符合「缺配置 fail-closed，不伪造连接」的边界。
type DenyAllAuthorizer struct{}

// AuthorizeConversation 对任意会话一律返回未授权错误，不泄露会话是否存在。
func (DenyAllAuthorizer) AuthorizeConversation(_ context.Context, _ string) error {
	return &FrameError{Reason: ReasonUnauthorizedConversation}
}
