# ElseLife product Go backend（开发导出）

Go 1.26+、PostgreSQL 16+。这是单 workspace、本机开发组合根，不是生产服务器，不含账号/套餐/支付/管理后台。

## 空数据库与运行

所有命令在本 `backend/` 执行。请仅使用自己新建的本地空数据库，**不要指向既有/生产库**。

```sh
createdb elselife_product_dev
export ELSELIFE_DEV_DATABASE_URL='postgres:///elselife_product_dev?host=/var/run/postgresql'
psql "$ELSELIFE_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f schema/schema.sql

# 在另一个终端按 algorithms/README.md 启动 Rust runtime：
# algorithm-runtime --listen 127.0.0.1:18083 --insecure-plaintext
export ELSELIFE_DEV_ALGORITHM_ADDR=127.0.0.1:18083

# 自己配置真实 OpenAI-compatible 模型 API；不内置地址、模型或密钥。
# BASE_URL 末尾通常为 /v1，客户端在其后追加 /chat/completions。
export ELSELIFE_DEV_MODEL_BASE_URL='https://your-provider.example/v1'
export ELSELIFE_DEV_MODEL_NAME='your-real-model'
# 从你自己的安全环境注入 ELSELIFE_DEV_MODEL_API_KEY（不要提交到源码）。
# 显式声明真实部署容量；此处不猜测模型上限：
export ELSELIFE_DEV_MODEL_CONTEXT_TOKENS=131072
export ELSELIFE_DEV_MAX_OUTPUT_TOKENS=8192
# 仅在已验证该模型/部署满足核心 byte-token 上界时设 true；不是绕过开关。
export ELSELIFE_DEV_MODEL_BYTE_TOKEN_BOUND_VERIFIED=true

GOWORK=off go run ./cmd/product-dev
# 同源 Flutter build（可选）：
GOWORK=off go run ./cmd/product-dev --static-dir ../frontend/build/web
```

如需在本机开发时复用已经登录的官方 Codex CLI，可显式选择 `codex` provider；这不会读取或复制登录令牌，也不改变默认 OpenAI-compatible 路径。在 WSL 中启动 Go、调用 Windows `codex.exe` 的示例：

```sh
export ELSELIFE_DEV_MODEL_PROVIDER=codex
export ELSELIFE_DEV_CODEX_CLI_PATH='/mnt/c/Users/16039/AppData/Local/OpenAI/Codex/bin/be3fd7e5c1969ff6/codex.exe'
export ELSELIFE_DEV_CODEX_AUTH_HOME='C:\Users\16039\.codex'
export ELSELIFE_DEV_CODEX_TEMP_DIR='/mnt/c/Users/16039/AppData/Local/Temp'
export ELSELIFE_DEV_CODEX_MODEL='gpt-6.1-sol'
# 本机 CLI 如需代理，显式提供给 CLI 子进程；无代理时省略。
export ELSELIFE_DEV_CODEX_PROXY='http://127.0.0.1:10808'
export ELSELIFE_DEV_MODEL_CONTEXT_TOKENS=65536
export ELSELIFE_DEV_MAX_OUTPUT_TOKENS=4096
export ELSELIFE_DEV_MODEL_BYTE_TOKEN_BOUND_VERIFIED=true
GOWORK=off go run ./cmd/product-dev --static-dir ../frontend/build/web
```

这些 CLI、授权目录和代理值仅是本机示例，换机器时请改为自己的路径与网络配置。`CODEX_AUTH_HOME` 是 Windows 路径；`CODEX_TEMP_DIR` 是 Go 可写、Windows CLI 可读的共享盘路径。提供的容量数字是保守的开发声明，仍须核对所选模型的实际容量与 byte-token 上界；缺少显式容量/验证时服务拒绝该 provider。CLI 以临时只读工作目录、禁用工具与搜索、JSON Schema 约束运行；stdout/stderr 总量有 1 MiB 上限，错误不会包含提示词、原始 CLI 输出或凭据。CLI 登录成功不等于模型调用成功，仍须验证网络、代理与模型可用性；调用使用当前 Codex 账号额度。`go test -tags codexlive -run TestCodexCLILive ./internal/capability/model` 是手动执行的最小真实连接测试，不属于普通单测。

