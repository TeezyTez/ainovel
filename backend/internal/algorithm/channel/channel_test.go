// 文件职责：集成测试 RuntimeChannel 的收发往返、服务端拒绝/审计与日志脱敏。
// 主要依赖：标准库 testing、google.golang.org/grpc、生成 DTO 与 protobuf。
// 调用边界：启动本地 127.0.0.1 临时监听器做真实 gRPC 往返；不触碰公网或数据库。
// 状态边界：每用例独立起停 server，无跨用例共享状态。
// 安全边界：测试用合成帧，不含真实凭据；日志脱敏用例用标记串验证 payload 绝不出现在日志。

package channel

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// allowAllAuthorizer 是测试用授权器：放行一切会话。
type allowAllAuthorizer struct{}

// AuthorizeConversation 放行任意会话，用于往返与授权失败之外的用例。
func (allowAllAuthorizer) AuthorizeConversation(_ context.Context, _ string) error { return nil }

// echoHandler 是测试用处理器：把 request.* 映射为对应 decision.* 回发。
type echoHandler struct{}

// HandleFrame 生成与请求类型对应的决策帧，并交给适配器补全 correlation。
func (echoHandler) HandleFrame(_ context.Context, frame *algorithmv1.Envelope) (*algorithmv1.Envelope, error) {
	decisionType := decisionTypeFor(frame.Type)
	if decisionType == "" {
		return nil, nil
	}
	return &algorithmv1.Envelope{
		ProtocolVersion: ProtocolVersion,
		FrameId:         "resp_" + frame.FrameId,
		ConversationId:  frame.ConversationId,
		Type:            decisionType,
		ContentType:     ContentTypeProtobuf,
		Payload:         mustMarshal(&algorithmv1.RouteDecision{Route: algorithmv1.RouteKind_ROUTE_KIND_DIRECT}),
	}, nil
}

// decisionTypeFor 把请求类型映射为对应决策类型；非请求类型返回空串。
func decisionTypeFor(requestType string) string {
	switch requestType {
	case "request.route":
		return "decision.route"
	case "request.goal":
		return "decision.goal"
	case "request.taskgraph":
		return "decision.taskgraph"
	case "request.verify":
		return "decision.verification"
	default:
		return ""
	}
}

// mustMarshal 序列化 protobuf 消息；失败即 panic（测试夹具，不允许静默吞错）。
func mustMarshal(m proto.Message) []byte {
	data, err := proto.Marshal(m)
	if err != nil {
		panic(err)
	}
	return data
}

// startServer 在 127.0.0.1 临时端口启动服务端适配器，返回实际地址与停止函数。
func startServer(t *testing.T, opts ServerOptions) (string, func()) {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听临时端口: %v", err)
	}
	srv, err := NewServer(opts)
	if err != nil {
		t.Fatalf("构造服务端: %v", err)
	}
	gs := grpc.NewServer()
	srv.Register(gs)
	go func() { _ = gs.Serve(lis) }()
	return lis.Addr().String(), func() { gs.Stop() }
}

// TestRoundTrip 验证合法 V0.1 帧在真实 gRPC 流上往返并正确关联（AC1）。
func TestRoundTrip(t *testing.T) {
	addr, stop := startServer(t, ServerOptions{Handler: echoHandler{}, Authorizer: allowAllAuthorizer{}})
	defer stop()

	ctx := context.Background()
	client, err := Dial(ctx, ClientOptions{
		Addr:      addr,
		Transport: ClientTransportConfig{InsecurePlaintext: true},
	})
	if err != nil {
		t.Fatalf("拨号: %v", err)
	}
	defer client.Close()

	request := validFrame("request.route", mustMarshal(&algorithmv1.RouteRequest{
		ConversationId: "cnv_0001",
		TurnId:         7,
	}))
	request.FrameId = "frm_req_01"

	resp, err := client.Request(ctx, request)
	if err != nil {
		t.Fatalf("往返失败: %v", err)
	}
	if resp.Type != "decision.route" {
		t.Fatalf("期望 decision.route，得到 %q", resp.Type)
	}
	if resp.CorrelationFrameId != request.FrameId {
		t.Fatalf("关联错误：correlation=%q，期望 %q", resp.CorrelationFrameId, request.FrameId)
	}
	if resp.ConversationId != request.ConversationId {
		t.Fatalf("会话 ID 漂移：%q != %q", resp.ConversationId, request.ConversationId)
	}
	var decision algorithmv1.RouteDecision
	if err := proto.Unmarshal(resp.Payload, &decision); err != nil {
		t.Fatalf("决策 payload 无法反序列化: %v", err)
	}
	if decision.Route != algorithmv1.RouteKind_ROUTE_KIND_DIRECT {
		t.Fatalf("决策路由不匹配: %v", decision.Route)
	}
}

