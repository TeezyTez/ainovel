# 自适应体验独立审查

2026-10-10。完整阅读桌面任务书和 `docs/ADAPTIVE-REFACTOR-PLAN.md` 后，对实际代码做只读审查。除本文外未修改文件。审查期间其他代理正修改账本、对象选择和应用接线；下列行号对应审查时快照，应在合并后重验，不能当作最终发布验收。

## 优先发现与最小修正契约

### P0：自然语言查看、草稿和假设仍可能走正式行动

`src/app.js:104` 先执行 gameQuery/localCommand，随后 `src/app.js:105` 使用 detectIntent；`src/experience.js:17` 的草稿识别只覆盖少量措辞，`:24` 默认 action。实际运行三个函数，以下五句均得到 `game=null, local=null, intent=action`：写一份答复草稿、帮我写一份答复草稿、查看人物资料、我现在怎么样、如果明天再去呢。即使模型遵守提示输出空 events，`src/core.js:52` 仍增加正式版本和回合，且两阶段模型会被调用。

最小修正：应用入口共用明确的查询/草稿/行动语义分派；任务书原句必须成为回归样例。纯查看在本地读取公开投影；明确草稿走 phrase；明确假设走 ask。带后续实际行动的复合语句和角色对白不能被粗糙关键词抢走。保留可见意图覆盖。断言不仅检查文字，还检查生成端点调用数、回合数、世界时间、资源和原草稿不变。对象选择接线另有人负责，此处不重复实现。

### P0：模型可选组件失效会阻断整段有效故事

`src/server-narrative.mjs:158` 对包含 game 的完整 schema 一次性校验，未知 kind、坏字段等导致整轮 INVALID_MODEL_RESULT；`src/game-ui.js:55` 对未知 surface.kind 直接返回空，没有文字解释。现有严格拒绝保护了状态，却未满足任务书第21项的“可读回退”。

最小修正：区分纯呈现错误与状态/交易错误。已独立验证的正文、事件、经验记录有效，且没有依赖坏组件的交易时，可去掉无法呈现的 surfaces，用已验证公开对象/正文作为文字回退并说明辅助展示不可用。若实体数量、引用、动作成本或回执不合法，必须保持整轮不提交；不能用降级绕过交易校验。先增加未知组件、坏视图、坏效果三类测试，再接入降级。

### P0 边界：玩家保密是呈现过滤，不是客户端不可见

`src/app.js:112` 原始请求携带完整 world/state；`src/server-model.mjs:153` 的 cleanProposal 保留 hidden events；`src/core.js:59` 将其写入 hiddenEvents；`src/storage.js:42` 序列化整个数据库。完整作者世界另含 secret/goal/history，`src/app.js:304` 提供作者视图，`:307` 明示完整导出含幕后资料。普通面板与 ask/phrase 已有正向白名单投影（`src/server-workflows.mjs:37`），这不等于网络、缓存、下载不可见。任务书第13项的强保密在本机作者兼玩家模式下不能判通过。

最小修正：当前版本明确标注“本机作者权限；公开面板不展示秘密”，不能宣称多用户授权隔离。若本轮要实现真正玩家模式，使用现有服务端账本分别保存私有权威状态和公开回执，玩家接口不返回 hidden/secret/私有 narrative；客户端只保存公开投影。旧完整作者存档作为明确的兼容导入边界，不自动删除用户资料。仅服务器持久化而仍返回完整私有提案并不足够。

叙事模型确实需要幕后动机来保持人物与谜底一致；不能把所有秘密从叙事上下文删除后宣称问题解决。公开助手只能用公开资料，私有叙事阶段用权威资料，再输出公开正文与受校验的状态提案。自由正文泄漏仍需真实模型对抗场景与人工检查，原文引用不能证明每句都符合知识边界。

### P0：一句话生成尚不是一句话进入

审查时 `src/app.js:208` 的模型世界结果只能“采用草案并编辑”，`:209` 采用后返回编辑器，`:84` 仍需单独开始故事表单。模型生成已有可玩开篇（`src/server-workflows.mjs:95`），不需要重复开发生成器。

最小修正：新增直接开始入口，在世界结果校验后使用合理默认身份/偏好创建 session，可靠保存成功才导航到正文；高级编辑仍可从独立入口打开。生成失败/用户修改原句/存储失败必须保留输入，不能创建幽灵存档；双击只产生一个世界和一个 session。主代理正在接线，此项需要最终浏览器重验。

