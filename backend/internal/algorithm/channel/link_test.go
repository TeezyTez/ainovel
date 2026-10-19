// 文件职责：进程级通道 Link 的集成测试——单流多路复用、并发隔离、流中止后的在途失败与重拨、
//           无主帧不牵连其它会话、重复订阅拒绝。
// 主要依赖：标准库 testing/sync/time 与 grpc；复用 channel_test.go 的真实 gRPC 服务端与合成帧。
// 调用边界：每个用例独立起停服务端；Link 用真实 127.0.0.1 往返，不触碰公网或数据库。
// 状态边界：每用例独立 Link，ConcurrentContext 下收尾 Close 并等读循环退出。
// 安全边界：测试用合成帧与凭据，无真实密钥。

package channel

import (
	"context"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// startServerWithStreamHook 与 startServer 相同，但允许观察每次开流。
func startServerWithStreamHook(t *testing.T, opts ServerOptions, onStream func()) (string, func()) {
	t.Helper()
	srv, err := NewServer(opts)
	if err != nil {
		t.Fatalf("构造服务端: %v", err)
	}
	gs := grpc.NewServer(grpc.StreamInterceptor(func(srvIface any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if onStream != nil {
			onStream()
		}
		return handler(srvIface, ss)
	}))
	srv.Register(gs)
	addr, stop := serveOnTempPort(t, gs)
	return addr, stop
}

// serveOnTempPort 在 127.0.0.1 临时端口上服务给定 gRPC Server，返回地址与停止函数。
func serveOnTempPort(t *testing.T, gs *grpc.Server) (string, func()) {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听临时端口: %v", err)
	}
	go func() { _ = gs.Serve(lis) }()
	return lis.Addr().String(), func() { gs.Stop() }
}

// slowHandler 让不同会话的响应以不同延迟返回，制造同一流上的乱序回帧。
type slowHandler struct{}

// HandleFrame 按 conversation_id 决定延迟，再交给 echoHandler 生成决策。
func (slowHandler) HandleFrame(ctx context.Context, frame *algorithmv1.Envelope) (*algorithmv1.Envelope, error) {
	if frame.ConversationId != "" && frame.ConversationId[len(frame.ConversationId)-1]%2 == 0 {
		time.Sleep(60 * time.Millisecond)
	}
	return echoHandler{}.HandleFrame(ctx, frame)
}

// abortHandler 对指定会话结束整条流。这是传输死了，不是这一帧的失败。
type abortHandler struct{ abortConversation string }

// HandleFrame 命中指定会话即返回 errStreamDead，Connect 把流交回 gRPC。
func (h abortHandler) HandleFrame(ctx context.Context, frame *algorithmv1.Envelope) (*algorithmv1.Envelope, error) {
	if frame.ConversationId == h.abortConversation {
		return nil, errStreamDead
	}
	return echoHandler{}.HandleFrame(ctx, frame)
}

// strayHandler 对指定会话回一帧关联到不存在等待者的帧，模拟无主帧。
type strayHandler struct{ strayConversation string }

// HandleFrame 命中指定会话时把响应的 correlation 改成无等待者的身份。
func (h strayHandler) HandleFrame(ctx context.Context, frame *algorithmv1.Envelope) (*algorithmv1.Envelope, error) {
	out, err := echoHandler{}.HandleFrame(ctx, frame)
	if err != nil || out == nil {
		return out, err
	}
	if frame.ConversationId == h.strayConversation {
		out.CorrelationFrameId = "frm_nobody_waiting"
	}
	return out, nil
}

// newLinkTo 构造指向测试服务端的进程级 Link。
func newLinkTo(t *testing.T, addr string) *Link {
	t.Helper()
	link := NewLink(context.Background(), ClientOptions{
		Addr:      addr,
		Transport: ClientTransportConfig{InsecurePlaintext: true},
	})
	t.Cleanup(func() { _ = link.Close() })
	return link
}

// requestFrame 构造一个合法的 request.route 合成帧。
func requestFrame(frameID, conversationID string) *algorithmv1.Envelope {
	frame := validFrame("request.route", mustMarshal(&algorithmv1.RouteRequest{
		ConversationId: conversationID,
		TurnId:         1,
	}))
	frame.FrameId = frameID
	frame.ConversationId = conversationID
	return frame
}

