package experience

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// A fixed loopback worker/provider exercises Go error transport, not Rust
// generation, a real model, narrative semantics or a database transaction.
type captureFailureModel struct {
	calls       atomic.Int32
	reviewCalls atomic.Int32
	outputs     map[string]any
}

func (m *captureFailureModel) Generate(_ context.Context, request model.Request) (model.Result, error) {
	m.calls.Add(1)
	stage := request.Messages[0].Content
	if stage == "review" {
		m.reviewCalls.Add(1)
	}
	output, ok := m.outputs[stage]
	if !ok {
		return model.Result{}, fmt.Errorf("unexpected fixed stage %q", stage)
	}
	return model.Result{Text: string(narrativeMarshal(map[string]any{"result": output}))}, nil
}
func (*captureFailureModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return errors.New("unused fixed stream")
}

type captureFailureReader struct{ origin narrativeEvidenceOrigin }

func (r captureFailureReader) MemoryEvidenceOrigin(context.Context) (narrativeEvidenceOrigin, error) {
	return r.origin, nil
}
func (captureFailureReader) RecordModel(context.Context, Context, int, []byte) error { return nil }
func (captureFailureReader) Read(context.Context, ReadRequest) (ReadReply, error) {
	return ReadReply{}, errors.New("unexpected read in fixed transport control")
}

type captureFailureWireResult struct {
	reviewReply string
	reviewCode  string
	terminated  bool
	err         error
}
type captureFailureWorker struct {
	context   Context
	candidate Candidate
	done      chan captureFailureWireResult
}

func (w *captureFailureWorker) Connect(stream grpc.ServerStream) (err error) {
	report := captureFailureWireResult{}
	defer func() { report.err = err; w.done <- report }()
	root := new(pb.Envelope)
	if err = stream.RecvMsg(root); err != nil {
		return err
	}
	for i, stage := range []string{"memory", "plan", "evaluate", "write", "extract", "review"} {
		body := map[string]any{"context": reviewHydrationWireContext(w.context, w.context.State)}
		if stage == "write" {
			body["selected_plan"] = map[string]any{"id": "wait"}
		}
		if stage == "extract" {
			body["draft"] = narrativeDraft{w.candidate.Title, w.candidate.Passage, w.candidate.StoryTime, w.candidate.Outcome, w.candidate.Suggestions}
		}
		if stage == "review" {
			body["candidate"] = w.candidate
		}
		call := &pb.ModelCallRequest{NarrativeStage: stage, Model: "capture-fixed",
			Messages:   []*pb.ModelMessage{{Role: "system", Content: stage}, {Role: "user", Content: string(narrativeMarshal(body))}},
			SchemaJson: `{"type":"object"}`, MaxOutputBytes: 65536}
		payload, _ := proto.Marshal(call)
		request := &pb.Envelope{ProtocolVersion: root.ProtocolVersion, FrameId: fmt.Sprintf("%s:model:%d", root.FrameId, i+1),
			CorrelationFrameId: root.FrameId, ConversationId: root.ConversationId, TurnId: root.TurnId, EventSeq: root.EventSeq,
			Type: "request.model", ContentType: channel.ContentTypeProtobuf, Payload: payload}
		if err = stream.SendMsg(request); err != nil {
			return err
		}
		reply := new(pb.Envelope)
		if err = stream.RecvMsg(reply); err != nil {
			return err
		}
		if stage != "review" {
			var result pb.ModelCallResult
			if reply.Type != "result.model" || proto.Unmarshal(reply.Payload, &result) != nil || result.ErrorCode != "" {
				return fmt.Errorf("fixed prefix %s failed: %s", stage, reply.Type)
			}
			continue
		}
		report.reviewReply = reply.Type
		if reply.Type == "result.frame" {
			report.terminated = reply.FrameId == root.FrameId+":terminated"
			return nil
		}
		if reply.Type != "result.model" {
			return fmt.Errorf("unexpected review reply: %s", reply.Type)
		}
		var result pb.ModelCallResult
		if err = proto.Unmarshal(reply.Payload, &result); err != nil {
			return err
		}
		report.reviewCode = result.ErrorCode
		// Match the real Rust model_failure closed-enum response to an internal
		// Go evidence error; never echo arbitrary provider text.
		failure, _ := proto.Marshal(&pb.FrameFailure{Code: pb.FrameFailureCode_FRAME_FAILURE_CODE_PRECONDITION, Reason: "invalid_model_error_code"})
		if err = stream.SendMsg(&pb.Envelope{ProtocolVersion: root.ProtocolVersion, FrameId: root.FrameId + ":failure",
			CorrelationFrameId: root.FrameId, ConversationId: root.ConversationId, TurnId: root.TurnId, EventSeq: root.EventSeq,
			Type: "result.frame", ContentType: channel.ContentTypeProtobuf, Payload: failure}); err != nil {
			return err
		}
		termination := new(pb.Envelope)
		if err = stream.RecvMsg(termination); err != nil {
			return err
		}
		report.terminated = termination.Type == "result.frame" && termination.FrameId == root.FrameId+":terminated"
	}
	return nil
}