### P1（P0 时间跳跃验收风险）：引用证明出处，尚未证明时间与约定的因果

`src/experience-state.js:20` 验证 clock 的字符串和 quote，`:39` 接受新 clock，`:40` 保留未出现的旧字段；没有按历法协调年龄、deadline、scheduledAt。实际调用 validateExperience，`label=十年后, elapsed=十年, quote=你等了一会儿。` 在正文同为“你等了一会儿。”时被接受。终态约定不能重开已有保护，但未到期约定跨年后仍可能原样保留。不能把 quote 校验描述为完整时间因果引擎。

最小修正：保留不同历法的自由文字和 unknown，不强制公历。时间跳跃的叙事上下文显式列出已知年龄、约定/期限与保留决定，要求对受影响记录给出有依据的变化或“不确定/待确认”；为“等三年但年龄仍18、昨天期限仍待履行”等矛盾设置针对性模型验收。仅对已有机器可比的时间/数值施加确定性约束。查询仍必须完全绕过提交；离线不自动推进已有实现不应改动。

### P1：人物自主性的提示基础充分，但需要拒绝场景的真实验证

`src/server-model.mjs:96` 明确 input 是尝试、NPC 依据动机知识回应；`:99` 禁止泄露幕后、重大玩家代决；`:103` 等待不代表同意交易。`src/server-narrative.mjs:36` 每个构想含 npcAction，写作要求承接人物决定。`src/game-prompt.mjs:6` 明确不确定谈判用 attempt，不能预先强迫同意。不存在“提示完全没有人物自主性”的缺口。

风险在于同一提示又强要求本轮 payoff（`src/server-narrative.mjs:40`），模型可能把“回应有价值”理解为“对方必须合作”。最小修正是说明拒绝、有限信息、反提条件、关系张力也可构成本轮成果，并实测“玩家宣布别人答应”“施压交出保护物”“等待不接受邀请”。结构测试能证明 attempt 无自动效果，不能证明人物可信；不要宣称数学保证所有自由叙事。

## 22 项场景证据地图

“有测试”仅表示代码中已有相应验证，不等于该完整旅程通过。本次实际运行下述六文件共83项，通过83、失败0；其他测试仅检查存在。旧验证文档的真实模型/浏览器证据是前轮证据，不充当本轮实测。

| # | 场景 | 已有证据 | 本轮剩余验证/缺口 |
|---|---|---|---|
| 1 | 一句话入局 | workflows.test.mjs:28 校验世界生成 | 直接生成→存档→阅读尚待最终浏览器验证 |
| 2 | 连续阅读不打断 | reading-ui.test.mjs:10、121；旧 DYNAMIC-GAME-VERIFICATION.md 移动检查 | 长篇多轮真实阅读、少组件策略未实测 |
| 3 | 建议外自由行动 | server.test.mjs:119 保留任意输入；阅读自由输入存在 | 新旅程真实模型合理自定义行动；demo 是有限脚本 |
| 4 | 我现在怎么样 | publicSituation 与 reading-ui.test.mjs:65 共用公开对象 | 原句路由实测失败，需接线后重验文字/表格同事实 |
| 5 | 三题材适配 | game-ui.test.mjs:13 六类布局、:34 未知数值；前轮修船/研究站 | 修仙、悬疑、日常各一个完整真实场景未在本审查运行 |
| 6 | 比较这两个 | experience-state.test.mjs:12 稳定同名ID；对象上下文新测试在并行开发 | 选择→自然指代→提交完整浏览器链路 |
| 7 | 展开排序选择只读 | reading-ui.test.mjs:58、65、137；game-query.test.mjs:13 | 网络计数和时间/版本无变化，选择新接线需重验 |
| 8 | 查看与草稿不执行 | workflows.test.mjs:23；本次路由复现 | “查看人物资料”“写一份答复草稿”当前失败 |
| 9 | 谈判允许拒绝 | game-state.test.mjs:54 attempt 无自动效果；提示规则 | 真实模型拒绝/反提条件，并核对 UI 没有成功误报 |
| 10 | 时间跳跃协调 | experience-state.test.mjs:8、9、13；reading-ui.test.mjs:103 | 年龄/约定跨期真实测试；quote 不证明语义 |
| 11 | 历史快照冻结 | core.test.mjs:8、19；experience-state.test.mjs:14、17 | 接入账本后刷新、历史对象和旧按钮重验 |
| 12 | 编辑/假设/行动/分支分开 | experience.test.mjs 意图与 repair/polish；core.test.mjs:12 | 宽泛假设原句存在漏判；端到端路由覆盖 |
| 13 | 隐藏资料不泄漏 | workflows.test.mjs:23、62；core.test.mjs:15 普通导出 | 浏览器完整作者数据仍含秘密；强网络隔离未达成 |
| 14 | 长局人物/规则连续 | narrative-pipeline.test.mjs:79；narrative-state.test.mjs；历史检索 | 长局、多次拒绝、谜底固定真实模型未在本轮测 |
| 15 | 输入/焦点保留 | core.test.mjs:14；reading-ui.test.mjs:38；app.js:98 恢复选区 | 真实中文输入中刷新/弹层/窄屏；非流式代码不能声称测过token流 |
| 16 | 取消与已提交结果 | narrative-pipeline.test.mjs:93、97；server.test.mjs:101 | 服务端提交后断连/取消竞争属于新账本验收 |
| 17 | 重试不重复 | core.test.mjs:9；server.test.mjs:144；storage-recovery.test.mjs | 重启、断线取回同回执新账本测试和浏览器接线 |
| 18 | 终端/分支隔离 | core.test.mjs:7、8；experience.test.mjs 分支上下文 | 当前旧模式非多用户鉴权；新账本两个作用域实测 |
| 19 | 旧按钮失效保草稿 | game-ui.test.mjs:24；game-state.test.mjs:29；core.test.mjs:14 | 返回旧页再操作的真实浏览器路径 |
| 20 | IME/复制/窄屏/键盘/慢网 | ui-behavior.test.mjs:5；旧文档390×844检查 | 慢网+输入法真实交互、焦点与长文本复制未本轮测 |
| 21 | 组件降级 | game-ui.test.mjs:52 转义；game-state.test.mjs:39 拒绝无效 | 尚无有效故事下的坏组件回退，见P0 |
| 22 | 三种呈现比较 | 以下工程比较 | 无用户实验，不声称降低负担已被用户研究证明 |

