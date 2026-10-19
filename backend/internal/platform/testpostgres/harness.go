// 文件职责：临时 PostgreSQL 16 集群的启动、连接与清理生命周期。
// 主要依赖：本机 PATH 中的 initdb/pg_ctl/createdb（可通过 Options.BinDir 指定）。
// 调用边界：仅由集成测试或 cmd/testpostgres 使用；生产进程禁止引用。
// 状态边界：不读取 TELOS_DATABASE_URL 等开发库配置；连接串只指向自己的临时 socket。
// 安全边界：trust 认证仅限临时 socket，数据目录用完即删。

package testpostgres

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"

	"elselife/backend/internal/operations/pgtool"
)

// macOS 不提供 Linux 的 C.utf8 名称；UTF8 编码仍由 initdb 的独立参数固定。
func initdbLocale(platform string) string {
	if platform == "darwin" {
		return "C"
	}
	return "C.utf8"
}

// defaultPort 是临时集群使用的固定端口，仅决定临时 socket 文件名，与任何 TCP 无关。
const defaultPort = 55432

// Options 配置临时集群的启动参数。
type Options struct {
	BinDir    string // PostgreSQL 工具目录；空表示从 PATH 查找。
	Superuser string // 超级用户，默认 telos。
	Database  string // 初始数据库名，默认 testdb。
	Port      int    // 端口，0 表示使用 defaultPort。
}

// State 是跨进程停止临时集群所需的最小状态。
// cmd/testpostgres 将它以 0600 JSON 文件保存，测试脚本退出时再恢复并清理。
type State struct {
	BinDir    string `json:"bin_dir"`
	Superuser string `json:"superuser"`
	Database  string `json:"database"`
	Port      int    `json:"port"`
	RootDir   string `json:"root_dir"`
	DataDir   string `json:"data_dir"`
	SocketDir string `json:"socket_dir"`
	LogFile   string `json:"log_file"`
}

// Cluster 表示一个运行中的临时 PostgreSQL 集群。
type Cluster struct {
	binDir    string
	superuser string
	database  string
	port      int

	rootDir   string
	dataDir   string
	socketDir string
	logFile   string

	started bool
	mu      sync.Mutex
}

// New 启动临时集群并注册 t.Cleanup。
// 测试失败或 panic 也会执行清理，避免遗留 PostgreSQL 进程。
func New(t testing.TB) *Cluster {
	t.Helper()
	c, err := StartCluster(context.Background(), Options{})
	if err != nil {
		t.Fatalf("启动临时 PostgreSQL: %v", err)
	}
	t.Cleanup(func() {
		if err := c.Stop(); err != nil {
			t.Errorf("停止临时 PostgreSQL: %v", err)
		}
	})
	return c
}

