// 文件职责：钉住唯一约束冲突只按 SQLSTATE 判定，且必须能穿过包装层。
package pgerr

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/lib/pq"
)

func TestConversationDeletedIsOnlyItsSQLState(t *testing.T) {
	t.Parallel()
	if !IsConversationDeleted(fmt.Errorf("写正文: %w", &pgconn.PgError{Code: ConversationDeleted, Message: "other words"})) {
		t.Fatal("wrapped QQD01")
	}
	if IsConversationDeleted(errors.New("pq: conversation_deleted")) {
		t.Fatal("text is not the contract")
	}
	if IsConversationDeleted(&pgconn.PgError{Code: "23514", Message: "conversation_deleted"}) {
		t.Fatal("check_violation is not conversation deletion")
	}
}

func TestRecoveryBlockedIsOnlyItsSQLState(t *testing.T) {
	t.Parallel()
	if !IsRecoveryBlocked(fmt.Errorf("gate: %w", &pgconn.PgError{Code: RecoveryBlocked, Message: "database_recovery_blocked"})) {
		t.Fatal("wrapped QQG01")
	}
	if IsRecoveryBlocked(errors.New("database_recovery_blocked")) {
		t.Fatal("text is not the contract")
	}
	if IsRecoveryBlocked(&pgconn.PgError{Code: "P0001", Message: "database_recovery_blocked"}) {
		t.Fatal("default raise is not the gate")
	}
	if !IsUndefinedFunction(&pgconn.PgError{Code: UndefinedFunction}) {
		t.Fatal("42883")
	}
}

func TestIsUndefinedTableRejectsTextAndNoRows(t *testing.T) {
	t.Parallel()
	if !IsUndefinedTable(fmt.Errorf("读权益: %w", &pgconn.PgError{Code: UndefinedTable})) {
		t.Fatal("wrapped undefined table")
	}
	if IsUndefinedTable(errors.New("relation \"model_entitlements\" does not exist (SQLSTATE 42P01)")) {
		t.Fatal("text is not the contract")
	}
	if IsUndefinedTable(&pgconn.PgError{Code: UniqueViolation}) {
		t.Fatal("unique is not undefined table")
	}
}

func TestIsUniqueViolationAcceptsTypedPgError(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"typed", &pgconn.PgError{Code: UniqueViolation, Message: "duplicate key value violates unique constraint"}, true},
		{"wrapped", fmt.Errorf("写入去重记录失败: %w", &pgconn.PgError{Code: UniqueViolation}), true},
		{"other_state", &pgconn.PgError{Code: "55P03"}, false},
		{"nil", nil, false},
		{"plain", errors.New("some failure"), false},
		// 文本不再是判据。驱动换措辞、约束名里带 unique、报文里恰好出现 23505，都不改变分类。
		{"text_unique", errors.New("error: duplicate key value violates unique constraint \"users_email_key\""), false},
		{"text_sqlstate", errors.New("ERROR: 23505"), false},
		// lib/pq 的错误类型不是本进程驱动的错误类型：旧 staff.isUnique 正是靠它，因而恒为 false。
		{"lib_pq_error", &pq.Error{Code: pq.ErrorCode(UniqueViolation)}, false},
	}
	for _, testCase := range cases {
		if got := IsUniqueViolation(testCase.err); got != testCase.want {
			t.Fatalf("%s: got %v want %v", testCase.name, got, testCase.want)
		}
	}
}
