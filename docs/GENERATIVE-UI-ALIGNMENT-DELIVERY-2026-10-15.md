# 生成式交互工作区重构交付报告

日期：2026-10-15。工程实现与有限真实模型验收记录；未完成的产品级门槛单独列明。

此次已交付可运行的生成式交互工作区：保留小说账本与现有模型连接，增加可持续编辑的作品版本、服务端参数状态、真实阶段进度、受控 React/TSX、候选运行检查和恢复入口。它解决的是本项目已有交互链路的工程缺口。现有证据不足以宣布与 ChatGPT 或 Claude 全面追平，也没有测得相对旧实现的速度提升比例。

实施范围依据已批准的[设计规格](superpowers/specs/2026-10-15-generative-ui-alignment-design.md)与[实施计划](superpowers/plans/2026-10-15-generative-ui-alignment.md)。本轮在原工作区继续实现，保留既有未提交改动；未提交或发布代码，也未迁移真实玩家数据。

新路径由 `GENERATIVE_UI_ENABLED` 控制，仓库默认关闭；当前本机已显式设为 `true`。未完成产品级门槛前保留旧路径回退，不把本地试用等同全面默认发布。已在确认旧服务属于当前项目且无在途连接后重启本机服务，地址为 http://127.0.0.1:4173 。

## 旧实现、此次变化与剩余限制

| 方面 | 旧实现及差距 | 此次重构 | 仍有限制 |
| --- | --- | --- | --- |
| 请求用途 | 有自动展示与续改入口，但较依赖本地正则；自然措辞和对白容易混淆 | 模型在同一次作品生成调用中返回 create/edit/story/mixed/clarify；编辑目标核对当前 artifactId；混合或不明确输入保留草稿，不擅自执行故事行动 | 尚未完成独立的 100 条自然措辞集；不能以现有单元测试推算真实精确率或召回率 |
| 前端结构 | 阅读器、工作区与 DOM 重绑较耦合 | 智能工作区使用 React、TypeScript、Vite，提供展开、收起、阶段、历史、恢复、重试、取消、导入与导出；相同内容保留兼容岛及 iframe 身份 | 阅读器主体仍是既有 JavaScript/DOM/CSS，没有全站迁移 |
| 协议 | JSON 外壳与事后校验并存 | 共享 Zod runtime schema；前端工作区增加 TypeScript 类型；安全 JSON 限制与既有状态清洗器衔接 | 既有业务模块仍保留兼容校验，不代表整个仓库已由同一类型系统覆盖 |
| 模型连接 | Codex 与兼容 API 需要各自适配 | ModelGateway 统一能力声明、取消、阶段与结果校验；兼容 API 通过 AI SDK Core 消费实际文本流；Codex 继续使用现有登录与模型配置 | 不支持内容增量的 Codex 路径只报告真实阶段；没有伪造 token 流。各兼容供应商的行为仍需分别验证 |
| 作品身份与历史 | 已有 digest、本地状态、最近契约目录和历史快照，但缺长期可寻址作品版本 | 独立 ArtifactStore 保存稳定 artifactId、父修订、内容 hash、来源 scope、当前 head、stateRevision 与请求结果收据；历史可恢复 | 本机文件存储，非云端协作数据库；有明确容量限制，达到上限拒绝写入，不静默删除历史 |
| 并发与重复请求 | 缓存和界面状态不能替代持久请求索引 | expectedHead 与 expectedStateRevision 双 CAS；版本、状态与成功请求收据在同一原子 manifest 提交；同 ID 不同输入拒绝；成功提交耐重启 | 故事账本仍按本机单服务进程使用；没有跨进程在途事件恢复或分布式事务 |
| 续改方式 | 主要重新生成整份定义 | 支持完整定义、沿用、隐藏及绑定 baseRevision/contentHash 的精确属性路径 patch；patch 限于呈现字段，随后重新验证 | 不是任意源文件编辑器；不猜测过期 patch 的套用位置，也不允许 patch 修改正式规则 |
| 参数连续性 | 部分依赖 iframe/localStorage 或新版本 initialState | 服务端保存局部状态；新版本默认合并旧参数和新默认值，支持验证过的键映射与删除声明；0、false、null、空数组保留 | 迁移仅覆盖声明的 JSON 状态，不保证任意闭包、计时器或未通过桥接保存的内部状态无损迁移 |
| 自由交互代码 | 已有 opaque iframe 内的 HTML/CSS/JS | 保留标准组件和旧沙箱，新增受控 TSX 编译；只解析随应用发布的 React 与 @story/ui 依赖；不在宿主 React 树或 Node 中执行模型代码 | 不支持任意 npm 安装、宿主文件读取、联网服务或自由存储权限 |
| 候选验证 | 已有语法、可见内容、控件与运行错误检查，但不足以证明任务完成 | 加入独立浏览器检查进程，检查启动、错误、布局及有限控件操作；超时终止进程；失败候选保留旧作品；允许一次修复 | 生产 smoke 检查与代表性控件操作不能证明所有公式和语义正确；全面任务断言仍依赖固定回归及人工评价 |
| 真实进度与取消 | 等待反馈难以区分生成、验证与保存 | SSE 展示实际 queued/preparing/generating/validating/building/checking/repairing/reviewing/saving 等阶段；新请求取消旧作业，最终提交有取消边界 | 在途作业与事件缓存有数量/时间上限且保存在内存。进程退出后不能恢复任意未完成流；成功收据可恢复已提交结果 |
| 导入、导出与恢复 | 故事存档已有正式导入导出，作品状态缺独立闭环 | 可导出受限的作品历史与当前参数；导入重新映射身份、清除私有收据和行动授权，再校验、编译和检查；CAS 追加历史 | 导入的是呈现内容与局部状态，不是正式行动授权；旧文件继续兼容，不能由作品文件恢复完整小说账本 |
| 小说边界 | 正式行动已经由 BranchLedger 和规则契约验证 | 展示、试算、修改、恢复、取消和作品导入不提交剧情回合；局部状态不成为事实、库存或权限；正式执行继续核对当前 scope、规则与来源 | 生成内容的语言含义仍需审查；确定性边界通过不等于长期叙事一致性已被证明 |