`schema/schema.sql` 是原 00068/00106/00155/00156 migration 的事务化合并，仅创建 recovery gate 与 8 张 experience 表。首次执行失败会回滚；非空库重复执行会明确失败，不是升级/迁移/恢复或旧业务 bootstrap。开发恢复门保留原物理连接 advisory-lock 约束，但此包不包含生产备份/恢复运维系统。

`--listen` 默认 `127.0.0.1:18081`，只接受 literal loopback IP，拒绝 `0.0.0.0`、空 host、域名和公网地址。Rust gRPC 也仅允许 literal loopback；明文仅用于开发。无 DB URL 时不启动；缺完整模型配置时不猜、不自动联系外部服务，生成/feedback 以 `model_unavailable` 明确失败；容量未被声明/验证则 `model_capacity_unknown`。`/healthz` 只说明 HTTP 进程存活，不证明 Rust/模型可用。真实生成经过原 Rust runtime + 原模型 transport；不会伪造故事。

workspace 固定 `local-workspace`，不接受 Authorization/X-Account-ID/X-User-ID。原 `AccountID/account_id` 字段只作为产品隔离/幂等/digest key 保留，不是用户账号；没有 account 表、身份解析、登录或账号模拟。不要把这个开发入口开放到公网或当多用户系统使用。

## HTTP 与前端

原 experience HTTP DTO 与状态码保留；plain JSON，不包 QQSS22、不需要登录。错误统一为 `{"error":{"code":"...","message":"..."}}`。CORS 仅允许同源和 `http://127.0.0.1:18080`、`http://localhost:18080`。不接受任意 origin，不设置允许凭据。loopback remote/Host 检查防止把开发入口当通用公开 HTTP 服务。

- `GET /v1/experiences`
- `POST /v1/experiences`: `{request_id,seed}` → 202 View（含 operation）
- `GET /v1/experience-requests/{request_id}` → receipt
- `GET /v1/experiences/{id}?branch_id=...` → snapshot
- `POST /v1/experiences/{id}/operations`: `{request_id,branch_id,expected_revision,mode,input}` → 202 View（含 operation）
- `GET /v1/experiences/{id}/operations/{request_id}`
- `POST /v1/experiences/{id}/operations/{request_id}/cancel`
- `POST /v1/experiences/{id}/branches`: `{request_id,from_branch_id,from_revision,name,edit?}` → 201 snapshot
- `GET /v1/experience-preferences` / `PUT` 单维度 `{dimension,expected,value,expression,confirmation}`（不是 changes 数组）
- `POST /v1/experience-preferences/interpret`: `{text}` → proposed changes; needs real configured model
- `GET /healthz`, `GET /v1/meta`, `GET /v1/time`

完整类型见 `internal/experience/types.go` 与 `devhttp/routes.go`。preference change 必须显式包含 `expected`（允许 null）与 `value`（允许 null）；省略与 null 不等价。自然语言 feedback 只提出候选，仍由产品原确认/CAS 规则落地。请求 ID 在固定 workspace 内全局幂等。

## 构建、测试、再生成

```sh
GOWORK=off go build ./...
GOWORK=off go test ./...
# 以下测试自动创建临时本地 PG cluster（root 时降权 postgres），不读取 DB 环境配置：
PATH=/usr/lib/postgresql/16/bin:$PATH GOWORK=off go test -race -tags=integration -count=1 ./internal/experience/... ./internal/algorithm/channel
# 可选真实 Rust 二进制联调；模型响应仅由测试 httptest fixture 提供，不调用真实模型：
ELSELIFE_TEST_RUST_RUNTIME=/path/to/algorithm-runtime ELSELIFE_TEST_RUST_EXPERIENCE_V2=1 PATH=/usr/lib/postgresql/16/bin:$PATH GOWORK=off go test -tags=integration -count=1 ./internal/experience
# 仅当修改产品 SQL/schema 后：sqlc v1.31.1
sqlc generate
```

生成 pgq 的 schema 输入只有 `schema/migrations`，queries 位于 internal/sqlc/queries（含 archive/delete 查询）。没有新手写 Scan。`go.mod/go.sum` 锁定公开依赖；不需要私有 `.modsrc`、`replace`、go.work、原仓 Git 或 CI/history 目录。首次 Go 依赖/toolchain 获取需要网络或预先准备 Go module cache；此导出不是全离线 vendor 包。

来源与修改清单见 `SOURCE_FILES.json`，完整验证/剩余边界见 `../notes/backend-extraction.md`。