运行命令：`node --test tests/experience.test.mjs tests/experience-state.test.mjs tests/workflows.test.mjs tests/game-ui.test.mjs tests/narrative-pipeline.test.mjs tests/reading-ui.test.mjs`。本审查没有调用付费模型、没有运行浏览器旅程。

## 纯文字、固定富组件、模型按需组织：工程取舍

| 方案 | 同一任务的操作成本 | 强项 | 代价与边界 |
|---|---|---|---|
| 纯文字 | 阅读接续无需打开面板；比较两对象需人工往返找依据，或再次问模型 | 低渲染复杂度、连续叙事最自然、天然文字回退 | 容易重复解释对象，难以清楚显示版本与动作回执；查询若都交模型会增加延迟/成本 |
| 固定富组件 | 已知资料入口→筛选/选择→比较；本地零模型调用 | 稳定可发现、可测试、键盘访问与旧版兼容容易 | 所有故事常驻同套面板会增加寻找负担；需按数据存在与否隐藏无关字段 |
| 模型按需组织 | 在相关段落直接显示合适对象/动作；局部操作仍本地 | 能适应题材与局面，减少寻找入口、重新说明背景 | 生成延迟、无关组件、结构错误、历史动作失效增加维护成本；必须复用固定可信目录及文字降级 |

推荐保留正文主体+固定资料入口+少量按需组件的组合。相同公开对象、相同版本与相同行动契约是比较前提，否则只是比外观。可用后续真实任务记录“到达正确对象的点击/输入次数、重复说明次数、误执行次数、模型调用数、等待时间”，再判断收益。以上是代码结构与可数步骤的工程评估，没有招募受试者或测得用户偏好，不能写成用户研究结论。


## 后端账本追加审查（A，2026-10-10）

范围：`src/server-branch-ledger.mjs`、`server.mjs`、`tests/branch-ledger.test.mjs` 及 `docs/ADAPTIVE-AUTHORITY-REPORT.md`。直接调用真实 BranchLedger（临时目录持久化）复现，并运行 `node --test tests/branch-ledger.test.mjs tests/server.test.mjs`，当时19/19通过。未调用外部模型。本节不把已接受的本机作者权限、旧API兼容或单进程范围重新列为缺陷。

### 已复现并即时回报

