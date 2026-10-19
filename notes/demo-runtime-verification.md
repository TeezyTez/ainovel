# Demo 迁移运行验证记录

日期：2026-10-15。对象：本包的 Flutter → Go → Rust → Codex 本机授权模型链路。这里记录迁移后验证，不替代或改写原始 SOURCE_MANIFEST、SOURCE_REVISIONS、SOURCE_FILES 和抽取验证记录。测试模型 fixture 仅验证程序行为；真实模型样本只证明对应请求完成，不证明所有故事的叙事质量。

## 自动检查

- Go：`GOPROXY=off /opt/elselife-tools/go/bin/go test ./...` 全部通过，含严格世界草稿 schema、Codex 传输 schema 与恢复、反馈解释、私有作者资料、archive、删除和 HTTP 边界。
- PostgreSQL 隔离测试：`PATH=/usr/lib/postgresql/16/bin:/opt/elselife-tools/go/bin:/usr/bin:/bin GOPROXY=off go test -race -tags integration ./internal/experience ./internal/experience/devhttp -count=1` 通过；使用临时测试数据库，不使用演示数据库。覆盖正式提交、分支、删除/生成竞态、archive 原子导入和作者版本隔离。
- Rust：`CARGO_TARGET_DIR=/root/.cache/elselife-cargo-target cargo test --locked --offline` 通过，共 37 项测试；包括正式契约字节、实际 protobuf 通道、隐藏资料投影、read/act/ask 语义和 reader 附件。
- 新增初始标题回归先复现再修复：等待开场时使用已校验 world_version.title，完整 seed 保持不变；正式候选仍可更新标题；无版本输入保留既有 fallback。
- 新增失败开场恢复回归先复现再修复：revision=0 的显式 read 在 Go 锁定与 CAS 后记为 begin；同一经历形成第一张 begin 页，旧 request 重试返回既有结果，不自动生成、不新建另一经历。已有页的 read 语义保持。
- 迁移哈希检查新增独立临时目录回归：精确哈希例外保留 original_sha256，错误来源、后续漂移、未登记新增源码及 provenance 改写均拒绝。最终清单在所有源码冻结后捕获。

## 真实模型和 HTTP 证据

没有打印或保存生成正文、作者秘密、登录文件或凭据。以下均为本轮创建的验证样本：

| 操作 | 结果 | 耗时或状态 |
| --- | --- | --- |
| 正式完整生成 Schema → Codex CLI | 成功 | 15.45 秒；修复前可安全诊断为 invalid_json_schema |
| HTTP begin → Rust → 模型 → Go PostgreSQL | committed | 28.22 秒 |
| HTTP read | committed | 24.17 秒 |
| HTTP act | committed | 26.20 秒 |
| HTTP ask | committed | 16.14 秒 |
| 上述经历最终读取 | 成功 | revision=4、4页，含 reader 投影 |
| 世界草稿生成 | 成功 | 完整必填字段、4人物、11条规则 |
| polish 待审阅提案与显式确认分支 | 成功 | 12.2 秒；旧线保留；重复确认同 request 返回同分支 |
| repair 提案、Rust 验证及显式确认分支 | 成功 | 14.2 秒；不再次调用模型重新决定结果 |
| world_version 新分支后继续 read | committed | revision=5；旧页、旧事实、旧标题保留 |
| 带 author_world 的开局 | committed | 28.31 秒；普通 View/Reader 无私有验证串 |
| 上述私有资料经历 ask | committed | 16.17 秒；ask 不收到私有附件 |
| 正式启动入口后台分离后的世界草稿 | 成功 | 50.68 秒；完整草稿、2人物及开场；无经历写入 |

测试经历 `exp_dd33ce6ac66c6a1c9c284b9af84a4e8e`、`exp_19fc3d689f9cd9dadb29cf8b63adcca0` 和早期失败样本 `exp_e563002999837b2c5786228e8ad0319c` 已按原始请求、分支版本及无活跃操作核验后删除，均返回 204。未处理其他经历。

Flutter 界面另建的验证经历 `exp_c338367547609a5d2c017efdcaa60809` 用于检查实际失败恢复。它暴露了新启动参数转义和 revision=0 的 read 模式问题，均已修复；修复后已只读确认 revision=1、pageCount=1、firstMode=begin、operation=committed、error_code=null。最终 UI 操作仍在验证，暂保留，尚未清理。

## 已修复的真实链路故障