## 2026-10-15 原 demo 迁移后的服务能力与实测

显式启用 Codex provider 时，适配器将正式 JSON Schema 转为 Codex 支持的严格传输子集：所有对象字段在传输中 required，原可选字段允许 null，oneOf 转 anyOf，条件与唯一性约束仍由原 Go/Rust 契约执行。返回只删除原可选且不可空字段上的人工 null；原 required/null 语义不变。重复 JSON 键拒绝，转换后重新计量上下文容量。不改写原合同来迁就供应商，不以固定故事回退，不自动重试到故事成功。CLI 无 Schema 时明确拒绝，不存在隐式默认 Schema。

`GET /v1/model-status` 的 available 只表示配置完整（checked=configuration），不是实时上游探测。使用普通 `go test ./...` 不会发模型请求；显式授权后可用 `go test -tags codexlive -run TestCodexCLIContractLive ./internal/capability/model` 验证完整正式生成 Schema。它使用上述 CLI 环境变量，只输出安全诊断类别，不打印剧情或认证信息。

新增接口：

- `POST /v1/world-drafts/generate`：`{request_id,idea}` → `{world}`。一次真实模型调用，返回可编辑作者草稿；不创建正式经历。必填、嵌套字段、枚举与编辑器容量由 Go 检查，失败不填假草稿。角色 goal/history/secret 是作者材料，Flutter 开始故事使用公开字段白名单。
- `GET /v1/archive`：导出格式 elselife-experience-archive、version=1，含全部正式分支、页面与内部状态。文件包含作者隐藏状态，应按自己的存档保管。
- `POST /v1/archive`：32 MiB 全局上限，完整结构/关系/页版本/状态校验后逐经历事务导入；已有 ID 保留、重试跳过；不恢复 pending 操作，不覆盖已有故事。
- `DELETE /v1/experiences/{id}`：显式永久删除一段经历及其分支/操作/页面；事务锁住分支防止晚到生成复活，重复调用安全。界面应先明确确认。

本机已完成真实 HTTP 链路：Flutter 使用的 Go API → Rust runtime → 当前登录 Codex → Go PostgreSQL 提交。独立验证故事依次 begin/read/act/ask 成功，达到 revision=4、4 页，每页保留 Reader 投影；同次世界草稿真实生成成功。该记录证明这组请求的完整链路，不代表所有生成结果的叙事质量或长期表现。验证过程中没有迁移原 demo 用户存档，没有打印生成正文或凭据。

运行二进制修改后需要重新 go build 并重启 Go；contract/Rust 修改时也需重建 Rust，四份 contract.json 与 Rust build pin 必须一致。当前工程校验使用根目录 `tools/verify_project.py`；当前文件变更由 Git 记录，原 SOURCE_MANIFEST/SOURCE_REVISIONS 仅保留为历史来源证据。
### 作者审阅与显式新分支

`POST /v1/experiences/{id}/assist` 接收 `{request_id,branch_id,expected_revision,kind,request}`，kind 为 polish 或 repair。返回 `{kind,branch_id,base_revision,text,proposal?}`；无正式写入。polish 返回待审阅表达，repair 的 proposal 是完整 Candidate，已经通过原 Rust 生成/验证通道和 Go Apply。若生成期间来源版本变化，则拒绝过期提案。

确认后调用现有 `POST /v1/experiences/{id}/branches`，额外提供 `expected_revision` 并保持 `from_revision` 等于当前正式 revision，四种变更 edit/polish/world_version/repair 互斥：

- `polish:{text}`：新支仅替换最后一页文字，正式事实、时间、建议与其他页保留；原支可恢复。
- `repair:{candidate}`：给定提案再次经过 Rust 原验证器和 Go Apply，成功才在新支替换最后一页及其派生状态，不再请求模型重新决定结果。
- `world_version:{id,version,title,public_seed}`：原字历史、现有事实与故事标题保持，后续新支生成使用此版本公开种子；后代分支继承最近的版本。NPC 私密资料不能拼进 public_seed。

确认事务锁住来源分支，检查 expected_revision 与活跃生成操作；重复 request_id 返回既有分支，改内容复用 ID 报冲突。metadata 使用现有 experience_forks.edit，由 sqlc 读写，未增加数据库列。完整档案包含 changes，导入时重新校验润色状态未变、修复候选与替换状态一致，并恢复分支世界版本。普通 View 不直接返回 changes。
### 私有作者世界资料

