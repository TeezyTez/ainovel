# ElseLife 动态智能界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** 交付模型生成、受控执行、可恢复的动态交互，且世界结算与叙事重试不会重复产生后果。

**Architecture:** 保留原生 JS / Node 与当前服务端分支账本。以声明式契约、纯规则求值、正式操作回执贯通模型、前端与世界；将现有 `branch.turns` 扩展为兼容旧完整回合和已提交操作的有序日志，避免另建一份不同步的世界状态。

**Tech Stack:** ES modules、Node.js >=22、原生 DOM/CSS、现有 Codex 本机模型适配器、`node:test`。

**Spec:** `docs/superpowers/specs/2026-10-12-dynamic-interaction-design.md`，用户已确认。

**Status:** 待用户审阅计划及确定执行方式。本文件不是实现或验收通过证明。

## Global Constraints

- 不新增框架、现实支付、社区、图片生成或其他项目服务。
- 不覆盖当前工作区中与本轮无关的未提交修改，不删除用户存档，不自动发布。
- 保留正文中心、自由输入、输入框旁的「+」及既有地图体验。
- 模型不输出可执行 JavaScript，不获得 DOM、网络、文件、时钟或任意数据库写入能力。
- 新运行接口仅返回当前分支的公开事实及交互，不下发私有世界再靠前端隐藏。
- 真实模型证据与固定数据测试分目录记录，所有失败和重试保留。
- 产品标识「人生副本 / ElseLife」，包标识 `elselife`；保留现有存储键、owner token 和数据路径。

## Review Focus

- 中文数量、单位或小数造成意图参数歧义时，不按默认数量执行交易：任务 4。
- 页签重试与进程重启恰好发生在持久提交之后，仍只执行一次：任务 3。
- 历史片段润色、分叉和导入不得使旧交易再次可领取：任务 2、3。
- 规则引用来自旁支、隐藏属性或已变更报价时，不能沿用客户端提交的值：任务 1、3、4。
- 局部刷新发生在输入法组合输入或用户正在编辑数量时，保留输入和焦点并拒绝过期提交：任务 5。

## 契约与文件边界

新增模块按职责划分，禁止增加商店、战斗等场景专用业务处理器。

| 文件 | 责任 |
| --- | --- |
| `src/interaction-contract.js` | 契约、scope、视图节点、参数、表达式和规则授权验证 |
| `src/interaction-rules.js` | 有界求值、表单计算、预演及正式效果计算；无 I/O |
| `src/interaction-operation.js` | 正式操作日志、回执回放、叙事附加及历史校验 |
| `src/server-interaction.mjs` | 模型交互提议、自由输入解释、公开上下文与诊断 |
| `src/dynamic-interaction-ui.js` | 可信递归渲染器及未知节点文字降级 |
| `src/dynamic-interaction-controls.js` | 草稿、步骤、选择、预演、请求和焦点恢复 |
| `src/dynamic-interaction.css` | 沿用现有视觉变量的行内交互布局 |

公共数据约定：

- `Scope = {worldKey, sessionId, branchId, sceneId, sourceTurnId, baseVersion}`。
- `InteractionDefinition = {schemaVersion:1, id, revision, scope, presentation, title, summary, bindings, view, fields, steps, actions, grants}`。服务端填充 id/revision/scope；模型只提交候选部分。
- `Expr` 为仅含 `op` 和有限参数的 JSON 节点；输入为常量、显式 binding、临时字段或重复项。绑定以公开对象 ID 与白名单字段解析，不执行属性路径字符串。
- `InteractionRequest = {requestId, scope, interactionId, revision, definitionDigest, actionId, targets, params}`；草稿、预演均不能伪造正式回执。
- `OperationReceipt = {schemaVersion:1, operationId, requestId, scope, actionId, params, beforeVersion, afterVersion, changes, publicEvents, receiptText}`。
- 普通历史回合保持现有结构。操作日志仍使用原 turnId/parentId，新增 `kind:'operation'`、已冻结的 contract/receipt，以及 `narration:{status:'pending'|'complete'|'failed',revision,text,errorCode}`。receipt 是世界结算依据，叙事只能附加；不以临时模型文本重放交易。
- 操作的 `state.version` 只在结算时增加一次；附加叙事只增加 narration.revision。`currentState` 仍取日志末项 state。无须增加另一份 branch.headState。
- 新存档为 schemaVersion 2。旧存档验证和迁移前备份保留，不改历史 ID；不将 v2 操作塞入伪称 v1 的导出。

