# Go 产品后端抽取报告

**已完成：导出目录内可独立编译、测试的无账号开发后端。**

来源 `/opt/cs/elselife/backend`，固定 commit `e564b101f8e8bd60a7bf661b70e0188b079c8fc6`。抽取前后实际 `git status --porcelain` 均为空，HEAD 未变。原仓只读，未 commit；未读取 .env/凭据，未连接真实/生产 DB，未调用外部模型。只写本 `backend/` 与本报告。

## 产物与产品边界

- `backend/internal/experience` 顶层 24 个 Go 文件全保留；23 个与原仓逐字节相同，唯一修改是 `authority_integration_test.go` 的 schema fixture。Service、Apply、source-reader、lease/fence、CAS、preferences、全历史和模型输入/检索收据等产品核心没有改字。
- `internal/algorithm/channel` 16 个 Go 文件全部逐字节相同。经验 contract 字节、Go proto 生成代码保持原样。
- 原 `worldhttp` 及其 tests 不带入；其唯一替代是副本 `internal/experience/devhttp`。保留原 DTO/paths/decode/产品错误码与状态映射，去掉 Auth/identity/sessionkeys/cipherdoor/QQSS22，固定 workspace 为 `local-workspace`。没有伪造故事或账号模拟。
- 不复制 account、billing、payment、staff、admin、旧 workflowtask、旧 bootstrap、旧部署/CI/历史上下文。
- `AccountID/account_id` 原字段保留以不改变产品幂等键、digest、隔离与 SQL 主键；在此 HTTP 入口其唯一 owner 是组合根常量，不来自用户头，不代表登录身份，DB 不存在 accounts 外键/表。所有值为非 null 的原产品键；此开发入口只使用 `local-workspace`，不提供多用户能力。集成测试检查其他 workspace 无列表数据，并验证身份头被拒绝。

### Δlocal

上列旧业务目录/生产组合根被排除。保留的公共技术底座仅 model transport、algorithm channel、contract、database serving/recovery gate、pgerr，以及临时 PG 测试所需 testpostgres/pgtool。没有复制 content 或私有 `.modsrc`；`modules.lock` 明确没有所需私有模块。

### Δcontract

- experience Revision `685758b9009c647f0b6b0da2dbe1769ea6964a71`，SHA256 `af4d178596cffc470f408b0924f04f93d104ca8047539c0d6a219bd3c6667121`（实际 sha256sum 核实）。
- `internal/contract/source/algorithm/v1/runtime.proto` SHA256 `4a7f66d6e1f5be0fe974388aaff6a275014761cfd23a01bd20ef5c99c2587646`，与原 Go 生成代码一起带入，未重定义协议。
- `go.mod/go.sum` 只保留所需公开依赖图；原核心直接依赖版本保留，x/net/x/sync/x/sys/x/text 也恢复为原仓显式 pin。没有 replace/外部 workspace/绝对路径依赖。不是 vendor 包，另一台机器首次构建仍需公开 Go dependency/toolchain 下载或预备 cache。
- pgq **不是复制整个原包**：使用 sqlc v1.31.1 从导出自有 `schema/migrations` + 原 `experience.sql`/`experience_retrieval.sql` 查询重新生成 5 个 Go 文件。生成 models 只有 Experience/Branch/Fork/ModelInput/Operation/Page/Preference/Read 八类，无账户/支付模型。无新增手写 Scan。
- 从上述原 commit 可按 `backend/SOURCE_FILES.json` 的源→导出路径与源/导出 SHA256 重新核对。该清单覆盖 89 个文件（清单本身不自哈希）；`scripts/source-manifest.py /path/to/original/backend` 要求指定原仓 clean 且 HEAD 匹配后重生成清单，不自动复制或覆盖核心。

## 副本修改清单