CreateRequest 可另带 `author_world` 和 `world_version`；ForkRequest 在 world_version 变更时可带 `author_world`。author_world 使用世界草稿 DTO 的严格白名单：title/description/era/rules/characters/identity/location/goal/opening/narrative，其中 characters 包含 name/role/public/goal/history/secret，不接受本机记录 id/seed/tagline/characters[].id 等额外字段。创建时 world_version.public_seed 必须等于实际 seed，以保留起始身份等选择。

编辑过的作者资料使用编辑器 UTF-16 字段上限（开场 12000、秘密 3000、规则 40 条、人物 30 位、自定义文风 200），整体至多 1 MiB；Create/Fork HTTP 请求至多 2 MiB。AI 生成草稿继续使用单独较小的输出约束。模型输入仍受显式上下文预算限制，资料过大时明确失败，不裁掉秘密或假装完整理解。

私有资料在 PostgreSQL 分支元数据持久化，后代继承最近世界版本；换版本不覆盖旧分支。Go 的内部 AuthorWorld 字段不序列化进普通 DTO 或共享 Context JSON。非 ask 模型调用使用独立 JSON 数据附件及系统级边界：作者秘密不等于玩家知识，不能越过已知事实、可观察发现与行动授权。ask 在资料投影和模型桥两处移除此附件。View、书架、Reader 与公开 seed 不输出作者资料；完整 archive 有意备份它。模型叙事仍须遵守提示约束，结构验证不等于逐句文义隐私证明。

已用独立虚构验证故事实测带 author_world 开局与 ask 均提交成功，普通读取没有出现私有校验串；隔离 PostgreSQL 测试覆盖跨 workspace、旧/新世界版本、原线保留与完整档案恢复。测试样本经过 ID、原始请求、分支版本及无活跃操作核验后已清理，不留在用户书架。

## Windows + WSL 可重复启动入口

从正式目录执行，不依赖任何 .merge-work 临时脚本：

```powershell
# 核验当前运行服务与本地合同/静态目录（只读）
.\tools\start-local.ps1 -Check
# 首次构建 Go/Rust 本地二进制并启动；公开依赖需要预先缓存
.\tools\start-local.ps1 -Build
# 以后启动/复用已核验服务；无新可见窗口
.\tools\start-local.ps1
# 不需要本机代理时：
.\tools\start-local.ps1 -CodexProxy ''
```

脚本发现本机安装的 codex.exe，只传入现有 .codex 目录路径，不读取登录文件。默认使用当前 Windows 用户路径、gpt-6.1-sol 和本机 10808 代理，可用参数覆盖。WSL 依赖 Go 位于 /opt/elselife-tools/go、Cargo 位于 /root/.cargo/bin、PostgreSQL16 已运行且已有按本文创建的 elselife_product_dev。它不会创建/清空数据库，不会下载依赖。Flutter 已构建的 frontend/build/web 必须存在；前端构建步骤见 frontend/README.md。

Go 构建输出 /opt/elselife-tools/bin/elselife-product-dev-local，Rust 构建缓存 /root/.cache/elselife-cargo-target，运行日志 /root/.cache/elselife-local/logs；Windows 启动器诊断位于 %LOCALAPPDATA%\ElseLife\logs。所有入口只监听 127.0.0.1，页面18080、Go18081、Rust18083。已占端口必须核验进程、Go合同/服务身份、Rust二进制和网页目录；未知或旧二进制进程保持原样并报错，需要明确停止已知旧服务后再启动。脚本不自动终止任何进程，Start-Process 始终 Hidden。
启动器已实际完成离线 Go/Rust 构建、已知进程替换及三端口复核，并通过启动后的真实世界草稿请求（约 51 秒，不创建经历）。Windows 登录目录以 WSL 路径跨进程传递，再由 wslpath 转回，避免反斜线转义；隐藏启动器只等待启动进程退出，不等待后台服务树。

开场失败或取消、revision 仍为 0 时，用户明确发送 read 会由 Go 在分支锁内转换成 begin，再生成同一经历的第 1 页；act/ask 此时拒绝。来源种子与作者资料不变，不自动重试，不创建第二段经历，原请求号保持幂等。已有正式页的 read 行为不变。

Public interactive artifact API and additive migration details: see ../notes/demo-runtime-verification.md (Public interactive artifacts).
