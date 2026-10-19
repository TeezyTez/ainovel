// 文件职责：PostgreSQL 错误的唯一分类点。
// 主要依赖：pgconn（pgx v5 的库错误类型）。
// 调用边界：任何需要按 SQLSTATE 分类库错误的包都调用这里；禁止各包自建文本匹配。
// 判定边界：SQLSTATE 是数据库契约；错误文本是驱动文案（会随驱动版本、语言、约束名变化，也会误命中），禁止用它判类别。
// 状态边界：无状态纯函数，不持有连接。
package pgerr

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	// UniqueViolation 是唯一约束冲突的 SQLSTATE。
	UniqueViolation = "23505"
	// UndefinedTable 是关系不存在的 SQLSTATE。它不是「没有这一行」。
	UndefinedTable = "42P01"
	// ConversationDeleted 是「所属会话已删除，禁止再写」的 SQLSTATE。
	// 不用 23514：那是所有 CHECK 约束共用的码。触发器在 00105 里把它写成 QQD01。
	ConversationDeleted = "QQD01"
	// RecoveryBlocked 是「这条连接不能做业务」的 SQLSTATE。acquire_serving_gate 在 00106 里写成 QQG01。
	// 不用 P0001：那是没写 ERRCODE 的 RAISE 的默认码。
	RecoveryBlocked = "QQG01"
	// UndefinedFunction 是函数不存在的 SQLSTATE。未迁移的库没有恢复门，调用点据此失败关闭。
	UndefinedFunction = "42883"
)

// IsUniqueViolation 判断错误链中是否有 PostgreSQL 唯一约束冲突。
// 只认类型化的 *pgconn.PgError：本进程的库句柄一律由 pgx stdlib 打开，这是唯一可信的错误类型。
func IsUniqueViolation(err error) bool {
	return codeIs(err, UniqueViolation)
}

// IsUndefinedTable 判断错误链中是否有「关系不存在」。
// 缺表不能当成没有这一行，也不能当成没有限制。
func IsUndefinedTable(err error) bool {
	return codeIs(err, UndefinedTable)
}

// IsConversationDeleted 判断错误链中是否是「会话已删除」的写入拒绝。
// 只认 QQD01。错误文本里出现 conversation_deleted，或别的约束返回 23514，都不是它。
func IsConversationDeleted(err error) bool {
	return codeIs(err, ConversationDeleted)
}

// IsRecoveryBlocked 判断错误链中是否是恢复门的拒绝。只认 QQG01。
func IsRecoveryBlocked(err error) bool {
	return codeIs(err, RecoveryBlocked)
}

// IsUndefinedFunction 判断错误链中是否是「函数不存在」。
func IsUndefinedFunction(err error) bool {
	return codeIs(err, UndefinedFunction)
}

func codeIs(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
