// 文件职责：冻结 V0.2 帧类型、合法流向与协议常量（对齐 spec.md §5.7 的类型与方向表）。
// 主要依赖：仅标准库 strings。
// 调用边界：被 validate.go / server.go / client.go 引用；只读查表，不改状态。
// 状态边界：纯函数查表，无可变状态。
// 安全边界：只暴露类型与方向这类低基数枚举，不回显任何正文或凭据。

package channel

import "strings"

// ProtocolVersion 是冻结的 V0.2 运行时通道协议版本串，帧的 protocol_version 必须精确匹配。
const ProtocolVersion = "v0.2"

// ContentTypeProtobuf 是帧 payload 的唯一 V0.2 内容类型。
// V0.2 各 request/decision/event 消息均由 protobuf 序列化，content_type 固定为该值。
const ContentTypeProtobuf = "application/protobuf"

// DefaultMaxPayloadBytes 是帧 payload 的默认上限（1 MiB），可经 Validator 配置覆盖。
const DefaultMaxPayloadBytes = 1 << 20

// Direction 表示帧在 Backend 与 Algorithm 之间的合法流向。
type Direction int

const (
	// DirectionBackendToAlgorithm 表示帧由后端发往算法（request.* 与 event.execution）。
	DirectionBackendToAlgorithm Direction = iota
	// DirectionAlgorithmToBackend 表示帧由算法发往后端（decision.*）。
	DirectionAlgorithmToBackend
)

// frameDirections 是 V0.2 帧类型到合法方向的固定映射，直接冻结 spec.md §5.7 的方向表。
// 未列入映射的类型一律视为未知类型，方向校验时拒绝。
var frameDirections = map[string]Direction{
	"request.model":         DirectionAlgorithmToBackend,
	"result.model":          DirectionBackendToAlgorithm,
	"request.context_read":  DirectionAlgorithmToBackend,
	"result.context_read":   DirectionBackendToAlgorithm,
	"request.direct":        DirectionBackendToAlgorithm,
	"decision.direct":       DirectionAlgorithmToBackend,
	"request.route":         DirectionBackendToAlgorithm,
	"request.summary":       DirectionBackendToAlgorithm,
	"decision.summary":      DirectionAlgorithmToBackend,
	"decision.route":        DirectionAlgorithmToBackend,
	"request.goal":          DirectionBackendToAlgorithm,
	"decision.goal":         DirectionAlgorithmToBackend,
	"request.taskgraph":     DirectionBackendToAlgorithm,
	"decision.taskgraph":    DirectionAlgorithmToBackend,
	"request.verify":        DirectionBackendToAlgorithm,
	"decision.verification": DirectionAlgorithmToBackend,
	"event.execution":       DirectionBackendToAlgorithm,
	// result.frame 是算法对单个请求帧的失败答复（FrameFailure）。方向与 decision 相同，
	// 但它不是决策：后端据此结束这一个请求，不把它当成整条流断了。
	"result.frame": DirectionAlgorithmToBackend,
}

// DirectionOf 返回给定帧类型的合法方向；类型未知时第二个返回值为 false。
// 调用方据此区分「未知类型」与「方向错误」两类拒绝原因。
func DirectionOf(typ string) (Direction, bool) {
	d, ok := frameDirections[typ]
	return d, ok
}

// CategoryOf 把帧类型拆分为类别（request/decision/event）与种类（route/goal/...）。
// 类型不含 '.' 时类别为空、种类为原串，供审计日志安全记录低基数类别。
func CategoryOf(typ string) (category, kind string) {
	if i := strings.IndexByte(typ, '.'); i >= 0 {
		return typ[:i], typ[i+1:]
	}
	return "", typ
}