## 关键实现的职责

React 负责智能工作区的组件身份和生命周期，TypeScript 明确工作区接口，Vite 输出随应用发布的静态 bundle。现有内容放在稳定兼容岛中，只有内容变化才重新绑定控件；生成的 React 组件经过编译后仍进入受限 iframe。采用这些工具是本项目的维护选择，不是对竞品内部技术栈的断言。

Zod 在共享协议模块验证 scope、请求、修订、状态、导入和事件。自由代码候选还经过专用结构检查与 esbuild 编译；可执行候选在完整返回并通过检查后才激活。模型输出中未完成的 JSON、TSX 或文本流不会作为宿主代码运行。

ModelGateway 保留 Codex CLI 授权路径，同时为兼容 API 接入 AI SDK。服务端根据实际能力发出阶段或来自真实输出流的进度；它不输出内部推理、原始 CLI 日志或授权信息。真实模型验收沿用当前配置，没有为本次报告更换到另一模型后冒充同配置比较。

ArtifactStore 与故事账本分开。生成期间如果用户继续修改参数，最终提交的状态 CAS 会拒绝过期候选，保留最新状态。请求结果与版本一起写入原子 manifest，解决提交后响应丢失时的重复生成问题。读取和恢复在故事锁内核对来源；重复旧请求返回当前权威呈现与原提交版本标识，避免旧响应把当前 head 投影回去。

取消在进入最终提交区前生效；已进入提交区的取消会等待提交结果，成功提交后不能把结果伪装为已取消。若 manifest 已写入而账本中的呈现投影保存失败，读取路径可按 manifest 恢复投影。SSE 事件与权威结果分开：终止事件可以只提示重新读取，避免完整长故事超过事件 JSON 上限而卡住作业。

精确 patch 先核对基础修订和内容 hash，再修改现有呈现属性路径；所有修改仍通过完整定义验证。状态迁移只执行固定的键映射、删除和默认值合并，不运行模型提供的迁移脚本。正式规则、剧情、库存和操作回执继续由原账本与执行路径管理。