## Task 1：受控契约与通用规则

**Files:** 新建 `interaction-contract.js`、`interaction-rules.js`、`tests/interaction-rules.test.mjs`、`tests/fixtures/interaction-contracts.mjs`；修改 `game-state.js` 中的可选交互定义验证。

**Interfaces:** `validateInteraction(definition, context) -> definition`；`evaluateExpression(expr, context, budget) -> JSON primitive/array`；`validateInteractionParams(definition, params) -> normalizedParams`；`previewInteraction(definition, actionId, params, publicState) -> {enabled, reason, changes}`；`resolveInteraction(definition, request, state) -> {changes, publicEvents, receiptText}`。

- [ ] 写失败测试：数量 2、单价 3、余额 10、库存 5，结算后余额 4、库存 3、随身数量增加 2；预演前后原状态深度相等。
- [ ] 写失败测试：负数、非整数数量、未知参数、缺少必填字段、除零、超过安全整数、未授权对象、原型属性和未知运算拒绝；`presentation:'none'` 合法且无需视图。
- [ ] 明确运行上限：定义最多 128 KiB、视图 200 节点/深度 8、表达式深度 12/每次 2000 求值步、重复最多 100 项、字段 24 个、步骤 8 个、动作 12 个、单次写入对象 32 个。测试每个边界和超限一项。
- [ ] 执行 `node --test tests/interaction-rules.test.mjs`，记录预期失败。
- [ ] 实现显式算术/布尔/比较/条件/集合聚合，禁止 eval/Function；实现受授权数值变更、对象转移和公开状态修改。结构合法但无规则授权的确定操作仍拒绝。
- [ ] 运行上述测试与现有 `tests/game-state.test.mjs`，全部通过后进入任务 2。

## Task 2：操作日志、旧档迁移及回放

**Files:** 新建 `interaction-operation.js`、`tests/interaction-operation.test.mjs`；修改 `core.js`、`storage.js`、`data-transfer.js`、`narrative-state.js`、`branch-client.js`、`server-public-archive.mjs`。

**Interfaces:** `commitInteraction(session, world, definition, request) -> operationTurn`；`attachOperationNarration(session, operationId, expectedRevision, text) -> operationTurn`；`migrateArchive(raw) -> v2Archive`。`validateArchive` 接受 v1/v2，v2 回放必须重算所有操作效果并核对 receipt。

- [ ] 写失败测试：提交确定操作后，不调用模型也能读取新余额、归属与回执；附加叙事不改变 state/version/receipt；同操作第二次执行拒绝。
- [ ] 写失败测试：v1 有分叉、笔记、历史引用和未发送草稿，迁移后逐项一致；非法旧档不覆盖原文；备份写入失败则不安装迁移结果。
- [ ] 写失败测试：操作 pending/failed/complete 均可导出、导入和验证；篡改 params、receipt、state 任一处导致校验失败；旁支复制只复制既有结果，不复制可执行生命周期。
- [ ] 运行 `node --test tests/interaction-operation.test.mjs` 确认失败，再实现记录与回放。
- [ ] 既有 proposal、经验对象和 game 更新保持兼容；普通叙事不能覆盖已结算资源。`narrativeForBranch` 承接最近有效叙事记录，不因末项是待补叙事操作而遗忘未决线索。
- [ ] 服务端玩家投影保留公开操作和叙事状态，排除 grants 的私有依据、秘密与旁支信息；历史文本使用当时契约，不绑定最新报价。
- [ ] 运行新测试及 `core`、`storage`、`storage-recovery`、`transfer`、`branch-client`、`narrative-state` 现有测试。

## Task 3：持久执行、幂等与单独叙事重试

**Files:** 修改 `server-branch-ledger.mjs`、`server.mjs`、`branch-client.js`；新增 `tests/interaction-ledger.test.mjs`。

**Interfaces:** 新增 `/api/interaction/execute` 与 `/api/interaction/narrate`；前者调用 `BranchLedger.executeInteraction(owner, request)`，后者调用 `BranchLedger.narrateInteraction(owner, {sessionId,branchId,operationId,expectedRevision}, run, signal)`。现有 branch/read 返回未完成操作及原回执。

