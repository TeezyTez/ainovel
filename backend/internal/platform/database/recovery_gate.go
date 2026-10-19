// 同库全部服务角色与恢复互斥；持久blocked状态在恢复进程退出后继续拒绝服务。
// 门禁连接独占至Release，调用方必须先Release再关闭连接池。
package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"sync"
	"time"

	"elselife/backend/internal/platform/pgerr"
	"elselife/backend/internal/sqlc/pgq"
)

var ErrRecoveryBlocked = errors.New("database_recovery_blocked")

// AcquireServing 在一条专用连接上调用 acquire_serving_gate。
// 锁和 verified 状态只由那个函数判定。QQG01、函数不存在、表不存在才是恢复门拒绝；别的错误原样返回。
func AcquireServing(ctx context.Context, db *sql.DB) (release func(), err error) {
	if db == nil {
		return nil, ErrRecoveryBlocked
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	q := pgq.New(conn)
	if err := q.AcquireServingConnection(ctx); err != nil {
		_ = conn.Close()
		return nil, servingGateError(err)
	}
	var once sync.Once
	release = func() {
		once.Do(func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := q.UnlockServingGate(cleanup); err != nil {
				_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			}
			_ = conn.Close()
		})
	}
	return release, nil
}

// RestoreGate holds exclusive access to the whole database, independent of object directories.
// AcquireRestore does not mutate state: the caller proves the target empty and applies migrations,
// then calls Block before loading any backup rows. Release never changes blocked to verified.
type RestoreGate struct {
	conn    *sql.Conn
	Release func()
}

func AcquireRestore(ctx context.Context, db *sql.DB) (*RestoreGate, error) {
	conn, release, err := acquireExclusive(ctx, db)
	if err != nil {
		return nil, err
	}
	return &RestoreGate{conn: conn, Release: release}, nil
}
func (g *RestoreGate) Block(ctx context.Context) error {
	n, err := pgq.New(g.conn).BlockRecoveryGate(ctx)
	if err != nil || n != 1 {
		return ErrRecoveryBlocked
	}
	return nil
}

// Verify is only valid after independent deletion reconciliation and all object checks succeed.
func (g *RestoreGate) Verify(ctx context.Context) error {
	n, err := pgq.New(g.conn).VerifyRecoveryGate(ctx)
	if err != nil || n != 1 {
		return ErrRecoveryBlocked
	}
	return nil
}

func acquireExclusive(ctx context.Context, db *sql.DB) (*sql.Conn, func(), error) {
	if db == nil {
		return nil, nil, ErrRecoveryBlocked
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, nil, ErrRecoveryBlocked
	}
	q := pgq.New(conn)
	acquired, err := q.TryRestoreGate(ctx)
	if err != nil || !acquired {
		// 取消的查询可能已经拿到会话锁；丢掉这条物理连接，不还回池。
		if err != nil {
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
		_ = conn.Close()
		return nil, nil, ErrRecoveryBlocked
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := q.UnlockRestoreGate(cleanup); err != nil {
				_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			}
			_ = conn.Close()
		})
	}
	return conn, release, nil
}

// servingGateError 只把恢复门自己的拒绝收成 ErrRecoveryBlocked。
// 未迁移（函数或表不存在）也失败关闭。正文里出现 database_recovery_blocked 不算。
func servingGateError(err error) error {
	if pgerr.IsRecoveryBlocked(err) || pgerr.IsUndefinedFunction(err) || pgerr.IsUndefinedTable(err) {
		return ErrRecoveryBlocked
	}
	return err
}