// TestServerRejectsUnauthorizedConversation 验证未授权会话被服务端拒绝并审计（AC2）。
func TestServerRejectsUnauthorizedConversation(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	// 缺省 Authorizer（DenyAll）即拒绝一切会话。
	addr, stop := startServer(t, ServerOptions{Handler: echoHandler{}, Logger: logger})
	defer stop()

	ctx := context.Background()
	client, err := Dial(ctx, ClientOptions{Addr: addr, Transport: ClientTransportConfig{InsecurePlaintext: true}})
	if err != nil {
		t.Fatalf("拨号: %v", err)
	}
	defer client.Close()

	request := validFrame("request.route", mustMarshal(&algorithmv1.RouteRequest{ConversationId: "cnv_secret"}))
	request.ConversationId = "cnv_secret"
	resp, err := client.Request(ctx, request)
	if err != nil {
		t.Fatalf("未授权应回 result.frame，不是流错误: %v", err)
	}
	if resp.GetType() != "result.frame" {
		t.Fatalf("type = %s", resp.GetType())
	}
	var failure algorithmv1.FrameFailure
	if err := proto.Unmarshal(resp.GetPayload(), &failure); err != nil {
		t.Fatal(err)
	}
	if failure.GetCode() != algorithmv1.FrameFailureCode_FRAME_FAILURE_CODE_PRECONDITION || failure.GetReason() != string(ReasonUnauthorizedConversation) {
		t.Fatalf("failure = %v %q", failure.GetCode(), failure.GetReason())
	}
	logs := logBuf.String()
	if !strings.Contains(logs, "unauthorized_conversation") {
		t.Fatalf("审计日志缺少未授权分类: %s", logs)
	}
	if !strings.Contains(logs, "cnv_secret") {
		t.Fatalf("审计日志缺少会话 ID: %s", logs)
	}
}

// TestLogsNeverContainPayload 验证日志只含 frame/category ID，绝不含 payload 字节（AC4）。
func TestLogsNeverContainPayload(t *testing.T) {
	const marker = "SUPER_SECRET_PAYLOAD_XYZ"

	var serverLog bytes.Buffer
	serverLogger := slog.New(slog.NewJSONHandler(&serverLog, nil))
	addr, stop := startServer(t, ServerOptions{Handler: echoHandler{}, Authorizer: allowAllAuthorizer{}, Logger: serverLogger})
	defer stop()

	var clientLog bytes.Buffer
	clientLogger := slog.New(slog.NewJSONHandler(&clientLog, nil))
	client, err := Dial(context.Background(), ClientOptions{
		Addr:      addr,
		Transport: ClientTransportConfig{InsecurePlaintext: true},
		Logger:    clientLogger,
	})
	if err != nil {
		t.Fatalf("拨号: %v", err)
	}
	defer client.Close()

	payload := mustMarshal(&algorithmv1.RouteRequest{ClientContext: marker})
	if !bytes.Contains(payload, []byte(marker)) {
		t.Fatal("测试前置失败：marker 未进入 payload 字节")
	}
	request := validFrame("request.route", payload)
	request.FrameId = "frm_marker_01"
	if _, err := client.Request(context.Background(), request); err != nil {
		t.Fatalf("往返失败: %v", err)
	}

	for name, logs := range map[string]string{"server": serverLog.String(), "client": clientLog.String()} {
		if strings.Contains(logs, marker) {
			t.Fatalf("%s 日志泄露 payload 字节: %s", name, logs)
		}
		if !strings.Contains(logs, "frm_marker_01") {
			t.Fatalf("%s 日志缺少 frame_id: %s", name, logs)
		}
		if !strings.Contains(logs, "request") {
			t.Fatalf("%s 日志缺少类别: %s", name, logs)
		}
	}
}

// scriptedStream 是 ConnectServerStream 的内存实现，用于直接驱动 Server.Connect 做拒绝用例。
type scriptedStream struct {
	inbound  []*algorithmv1.Envelope
	outbound []*algorithmv1.Envelope
	ctx      context.Context
}

// Send 记录出站帧，不真正走网络。
func (s *scriptedStream) Send(m *algorithmv1.Envelope) error {
	s.outbound = append(s.outbound, m)
	return nil
}

// Recv 依脚本返回下一帧入站，耗尽后返回 io.EOF。
func (s *scriptedStream) Recv() (*algorithmv1.Envelope, error) {
	if len(s.inbound) == 0 {
		return nil, io.EOF
	}
	m := s.inbound[0]
	s.inbound = s.inbound[1:]
	return m, nil
}

// 以下为 grpc.ServerStream 接口的桩实现，仅满足类型约束。
func (s *scriptedStream) SetHeader(metadata.MD) error  { return nil }
func (s *scriptedStream) SendHeader(metadata.MD) error { return nil }
func (s *scriptedStream) SetTrailer(metadata.MD)       {}
func (s *scriptedStream) Context() context.Context     { return s.ctx }
func (s *scriptedStream) SendMsg(interface{}) error    { return nil }
func (s *scriptedStream) RecvMsg(interface{}) error    { return io.EOF }