- [ ] 写失败 HTTP 测试：同 ID 同指纹重复和重启恢复均返回同 operationId，金额只扣一次；同 ID 不同 params 返回 `REQUEST_CONFLICT`。
- [ ] 写失败测试：两个页面同版本购买只成功一次；跨 owner、分支、世界、场景、过期 revision/digest、旧报价均不写入；执行后响应丢失可恢复。
- [ ] 写失败测试：结算成功后模型超时仍有回执；只重试叙事不会扣款；迟到叙事不替换更高 narrationRevision；取消后客户端不得显示“世界未改变”。
- [ ] 写失败测试：同账本目录的并行服务实例不能绕过事务互斥；锁在异常与服务关闭后释放，进程崩溃恢复须核对锁持有进程。
- [ ] 执行 `node --test tests/interaction-ledger.test.mjs`，确认失败后实现服务端原子保存与互斥。幂等查验先于当前版本拒绝，执行依据只从服务端契约与状态读取。
- [ ] 保留已提交操作的正式结果；pending narration 只阻止新的世界动作，不阻止查询、草稿与导出。纯规则执行不要求模型在线。
- [ ] 运行新测试、`tests/branch-ledger.test.mjs` 和 `tests/server.test.mjs`。

## Task 4：模型生成、自由输入与正式规则登记

**Files:** 新建 `server-interaction.mjs`、`tests/interaction-generation.test.mjs`；修改 `server-narrative.mjs`、`server-model.mjs`、`server-codex.mjs`、`game-prompt.mjs`、`server-branch-ledger.mjs`。

**Interfaces:** `proposeInteraction(publicContext, config, signal, {requestJSON}) -> validatedCandidate`；`interpretInteractionInput(input, definition, publicContext, config, signal) -> {kind:'execute'|'attempt'|'clarify'|'unrelated', actionId?, targets?, params?, reason?}`；`narrateOperation(publicContext, receipt, config, signal) -> {text}`。

- [ ] 写失败测试：模型可以输出 none；未知显示节点保留 summary 降级，未知规则不能执行；不完整 JSON/错误对象/过期 scope 不进入登记状态。
- [ ] 写失败测试：玩家上下文不含秘密、未见角色和旁支资料；隐藏事实不得通过 disabledReason、排序字段或规则条件进入返回契约。
- [ ] 写失败测试：点击“买两件”和自由输入明确买两件得到同一 actionId/targets/params 并经过同一执行器；“能便宜吗”“两瓶还是一瓶”“我说买两瓶”不能默认为确定购买；复合输入不能丢弃限制。
- [ ] 运行 `node --test tests/interaction-generation.test.mjs` 确认失败，再扩展模型 schema 与提示版本。
- [ ] 提议沿用当前场景和正式对象 ID；模型新增价格或规则必须进入已有世界提议验证流程，登记后绑定原始来源与摘要。输入界面不能直接创造权威余额或物品。
- [ ] 生成只发送相关公开状态、近期必要经历、当前能力目录与交互摘要；不发送全档案。已提交操作叙事不再给模型产生第二份资源扣除的执行权限。
- [ ] 记录 stage、schemaVersion、promptVersion、耗时、成功/拒绝/降级及可获得用量；不写密钥、owner token 或授权文件内容。
- [ ] 运行新测试、`tests/narrative-pipeline.test.mjs`、`tests/game-pipeline.test.mjs`、`tests/workflows.test.mjs`。

## Task 5：动态视图、草稿与生命周期

**Files:** 新建 `dynamic-interaction-ui.js`、`dynamic-interaction-controls.js`、`dynamic-interaction.css`、`tests/dynamic-interaction-ui.test.mjs`、`tests/dynamic-interaction-controls.test.mjs`；修改 `app.js`、`reading-ui.js`、`adaptive-surfaces.js`、`personal-library.js`、`index.html`。

**Interfaces:** `dynamicInteractionView({definition,state,draft,receipt,historical,busy}) -> escapedHTML`；`createDynamicInteractionControls(api) -> {bind,handle,view,restore,invalidate}`。草稿键必须含 session/branch/interaction/revision；保存选择、局部输入和步骤，不保存自行计算的成功状态。