func TestGenerateWithReadsPreservesPreModelEvidenceFailure(t *testing.T) {
	for _, want := range []string{"narrative_memory_origin_invalid", "narrative_memory_evidence_invalid"} {
		t.Run(want, func(t *testing.T) {
			c := sampleContext()
			c.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 0, MaxRepairs: 1}
			candidate := sampleCandidate()
			candidate.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{}}
			origin := narrativeEvidenceOrigin{Kind: "operation", ID: "fixed-request", ExperienceID: c.ExperienceID,
				BranchID: c.BranchID, BaseRevision: c.Revision, BaseFence: 1,
				SourceHandle: c.StateCoverage.SourceHandle, Pin: memoryPageSHA256("fixed operation")}
			if want == "narrative_memory_origin_invalid" {
				origin.ID = ""
			} else {
				origin.BranchID = "other-branch"
			}
			m := &captureFailureModel{outputs: map[string]any{
				"memory": map[string]any{"actors": []any{}, "relevant_fact_ids": []string{}, "objective": "Observe."},
				"plan": map[string]any{"candidates": []any{
					map[string]any{"id": "wait", "fact_ids": []string{}, "thread_ids": []string{}},
					map[string]any{"id": "knock", "fact_ids": []string{}, "thread_ids": []string{}}}},
				"evaluate": map[string]any{"evaluations": []any{
					map[string]any{"evidence_fact_ids": []string{}},
					map[string]any{"evidence_fact_ids": []string{}}}},
				"write":   narrativeDraft{candidate.Title, candidate.Passage, candidate.StoryTime, candidate.Outcome, candidate.Suggestions},
				"extract": map[string]any{"candidate": candidate},
			}}
			lis, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			server := &captureFailureWorker{context: c, candidate: candidate, done: make(chan captureFailureWireResult, 1)}
			gs := grpc.NewServer()
			gs.RegisterService(&grpc.ServiceDesc{ServiceName: "telos.algorithm.v1.RuntimeChannel", HandlerType: (*testConnect)(nil),
				Streams: []grpc.StreamDesc{{StreamName: "Connect", ClientStreams: true, ServerStreams: true,
					Handler: func(s any, ss grpc.ServerStream) error { return s.(testConnect).Connect(ss) }}}}, server)
			go gs.Serve(lis)
			defer gs.Stop()
			link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: lis.Addr().String(), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
			defer link.Close()
			a := Algorithm{Link: link, Model: m, ModelName: "capture-fixed", MaxModelCalls: 12,
				ModelContextTokens: 131072, ModelByteTokenBoundVerified: true}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			got, err := a.GenerateWithReads(ctx, c, "capture-control", captureFailureReader{origin})
			var domain *Error
			if !errors.As(err, &domain) || domain.Code != want {
				t.Errorf("error = %v, want original Go %s", err, want)
			}
			if got.Passage != "" || m.calls.Load() != 5 || m.reviewCalls.Load() != 0 {
				t.Errorf("fixed prefix calls=%d review calls=%d returned=%q", m.calls.Load(), m.reviewCalls.Load(), got.Passage)
			}
			select {
			case report := <-server.done:
				if report.err != nil || !report.terminated || report.reviewReply != "result.frame" || report.reviewCode != "" {
					t.Errorf("internal binding failure was answered to model-error transport: %+v", report)
				}
			case <-ctx.Done():
				t.Fatal("fixed worker did not observe root termination")
			}
		})
	}
}

func TestPreModelCaptureFailureStopsProvider(t *testing.T) {
	for _, capacityFirst := range []bool{false, true} {
		for _, code := range []string{"narrative_memory_origin_invalid", "narrative_memory_evidence_invalid"} {
			t.Run(fmt.Sprintf("%s/capacity-first=%t", code, capacityFirst), func(t *testing.T) {
				provider := &modelCallFailureGenerator{}
				a := &Algorithm{Model: provider, ModelName: "fixed", ModelContextTokens: 65536, ModelByteTokenBoundVerified: true}
				call := &pb.ModelCallRequest{Model: "fixed", Messages: []*pb.ModelMessage{{Role: "user", Content: "{}"}},
					SchemaJson: `{"type":"object"}`, MaxOutputBytes: 8192}
				if capacityFirst {
					a.MaxModelInputBytes = 1
				}
				captured := 0
				var captureErr error
				result := a.modelCallWithAuthorCaptured(context.Background(), call, proto.Size(call), nil, func(model.Request) error {
					captured++
					captureErr = fail(code)
					return captureErr
				})
				wantCalls, wantCode := 1, code
				if capacityFirst {
					wantCalls, wantCode = 0, "context_budget_exceeded"
				}
				if captured != wantCalls || result.ErrorCode != wantCode || provider.calls != 0 || result.Text != "" {
					t.Fatalf("capture=%d result=%v provider=%d", captured, result, provider.calls)
				}
				if !capacityFirst {
					var domain *Error
					if !errors.As(captureErr, &domain) || domain.Code != code {
						t.Fatal("capture lost original Go error", captureErr)
					}
				}
			})
		}
	}
}