1. Codex 要求严格传输 Schema，原正式 Schema 的可选字段与复杂条件不能直接发送。适配器现在只转换传输副本；返回只移除人工可空的原可选字段上的 null，原 required/null 语义和 Go/Rust 校验不变；重复键拒绝，预算重新计量。世界草稿和 Codex feedback 明确提供 Schema，失败不填固定内容。
2. Windows → wsl.exe 参数链消耗原始反斜线，导致 AUTH_HOME 路径损坏但配置仍显示 available。启动器先传 WSL 路径，再在 Bash 中 wslpath 转回 Windows 路径；不读取登录文件。
3. `runuser` 不在初始固定 PATH 中，首次后台启动失败；已补 `/usr/sbin`。后台进程使用 setsid，启动器等监听就绪；PowerShell 只等待启动进程，避免 Start-Process -Wait 等待整个常驻服务树。
4. 初始生成失败后显式 read 被原样送到 revision=0，Rust 正确拒绝 begin_required，Go 映射为 algorithm_protocol。现在 Go 在分支锁内将这一次明确 read 转为 begin，不削弱原契约，不自动重试。

## 可重复启动

正式入口：`tools/start-local.ps1` 与 `tools/start-local.sh`，不依赖 `.merge-work`。先按 backend/README.md 准备既有本机 PostgreSQL 与公开依赖缓存、Flutter web 构建。

```powershell
.\tools\start-local.ps1 -Build
.\tools\start-local.ps1
.\tools\start-local.ps1 -Check
```

Go 二进制 `/opt/elselife-tools/bin/elselife-product-dev-local`，Rust 二进制 `/root/.cache/elselife-cargo-target/debug/algorithm-runtime`。页面、Go、Rust 分别只监听 127.0.0.1:18080、18081、18083。入口核验已占端口的进程、Go 服务身份/合同、二进制哈希及网页目录；未知或旧进程不自动杀掉。所有 Start-Process 窗口隐藏。模型状态 `checked=configuration` 只表明配置完整，真实调用由上面的独立 HTTP 证据证明。

完整 archive 有意包含作者私密状态，普通 View/Reader 不包含。结构校验不等于自然语言逐句保密证明。本轮未从原 demo 迁移任何用户存档。
## Public interactive artifacts (verified 2026-10-15)

The development API now owns public presentation attachments in three additive tables (`experience_artifact_heads`, `experience_artifact_versions`, `experience_artifact_receipts`). `product-dev --migrate-artifacts` takes an advisory transaction lock and adds only these tables; it refuses partial schemas. The launcher invokes this idempotent upgrade before starting a missing Go service. Existing story pages and branch state remain unchanged.

Routes under `/v1/experiences/{id}/artifacts`: GET current attachment; POST `prepare` with `request_id`, `branch_id`, `expected_revision`, optional `intent` and `retry`; POST `import` with the same pin plus `definition` and local `state`; GET `/{artifact}` with optional `revision_id`; POST `/{artifact}/state` with `revision_id`, `expected_state_revision`, and `state`; POST `/{artifact}/restore` with `revision_id`, `expected_head`, and `expected_state_revision`. Every mutation is scoped, revision checked, and idempotent by request ID. Model results arriving after story or attachment changes are rejected. A saved state change during generation also causes a conflict instead of being overwritten.

The fixed source validator is configured by `ELSELIFE_DEV_ARTIFACT_NODE` and `ELSELIFE_DEV_ARTIFACT_VALIDATOR`; React builds additionally use `ELSELIFE_DEV_ARTIFACT_COMPILER`. On Windows Node called from WSL, worker paths must be Windows paths. The launcher discovers installed Node and converts the worker paths. The validator reuses the demo's dynamic/game/spatial/journey/rich/script modules; it never executes model scripts on the server. The separate compiler emits bounded React bundles. Definitions retain the original source, and `payload.bundles` indexes trusted builds by the original JavaScript canonical-node SHA-256. Imported archive bundles are discarded and rebuilt from the validated source.

`payload.scope`, `state.version`, and document `base_revision` agree. Only public facts, reader records and recent visible prose reach preparation; recent committed player inputs are separate intent clues, never quote evidence. Same-scope caching, `keep`, `none`, display-only patches, and bounded parameter migration preserve local controls. `retry:true` requests explicit regeneration. This presentation layer does not itself execute deterministic world effects. Dynamic rules, game apply and journey settlement require the separately implemented formal execution contract; an `attempt` remains an explicitly submitted story action.

Validation: full ordinary Go suite passed; race integration suite passed (experience 76.058s, HTTP 2.199s). Dedicated tests cover scoped access, replay without a second model call, state/head CAS, late model rejection, hidden-state exclusion, backup restoration, forged projection rejection, React recompilation, additive schema preservation, keep/none/patch and parameter migration. Source worker tests: 3/3 passed. A real Codex-backed prepare on the retained UI verification experience `exp_c338367547609a5d2c017efdcaa60809` completed in 44.00s, stored two views with matching scope, and left formal revision 1 unchanged. Attachment ID: `artifact_6b67d514caa5bb8277df7d72b5fdecba`; revision ID: `artifact_revision_78fe5db1e153dc12a371f4d0b2f9acc0`. No story prose, credentials or private author content is included in this record.

## Deterministic gameplay: isolated and real-model verification