1. `cmd/product-dev/main.go`：新组合根。默认 `127.0.0.1:18081`，只接受 literal loopback IP bind；algorithm 地址也只允许 literal loopback，默认 `127.0.0.1:18083`。明文 gRPC 仅开发。配置不引用旧配置注册或账号系统；真实 Rust link + 原模型 transport 装配，保留 GenerateAccepted/RecoverExpired 路径。
2. `internal/experience/devhttp/{routes,boundary}.go`：上述 transport 替换；JSON 错误 envelope 与原 ExperienceApi 兼容；loopback peer/Host、有限 origin guard，拒绝 Authorization/X-Account-ID/X-User-ID，不使用凭据。CORS 仅同源 + `http://127.0.0.1:18080`/`http://localhost:18080`。`--static-dir` 可 serve Flutter build 并以 index.html 承接 SPA 路由。
3. `internal/capability/model/provider_attempt.go`：在副本去掉 account/cost provider-attempt 绑定，保留模型 HTTP 尝试、超时/错误分类；不带计费 ledger。`capacity.go`：从原 route_plan.go 提取纯 token capacity 类型/函数，不带旧 runtime config/成本业务依赖。OpenAI model transport、DTO 等保留原字。
4. `internal/platform/database/database.go`：仅提供 pgx Open/OpenServing 与原恢复门 hook；保留原 `recovery_gate.go`。不带旧迁移/生产 bootstrap/管理面。
5. `schema/migrations`：原 00068 recovery gate、00106 SQLSTATE 修订、00155 experience、00156 retrieval 四份迁移原字。`schema/schema.sql` 是它们的事务合并；`schema/schema.go` embed 给测试用。`authority_integration_test.go` 改为调用产品自有 ApplyEmpty。
6. `sqlc.yaml`：schema 输入改为本地产品 migrations。go.mod/go.sum/modules.lock 裁剪旧业务依赖与 replace。
7. 新 devhttp boundary/unit/PG integration tests、README、source manifest 工具与清单。

## API / bootstrap 精确接口（前端对齐）

Plain JSON，不发送身份头、不走 `/v1/cipher`，错误 `{ "error": { "code": "...", "message": "..." } }`。

| Method/path | 请求与返回 |
|---|---|
| GET `/v1/experiences` | `{experiences:[Summary...]}` |
| POST `/v1/experiences` | `{request_id,seed}` → 202 **View**，包含 operation |
| GET `/v1/experience-requests/{request_id}` | 原 Receipt DTO |
| GET `/v1/experiences/{id}?branch_id=...` | View；保留全量 pages/history |
| POST `/v1/experiences/{id}/operations` | `{request_id,branch_id,expected_revision,mode,input}` → 202 **Operation** |
| GET `/v1/experiences/{id}/operations/{request_id}` | 原 operation DTO |
| POST `/v1/experiences/{id}/operations/{request_id}/cancel` | 原取消返回 DTO |
| POST `/v1/experiences/{id}/branches` | `{request_id,from_branch_id,from_revision,name,edit?}` → 201 View |
| GET `/v1/experience-preferences` | `{preferences:[...]}` |
| PUT `/v1/experience-preferences` | 单维度 `{dimension,expected,value,expression,confirmation}` → `{preferences:[...]}`，**不是 changes 数组** |
| POST `/v1/experience-preferences/interpret` | `{text}` → 原 FeedbackProposal DTO，需真实模型配置 |

保留 `GET /healthz`、`/v1/meta`、`/v1/time`。具体类型唯一权威为 `internal/experience/{types,preferences,feedback}.go`。preference `expected/value` 需要显式存在，null 与省略不同。JSON 内容限制及产品严格校验原样保留。

**空本地数据库初始化（不是旧 bootstrap）**：

```sh
cd backend
createdb elselife_product_dev
export ELSELIFE_DEV_DATABASE_URL='postgres:///elselife_product_dev?host=/var/run/postgresql'
psql "$ELSELIFE_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f schema/schema.sql
GOWORK=off go run ./cmd/product-dev
# 同源 build 可选：--static-dir ../frontend/build/web
```

