// 文件职责：RuntimeChannel 服务端适配器——校验/授权入站帧、派发到 FrameHandler、回送出站帧。
// 主要依赖：标准库 context/errors/io/log/slog、google.golang.org/grpc 与 protobuf、本包校验/授权。
// 调用边界：装配层 NewServer + Register 挂到 grpc.Server；连接生命周期由 grpc 管理。
// 状态边界：不拥有业务终态；帧语义由 FrameHandler 决定，本适配器只做协议边界。
// 安全边界：拒绝只回显 FrameFailureCode 与稳定 reason，授权错误/传输错误不回显 raw peer 错误，payload 绝不进日志。

package channel

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// errHandlerMismatch 是服务实现不满足 ConnectHandler 接口时的内部错误，不含任何帧内容。
var errHandlerMismatch = status.Error(codes.Internal, "RuntimeChannel 服务实现不满足 ConnectHandler 接口")

// errStreamDead 表示传输本身坏了，不是这一帧的失败。Connect 把它交回 gRPC，整条流结束。
// 帧失败回 result.frame，不得用这个错误。
var errStreamDead = errors.New("channel stream dead")

// FrameHandler 是算法侧处理已校验入站帧的业务 seam。
//
// 入站帧已通过版本/类型/方向/尺寸/内容类型/授权校验；返回的出站帧（可为 nil）
// 由适配器补全 correlation_frame_id 并做方向校验后回发。
// 普通错误是这一帧的失败，适配器回 result.frame 并继续读下一条。
// 只有 context 取消/超时，或 errStreamDead，才中止整条流。
type FrameHandler interface {
	HandleFrame(ctx context.Context, frame *algorithmv1.Envelope) (*algorithmv1.Envelope, error)
}

// ServerOptions 装配服务端适配器；Handler 必填，Authorizer 缺省为拒绝一切。
type ServerOptions struct {
	Handler         FrameHandler
	Authorizer      ConversationAuthorizer
	MaxPayloadBytes int
	Logger          *slog.Logger
}

// Server 是 RuntimeChannel 服务端适配器，只负责协议边界。
type Server struct {
	handler    FrameHandler
	authorizer ConversationAuthorizer
	validator  Validator
	logger     *slog.Logger
}

// NewServer 校验选项并构造服务端适配器。
//
// Handler 为 nil 时返回错误；Authorizer 为 nil 时回落为拒绝一切的 DenyAllAuthorizer，
// 保证缺配置时不伪造授权。
func NewServer(opts ServerOptions) (*Server, error) {
	if opts.Handler == nil {
		return nil, errors.New("缺少帧处理器 FrameHandler")
	}
	authorizer := opts.Authorizer
	if authorizer == nil {
		authorizer = DenyAllAuthorizer{}
	}
	return &Server{
		handler:    opts.Handler,
		authorizer: authorizer,
		validator:  Validator{MaxPayloadBytes: opts.MaxPayloadBytes},
		logger:     opts.Logger,
	}, nil
}

// Register 把 RuntimeChannel 服务注册到给定 gRPC Server。
func (s *Server) Register(gs *grpc.Server) {
	gs.RegisterService(&serviceDesc, s)
}