候选浏览器运行在独立进程中，使用受限环境、opaque iframe、CSP 和受控桥接。桥接提供局部状态与草稿等能力，不授予故事执行权。进程级超时覆盖模型代码阻塞浏览器主线程的情况。浏览器检查通过表示覆盖范围内运行正常，不表示任意生成工具的业务语义已经全部验证。

## 已取得的验证证据

| 验证层级 | 本次记录 | 结论范围 |
| --- | --- | --- |
| 全套自动测试 | 最终 `npm test`：776 项通过，0 失败、0 跳过；[完整日志](../test-results/generative-ui-full-verification-final-5.log) | 覆盖仓库现有与新增确定性回归；不替代真实模型质量评测 |
| 类型与构建 | `npm run typecheck`、`npm run build` 均通过 | 工作区类型检查与 Vite 构建通过；不意味着整个阅读器已迁移至 TypeScript |
| 受控浏览器闭环 | 390px 与 1280px 均通过；将数量调至 6 后连续三次修改仍保留 6；刷新、历史恢复、取消、导入导出、错误分支隔离均验证 | 使用真实应用、服务端与 React iframe，模型输出是受控 fixture。该脚本明确绕过候选 probe；生产 probe 由其他运行测试单独验证 |
| 受控故事不变 | 两个视口的回合数、故事版本均保持 0；错误分支请求返回 404 | 覆盖此次隔离测试故事，不触碰真实玩家存档 |
| 真实模型 C05 | 实际生成分配滑块，检查初值 4、范围 0–12、操作至 6/12/0/4 后剩余值同步；17 个自动检查通过，5 个基础语义项未由 harness 自动评分 | 记录状态为 partial，不能改写为完整题目全部通过或整体任务成功率 100% |

受控浏览器证据见[结果清单](../test-results/artifact-workspace/result.json)、[1280px 截图](../test-results/artifact-workspace/workspace-1280-full.png)、[390px 截图](../test-results/artifact-workspace/workspace-390-full.png)。脚本为 [verify-artifact-workspace.mjs](../scripts/verify-artifact-workspace.mjs)。其中毫秒级响应数据仅来自受控输出，不作为真实模型生成延迟。

回归过程保留了环境失败记录：与真实模型评测并行时，部分浏览器启动超过原12秒测试预算；另有旧 HTTP 测试被系统分配到 Fetch 禁用端口。成功启动类测试预算调整到20秒，业务断言保持，死循环必须被1.8秒进程时限终止的专门测试未放宽。HTTP 夹具在写入故事前探测端口，仅对 `bad port` 重新分配，不重试业务断言。生产候选验证时限未借此更改。

### 真实模型 C05 的具体口径

运行使用 Codex 本机授权、`gpt-6-sol`、`low` 推理配置、`elselife-dynamic-7` 提示版本；模型调用一次，未发生自动修复。测试通过独立合成账本运行，原始定义、模型调用、浏览器操作和故事前后快照均保留在 [C05 证据目录](../test-results/generative-ui-eval-2026-10-15T05-10-53-638Z/manifest.json)。

| 时间字段 | 观测值 | 含义 |
| --- | --- | --- |
| 首次阶段反馈 | 0.005 秒 | 接受作业后的首个真实 status 事件 |
| 模型调用 | 16.002 秒 | 此次 Codex 生成调用耗时 |
| 请求至版本提交 | 27.506 秒 | 包含生成、候选检查及保存 |
| 实际控件操作确认 | 29.439 秒 | 首次正确操作被观察到时的可用性上界；不是最早可用时刻 |

这些是本游戏单次 C05 的记录，既不是 ChatGPT/Claude 网页时间，也不是 p50、p95 或相对旧实现的提速比例。完整语义完成时间与最早可用时间仍未测得；报告保持这些字段为空的原始口径。