PG schema 只创建 recovery_gate + 八张 experience 表，自动初始 verified 行使 OpenServing 真实放行；重复/非空执行失败，不做 adopt/migrate。不要指向旧业务或生产库。

环境变量：`ELSELIFE_DEV_DATABASE_URL` 必须明确；`ELSELIFE_DEV_ALGORITHM_ADDR` 默认回环 `127.0.0.1:18083`；模型必须显式给 `ELSELIFE_DEV_MODEL_BASE_URL/NAME/API_KEY`（全有或全无）；`ELSELIFE_DEV_MODEL_CONTEXT_TOKENS` 默认未知 0；`ELSELIFE_DEV_MAX_OUTPUT_TOKENS` 默认 8192；`ELSELIFE_DEV_MODEL_BYTE_TOKEN_BOUND_VERIFIED` 默认 false，只有真实核验后才可设 true。不内置外部 API、模型、token 或 fake 生成器。缺模型时 server 可用于查询，但生成/feedback 明确 `model_unavailable`；缺容量声明/核验则 `model_capacity_unknown`。不把存活检查冒充模型/Rust ready。

## 已执行验证（均在导出 backend 根目录）

以下最终一组命令 `set -e` 串联，总退出码 0：

- `GOWORK=off GOPROXY=off go mod tidy`：成功，依赖已在本机 cache，无下载需求。
- `GOWORK=off go build ./...`：退出 0。
- `GOWORK=off go test ./...`：退出 0。
- `PATH=/usr/lib/postgresql/16/bin:$PATH GOWORK=off go test -race -tags=integration -count=1 ./internal/experience/... ./internal/algorithm/channel`：退出 0；experience 21.996s、devhttp 2.080s、channel 1.865s。只创建临时本机 PG cluster，root 时 testpostgres 降权 postgres。新测试核对实际 public 表 inventory、空库 serving gate、plain JSON list/create/receipt、固定 workspace、缺模型明确失败且没有假 page；并测拒公网 bind、身份头、恶意 Host/origin、CORS、JSON error、static SPA。
- `GOWORK=off go vet ./...`：退出 0。
- `GOWORK=off go mod verify`：`all modules verified`。
- `GOWORK=off go env GOWORK GOMOD`：`off` + 导出根 go.mod；`go list -deps` 审计实际 `.Dir`，外部 `/opt/cs/` source 依赖为空。
- `sqlc generate`：退出 0，重生成前后五个 pgq 文件 SHA256 全相同。
- `go run ./cmd/product-dev --listen 0.0.0.0:18081`：明确拒绝，进程退出 1；不带 DB URL 启动也明确退出 1。未用真实 DB 启动。
- 原核心 byte 比对：experience 24 文件只上述 test fixture 1 处变化，channel 16 文件零变化；原仓仍 clean/HEAD 不变。

## 未验证 / 使用边界

- **UNKNOWN：真实外部模型 API + 导出 Rust runtime + 前端浏览器三端端到端生成未执行。** 没有读取凭据或发起模型调用，也没有编造验证成功。原 actual Rust integration tests 保留；未设置 `ELSELIFE_TEST_RUST_RUNTIME` 时按原逻辑 skip，这不算真实 Rust 集成通过。README 给可显式运行的命令。
- Flutter build 的同源服务逻辑已用独立 HTML/JS fixture 测试；未在此任务运行真实 Flutter build/浏览器。
- 不提供生产 TLS、身份/权限、多 workspace 入口、生产运维/恢复/迁移系统；开发回环与拒绝身份头不是生产鉴权替代品。
- **CONTRADICTS：没有发现与原仓 clean/HEAD 或 contract pin 前提相反的事实。** 文档 DTO 两处初稿误写（create 返回 operation、PUT preferences changes 数组）已按实际 Routes 修正为 View 与单维度 change；源码接口未变。