// TestServerRejectsInvalidFrames 验证服务端对未知类型/错误方向/超尺寸帧均拒绝并审计（AC2）。
func TestServerRejectsInvalidFrames(t *testing.T) {
	oversized := make([]byte, DefaultMaxPayloadBytes+1)
	cases := []struct {
		name   string
		frame  *algorithmv1.Envelope
		reason Reason
	}{
		{
			name:   "未知类型",
			frame:  validFrame("request.unknown", nil),
			reason: ReasonUnknownType,
		},
		{
			name:   "错误方向",
			frame:  validFrame("decision.route", nil),
			reason: ReasonWrongDirection,
		},
		{
			name:   "超尺寸 payload",
			frame:  validFrame("request.route", oversized),
			reason: ReasonPayloadTooLarge,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var logBuf bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
			srv, err := NewServer(ServerOptions{Handler: echoHandler{}, Authorizer: allowAllAuthorizer{}, Logger: logger})
			if err != nil {
				t.Fatalf("构造服务端: %v", err)
			}
			stream := &scriptedStream{inbound: []*algorithmv1.Envelope{c.frame}, ctx: context.Background()}
			err = srv.Connect(stream)
			if err != nil {
				t.Fatalf("非法帧应回 result.frame 并保持流，得到 %v", err)
			}
			if len(stream.outbound) != 1 || stream.outbound[0].GetType() != "result.frame" {
				t.Fatalf("应只回一帧 result.frame，得到 %#v", stream.outbound)
			}
			var failure algorithmv1.FrameFailure
			if err := proto.Unmarshal(stream.outbound[0].GetPayload(), &failure); err != nil {
				t.Fatal(err)
			}
			if failure.GetCode() != failureCode(c.reason) || failure.GetReason() != string(c.reason) {
				t.Fatalf("failure = %v %q", failure.GetCode(), failure.GetReason())
			}
			logs := logBuf.String()
			if !strings.Contains(logs, string(c.reason)) {
				t.Fatalf("审计日志缺少分类 %s: %s", c.reason, logs)
			}
			if !strings.Contains(logs, c.frame.FrameId) {
				t.Fatalf("审计日志缺少 frame_id: %s", logs)
			}
		})
	}
}

// hangHandler 挂起直到调用方取消，用于证明 Request 遵守 deadline。
// 它不产生响应或副作用，只把流 Context 的取消原样返回。
type hangHandler struct{}

// HandleFrame 等待请求 Context 结束并返回取消原因。
// 测试借此验证客户端 deadline 能中止服务端处理中等待。
func (hangHandler) HandleFrame(ctx context.Context, _ *algorithmv1.Envelope) (*algorithmv1.Envelope, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

// TestRequestUnavailableEndpoint 证明对端不可用时通道显式失败，不回退 Demo/Fake。
// 关闭的回环端口必须收敛为 Unavailable 或 DeadlineExceeded，且不伪造响应。
func TestRequestUnavailableEndpoint(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	client, err := Dial(ctx, ClientOptions{Addr: addr, Transport: ClientTransportConfig{InsecurePlaintext: true}})
	if err != nil {
		if status.Code(err) == codes.DeadlineExceeded || status.Code(err) == codes.Unavailable {
			return
		}
		if ctx.Err() != nil {
			return
		}
		t.Fatalf("不可用端点应返回 Unavailable/DeadlineExceeded，得到 %v", err)
	}
	defer client.Close()
	frame := validFrame("request.route", nil)
	frame.TurnId = 1
	_, err = client.Request(ctx, frame)
	if err == nil {
		t.Fatal("对已关闭端口的 Request 应失败")
	}
	code := status.Code(err)
	if code != codes.Unavailable && code != codes.DeadlineExceeded && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("不可用应归为 Unavailable/DeadlineExceeded，得到 code=%s err=%v", code, err)
	}
}

// TestRequestDeadlineExceeded 证明对端挂起时通道按 deadline 失败，不无限等待。
func TestRequestDeadlineExceeded(t *testing.T) {
	addr, stop := startServer(t, ServerOptions{Handler: hangHandler{}, Authorizer: allowAllAuthorizer{}})
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	client, err := Dial(ctx, ClientOptions{Addr: addr, Transport: ClientTransportConfig{InsecurePlaintext: true}})
	if err != nil {
		t.Fatalf("拨号: %v", err)
	}
	defer client.Close()
	frame := validFrame("request.route", nil)
	frame.TurnId = 1
	_, err = client.Request(ctx, frame)
	if err == nil {
		t.Fatal("挂起处理应超时")
	}
	if status.Code(err) != codes.DeadlineExceeded && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("超时应归为 DeadlineExceeded，得到 %v", err)
	}
}
