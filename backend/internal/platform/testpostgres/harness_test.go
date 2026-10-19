//go:build integration

// 文件职责：以真实 PostgreSQL 16 验证临时集群的 Unix socket、隔离与失败清理。
// 主要依赖：本机 PostgreSQL 16 工具、pgx/v5。
// 调用边界：仅通过 -tags=integration 或 make test-integration-harness 执行。
// 状态边界：不读取或连接开发数据库；每例独立 initdb。
// 安全边界：测试日志不打印 DSN、数据库日志或业务正文。

package testpostgres

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/operations/pgtool"

	"github.com/jackc/pgx/v5"
)

// TestHarnessUsesOnlyUnixSocket 证明 Harness 忽略开发 DSN，并通过自己的 Unix socket 查询。
// 同时校验服务端没有 TCP 地址，避免回退到 127.0.0.1:15432 或 :5432。
func TestHarnessUsesOnlyUnixSocket(t *testing.T) {
	requirePostgreSQL16(t)
	t.Setenv("ELSELIFE_DATABASE_URL", "postgres://dev@127.0.0.1:15432/development")
	cluster := New(t)

	dsn := cluster.DSN()
	for _, forbidden := range []string{"127.0.0.1", "15432", "port=5432", "development"} {
		if strings.Contains(dsn, forbidden) {
			t.Fatalf("临时连接串包含禁止目标 %q", forbidden)
		}
	}
	if !strings.Contains(dsn, "host="+cluster.SocketDir()) {
		t.Fatal("临时连接串未指向 Harness Unix socket")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("连接临时 PostgreSQL: %v", err)
	}
	defer conn.Close(ctx)
	var database string
	var unixSocket bool
	if err := conn.QueryRow(ctx, "SELECT current_database(), inet_server_addr() IS NULL").Scan(&database, &unixSocket); err != nil {
		t.Fatalf("查询临时 PostgreSQL: %v", err)
	}
	if database != cluster.Database() || !unixSocket {
		t.Fatalf("未连接预期 Unix socket 数据库：database=%q unix=%v", database, unixSocket)
	}
}

// TestHarnessRunsUseDifferentDirectories 连续启动两个集群并验证目录完全不同。
// 每次显式 Stop 后根目录必须不存在，且重复 Stop 仍成功。
func TestHarnessRunsUseDifferentDirectories(t *testing.T) {
	requirePostgreSQL16(t)
	first, err := StartCluster(context.Background(), Options{})
	if err != nil {
		t.Fatalf("启动第一个集群: %v", err)
	}
	firstRoot := first.RootDir()
	firstSocket := first.SocketDir()
	if err := first.Stop(); err != nil {
		t.Fatalf("停止第一个集群: %v", err)
	}
	assertMissing(t, firstRoot)
	if err := first.Stop(); err != nil {
		t.Fatalf("重复停止第一个集群: %v", err)
	}

	second, err := StartCluster(context.Background(), Options{})
	if err != nil {
		t.Fatalf("启动第二个集群: %v", err)
	}
	secondRoot := second.RootDir()
	secondSocket := second.SocketDir()
	if firstRoot == secondRoot || firstSocket == secondSocket {
		_ = second.Stop()
		t.Fatal("连续运行复用了临时目录")
	}
	if err := second.Stop(); err != nil {
		t.Fatalf("停止第二个集群: %v", err)
	}
	assertMissing(t, secondRoot)
}

// TestHarnessForcedFailureStillCleans 启动一个会 t.Fatal 的子测试进程。
// 子进程非零退出后根目录必须已由 t.Cleanup 删除，证明失败路径不会遗留 PostgreSQL。
func TestHarnessForcedFailureStillCleans(t *testing.T) {
	requirePostgreSQL16(t)
	marker := filepath.Join(t.TempDir(), "root.txt")
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("定位测试二进制: %v", err)
	}
	cmd := exec.Command(executable, "-test.run=^TestHarnessForcedFailureHelper$", "-test.v")
	cmd.Env = append(os.Environ(), "ELSELIFE_FORCE_FAILURE_HELPER=1", "ELSELIFE_FORCE_FAILURE_MARKER="+marker)
	if err := cmd.Run(); err == nil {
		t.Fatal("强制失败子测试意外成功")
	}
	root, err := os.ReadFile(marker)
	if err != nil {
		t.Fatalf("读取子测试目录标记: %v", err)
	}
	assertMissing(t, strings.TrimSpace(string(root)))
}

// TestHarnessForcedFailureHelper 只在父测试设置专用环境变量时启动集群后强制失败。
// New 注册的 t.Cleanup 必须在 t.Fatal 后停止集群并删除根目录。
func TestHarnessForcedFailureHelper(t *testing.T) {
	if os.Getenv("ELSELIFE_FORCE_FAILURE_HELPER") != "1" {
		t.Skip("仅供强制失败子进程调用")
	}
	cluster := New(t)
	if err := os.WriteFile(os.Getenv("ELSELIFE_FORCE_FAILURE_MARKER"), []byte(cluster.RootDir()), 0o600); err != nil {
		t.Fatalf("写目录标记: %v", err)
	}
	t.Fatal("按设计强制失败以验证 Cleanup")
}

// requirePostgreSQL16 校验 initdb 存在且主版本为 16。
// 工具不可用时跳过，版本不符时失败，避免误用其他 PostgreSQL 主版本。
func requirePostgreSQL16(t *testing.T) {
	t.Helper()
	path, err := exec.LookPath("initdb")
	if err != nil {
		t.Skip("未安装 initdb，跳过 PostgreSQL Harness 集成测试")
	}
	out, err := exec.Command(path, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("读取 initdb 版本: %v", err)
	}
	major, ok := pgtool.VersionMajor(string(out))
	if !ok || major != 16 {
		t.Fatalf("Harness 要求 PostgreSQL 16，得到 %q", strings.TrimSpace(string(out)))
	}
}

// assertMissing 断言路径不存在。
// 其他 Stat 错误也视为失败，防止把权限问题误判为已清理。
func assertMissing(t *testing.T, path string) {
	t.Helper()
	_, err := os.Stat(path)
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("临时目录仍存在或不可判定：%s err=%v", path, err)
	}
}
