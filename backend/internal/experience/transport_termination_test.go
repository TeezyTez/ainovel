package experience

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type terminationServer struct {
	replies chan *pb.Envelope
	streams atomic.Int32
	noModel bool
}

func (s *terminationServer) Connect(stream grpc.ServerStream) error {
	s.streams.Add(1)
	for {
		in := new(pb.Envelope)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		switch in.Type {
		case "request.experience":
			if s.noModel {
				s.replies <- in
				continue
			}
			call := &pb.ModelCallRequest{Model: "world-explicit", Messages: []*pb.ModelMessage{{Role: "user", Content: in.ConversationId}}, SchemaJson: `{"type":"object"}`, MaxOutputBytes: 4096}
			payload, _ := proto.Marshal(call)
			if err := stream.SendMsg(&pb.Envelope{ProtocolVersion: ProtocolVersion, FrameId: in.FrameId + ":model:1", CorrelationFrameId: in.FrameId, ConversationId: in.ConversationId, TurnId: in.TurnId, Type: "request.model", ContentType: channel.ContentTypeProtobuf, Payload: payload}); err != nil {
				return err
			}
		case "result.model":
			s.replies <- in
			if in.ConversationId == "fast" {
				base := strings.TrimSuffix(in.FrameId, ":model:1:result")
				payload, _ := json.Marshal(sampleCandidate())
				if err := stream.SendMsg(&pb.Envelope{ProtocolVersion: ProtocolVersion, FrameId: base + ":decision", CorrelationFrameId: base, ConversationId: in.ConversationId, TurnId: in.TurnId, Type: "decision.experience", ContentType: "application/json", Payload: payload}); err != nil {
					return err
				}
			}
		case "result.frame":
			s.replies <- in
		}
	}
}
func startTerminationServer(t *testing.T, srv *terminationServer) string {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	gs := grpc.NewServer()
	gs.RegisterService(&grpc.ServiceDesc{ServiceName: "telos.algorithm.v1.RuntimeChannel", HandlerType: (*testConnect)(nil), Streams: []grpc.StreamDesc{{StreamName: "Connect", ClientStreams: true, ServerStreams: true, Handler: func(s any, ss grpc.ServerStream) error { return s.(testConnect).Connect(ss) }}}}, srv)
	go gs.Serve(lis)
	t.Cleanup(gs.Stop)
	return lis.Addr().String()
}

type deadlineModel struct{ started chan struct{} }

func (m *deadlineModel) Generate(ctx context.Context, r model.Request) (model.Result, error) {
	if r.Messages[0].Content == "slow" {
		close(m.started)
		<-ctx.Done()
		return model.Result{}, ctx.Err()
	}
	return model.Result{Text: `{"model":"中文"}`}, nil
}
func (*deadlineModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return errors.New("unused")
}
func awaitWire(t *testing.T, ch <-chan *pb.Envelope) *pb.Envelope {
	t.Helper()
	select {
	case r := <-ch:
		return r
	case <-time.After(3 * time.Second):
		t.Fatal("no bounded wire receipt")
		return nil
	}
}

// Real gRPC and one shared stream: model deadline/cancel is confined to its
// root; another root finishes while the slow model is still outstanding, and a
// later root finishes on the SAME stream. No external models and no PG here.
func TestModelTerminationReceiptAndSharedRootIsolation(t *testing.T) {
	for _, reason := range []string{"deadline", "cancel"} {
		t.Run(reason, func(t *testing.T) {
			srv := &terminationServer{replies: make(chan *pb.Envelope, 16)}
			link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: startTerminationServer(t, srv), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
			defer link.Close()
			m := &deadlineModel{started: make(chan struct{})}
			a := Algorithm{Link: link, Model: m, ModelName: "world-explicit", Timeout: 3 * time.Second, ModelContextTokens: 131072, ModelByteTokenBoundVerified: true}
			slow := sampleContext()
			slow.ExperienceID = "slow"
			ctx, cancel := context.WithCancel(context.Background())
			if reason == "deadline" {
				ctx, cancel = context.WithTimeout(context.Background(), 400*time.Millisecond)
			}
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := a.Generate(ctx, slow, "root-slow"); done <- err }()
			select {
			case <-m.started:
			case <-time.After(2 * time.Second):
				t.Fatal("slow model never started")
			}
			fast := sampleContext()
			fast.ExperienceID = "fast"
			if _, err := a.Generate(context.Background(), fast, "root-fast"); err != nil {
				t.Fatalf("independent fast root: %v", err)
			}
			if reason == "cancel" {
				cancel()
			}
			err := <-done
			expected, code := context.Canceled, "model_canceled"
			if reason == "deadline" {
				expected = context.DeadlineExceeded
				code = "model_deadline_exceeded"
			}
			// For deadline mode cancellation must happen by the deadline, not explicit cancel.
			if !errors.Is(err, expected) {
				t.Fatalf("slow result: %v expected %v", err, expected)
			}
			slowReceipt := false
			for i := 0; i < 3; i++ {
				frame := awaitWire(t, srv.replies)
				if frame.Type == "result.model" && frame.ConversationId == "slow" {
					var result pb.ModelCallResult
					if proto.Unmarshal(frame.Payload, &result) != nil || result.ErrorCode != code {
						t.Fatalf("wrong named receipt: %+v", &result)
					}
					slowReceipt = true
				}
			}
			if !slowReceipt {
				t.Fatal("outstanding model was not answered")
			}
			if _, err := a.Generate(context.Background(), fast, "root-next"); err != nil {
				t.Fatalf("next root: %v", err)
			}
			if srv.streams.Load() != 1 {
				t.Fatalf("normal root cancellation reset shared stream: %d", srv.streams.Load())
			}
		})
	}
}

// Root interruption also covers a reverse request that hasn't arrived yet;
// only a root receipt can do this (inventing a model callback ID is not allowed).
func TestRootTerminationBeforeAnyReverseCallback(t *testing.T) {
	srv := &terminationServer{replies: make(chan *pb.Envelope, 4), noModel: true}
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: startTerminationServer(t, srv), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	a := Algorithm{Link: link, Model: &carrierModel{}, ModelName: "world-explicit", Timeout: 100 * time.Millisecond, ModelContextTokens: 131072, ModelByteTokenBoundVerified: true}
	_, err := a.Generate(context.Background(), sampleContext(), "root-before-callback")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("%v", err)
	}
	_ = awaitWire(t, srv.replies)
	frame := awaitWire(t, srv.replies)
	var failure pb.FrameFailure
	if frame.Type != "result.frame" || frame.CorrelationFrameId != "root-before-callback" || proto.Unmarshal(frame.Payload, &failure) != nil || failure.Reason != "model_deadline_exceeded" {
		t.Fatalf("root not interrupted: %v", frame)
	}
}