此前在受限工具账号环境运行 C05 时发生 `CODEX_PERMISSION_DENIED`，记录保存在[失败运行清单](../test-results/generative-ui-eval-2026-10-15T05-10-23-864Z/manifest.json)。该次失败未删除、未计为成功；改由正常用户权限环境重跑后生成与实际控件检查成功。登录检查成功不能替代实际进程运行权限检查。这也不是通过修改模型输出掩盖失败。

### 真实续改与路由验收

| 用例 | 观测结果 | 证据与边界 |
| --- | --- | --- |
| C08 首次 | 未通过：备注 textarea 被旧 HTML 白名单过滤，修改候选失败；原界面及数量 0 保留 | [失败记录](../test-results/generative-ui-eval-2026-10-15T05-11-49-711Z/C08-1/result.json)。失败计入记录，未删除。 |
| C08 修复后 | 24 个自动检查通过、4 个总体语义项仍未自动打分；标题更新，数量 0/剩余 12 保留，两次备注编辑不重置数量；故事前后快照相同 | [新模型独立重跑](../test-results/generative-ui-eval-2026-10-15T05-17-17-645Z/C08-1/result.json)，两次模型调用，无自动修复。另将原失败候选在390px重放也通过，见[同候选验证](../test-results/generative-ui-eval-2026-10-15T05-11-49-711Z/C08-1/candidate-replay-after-textarea-fix.json)。harness 状态仍为 partial。 |
| C09 安静阅读 | 返回 story，不新建作品；4 个自动检查通过、3 项完整叙事任务未测 | [真实记录](../test-results/generative-ui-eval-2026-10-15T05-11-49-711Z/C09-1/result.json)。仅检验路由，不冒充完整续写验收。 |
| C10 人物对白 | 对白内“给表格加一列”被识别为 story，原表格不修改；4 个自动检查通过、3 项完整叙事任务未测 | [真实记录](../test-results/generative-ui-eval-2026-10-15T05-11-49-711Z/C10-1/result.json)。包括一轮前置表格生成。 |

C08 修复后前置生成40.494秒、续改35.997秒；该次与全套浏览器回归并行，包含资源竞争，不用于推导常态速度或提升比例。C09路由7.428秒，C10路由7.829秒，均为单样本。以上真实运行各自记录的源码指纹前后一致；其后补充了迁移开关的未就绪保护和旧路径 renderer 能力限制，这些修改另由定向回归与最终全套验证覆盖。

测试产物目录受 Git 忽略规则管理；本机证据链接不代表这些文件已随源代码发布。真实运行携带源码指纹，后续修改应以对应快照为准，不能把旧运行结果扩大为未执行的新版本验证。

## 尚未完成的验收与产品比较

- 未完成外部 ChatGPT、Claude 的同题账号实测，未测账号可用性、连续修改质量、真实延迟或成本，也没有产品排名与“对齐百分比”。
- 未完成 20 类任务各重复 5 次的完整题集；不能报告首次成功率、一次修复后成功率或稳定性门槛已达到。
- 未完成独立 100 条自然措辞路由集；不能报告 ≥95% 的展示精确率、召回率或完整路由误推进率门槛已达标。
- 未完成两位独立评审的盲评；任务清晰度、层级、反馈和准确性的平均分尚未取得。
- 未建立同模型、同输入、同配置的重构前后重复计时基线；续改提速 30%、p50/p95 改善等计划目标没有实测结论。
- 未将阅读器全量迁移为 React/TypeScript，未提供云账号、协作数据库、云同步或多服务进程共同写故事账本的支持。
- 未提供跨进程的在途作业和全部 SSE 事件持久恢复；当前可耐重启的是成功提交的版本、状态及请求收据。未完成作业不能因存在成功收据机制就被宣称可无缝续传。
- 候选 smoke 检查、单题控件测试和自动测试总数不能证明所有生成公式、公开来源绑定或长期故事语义都正确；仍需按冻结题集持续评估。

## 源码与复现入口