// Connect 实现 ConnectHandler，处理一条双向流的完整生命周期。
//
// 循环接收入站帧：EOF 视为正常关闭。校验失败、授权失败、处理器的普通错误都回
// result.frame 并继续下一条，不把这一帧变成整条流的 gRPC 状态。
// context 取消/超时与 errStreamDead 才结束流。任何阶段都只回显稳定分类码。
func (s *Server) Connect(stream ConnectServerStream) error {
	ctx := stream.Context()
	for {
		in, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		if verr := s.validator.Validate(in, DirectionBackendToAlgorithm); verr != nil {
			fe := asFrameError(verr)
			auditFrame(s.logger, slog.LevelWarn, "channel.frame.rejected", fe.Category, fe.FrameID, in.GetConversationId(), fe.Reason)
			if err := s.replyFailure(stream, in, fe.Reason); err != nil {
				return err
			}
			continue
		}

		if aerr := s.authorizer.AuthorizeConversation(ctx, in.ConversationId); aerr != nil {
			category, _ := CategoryOf(in.Type)
			auditFrame(s.logger, slog.LevelWarn, "channel.frame.rejected", category, in.FrameId, in.ConversationId, ReasonUnauthorizedConversation)
			if err := s.replyFailure(stream, in, ReasonUnauthorizedConversation); err != nil {
				return err
			}
			continue
		}

		category, _ := CategoryOf(in.Type)
		auditFrame(s.logger, slog.LevelInfo, "channel.frame.accepted", category, in.FrameId, in.ConversationId, "")

		out, herr := s.handler.HandleFrame(ctx, in)
		if herr != nil {
			if streamDead(herr) {
				return herr
			}
			auditFrame(s.logger, slog.LevelWarn, "channel.frame.handler_error", category, in.FrameId, in.ConversationId, ReasonHandlerError)
			if err := s.replyFailure(stream, in, ReasonHandlerError); err != nil {
				return err
			}
			continue
		}
		if out == nil {
			continue
		}
		if out.CorrelationFrameId == "" {
			out.CorrelationFrameId = in.FrameId
		}
		if verr := s.validator.Validate(out, DirectionAlgorithmToBackend); verr != nil {
			fe := asFrameError(verr)
			auditFrame(s.logger, slog.LevelWarn, "channel.frame.rejected", fe.Category, fe.FrameID, out.ConversationId, fe.Reason)
			if err := s.replyFailure(stream, in, fe.Reason); err != nil {
				return err
			}
			continue
		}
		if serr := stream.Send(out); serr != nil {
			return serr
		}
	}
}

// asFrameError 把校验错误归一为 *FrameError；非 FrameError 时以未知类型兜底。
// 兜底保证审计字段始终可用，绝不回显底层错误文本。
func asFrameError(err error) *FrameError {
	var fe *FrameError
	if errors.As(err, &fe) {
		return fe
	}
	return &FrameError{Reason: ReasonUnknownType}
}

// replyFailure 把这一帧的拒绝写成 result.frame 发回，不结束流。
// reason 是通道的稳定分类，code 是同一件事的线合同枚举。两者都不带 payload。
func (s *Server) replyFailure(stream ConnectServerStream, in *algorithmv1.Envelope, reason Reason) error {
	if in == nil {
		return status.Error(codes.Internal, "channel frame rejected")
	}
	body, err := proto.Marshal(&algorithmv1.FrameFailure{
		Code:   failureCode(reason),
		Reason: string(reason),
	})
	if err != nil {
		return status.Error(codes.Internal, "channel frame rejected")
	}
	frameID := in.FrameId
	if frameID == "" {
		frameID = "frame"
	}
	out := &algorithmv1.Envelope{
		ProtocolVersion:    ProtocolVersion,
		FrameId:            frameID + ":fail",
		CorrelationFrameId: in.FrameId,
		ConversationId:     in.ConversationId,
		TurnId:             in.TurnId,
		Type:               "result.frame",
		ContentType:        ContentTypeProtobuf,
		Payload:            body,
	}
	if verr := s.validator.Validate(out, DirectionAlgorithmToBackend); verr != nil {
		return status.Error(codes.Internal, "channel failure frame invalid")
	}
	return stream.Send(out)
}

// failureCode 把通道拒绝分类映射成线合同 FrameFailureCode。
// 超尺寸是 TOO_LARGE，不是 CAPACITY；不认识的类型是 UNSUPPORTED_TYPE，不是非法上下文。
func failureCode(r Reason) algorithmv1.FrameFailureCode {
	switch r {
	case ReasonUnknownType:
		return algorithmv1.FrameFailureCode_FRAME_FAILURE_CODE_UNSUPPORTED_TYPE
	case ReasonPayloadTooLarge:
		return algorithmv1.FrameFailureCode_FRAME_FAILURE_CODE_TOO_LARGE
	case ReasonUnauthorizedConversation:
		return algorithmv1.FrameFailureCode_FRAME_FAILURE_CODE_PRECONDITION
	case ReasonHandlerError:
		return algorithmv1.FrameFailureCode_FRAME_FAILURE_CODE_INTERNAL
	default:
		return algorithmv1.FrameFailureCode_FRAME_FAILURE_CODE_INVALID_CONTEXT
	}
}

// streamDead 只认传输已经结束的错误。普通处理器错误不是其中之一。
func streamDead(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, errStreamDead)
}