The optional canonical gameplay extension passed the independent old-contract comparison: removing the three new optional carrier properties and seven definitions yields the original schema. All four installed contract copies and the Rust build pin match `af34208ebcffdde21ea3a727e24743b60c808f0dd5df303b52a3f476483429fc`. Original provenance records were retained. Full Go unit tests and race-enabled integration tests passed using real temporary PostgreSQL and the new Rust executable (experience 67.651s; HTTP 2.764s). The only skipped test was the harness helper deliberately run by a separate failure-test subprocess. The implementation details are in `notes/deterministic-gameplay.md`.

The integration coverage includes original dynamic rules and game actions spending 5 to 3 exactly once, duplicate request replay, branch-busy fencing, semantic rejection, model resource override rejection, actual journey settlement at its quoted 10-minute/2-coin cost, rejection of a 20-minute overquote, historical reader gameplay isolation, and full backup restoration with forged receipt/repair-state rejection. Author repair now receives the fixed gameplay runtime, creates a new branch without inheriting the old deterministic receipt, and retains the original line. Archive import separately replays the complete gameplay repair candidate; structural decoding does not execute actions.

A separate explicit test experience `exp_767578ce7205b69c548056558b27d0f2` exercised the actual local HTTP → Go → Rust → Codex → PostgreSQL path. Initial new-schema generation failed with model_unavailable because the Rust output-schema builder omitted the new transitive definitions. It was corrected to a complete reachable reference closure. The Codex transport also now preserves original nullable object types and prunes only unreachable definitions; a regression first reproduced the narrowing bug and then passed. Neither repair changes the canonical schema or retries until a fictional wish succeeds.

After that code correction, explicit revision-zero read recovery committed the opening in 28.36s; ordinary read committed revision 2 in 18.30s with a real public five-coin ledger. An initial presentation was read-only because the preparation prompt still contained the older non-executing capability statement and omitted the original named `objects` root. After correcting those source-integration gaps, one new prepare produced a real rule action in 23.08s. Explicit execute passed semantic review in 12.42s and committed revision 3 in 30.66s total. Its formal page receipt records `coins` changing from 5 to 3. Repeating the same execute request returned committed in 0.17s and left revision 3 unchanged. This is a real model result, not a fixed candidate or local UI deduction. No generated prose or private author material is stored in this verification note. The new test experience remains temporarily available for integration checks and is explicitly identified for later cleanup; other experiences were not altered.

## Natural input routing and frozen historical artifacts

The original semantic UI routing and second-stage action interpreter are now exposed by the formal Go service. Input routing does not submit story actions: story/mixed/clarify only save a durable response; create/edit prepare the display in the same model call. The second stage runs the original unique exact action matcher and otherwise uses saved approved contracts. A missing contract may be composed once, and a second missing contract becomes a free attempt. All execution plans still require the formal operation transaction and receipt path. History pins contain the exact artifact version, origin branch and local state captured under the page-commit lock; fork copies and backups preserve the pin without consulting a later current layout.

The full ordinary Go suite and race-enabled integration suite passed with real isolated PostgreSQL, the current Rust runtime and the fixed source workers (experience 84.316s; HTTP 1.942s). Source validator tests passed 3/3. Additional routing/history tests exercise exact input followed by formal execution, saved rules with independently pinned current head, nonexecuting decisions and same-request recovery, bounded composition, unknown parameter rejection, late revision rejection, separate parent/child local state after a fork, fixed historical retrieval and archive restoration. After bounding the new reads to one contract query and two adjacent pages, all affected race tests passed again in 16.065s.

Real Codex-backed requests on the explicitly identified test story `exp_767578ce7205b69c548056558b27d0f2` returned story (14.67s), create (12.01s), edit (20.59s), mixed (11.80s), and an attempted inquiry (11.45s). The formal story stayed at revision 3 throughout. Replaying each request returned the identical response in 0.00–0.02s with no second model call. An additional natural purchase request made one bounded composition pass and returned attempt in 38.95s; no deterministic execution was claimed or submitted and no repeated model calls were made to force an approval. Its same-ID replay returned unchanged in 0.05s. The separate actual deterministic 5-to-3 execution recorded above remains the evidence for successful formal settlement.

The deployment used the formal launcher after verifying zero active operations and the exact known Go listener identity. Only that idle Go process was replaced; the existing Rust and static frontend listeners were reused and verified. No story prose, author secrets, credentials or generated source are included in this note.


Final cleanup: the explicitly created gameplay/routing validation experience `exp_767578ce7205b69c548056558b27d0f2` was verified against its test seed, single branch, unchanged revision 3, original committed request and settlement receipt, then deleted with HTTP 204; subsequent GET returned 404. The retained UI verification story `exp_c338367547609a5d2c017efdcaa60809` was not deleted. Explicit attempt-button scope/target/parameter validation and ambiguous-rule rejection passed two additional race integration tests in 5.043s, followed by another complete ordinary Go test run and controlled Go-only deployment.