| 职责 | 主要文件 |
| --- | --- |
| React 工作区、组件接口与构建 | [entry.tsx](../src/workbench/entry.tsx)、[types.ts](../src/workbench/types.ts)、[workbench.css](../src/workbench/workbench.css)、[vite.config.mjs](../vite.config.mjs)、[tsconfig.json](../tsconfig.json) |
| 共享协议、原子版本、作业与归档 | [protocol.mjs](../src/artifacts/protocol.mjs)、[store.mjs](../src/artifacts/store.mjs)、[jobs.mjs](../src/artifacts/jobs.mjs)、[archive.mjs](../src/artifacts/archive.mjs) |
| 模型、用途判断、精确 patch 与状态迁移 | [model-gateway.mjs](../src/model-gateway.mjs)、[interaction-intent.mjs](../src/interaction-intent.mjs)、[server-dynamic-model.mjs](../src/server-dynamic-model.mjs) |
| 服务端整合与故事边界 | [server-artifact-service.mjs](../src/server-artifact-service.mjs)、[server-dynamic.mjs](../src/server-dynamic.mjs)、[server-branch-ledger.mjs](../src/server-branch-ledger.mjs)、[server.mjs](../server.mjs) |
| 受控 React、编译、浏览器检查与 iframe | [react-artifact.js](../src/react-artifact.js)、[server-artifact-build.mjs](../src/server-artifact-build.mjs)、[server-artifact-probe.mjs](../src/server-artifact-probe.mjs)、[interactive-runtime.js](../src/interactive-runtime.js)、[interactive-artifact.js](../src/interactive-artifact.js) |
| 客户端、阅读工作区接入 | [artifact-client.js](../src/artifact-client.js)、[dynamic-ui.js](../src/dynamic-ui.js)、[app.js](../src/app.js) |
| 浏览器闭环与真实题集 | [verify-artifact-workspace.mjs](../scripts/verify-artifact-workspace.mjs)、[eval-generative-ui.mjs](../scripts/eval-generative-ui.mjs)、[generative-ui-cases.json](../scripts/fixtures/generative-ui-cases.json) |

复现基础检查使用 `npm test`、`npm run typecheck`、`npm run build`。`node scripts/verify-artifact-workspace.mjs` 运行受控应用闭环。`node scripts/eval-generative-ui.mjs --plan` 只列计划；显式加 `--live --case C05 --repeats 1` 才调用当前真实模型并使用额度。真实模型运行应采用已登录 Codex 的正常用户终端，使用隔离账本并保留全部失败记录。

## 官方参照与解释边界

以下链接来自 2026-10-15 的[官方证据研究记录](research/2026-10-15-frontier-generative-ui-evidence.md)，用于说明可借鉴的公开能力与工程机制，不作为竞品实测成绩，也不推断产品内部实现。

- [ChatGPT Visualizations](https://learn.chatgpt.com/docs/visualizations)：任务驱动的可视表达与追问调整；不提供本项目可直接复制的内部生成引擎或性能数据。
- [ChatGPT 可编辑文本与代码块](https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt)：公开的代码编辑、React 等内容预览及沙箱能力；不等于任意运行状态无损保存。
- [Claude Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)：对话修改、直接编辑、分支探索及错误修复入口；新版与 legacy 规格需要区分，不能沿用旧限制概括全部产品。
- [Claude 对话内 visuals](https://claude.com/resources/articles/claude-builds-visuals)：按任务生成与续改的公开产品能力；没有本次同账号、同题延迟测试。
- [React：逐步加入现有项目](https://react.dev/learn/add-react-to-an-existing-project)：支持本次从独立工作区开始迁移的工程选择。
- [AI SDK：Streaming Custom Data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)：类型化流数据的公开机制；业务幂等、作品数据库与持久恢复仍由本项目实现。
- [esbuild API](https://esbuild.github.io/api/)：受控虚拟源码构建的工具依据；不自动提供浏览器运行隔离。
- [Anthropic：Agent 评估方法](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)：结合代码、模型与人工评分并检查轨迹的评估参照，支持把工程回归、真实模型和产品盲评分别记录。

本次交付可以证明新增工作区、版本与状态边界及已运行场景的实际行为；计划中未取得的产品比较、统计门槛和独立人工评价仍保持未测状态。
