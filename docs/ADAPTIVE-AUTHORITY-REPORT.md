# 持久分支权威（A）

## 实际接口

所有登记接口与带 sessionId 的生成请求携带 `x-branch-owner`，值为浏览器持久保存的随机 token（32–160 位字母、数字、下划线或短横线）。服务端文件名只使用 token + sessionId 的 SHA256，不保存原 token。

- `POST /api/branch/register {session,worlds}`：首次通过 validateArchive 导入整个故事，包含父分支引用。已登记分支不会被旧浏览器快照覆盖；新增分支必须从登记父分支的原始回合链分叉。返回 `{session,worlds}`。
- `POST /api/branch/read {sessionId,branchId,requestId?}`：返回 `{branch,state,world,receipt}`；receipt 是该请求原始完整响应，无回执时为 null。
- `POST /api/generate {sessionId,branchId,baseVersion,requestId,input,preferences?,control?,gameAction?,references?,selection?}`：服务端重建世界、状态、人物、记忆、历史与叙事元数据，忽略客户端相应快照；引用必须存在于权威原文。preferences 使用模型接口已有白名单。selection 的验证由公共模型校验负责。

响应保留提案字段，并增加 `committedTurn`、`authoritativeBranch` 和 `receipt {requestId,sessionId,branchId,baseVersion,version,turnId}`。客户端直接安装权威回合，不再调用 commitTurn 创建第二个回合。持久回执保存固定提案与 committedTurn，响应 authoritativeBranch 每次从最新账本重建，避免每个回执复制全部历史以及旧回执回退分支。客户端草稿、阅读位置等个人数据由 UI 合并保留。

`POST /api/branch/edit {requestId,sessionId,branchId,baseVersion,turnId,expectedProse,kind,text?,proposal?,reason?,rules?,name?}` 支持 polish / undo-polish / repair / rewrite。正文 CAS 同时检查原文，防止相同回合版本下的并发润色覆盖；修改请求持久去重，重试不再次修复或撤销。重试返回最新档案和固定操作对应的分支，不返回旧快照。rewrite 仅修订 rules：复制完整服务端世界到新版本并建立分支，保留旧线和幕后资料。空分支 rewrite 使用 turnId:null、expectedProse:''。返回 `{session,worlds,branch}`。

## 保证与边界

每个 owner + session 同时最多一次登记/生成变更；冲突返回 BRANCH_BUSY。baseVersion 不匹配返回 VERSION_CONFLICT。已完成 requestId 对相同输入返回持久回执，对不同输入返回 REQUEST_CONFLICT。取消在提交前检查 abort；进入持久保存之后，即使连接断开也完成保存，恢复接口带回相同 turnId。数据以独立临时文件写入、文件 sync、原子 rename 后才回复成功，重启后直接读取文件。

账本位于 `.data/branches`，Git 忽略，静态服务白名单不会提供文件。单进程本机服务是支持范围；没有跨进程锁，不支持多个服务进程共享同一账本。文件 sync + rename 没有目录 fsync 的跨平台保证，不能宣称抵抗所有突然断电和硬件故障。失败的持久写入不返回成功；未提交的模型调用可能已经耗费供应商额度，重试不能保证供应商计费幂等。

初次登记是显式兼容导入边界，允许本机作者导入自己编辑的旧档；它不是云身份验证。token 授予本机故事访问权限，丢失 token 不能读取旧登记。旧作者档案继续保留完整资料语义，不做破坏性迁移；它们仍可在浏览器包含人物秘密，不能把旧作者档案称为玩家秘密隔离。

新增 `POST /api/world/start {requestId,seed,preferences?}`：服务端调用 world 辅助生成、登记完整幕后世界，仅返回 `{session,worlds}` 公开档案，并标记 session.privateLedger:true。同 requestId 持久去重，种子冲突拒绝。此类档案的 register/read/generate/edit 响应均使用显式字段投影：世界不含角色 secret/goal/history，未在任何分支正文出现的人物不提供；隐藏事件、flag、state.hiddenEvents、未来叙事元数据均不提供。初始关系与人物仅由初始开场/事实建立，公开回合状态逐次回放公开事件与公开 game/experience，后续人物发现不改变历史状态。register/edit 的多分支档案共享世界版本为兼容存档校验包含各分支已在公开正文发现的人物并集；仅属于明确的多分支作者档案视图。scoped read/generate 的 world 单独从当前分支开场及已发生正文构建人物和公开描述，兄弟分支中才出现的人物及描述不会通过这些玩家接口返回。客户端可保留作者档案并集以支持完整回放，但当前分支查询应使用分支公开证据。模型正文主动披露某条秘密时，该正文成为公开叙事，投影本身不判断模型披露是否适当。

保护故事的普通新分支先匹配公开历史，再从服务端完整父分支重建，保留隐藏事实。世界改写仅通过 rewrite 的规则补丁实现，任意新世界导入拒绝 PRIVATE_WORLD_EDIT_UNSUPPORTED。保护档案的公开备份无法单独恢复幕后真相：没有原 owner 下服务端账本时登记拒绝 PRIVATE_LEDGER_REQUIRED，不把不完整公开快照冒充完整秘密存档。应保留设备账本和原浏览器 token。

没有 sessionId 的旧 `/api/generate` 保留原 stateless + 五分钟缓存语义，客户端可提供状态且重启不保留回执；这是旧 API 兼容限制，实际 UI 必须使用登记 scope。

新增分支历史按原始父分支比对；改写世界同时增添人物并重写历史状态的旧客户端分支可能被拒绝，需设计专门的权威改写接口才能安全覆盖此情形。

## 验证

`node --test tests/branch-ledger.test.mjs tests/server.test.mjs tests/workflows.test.mjs`：33 项通过。新增确定性模型 HTTP 验证保护开局、秘密哨兵不出现在返回 JSON、完整幕后上下文仍供下一轮使用、秘密保留的分支与规则改写、空分支修改、正文 CAS、修改请求冲突与幂等、修改后继续生成再重试不回退。公开回放测试验证人物后续发现不改变初始状态或旧节点分叉；HTTP 测试验证兄弟分支出现神秘访客后，原分支读取和生成不返回其姓名及公开描述。原 HTTP 回归验证伪造 world/state、版本 CAS、所有者隔离、重启、并发、取消及提交后断开恢复。这些不是供应商真实模型质量测试。
