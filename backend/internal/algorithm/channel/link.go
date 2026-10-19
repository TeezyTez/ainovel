// 文件职责：进程级算法通道连接（Link）——一条长活 gRPC 双向流承载该进程的全部算法请求，
//           按 correlation_frame_id 把入站帧派发给各自的等待者（多路复用）。
// 主要依赖：标准库 context/sync/errors/log/slog 与同包的 Client/Audit/FrameError。
// 调用边界：由进程组合根（cmd/*/main.go 经 workflow.NewClient）持有，全进程一份；
//           请求级逻辑只经 Send/Subscribe 使用，绝不自己 Dial。
// 状态边界：连接与流是进程生命周期（procCtx），不随任何一次请求的 ctx 结束而关闭；
//           流异常死亡时统一失败在途等待者并标记死亡，下一次 Send 单飞重拨；
//           单帧协议拒绝只失败其关联等待者，不牵连同流其它会话。
// 安全边界：连接经 ClientOptions.Transport 的 fail-closed 校验（生产强制 mTLS）；
//           帧校验/审计沿用 Client；本文件不记录任何 payload 正文。

package channel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// ErrLinkClosed 表示 Link 已被显式关闭，不能再发送或订阅。
var ErrLinkClosed = errors.New("channel: link closed")

// ErrWaiterClosedWithPending 表示等待者关闭时缓冲里仍有未取走的帧。
var ErrWaiterClosedWithPending = errors.New("channel: waiter closed with pending frame")

// waiterBuffer 是单个等待者的入站帧缓冲。协议上每个请求在任一时刻只期待一帧，
// 留出余量吸收反向模型调用的中途帧（request.model）而不阻塞读循环。
const waiterBuffer = 8

// Waiter 是一次请求对某一个关联帧身份的等待句柄。
// 生命周期由调用方负责：订阅后必须 Close（通常 defer）。
type Waiter struct {
	link   *Link
	id     string
	ch     chan *algorithmv1.Envelope
	closed bool // 由 link.mu 保护
	reason error
	client *Client // bound on first Send; callbacks may never redial an old root onto a new stream
}

// Next 取下一帧；ctx 取消、流死亡或句柄关闭时返回原因错误。
// 已入缓冲的帧先于关闭原因返回（已收到的帧仍然是可用的真相）。
func (w *Waiter) Next(ctx context.Context) (*algorithmv1.Envelope, error) {
	select {
	case env, ok := <-w.ch:
		if !ok {
			w.link.mu.Lock()
			reason := w.reason
			w.link.mu.Unlock()
			if reason != nil {
				return nil, reason
			}
			return nil, ErrWaiterClosedWithPending
		}
		return env, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Close 注销等待者；重复调用安全。
func (w *Waiter) Close() {
	w.link.unsubscribe(w)
}

// Link 是一条进程级长活通道：一个 conn + 一条 Connect 双向流 + 帧身份派发表。
type Link struct {
	options ClientOptions
	procCtx context.Context
	cancel  context.CancelFunc

	mu      sync.Mutex
	client  *Client
	waiters map[string]*Waiter
	closed  bool
	dialMu  sync.Mutex    // 单飞重拨：同一时刻只允许一次拨号，避免首次并发使用时开出一堆废弃流
	sendSem chan struct{} // 容量1的写许可：串行化写（gRPC 双向流不允许并发 Send 同一流），
	// 且以 ctx 感知方式获取——一个慢 root 占着写许可时，其他操作的 Send 受自身期限约束
	// 而不是无限阻塞，保证一个 experience/account 不会永久卡住共享通道上的其余操作。
	audit *slog.Logger
}

// NewLink 构造进程级通道；procCtx 决定连接寿命（通常来自进程根 ctx），调用方负责 Close。
func NewLink(procCtx context.Context, options ClientOptions) *Link {
	ctx, cancel := context.WithCancel(procCtx)
	return &Link{
		options: options,
		procCtx: ctx,
		cancel:  cancel,
		waiters: make(map[string]*Waiter),
		sendSem: make(chan struct{}, 1),
		audit:   options.Logger,
	}
}

// A real transport write has a process-level bound, separate from a root's
// deadline. Cancelling a root while its write is in progress must not kill a
// healthy multiplexed stream. A blocked wire write, however, cannot be abandoned
// while another Send starts: gRPC forbids concurrent SendMsg. The watchdog closes
// that genuinely unresponsive transport and reports unknown delivery; no replay.
const transportWriteTimeout = 5 * time.Second

var ErrWriteTimeout = errors.New("channel: transport write timeout, delivery unknown")

// Send permits redial for new requests. Callbacks should use Waiter.Send so an
// old root can never be answered on a new, unrelated stream.
func (l *Link) Send(ctx context.Context, env *algorithmv1.Envelope) error {
	return l.send(ctx, env, nil)
}

// Send binds this root to one stream. After actual stream failure it returns an
// error without redial: Rust's old per-stream receiver has already been closed.
func (w *Waiter) Send(ctx context.Context, env *algorithmv1.Envelope) error {
	return w.link.send(ctx, env, w)
}

func (l *Link) send(ctx context.Context, env *algorithmv1.Envelope, w *Waiter) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case l.sendSem <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	case <-l.procCtx.Done():
		return ErrLinkClosed
	}
	// Ownership is transferred to the write goroutine once SendMsg starts.
	// Only it releases the permit, even if the watchdog has returned earlier.
	release := true
	defer func() {
		if release {
			<-l.sendSem
		}
	}()
	if err := ctx.Err(); err != nil {
		return err
	}
	l.mu.Lock()
	var client *Client
	if w != nil {
		if w.closed {
			l.mu.Unlock()
			return ErrWaiterClosedWithPending
		}
		client = w.client
		if client != nil && l.client != client {
			l.mu.Unlock()
			return ErrLinkClosed
		}
	}
	l.mu.Unlock()
	if client == nil {
		var err error
		client, err = l.live()
		if err != nil {
			return err
		}
	}
	l.mu.Lock()
	if w != nil {
		if w.closed || l.client != client {
			l.mu.Unlock()
			return ErrLinkClosed
		}
		w.client = client
	}
	l.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	done := make(chan error, 1)
	release = false
	go func() {
		err := client.Send(l.procCtx, env)
		<-l.sendSem
		done <- err
	}()
	timer := time.NewTimer(transportWriteTimeout)
	defer timer.Stop()
	select {
	case err := <-done:
		var rejected *FrameError
		if err != nil && !errors.As(err, &rejected) {
			l.fail(client, err)
			_ = client.Close()
		}
		return err // local validation failures never invalidate other roots
	case <-timer.C:
		l.fail(client, ErrWriteTimeout)
		_ = client.Close() // actual unresponsive transport, NOT normal root cancellation
		return ErrWriteTimeout
	case <-l.procCtx.Done():
		_ = client.Close()
		return ErrLinkClosed
	}
}