1. **P0，编辑缺乏正文CAS（初审版；开发代理已开始修正）。** `src/server-branch-ledger.mjs:22` 初版只比较 baseVersion 与 turnId；两位编辑都拿同一回合版本，先后提交不同 polish 都被接受，后者静默覆盖前者。修改正文不增加事实版本，所以现有测试把 baseVersion 改为0的检查不能覆盖这个冲突。最小契约：expectedProse 或独立正文修订版本；修改前匹配权威值，不匹配返回冲突。审查后已观察到 expectedProse 校验加入，最终需重跑同版本旧编辑反例。

2. **P0，作者修改重试不幂等（初审版；开发代理已开始修正）。** 同一 undo-polish 两次调用，第一次恢复上一次措辞，第二次又退到最原始措辞；同一 repair 提案重复调用产生不同修复分支，总分支数从1变3。最小契约：作者编辑也有持久 requestId+输入指纹，先查回执再检查CAS，重复请求不再次执行；不同内容复用ID拒绝。审查后已观察到 editReceipts 加入。

3. **P0，新编辑回执会返回过时整份存档。** 加入幂等后的 `src/server-branch-ledger.mjs:22` 使用 `return prior.response`，该response包含旧session/worlds/branch快照。实际复现：生成回合1→polish→生成回合2→重试同一polish，磁盘权威分支2回合，重试响应branch只有1回合。客户端若照通常编辑响应安装session，会静默回退界面并丢掉最新回合的本地可见状态。最小契约：持久记录固定的编辑结果/结果分支ID，但每次回复附带当前权威session/worlds/结果branch；与generate现有“固定回执+最新authoritativeBranch”设计一致。不能以返回旧完整session实现幂等。

4. **P1，新分支登记未冻结开篇。** `src/server-branch-ledger.mjs:19` 比较parent回合链和initialState，却没有比较branch.opening。实际复现：正常开篇fork登记成功；另fork把opening改为“你从开篇就已得到金印。”仍登记成功，read返回伪造开篇。已有 `core.test.mjs:19` 与 `forkBranch` 明确保留原开篇，登记契约不应放行普通fork重写它。最小契约：新分支opening与权威父分支冻结opening相同；如确需改写开篇，走显式作者新世界/新经历操作，不混进普通fork。

### 已确认的合理实现与验证边界

- register/edit/generate 共用 owner+session 的同步pending锁；锁在首次await之前取得，finally释放，单进程范围内未发现并行读改写丢更新。
- generate先检查持久requestId指纹再检查baseVersion，完成请求可跨重启恢复；返回最新authoritativeBranch，没有把旧生成回执当最新分支。
- 取消检查在持久化之前，save开始后的网络断开仍完成保存；已有断响应重启测试覆盖成功回执恢复，未发现同一次生成重复提交。
- 新分支回合链按父分支统一branchId再比较，正常空历史fork已实际验证通过；伪造回合链与initialState有校验。漏检开篇见上项。
- 文件写入经临时文件、sync、rename，返回成功在保存之后；目录fsync与多进程锁限制已如实声明，不要求扩成分布式系统。
- 临时复现文件写在系统Temp下独立 `adaptive-audit-*` 目录；没有改动用户真实账本。上面是边开发边审查的时间点记录，最终是否已修复需以最后测试与代码为准。

## 主应用集成追加审查（2026-10-10）

范围：app.js、branch-client.js、interaction-*、意图路由、selectedObjects和新privateLedger投影。复查时前述A的expectedProse、持久编辑回执最新响应、冻结opening检查已加入；新私有开局也不再沿用完整作者数据响应。因此开头的秘密边界段只适用于旧作者兼容路径，不能用来否认新路径的改进。

实际运行 `node --test tests/branch-ledger.test.mjs tests/branch-client.test.mjs tests/interaction-context.test.mjs tests/experience.test.mjs tests/game-ui.test.mjs tests/narrative-pipeline.test.mjs`：59/59通过。以下是该通过结果之外的集成覆盖空缺，均已即时报告主代理；代码仍在修改，应最终复验。

1. **P0，恢复后的busy UI没有解除（代码路径确认，尚未浏览器复现）。** 审查时 `app.js:61` recoverStory设置recovering=true，在有变化或回执时render(true)，而 `app.js:96` reader把recovering并入busy；finally只设recovering=false，不刷新。`reading-ui.js:69` 因此保留disabled发送按钮，:67仍显示停止。最小修正：finally清标志后更新阅读控制；恢复同时切换分支时也要检查原branchId，不能只检查sessionId。