// TestLinkServesManyRequestsOnOneStream 验证一条 Link 承载多次请求且服务端只看到一条流。
func TestLinkServesManyRequestsOnOneStream(t *testing.T) {
	var streams int32
	addr, stop := startServerWithStreamHook(t, ServerOptions{Handler: echoHandler{}, Authorizer: allowAllAuthorizer{}}, func() {
		atomic.AddInt32(&streams, 1)
	})
	defer stop()

	link := newLinkTo(t, addr)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		frameID := fmt.Sprintf("frm_seq_%d", i)
		waiter, err := link.Subscribe(frameID)
		if err != nil {
			t.Fatalf("订阅失败: %v", err)
		}
		if err := link.Send(ctx, requestFrame(frameID, "cnv_seq")); err != nil {
			t.Fatalf("发送失败: %v", err)
		}
		resp, err := waiter.Next(ctx)
		if err != nil {
			t.Fatalf("第 %d 次收帧失败: %v", i, err)
		}
		if resp.CorrelationFrameId != frameID {
			t.Fatalf("关联身份错误: got %s want %s", resp.CorrelationFrameId, frameID)
		}
		waiter.Close()
	}
	if got := atomic.LoadInt32(&streams); got != 1 {
		t.Fatalf("期望只开一条流，实际 %d 条", got)
	}
}

// TestLinkMultiplexesConcurrentRequests 验证并发请求在同一流上互不偷帧（按 frame_id 派发）。
func TestLinkMultiplexesConcurrentRequests(t *testing.T) {
	var streams int32
	addr, stop := startServerWithStreamHook(t, ServerOptions{Handler: slowHandler{}, Authorizer: allowAllAuthorizer{}}, func() {
		atomic.AddInt32(&streams, 1)
	})
	defer stop()

	link := newLinkTo(t, addr)
	ctx := context.Background()

	const n = 8
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			conversationID := fmt.Sprintf("cnv_par_%d", i)
			frameID := fmt.Sprintf("frm_par_%d", i)
			waiter, err := link.Subscribe(frameID)
			if err != nil {
				errs <- fmt.Errorf("订阅 %d: %w", i, err)
				return
			}
			defer waiter.Close()
			if err := link.Send(ctx, requestFrame(frameID, conversationID)); err != nil {
				errs <- fmt.Errorf("发送 %d: %w", i, err)
				return
			}
			resp, err := waiter.Next(ctx)
			if err != nil {
				errs <- fmt.Errorf("收帧 %d: %w", i, err)
				return
			}
			if resp.CorrelationFrameId != frameID || resp.ConversationId != conversationID {
				errs <- fmt.Errorf("第 %d 条拿到别人的帧: corr=%s conv=%s", i, resp.CorrelationFrameId, resp.ConversationId)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("并发多路复用失败: %v", err)
	}
	if got := atomic.LoadInt32(&streams); got != 1 {
		t.Fatalf("并发请求应共用一条流，实际 %d 条", got)
	}
}