// Subscribe 为某个关联帧身份登记等待者。同一身份重复订阅返回错误（双份等待者会互相偷帧）。
func (l *Link) Subscribe(frameID string) (*Waiter, error) {
	if frameID == "" {
		return nil, errors.New("channel: 缺少 frame_id")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil, ErrLinkClosed
	}
	if _, dup := l.waiters[frameID]; dup {
		return nil, fmt.Errorf("channel: frame %s 已有等待者", frameID)
	}
	waiter := &Waiter{link: l, id: frameID, ch: make(chan *algorithmv1.Envelope, waiterBuffer)}
	l.waiters[frameID] = waiter
	return waiter, nil
}

// Close 关闭长活通道：取消进程 ctx、断开连接、失败全部在途等待者。
func (l *Link) Close() error {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil
	}
	l.closed = true
	client := l.client
	l.client = nil
	pending := l.takeWaitersLocked(ErrLinkClosed)
	l.mu.Unlock()

	l.cancel()
	for _, waiter := range pending {
		close(waiter.ch)
	}
	if client == nil {
		return nil
	}
	return client.Close()
}

// live 返回可用连接；不存在或已死亡时重拨。
// 重拨单飞：并发首次使用只开一条流，其余请求排队等它（而不是各拨一条再丢弃）。
func (l *Link) live() (*Client, error) {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil, ErrLinkClosed
	}
	if l.client != nil {
		client := l.client
		l.mu.Unlock()
		return client, nil
	}
	l.mu.Unlock()

	l.dialMu.Lock()
	defer l.dialMu.Unlock()

	// 双检：可能在等锁期间已被前一个拨号者建立（或已关闭）。
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil, ErrLinkClosed
	}
	if l.client != nil {
		client := l.client
		l.mu.Unlock()
		return client, nil
	}
	l.mu.Unlock()

	// 重拨用进程 ctx，不用请求 ctx：请求结束不得关闭共享流。
	client, err := Dial(l.procCtx, l.options)
	if err != nil {
		return nil, err
	}

	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		_ = client.Close()
		return nil, ErrLinkClosed
	}
	if l.client != nil { // 理论上不可达（dialMu 已串行化）；保险起见保留先到者
		existing := l.client
		l.mu.Unlock()
		_ = client.Close()
		return existing, nil
	}
	l.client = client
	l.mu.Unlock()

	go l.read(client)
	return client, nil
}