2. **P0，过期选择会卡住助手状态（代码路径确认）。** `app.js:208` 左右先设置assistantJob，之后在try之外调用 `interaction.selection()`（审查时:214），此方法会对过期版本抛错；catch未包住该构建阶段，assistantJob残留使所有发送被拦截。最小修正：选中对象校验先于进入busy，或把整段构建纳入try/finally；用“选择→服务端恢复更高版本→请求草稿”验证提示清楚且下一次操作仍可用。

3. **P0，编辑响应覆盖本机命名存档（代码路径确认）。** `app.js:62` editConfirmed用result.session覆盖整个session，只保留preferences/personal。已登记后本地“保存此刻”写入s.saves，但register不更新已有服务器session个人元数据，后续polish/undo/repair带回旧saves并覆盖本机新书签式存档。最小修正：明确session个人元数据归属并合并，至少保留saves、用户标题、封存偏好；分支历史才由权威替换。验收用“登记→命名存档→润色→刷新→恢复命名存档”。

4. **P0，新privateLedger世界投影跨分支泄漏发现内容（已运行最小复现）。** `server-public-archive.mjs:9` 汇总同worldKey所有分支正文，:10据此把人物名和发现原句放入共享world.characters。创建原分支0回合；另分支正文“神秘访客走进门来，他自称老周。”；再切回原分支生成公开档案，world仍包含 `{name:'神秘访客',public:'神秘访客走进门来，他自称老周。'}`。这是新受保护读取链路的问题，不是重复提出旧作者权限限制。最小契约：分支可知资料不能由兄弟分支扩大；共享世界元数据与分支发现记录分开投影，read接口也必须按请求分支裁剪。不能只修initialState人物而保留共享world中的发现详情。

5. **P1，UI与服务端选择解析使用不同公开投影（已运行最小复现）。** `server-model.mjs:96` 把当前state伪装成initialState，并把recent.events清空，导致部分已知历史对象被丢弃；UI使用完整真实branch的publicSituation。实际“拿钥匙→归还钥匙”后UI仍有已知对象 `item:1ga1f3v / 不再持有` 可选；相同ID发给validateRequest被INVALID_REQUEST拒绝。超过recent范围且未写experience的旧人物也有同类风险。最小契约：账本在真实权威branch上解析selection，得到已授权selectedObjects再传模型；公开助手/旧API也明确沿用相同投影规则，不能把当前库存等同于全部已知对象。用归还物品、旧人物、跨分支、过期版本共同测试。

其他观察：BranchClient的草稿/阅读位置合并已有正向测试；模型输入会带经解析的selectedObjects，未直接相信客户端附带对象值。新未知组件kind已有只读文字回退测试。文本/表格开关和密度控制属于确定性本地呈现，不增加模型调用。选择在生成期间仍可变更，而成功处理无条件interaction.clear()，可能清掉用户为下一次输入刚选的对象；可仿照draftReferences仅清除本次实际发送的选择，这是较低优先级的输入连续性改进。

## 最后接线复审（本轮末）

确认已看到前述busy恢复、助手过期选择、session个人存档合并、按已发送selection清除、分支读取人物投影、浏览器fetch receiver等修正。定向运行 branch-client、branch-ledger、interaction-context 三文件16/16通过。

仍发现一条会丢失用户工作的闭环阻塞：`src/app.js:62` editConfirmed用服务器分支数组覆盖本机全部分支，而 `src/branch-client.js:6` register只按当前session+activeBranch缓存。用户已登记原分支后，建立尚未发送的本地fork，再切回原分支做polish/undo/repair，登记被缓存跳过，服务器编辑响应没有本地新fork，覆盖操作把该fork及其草稿删除；若命名存档指向此fork，还留下无效引用。

已用实际BranchClient/forkBranch/mergeConfirmedBranch和与app相同的响应安装表达式复现，输出：`secondRegistrationSkipped:true, registrationPosts:1, forkRemains:false, finalBranchCount:1`。这是确定性集成问题，非模型质量猜测。最小修正：编辑响应合并必须保留服务器未含的本机新增分支，或登记缓存跟完整分支集合变化失效并在编辑前同步新增分支；建议仍保留客户端未提交草稿。添加“fork未发送→切回原线→作者编辑→fork草稿与命名存档仍在”回归。

## 主代理最终修复记录

最后未登记fork丢失问题已改为mergeConfirmedBranches保留本地新增分支，新增red→green回归；全量240/240通过。真实浏览器闭环、三题材实际模型、失败与修复证据请以ADAPTIVE-VERIFICATION.md为准。本文件前面的风险列表是各审查时间点记录，不代表最终仍未修复。