- [ ] 写失败测试：同一参数在摘要与比较表同步更新；条件区和重复区正常组合；多步只改变草稿，预演无世界写入，提交才调用正式接口。
- [ ] 写失败测试：刷新与切分支后恢复正确的局部输入；报价变化保留旧输入并显式标过期，不能无声使用新代价；历史界面只读。
- [ ] 写失败测试：恶意标题、摘要、对象名与文本输入全部转义；未知节点显示文字；none 不渲染空容器或按钮。
- [ ] 执行两份新测试确认失败，再实现可信视图解释器。简单图形只用白名单 SVG 几何和公开坐标，不运行模型 HTML/CSS/脚本。
- [ ] 接入局部更新：自动建议不 focus/scroll，不替换正在组合输入的 textarea；主动打开才定位结果。收起不改变场景，主输入仍可自由表达。
- [ ] 显示“预演”“执行”“尝试”“结果已保存，叙事待补充”的区别；失败显示文字及可用恢复操作。pending narration 提供仅补写叙事入口。
- [ ] 运行新测试和 `reading-ui`、`ui-controls`、`ux-regressions`、`personal-library` 现有测试。统一产品标识，保持旧数据键不变。

## Task 6：未预设情境、真实模型及商人闭环

**Files:** 新建 `scripts/verify-dynamic-interactions.mjs`、`tests/interaction-scenarios.test.mjs`、`tests/fixtures/generated-interactions/`、`docs/DYNAMIC-INTERACTION-VERIFICATION.md`。

**Interfaces:** 验证脚本默认只检查测试配置；`--live` 使用现有本机模型、临时独立账本和随机测试 owner，不操作用户现有故事。证据目录为 `test-results/dynamic-interactions/<runId>/`，逐阶段追加，禁止覆盖失败记录。

- [ ] 在通用代码完成后，记录相关源文件 SHA-256，随后才创建 10 个语义不同的新情境。覆盖多对象比较、资源分配、多步输入、条件变化、人物判断和至少一种模型临时组合规则；不可通过换皮计数。
- [ ] 增加 3 个无需界面的情境，以及同场景不同玩家意图、人物立场、价格/库存/资格变化的对照。无关变化不应更换输入字段 ID。
- [ ] 商人从正式报价开始，实际比较、选择数量、购买、核对余额/库存/归属/交易记录、生成承接叙事；自由议价与拒售分别验证，不能以商人标签触发专用页面。
- [ ] 首次运行 `node scripts/verify-dynamic-interactions.mjs --live`。逐例保存世界输入、公开状态、原始模型提议、契约、提交参数、回执、恢复结果、耗时和实际调用数；不可得的用量明确标记。
- [ ] 至少一个真实生成多步流程在中间步骤保存并恢复，再提交；叙事阶段注入一次受控故障，恢复后核对原 operationId 和原余额。故障注入证据与正常真实模型输出明确区分。
- [ ] 对生成产物运行 `node --test tests/interaction-scenarios.test.mjs` 重放。发现通用缺陷时修复、更新版本证据并重跑相关情境，不增加场景专用代码。

## Task 7：浏览器验收、审查与交付

**Files:** 更新 `README.md`、`docs/DYNAMIC-INTERACTION-VERIFICATION.md` 和本计划状态；截图与日志位于忽略目录 `test-results/`。

- [ ] 在独立测试故事实际走通生成交互、输入、多步恢复、执行、断线恢复和仅重试叙事；保存关键画面及实际响应。
- [ ] 验证 1280×900、390×844、键盘 Tab/Enter/Escape、长文本、滚动、输入法组合事件、无障碍名称与替代按钮。真实设备软键盘及屏幕阅读器未实测则列为限制。
- [ ] 运行 `npm test`、修改 JS/MJS 的 `node --check` 与 `git diff --check`；记录真实测试数量、失败名称和退出码。
- [ ] 按 requesting-code-review 技能请求独立审查，仅审查本轮明确文件和变更边界；处理重要问题后重跑受影响测试。保留工作区其他改动。
- [ ] 交付运行代码、数据迁移与接口说明、提示和契约版本、测试报告、可复现演示地址、命令和未支持边界。只有全部最低验收实际通过才标记完成。

## 执行方式与保存检查点

推荐 Native：由当前会话顺序实施，每个任务完成后核对接口与测试，最后独立审查。各任务强依赖同一存档、版本和公开投影契约，顺序执行更容易避免并发修改核心文件。

若选择 Subagent-driven，则依次委派任务与审查，不让多个代理同时修改 `core.js`、`app.js` 或 `server-branch-ledger.mjs`。两种方式都不省略真实模型验收。

当前工作区已有大量未提交改动。检查点先通过测试日志、明确文件清单与源文件摘要保存；不把用户无关修改打包提交，不自动推送或部署。需要提交时仅提交可分离且已核实归属的本轮文件/变更。