// StartCluster 在独立临时目录执行 initdb。
// 集群只监听自己的 Unix socket，不读取任何开发数据库配置。
func StartCluster(ctx context.Context, opts Options) (*Cluster, error) {
	if opts.Superuser == "" {
		opts.Superuser = "telos"
	}
	if opts.Database == "" {
		opts.Database = "testdb"
	}
	if opts.Port == 0 {
		opts.Port = defaultPort
	}

	initdb, err := findTool(opts.BinDir, "initdb")
	if err != nil {
		return nil, err
	}
	if err := requireVersion16(ctx, initdb); err != nil {
		return nil, err
	}
	pgCtl, err := findTool(opts.BinDir, "pg_ctl")
	if err != nil {
		return nil, err
	}
	createdb, err := findTool(opts.BinDir, "createdb")
	if err != nil {
		return nil, err
	}

	rootDir, err := os.MkdirTemp("", "telos-pg-")
	if err != nil {
		return nil, fmt.Errorf("创建临时目录: %w", err)
	}
	if err := chownIfRoot(rootDir); err != nil {
		_ = os.RemoveAll(rootDir)
		return nil, err
	}
	c := &Cluster{
		binDir:    opts.BinDir,
		superuser: opts.Superuser,
		database:  opts.Database,
		port:      opts.Port,
		rootDir:   rootDir,
		dataDir:   filepath.Join(rootDir, "data"),
		socketDir: filepath.Join(rootDir, "sock"),
		logFile:   filepath.Join(rootDir, "pg.log"),
	}
	if err := os.MkdirAll(c.socketDir, 0o755); err != nil {
		c.removeDirs()
		return nil, fmt.Errorf("创建 socket 目录: %w", err)
	}
	if err := chownIfRoot(c.socketDir); err != nil {
		c.removeDirs()
		return nil, err
	}

	if err := run(ctx, initdb, "-D", c.dataDir, "-U", c.superuser, "--locale="+initdbLocale(runtime.GOOS), "--encoding=UTF8", "--auth-local=trust", "--auth-host=reject", "--no-sync"); err != nil {
		c.removeDirs()
		return nil, fmt.Errorf("initdb: %w", err)
	}
	// 关键安全配置：关闭 TCP 监听，只监听本临时 socket，并关闭 fsync 加速测试。
	socketDir := strings.ReplaceAll(c.socketDir, "'", "''")
	conf := fmt.Sprintf("\nlisten_addresses = ''\nunix_socket_directories = '%s'\nport = %d\nfsync = off\nsynchronous_commit = off\n", socketDir, c.port)
	if err := appendFile(filepath.Join(c.dataDir, "postgresql.conf"), conf); err != nil {
		c.removeDirs()
		return nil, fmt.Errorf("写 postgresql.conf: %w", err)
	}
	if err := run(ctx, pgCtl, "-D", c.dataDir, "-l", c.logFile, "-w", "-t", "60", "start"); err != nil {
		c.removeDirs()
		return nil, fmt.Errorf("启动 PostgreSQL: %w", err)
	}
	c.started = true

	if err := run(ctx, createdb, "-h", c.socketDir, "-p", strconv.Itoa(c.port), "-U", c.superuser, c.database); err != nil {
		_ = c.Stop()
		return nil, fmt.Errorf("创建数据库: %w", err)
	}
	return c, nil
}

// Stop 停止集群并删除临时目录，可重复调用。
// fast 模式失败时尝试 immediate；两者均失败时保留数据目录，避免删除运行中集群。
func (c *Cluster) Stop() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.started {
		pgCtl, err := findTool(c.binDir, "pg_ctl")
		if err != nil {
			return err
		}
		if err := run(context.Background(), pgCtl, "-D", c.dataDir, "-m", "fast", "-w", "stop"); err != nil {
			if fallbackErr := run(context.Background(), pgCtl, "-D", c.dataDir, "-m", "immediate", "-w", "stop"); fallbackErr != nil {
				return fmt.Errorf("停止 PostgreSQL: fast=%v, immediate=%w", err, fallbackErr)
			}
		}
		c.started = false
	}
	return c.removeDirs()
}

// State 返回可跨进程持久化的停止状态。
// 状态不含密码或业务正文，只描述本次临时目录与进程参数。
func (c *Cluster) State() State {
	return State{
		BinDir: c.binDir, Superuser: c.superuser, Database: c.database, Port: c.port,
		RootDir: c.rootDir, DataDir: c.dataDir, SocketDir: c.socketDir, LogFile: c.logFile,
	}
}

// StopState 恢复脚本保存的临时集群状态并执行幂等停止清理。
// 路径必须满足 telos-pg-* 临时根目录约束，避免状态文件被篡改后删除任意目录。
func StopState(state State) error {
	root := filepath.Clean(state.RootDir)
	tempRoot, err := filepath.Abs(os.TempDir())
	if err != nil {
		return fmt.Errorf("定位系统临时目录: %w", err)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("定位集群临时目录: %w", err)
	}
	rel, err := filepath.Rel(tempRoot, rootAbs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) ||
		!strings.HasPrefix(filepath.Base(rootAbs), "telos-pg-") ||
		filepath.Clean(state.DataDir) != filepath.Join(rootAbs, "data") ||
		filepath.Clean(state.SocketDir) != filepath.Join(rootAbs, "sock") {
		return fmt.Errorf("拒绝不安全的临时集群状态")
	}
	if _, err := os.Stat(rootAbs); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("检查集群临时目录: %w", err)
	}
	_, pidErr := os.Stat(filepath.Join(state.DataDir, "postmaster.pid"))
	if pidErr != nil && !os.IsNotExist(pidErr) {
		return fmt.Errorf("检查 PostgreSQL 进程状态: %w", pidErr)
	}
	cluster := &Cluster{
		binDir: state.BinDir, superuser: state.Superuser, database: state.Database, port: state.Port,
		rootDir: rootAbs, dataDir: state.DataDir, socketDir: state.SocketDir, logFile: state.LogFile,
		started: pidErr == nil,
	}
	return cluster.Stop()
}

