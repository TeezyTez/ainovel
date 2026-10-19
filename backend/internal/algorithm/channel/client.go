// 文件职责：RuntimeChannel 客户端适配器——后端拨号连接 Algorithm、收发并关联帧。
// 主要依赖：标准库 context/log/slog、google.golang.org/grpc 与本包校验/传输配置。
// 调用边界：装配层 Dial 建立连接；Send/Recv/Request 供上层 Outbox（Ticket 19）投递与取回。
// 状态边界：只持有一条双向流与连接，不拥有业务终态；correlation 只做收发关联。
// 安全边界：出/入站帧均经方向与尺寸校验；日志只记 frame/category ID，不记 payload 字节。

package channel

import (
	"context"
	"errors"
	"log/slog"

	"google.golang.org/grpc"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// ClientOptions 装配客户端；Addr 与 Transport 必填，缺省即 Dial 失败。
type ClientOptions struct {
	Addr            string
	Transport       ClientTransportConfig
	MaxPayloadBytes int
	Logger          *slog.Logger
}

// Client 是 RuntimeChannel 客户端适配器，持有一条到 Algorithm 的双向流。
type Client struct {
	stream    ConnectClientStream
	conn      *grpc.ClientConn
	validator Validator
	logger    *slog.Logger
}

// Dial 建立到 Algorithm 的 gRPC 连接并打开 Connect 双向流。
//
// Transport 先经 Validate/DialOption 做 fail-closed 校验（生产强制 mTLS），
// 拨号与开流任一失败即返回错误并关闭连接，绝不伪造可用通道。
func Dial(ctx context.Context, opts ClientOptions) (*Client, error) {
	if opts.Addr == "" {
		return nil, errors.New("缺少 Algorithm 通道地址")
	}
	dialOpt, err := opts.Transport.DialOption()
	if err != nil {
		return nil, err
	}
	conn, err := grpc.DialContext(ctx, opts.Addr, dialOpt)
	if err != nil {
		return nil, err
	}
	stream, err := conn.NewStream(ctx, &streamDesc, ConnectMethod)
	if err != nil {
		conn.Close()
		return nil, err
	}
	return &Client{
		stream:    &connectClientStream{ClientStream: stream},
		conn:      conn,
		validator: Validator{MaxPayloadBytes: opts.MaxPayloadBytes},
		logger:    opts.Logger,
	}, nil
}

// Send 校验并发送一帧出站请求（必须为 backend→algorithm 方向）。
//
// 校验失败返回 *FrameError 并审计；发送失败透传底层错误，不记录 payload。
func (c *Client) Send(ctx context.Context, env *algorithmv1.Envelope) error {
	if verr := c.validator.Validate(env, DirectionBackendToAlgorithm); verr != nil {
		fe := asFrameError(verr)
		auditFrame(c.logger, slog.LevelWarn, "channel.frame.rejected", fe.Category, fe.FrameID, env.ConversationId, fe.Reason)
		return verr
	}
	category, _ := CategoryOf(env.Type)
	auditFrame(c.logger, slog.LevelInfo, "channel.frame.accepted", category, env.FrameId, env.ConversationId, "")
	if err := c.stream.Send(env); err != nil {
		return err
	}
	return nil
}

// Recv 接收并校验一帧入站决策（必须为 algorithm->backend 方向）。
//
// 流关闭返回 io.EOF；校验失败返回 *FrameError（同时回传被拒帧，供上层按 correlation_frame_id
// 定位它的等待者）并审计；其余透传底层错误。
func (c *Client) Recv(ctx context.Context) (*algorithmv1.Envelope, error) {
	env, err := c.stream.Recv()
	if err != nil {
		return nil, err
	}
	if verr := c.validator.Validate(env, DirectionAlgorithmToBackend); verr != nil {
		fe := asFrameError(verr)
		auditFrame(c.logger, slog.LevelWarn, "channel.frame.rejected", fe.Category, fe.FrameID, env.ConversationId, fe.Reason)
		return env, verr
	}
	category, _ := CategoryOf(env.Type)
	auditFrame(c.logger, slog.LevelInfo, "channel.frame.accepted", category, env.FrameId, env.ConversationId, "")
	return env, nil
}

// Request 发送请求帧并等待关联响应：循环接收直到 correlation_frame_id 与请求 frame_id 匹配。
//
// 这是 send/receive 关联的通道职责；不匹配的中间帧被跳过（交由调用方再消费的场景除外，
// 此处仅等待本请求的关联响应）。ctx 取消或流关闭时返回相应错误。
func (c *Client) Request(ctx context.Context, env *algorithmv1.Envelope) (*algorithmv1.Envelope, error) {
	if err := c.Send(ctx, env); err != nil {
		return nil, err
	}
	for {
		resp, err := c.Recv(ctx)
		if err != nil {
			return nil, err
		}
		if resp.CorrelationFrameId == env.FrameId {
			return resp, nil
		}
		auditFrame(c.logger, slog.LevelWarn, "channel.frame.unmatched", "", resp.FrameId, resp.ConversationId, "")
	}
}

// Close 关闭底层流与连接；重复调用安全。
func (c *Client) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}