// read 是唯一的读循环：接收并派发入站帧。
// 传输错误收敛整条流；单帧协议拒绝只收敛其关联等待者，其余会话不受影响。
func (l *Link) read(client *Client) {
	for {
		env, err := client.Recv(l.procCtx)
		if err != nil {
			var frameErr *FrameError
			if errors.As(err, &frameErr) {
				l.rejectFrame(client, env, frameErr)
				continue
			}
			l.fail(client, err)
			return
		}
		l.dispatch(env)
	}
}

// rejectFrame 处理一帧协议拒绝：审计留痕，并把该帧关联的等待者单独失败。
func (l *Link) rejectFrame(client *Client, env *algorithmv1.Envelope, frameErr *FrameError) {
	auditFrame(l.audit, slog.LevelWarn, "channel.frame.rejected", frameErr.Category, frameErr.FrameID, "", frameErr.Reason)
	if env == nil || env.CorrelationFrameId == "" {
		return
	}
	l.mu.Lock()
	waiter := l.waiters[env.CorrelationFrameId]
	if waiter != nil {
		delete(l.waiters, waiter.id)
		waiter.closed = true
		waiter.reason = frameErr
	}
	l.mu.Unlock()
	if waiter != nil {
		close(waiter.ch)
	}
}

// dispatch 按 correlation_frame_id 把帧投给对应等待者；无主帧交审计留痕（不静默丢弃）。
// 发送在 l.mu 内以非阻塞方式完成，避免与 unsubscribe 的 close 竞争。
func (l *Link) dispatch(env *algorithmv1.Envelope) {
	l.mu.Lock()
	waiter, ok := l.waiters[env.CorrelationFrameId]
	if !ok || waiter == nil || waiter.closed {
		l.mu.Unlock()
		category, _ := CategoryOf(env.Type)
		auditFrame(l.audit, slog.LevelWarn, "channel.frame.unmatched", category, env.FrameId, env.ConversationId, "no_waiter")
		return
	}
	select {
	case waiter.ch <- env:
		l.mu.Unlock()
	default:
		delete(l.waiters, waiter.id)
		waiter.closed = true
		waiter.reason = fmt.Errorf("channel: 帧缓冲溢出: %s", env.FrameId)
		l.mu.Unlock()
		category, _ := CategoryOf(env.Type)
		auditFrame(l.audit, slog.LevelWarn, "channel.frame.overflow", category, env.FrameId, env.ConversationId, "waiter_overflow")
		close(waiter.ch)
	}
}

// Drop 关掉当前这条流并失败在途等待者，下一次 Send 重拨。
// 一次请求已经发出、对面却不再回帧时用它。只失败等待者而不关连接的话，
// 服务端仍停在等 result.model，这条流上之后的帧都进不了处理。
func (l *Link) Drop(err error) {
	if l == nil || err == nil {
		return
	}
	l.mu.Lock()
	client := l.client
	l.mu.Unlock()
	if client != nil {
		_ = client.Close()
	}
	l.fail(client, err)
}

// fail 收敛一次流死亡：标记连接不可用、失败该连接上的全部在途等待者，下一次 Send 会重拨。
func (l *Link) fail(client *Client, err error) {
	l.mu.Lock()
	if l.client != client { // 已被新一轮重拨替换，本次死亡不影响现状
		l.mu.Unlock()
		return
	}
	l.client = nil
	pending := l.takeWaitersLocked(err)
	l.mu.Unlock()

	for _, waiter := range pending {
		close(waiter.ch)
	}
}

// unsubscribe 注销等待者（持有 mu 内标记，锁外关闭通道）。
func (l *Link) unsubscribe(waiter *Waiter) {
	l.mu.Lock()
	current, ok := l.waiters[waiter.id]
	if ok && current == waiter {
		delete(l.waiters, waiter.id)
	}
	if waiter.closed {
		l.mu.Unlock()
		return
	}
	waiter.closed = true
	waiter.reason = ErrWaiterClosedWithPending
	pending := len(waiter.ch) > 0
	l.mu.Unlock()

	close(waiter.ch)
	if pending {
		auditFrame(l.audit, slog.LevelWarn, "channel.frame.unconsumed", "", waiter.id, "", "waiter_closed_with_pending")
	}
}

// takeWaitersLocked 取走并清空等待者表，逐个登记失败原因（持有 mu）。
func (l *Link) takeWaitersLocked(reason error) []*Waiter {
	pending := make([]*Waiter, 0, len(l.waiters))
	for id, waiter := range l.waiters {
		delete(l.waiters, id)
		if !waiter.closed {
			waiter.closed = true
			waiter.reason = reason
		}
		pending = append(pending, waiter)
	}
	return pending
}