// DSN 返回 pgx 可用的 keyword/value 连接串。
// host 始终是临时 Unix socket 目录，连接串不含密码或 TCP 地址。
func (c *Cluster) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s dbname=%s sslmode=disable", c.socketDir, c.port, c.superuser, c.database)
}

// SocketDir 返回临时 Unix socket 目录。
// 该路径属于本集群临时根目录，停止后即失效。
func (c *Cluster) SocketDir() string { return c.socketDir }

// DataDir 返回临时 PostgreSQL 数据目录。
// 该路径仅供 Harness 自检，不应作为业务配置。
func (c *Cluster) DataDir() string { return c.dataDir }

// RootDir 返回本集群临时根目录。
// 停止成功后该目录必须不存在。
func (c *Cluster) RootDir() string { return c.rootDir }

// Port 返回 Unix socket 文件名使用的端口。
// 集群未监听 TCP，因此该值不是网络连接入口。
func (c *Cluster) Port() int { return c.port }

// User 返回临时集群超级用户名。
// 用户只在本次临时集群内有效。
func (c *Cluster) User() string { return c.superuser }

// Database 返回初始隔离数据库名。
// Harness 不会返回或复用开发数据库名。
func (c *Cluster) Database() string { return c.database }

// removeDirs 删除临时根目录。
// 目录不存在时静默成功，便于失败路径和重复 Stop 共用。
func (c *Cluster) removeDirs() error {
	if c.rootDir == "" {
		return nil
	}
	if err := os.RemoveAll(c.rootDir); err != nil {
		return fmt.Errorf("清理临时目录 %s: %w", c.rootDir, err)
	}
	return nil
}

// requireVersion16 校验 initdb 主版本，防止误用不兼容集群。
// 版本输出只用于本地工具判定，不进入业务日志。
func requireVersion16(ctx context.Context, initdb string) error {
	out, err := exec.CommandContext(ctx, initdb, "--version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("读取 initdb 版本: %w", err)
	}
	major, ok := pgtool.VersionMajor(string(out))
	if !ok || major != 16 {
		return fmt.Errorf("Harness 要求 PostgreSQL 16，得到 %q", strings.TrimSpace(string(out)))
	}
	return nil
}

// findTool 定位 PostgreSQL 工具；指定 binDir 时优先使用，否则从 PATH 查找。
// 工具缺失时返回明确错误，不回退到开发数据库或远程 Service。
func findTool(binDir, name string) (string, error) {
	if binDir != "" {
		candidate := filepath.Join(binDir, name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		return "", fmt.Errorf("PostgreSQL 工具 %s 不在 %s", name, binDir)
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("找不到 PostgreSQL 工具 %s（需安装 PostgreSQL 16）: %w", name, err)
	}
	return path, nil
}

// run 执行外部命令。
// 失败时携带测试工具输出，但不读取或拼入业务正文。
func run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	if cred, err := postgresCred(); err != nil {
		return err
	} else if cred != nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred}
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func postgresCred() (*syscall.Credential, error) {
	if os.Getuid() != 0 {
		return nil, nil
	}
	u, err := user.Lookup("postgres")
	if err != nil {
		return nil, fmt.Errorf("root 下 initdb 需要 postgres 用户: %w", err)
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return nil, err
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return nil, err
	}
	return &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}, nil
}

func chownIfRoot(path string) error {
	cred, err := postgresCred()
	if err != nil {
		return err
	}
	if cred == nil {
		return nil
	}
	return os.Chown(path, int(cred.Uid), int(cred.Gid))
}

// appendFile 向 PostgreSQL 配置文件追加测试覆盖项。
// 文件已有权限保持不变，调用方只传 Harness 生成的固定配置。
func appendFile(path, content string) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		return err
	}
	return nil
}