// TestLinkFailsWaiterOnStreamAbortThenRedials 验证流被服务端中止时在途等待者立即失败（不悬挂），
// 且下一次请求经重拨成功，服务端因此看到第二条流。
func TestLinkFailsWaiterOnStreamAbortThenRedials(t *testing.T) {
	var streams int32
	addr, stop := startServerWithStreamHook(t, ServerOptions{
		Handler:    abortHandler{abortConversation: "cnv_abort"},
		Authorizer: allowAllAuthorizer{},
	}, func() { atomic.AddInt32(&streams, 1) })
	defer stop()

	link := newLinkTo(t, addr)
	ctx := context.Background()

	waiter, err := link.Subscribe("frm_abort")
	if err != nil {
		t.Fatalf("订阅失败: %v", err)
	}
	defer waiter.Close()
	if err := link.Send(ctx, requestFrame("frm_abort", "cnv_abort")); err != nil {
		t.Fatalf("发送失败: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := waiter.Next(ctx)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("流被中止时等待者不应拿到成功帧")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("流中止后等待者悬挂，未在限定时间内失败")
	}

	// 下一次请求必须经重拨成功。
	good := "frm_after_abort"
	waiter2, err := link.Subscribe(good)
	if err != nil {
		t.Fatalf("重拨前订阅失败: %v", err)
	}
	defer waiter2.Close()
	if err := link.Send(ctx, requestFrame(good, "cnv_ok")); err != nil {
		t.Fatalf("重拨后发送失败: %v", err)
	}
	resp, err := waiter2.Next(ctx)
	if err != nil {
		t.Fatalf("重拨后收帧失败: %v", err)
	}
	if resp.CorrelationFrameId != good {
		t.Fatalf("重拨后拿到了错误帧: %s", resp.CorrelationFrameId)
	}
	if got := atomic.LoadInt32(&streams); got != 2 {
		t.Fatalf("期望重拨后共两条流，实际 %d 条", got)
	}
}

// TestLinkUnmatchedFrameDoesNotKillOtherConversations 验证无主帧只留审计，不牵连同流其它会话。
func TestLinkUnmatchedFrameDoesNotKillOtherConversations(t *testing.T) {
	addr, stop := startServerWithStreamHook(t, ServerOptions{
		Handler:    strayHandler{strayConversation: "cnv_stray"},
		Authorizer: allowAllAuthorizer{},
	}, nil)
	defer stop()

	link := newLinkTo(t, addr)
	ctx := context.Background()

	// 第一帧的响应被别人关联（无主帧）：等待者会等到自己的请求超时，而不是拿到错帧。
	strayWaiter, err := link.Subscribe("frm_stray")
	if err != nil {
		t.Fatalf("订阅失败: %v", err)
	}
	if err := link.Send(ctx, requestFrame("frm_stray", "cnv_stray")); err != nil {
		t.Fatalf("发送失败: %v", err)
	}
	strayCtx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if _, err := strayWaiter.Next(strayCtx); err == nil {
		t.Fatal("无主帧不应被投给任何等待者")
	}
	strayWaiter.Close()

	// 同一条流上的正常会话必须照常工作。
	ok := "frm_ok_after_stray"
	waiter, err := link.Subscribe(ok)
	if err != nil {
		t.Fatalf("订阅失败: %v", err)
	}
	defer waiter.Close()
	if err := link.Send(ctx, requestFrame(ok, "cnv_ok")); err != nil {
		t.Fatalf("无主帧后发送失败: %v", err)
	}
	resp, err := waiter.Next(ctx)
	if err != nil {
		t.Fatalf("无主帧后收帧失败: %v", err)
	}
	if resp.CorrelationFrameId != ok {
		t.Fatalf("无主帧后拿到错帧: %s", resp.CorrelationFrameId)
	}
}

// TestLinkRejectsDuplicateSubscription 验证同一 frame_id 不会被两个等待者共享（防互相偷帧）。
func TestLinkRejectsDuplicateSubscription(t *testing.T) {
	link := NewLink(context.Background(), ClientOptions{Addr: "127.0.0.1:1", Transport: ClientTransportConfig{InsecurePlaintext: true}})
	defer func() { _ = link.Close() }()

	if _, err := link.Subscribe("frm_dup"); err != nil {
		t.Fatalf("首次订阅应成功: %v", err)
	}
	if _, err := link.Subscribe("frm_dup"); err == nil {
		t.Fatal("重复订阅同一 frame_id 必须被拒绝")
	}
}

// TestLinkCloseFailsPendingWaiters 验证 Close 会立即收敛在途等待者，不使其悬挂。
func TestLinkCloseFailsPendingWaiters(t *testing.T) {
	link := NewLink(context.Background(), ClientOptions{Addr: "127.0.0.1:1", Transport: ClientTransportConfig{InsecurePlaintext: true}})
	waiter, err := link.Subscribe("frm_close")
	if err != nil {
		t.Fatalf("订阅失败: %v", err)
	}
	if err := link.Close(); err != nil {
		t.Fatalf("关闭失败: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := waiter.Next(context.Background())
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Close 后等待者不应拿到成功帧")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close 后等待者悬挂")
	}
}
