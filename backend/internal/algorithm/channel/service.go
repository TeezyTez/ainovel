// 文件职责：手写 RuntimeChannel 的 gRPC 服务描述与双向流接口（同构 protoc-gen-go-grpc 生成物）。
// 主要依赖：google.golang.org/grpc 与生成 DTO algorithmv1.Envelope。
// 调用边界：被 server.go 注册服务、client.go 打开流；序列化仍走 protobuf codec。
// 状态边界：纯声明，不持有连接或流状态。
// 安全边界：不自定义序列化，杜绝手写第二套线格式与由此引入的解码风险。

package channel

import (
	"google.golang.org/grpc"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

const (
	serviceName       = "telos.algorithm.v1.RuntimeChannel"
	connectMethodName = "Connect"
)

// ConnectMethod 是 Connect 双向流的完整 gRPC 方法名（含前导斜杠），供客户端 NewStream 使用。
const ConnectMethod = "/" + serviceName + "/" + connectMethodName

// ConnectServerStream 是 Connect 双向流的服务端接口，等价 protoc-gen-go-grpc 生成类型。
type ConnectServerStream interface {
	Send(*algorithmv1.Envelope) error
	Recv() (*algorithmv1.Envelope, error)
	grpc.ServerStream
}

// ConnectClientStream 是 Connect 双向流的客户端接口，等价 protoc-gen-go-grpc 生成类型。
type ConnectClientStream interface {
	Send(*algorithmv1.Envelope) error
	Recv() (*algorithmv1.Envelope, error)
	grpc.ClientStream
}

// ConnectHandler 是服务端对每条双向流的处理 seam，由 Server 适配器实现。
//
// 实现方负责在 stream 上循环 Recv/Send；该接口仅用于 grpc.RegisterService 的类型断言，
// 业务侧应面向 Server 暴露的 FrameHandler 编程，而非直接实现本接口。
type ConnectHandler interface {
	Connect(ConnectServerStream) error
}

// streamDesc 是 Connect 双向流描述，同时用于服务端注册与客户端 NewStream。
// Handler 仅服务端注册时被 grpc 使用，客户端 NewStream 会忽略该字段。
var streamDesc = grpc.StreamDesc{
	StreamName:    connectMethodName,
	Handler:       connectHandler,
	ServerStreams: true,
	ClientStreams: true,
}

// connectHandler 把 grpc 原始流适配为 ConnectServerStream 并转交 ConnectHandler。
// 服务实现类型不满足 ConnectHandler 时返回内部错误，不泄露任何帧内容。
func connectHandler(srv interface{}, stream grpc.ServerStream) error {
	h, ok := srv.(ConnectHandler)
	if !ok {
		return errHandlerMismatch
	}
	return h.Connect(&connectServerStream{ServerStream: stream})
}

// serviceDesc 是 RuntimeChannel 服务描述；HandlerType 用 ConnectHandler 接口做注册期类型断言。
var serviceDesc = grpc.ServiceDesc{
	ServiceName: serviceName,
	HandlerType: (*ConnectHandler)(nil),
	Streams:     []grpc.StreamDesc{streamDesc},
	Metadata:    "algorithm/v1/runtime.proto",
}

// connectServerStream 把 grpc.ServerStream 包装成 ConnectServerStream。
type connectServerStream struct {
	grpc.ServerStream
}

// Send 序列化并发送一帧 Envelope；序列化由 grpc 默认 protobuf codec 完成。
func (s *connectServerStream) Send(m *algorithmv1.Envelope) error {
	return s.ServerStream.SendMsg(m)
}

// Recv 接收并反序列化一帧 Envelope；反序列化由 grpc 默认 protobuf codec 完成。
func (s *connectServerStream) Recv() (*algorithmv1.Envelope, error) {
	m := new(algorithmv1.Envelope)
	if err := s.ServerStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

// connectClientStream 把 grpc.ClientStream 包装成 ConnectClientStream。
type connectClientStream struct {
	grpc.ClientStream
}

// Send 序列化并发送一帧 Envelope；序列化由 grpc 默认 protobuf codec 完成。
func (s *connectClientStream) Send(m *algorithmv1.Envelope) error {
	return s.ClientStream.SendMsg(m)
}

// Recv 接收并反序列化一帧 Envelope；反序列化由 grpc 默认 protobuf codec 完成。
func (s *connectClientStream) Recv() (*algorithmv1.Envelope, error) {
	m := new(algorithmv1.Envelope)
	if err := s.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}
