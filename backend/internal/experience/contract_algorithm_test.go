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

func sampleContext() Context {
	return Context{Version: 2, ExperienceID: "e", BranchID: "b", Mode: "begin", Seed: "中文原字\n起点", Input: "", State: EmptyState(), History: []HistoryPage{}, HistoryComplete: true, Preferences: []Preference{}, Recalls: []ReadReply{}, ReadBudget: ReadBudget{}, StateCoverage: StateCoverage{Policy: "full.v1", RecentFromRevision: 0, Total: StateCounts{}, Omitted: StateCounts{}, Complete: true, SourceHandle: "handle", Audience: "author"}}
}
func sampleCandidate() Candidate {
	return Candidate{Title: "雨城", Passage: "雨落。\n原字  不变。", StoryTime: "暮色", Outcome: "continues", Suggestions: []string{}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{}, ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{}}
}
func TestCanonicalContractTypedShapeAndInvalidInputs(t *testing.T) {
	raw, _ := json.Marshal(sampleContext())
	if err := validateContract(raw, "context"); err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(sampleCandidate())
	if _, err := DecodeCandidate(raw); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{`{}`, strings.Replace(string(raw), `"new_facts":[]`, `"new_facts":null`, 1), strings.Replace(string(raw), `"title":"雨城"`, `"title":"雨城","title":"重复"`, 1), strings.Replace(string(raw), `"title":"雨城"`, `"title":"雨城","account_id":"fake"`, 1), string(raw) + `{}`} {
		if _, err := DecodeCandidate([]byte(bad)); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
	c := sampleCandidate()
	c.NewFacts = []Fact{{ID: "claim", Kind: "belief", Text: "他认为这是真的", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	if _, err := Apply(sampleContext(), c); err == nil {
		t.Fatal("belief without subject")
	}
	c = sampleCandidate()
	c.NewEntities = []Entity{{ID: "actor", Kind: "person", Name: "见证者", Known: true, RelatedIDs: []string{"claim"}}}
	c.NewFacts = []Fact{{ID: "claim", Kind: "belief", Text: "他认为这是真的", SubjectID: "actor", Known: true, KnownBy: []string{"actor"}, SourceRevision: 1}}
	state, err := Apply(sampleContext(), c)
	if err != nil {
		t.Fatal(err)
	}
	if state.Facts[0].Kind != "belief" {
		t.Fatal("belief promoted to truth")
	}
	c.NewFacts[0].KnownBy = []string{"nobody"}
	if _, err = Apply(sampleContext(), c); err == nil {
		t.Fatal("unknown actor knowledge accepted")
	}
}

type carrierModel struct{ calls atomic.Int32 }

func (m *carrierModel) Generate(_ context.Context, r model.Request) (model.Result, error) {
	m.calls.Add(1)
	if r.Model != "world-explicit" || r.AccountID != "" || r.PlanKey != "" || r.Task != "" {
		return model.Result{}, errors.New("legacy model policy used")
	}
	return model.Result{Text: `{"model":"中文"}`}, nil
}
func (*carrierModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return errors.New("unused")
}

type testConnect interface{ Connect(grpc.ServerStream) error }
type reverseServer struct {
	t             *testing.T
	badCoordinate bool
	duplicate     bool
}

func (s *reverseServer) Connect(stream grpc.ServerStream) error {
	in := new(pb.Envelope)
	if err := stream.RecvMsg(in); err != nil {
		return err
	}
	if in.ProtocolVersion != ProtocolVersion || in.Type != "request.experience" || in.ContentType != "application/json" || strings.Contains(string(in.Payload), "credential") || in.Facts.DefaultModel != "world-explicit" || in.Facts.ContextTokenLimit != 131072 || in.Facts.OutputTokenReserve != 8192 || !in.Facts.ByteTokenBoundVerified {
		s.t.Error("bad experience envelope")
	}
	if err := validateContract(in.Payload, "context"); err != nil {
		s.t.Error(err)
	}
	call := &pb.ModelCallRequest{Model: "world-explicit", Messages: []*pb.ModelMessage{{Role: "user", Content: "中文语义"}}, SchemaJson: `{"type":"object"}`, MaxOutputBytes: 4096}
	payload, _ := proto.Marshal(call)
	env := &pb.Envelope{ProtocolVersion: ProtocolVersion, FrameId: in.FrameId + ":model:1", CorrelationFrameId: in.FrameId, ConversationId: in.ConversationId, TurnId: in.TurnId, Type: "request.model", ContentType: channel.ContentTypeProtobuf, Payload: payload}
	if s.badCoordinate {
		env.TurnId++
	}
	if err := stream.SendMsg(env); err != nil {
		return err
	}
	if s.badCoordinate {
		return nil
	}
	reply := new(pb.Envelope)
	if err := stream.RecvMsg(reply); err != nil {
		return err
	}
	var result pb.ModelCallResult
	if proto.Unmarshal(reply.Payload, &result) != nil || result.ErrorCode != "" || result.Text != `{"model":"中文"}` || reply.CorrelationFrameId != env.FrameId || reply.Type != "result.model" {
		s.t.Error("wrong protobuf model result")
	}
	if s.duplicate {
		return stream.SendMsg(env)
	}
	payload, _ = json.Marshal(sampleCandidate())
	decision := &pb.Envelope{ProtocolVersion: ProtocolVersion, FrameId: in.FrameId + ":decision", CorrelationFrameId: in.FrameId, ConversationId: in.ConversationId, TurnId: in.TurnId, Type: "decision.experience", ContentType: "application/json", Payload: payload}
	return stream.SendMsg(decision)
}
func TestEnvelopeReverseModelAndProtocolFencing(t *testing.T) {
	for _, mode := range []string{"valid", "bad-coordinate", "duplicate-call"} {
		t.Run(mode, func(t *testing.T) {
			lis, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			gs := grpc.NewServer()
			server := &reverseServer{t: t, badCoordinate: mode == "bad-coordinate", duplicate: mode == "duplicate-call"}
			gs.RegisterService(&grpc.ServiceDesc{ServiceName: "telos.algorithm.v1.RuntimeChannel", HandlerType: (*testConnect)(nil), Streams: []grpc.StreamDesc{{StreamName: "Connect", ClientStreams: true, ServerStreams: true, Handler: func(s any, ss grpc.ServerStream) error { return s.(testConnect).Connect(ss) }}}}, server)
			go gs.Serve(lis)
			defer gs.Stop()
			link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: lis.Addr().String(), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
			defer link.Close()
			m := &carrierModel{}
			a := Algorithm{Link: link, Model: m, ModelName: "world-explicit", Timeout: 2 * time.Second, ModelContextTokens: 131072, ModelByteTokenBoundVerified: true}
			got, err := a.Generate(context.Background(), sampleContext(), "experience-test")
			if mode == "valid" {
				if err != nil || got.Passage != sampleCandidate().Passage || m.calls.Load() != 1 {
					t.Fatalf("result=%+v err=%v calls=%d", got, err, m.calls.Load())
				}
			} else {
				var e *Error
				if !errors.As(err, &e) || e.Code != "algorithm_protocol" {
					t.Fatalf("err=%v", err)
				}
				if m.calls.Load() > 1 {
					t.Fatal("multiple model calls")
				}
			}
		})
	}
}
func TestCarrierUnavailableAndBoundsNoTemplate(t *testing.T) {
	a := &Algorithm{}
	_, err := a.Generate(context.Background(), sampleContext(), "no-model")
	var domain *Error
	if !errors.As(err, &domain) || domain.Code != "model_unavailable" {
		t.Fatal(err)
	}
	m := &carrierModel{}
	a.Model = m
	a.ModelName = "world-explicit"
	a.ModelContextTokens = 131072
	a.ModelByteTokenBoundVerified = true
	a.MaxModelInputBytes = 10
	call := &pb.ModelCallRequest{Messages: []*pb.ModelMessage{{Role: "user", Content: "too long中文"}}, SchemaJson: `{}`, MaxOutputBytes: 4096}
	if got := a.modelCall(context.Background(), call); got.ErrorCode != "context_budget_exceeded" || got.Text != "" || m.calls.Load() != 0 {
		t.Fatal(got)
	}
	a.MaxModelInputBytes = 0
	call.Model = "old-plan-model"
	if got := a.modelCall(context.Background(), call); got.ErrorCode != "model_unavailable" || m.calls.Load() != 0 {
		t.Fatal(got)
	}
}
