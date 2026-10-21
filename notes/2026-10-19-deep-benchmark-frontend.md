# 深度基准：前端行为回归与证据边界

依据用户提供的 `ElseLife_深度测试基准_2026-10-19.md` 中 SYS-003、004、010、019、025、026、027、029 及 UIX 展开项审查。这里的结论针对列出的客户端断言，不表示整个案例通过。夹具 API、Flutter 合成事件、Node 校验器均不是生产数据库、真实模型、实体输入法或盲测读者。

## 本轮复现、根因和修复

| 基准断言 | 失败证据 | 根因 | 实施和复测 |
|---|---|---|---|
| SYS-019-H2 旧锚点行动不能搬到新局面 | 在 r1 输入“按刚才三枚的价格买两张”，刷新为 r2 后实际 POST 带 `expected_revision: 2` | 本地日志只有草稿文本；发送直接读取最新 current.revision | 草稿从空变为有内容时绑定正式页；`draft_revision` 随草稿持久化。刷新不改变锚点。过期或旧版缺锚点草稿保留，发送前显示原页/当前页；明确“已核对”仅更新锚点，另一次发送才发请求。确认也校验 scope 和 revision。 |
| SYS-019-H4 / SYS-025-H1 组合输入和刷新 | 未结束的 TextRange(0,4) 在 recover 后变为 (-1,-1) | recover 调用 open，先清空编辑状态再读本地日志，打断 IME 事务 | 恢复已确认历史只刷新服务端 current/operation，不重建本地编辑状态。合成中文 composition、Ctrl/Meta+Enter、按钮、刷新均保留草稿且不误发送。 |
| SYS-025-H1 组合快捷键 | Ctrl+Shift+Enter 实际发送了 act | 基础阅读器只检查 Ctrl，没有排除 Shift/Alt | 排除 Shift/Alt，保持与正式阅读器输入语义一致。 |
| SYS-025-H3 大字、窄屏、键盘下可操作 | 340/390/768/1280 宽、200% 字体、280px viewInsets 下头部溢出；340 宽输入区也溢出 | 头部固定 64px；展开输入区无高度上限 | 头部按内容增长；输入区按剩余视口限高且可滚动。4 种尺寸均实际定位并点击“发送”“停止生成”，验证只有一次提交及一次取消。 |
| SYS-026-H4 自动修复不能因重挂载无限调用 | 同故事版本重挂载 ReaderPreparedWorkbench 后，同一错误产生第 2 次 prepare | JS 的 repaired Set 属于一次 renderer 实例；Flutter host 无持久预算；错误消息仅作 DOM title，模型只收到固定文案 | JS 将实际错误及作品标识作为诊断数据，明确 automatic/manual；host 在 branch+storyRevision 日志中先持久记录一次自动预算，并以进程内 scope reservation 阻止多组件并发。重挂载不会获得新预算，明确手动重试仍可用；修复前仍先 flush 参数。 |
| SYS-017 / SYS-029-H4 分享范围 | 完整备份名称容易被误认为普通阅读分享；正文 JSON 曾带私人 input | 迁移备份和分享导出没有足够明确的用途命名 | 配合 Go `/v1/reader-export` 增加“导出全部已揭示阅读记录”，标明全部工作区经历/分支范围。client 拒绝非 `elselife-reader-export` v1 响应；当前分支正文 JSON 不含 input。完整备份仍保留可恢复语义，明确标为“作者完整备份”，说明未揭示事实、秘密和私人输入。 |

修复预算是本机日志与同进程多组件边界，未实现/未宣称跨设备全局预算。JS 错误字符串来自不可信的运行诊断，作为数据随请求传递；它不拥有新的行动权限，现有服务端 artifact 验证与正式执行仍负责权威边界。

## 运行记录

- Flutter 全量：288 passed，`.validation/deep-benchmark-frontend-full.log`。
- Flutter analyze：退出 0，156 条 info，0 warning/error；`.validation/deep-benchmark-frontend-analyze.log`。
- 定向核心：43 passed，`.validation/deep-benchmark-frontend-core.log`。
- 作品工作台：14 passed，`.validation/deep-benchmark-repair.log`。
- Node artifact-validator：16 passed，覆盖 patch/migration/各 scope 隔离、unknown 数值等结构规则；不表示模型会生成可用界面。
- 改动的 `reader-advanced.js` 与 `renderer.js` 均通过 `node --check`。
- `git diff --check` 通过。
- 失败证据保留：`.validation/deep-benchmark-frontend-red.log`、`deep-benchmark-composition-red.log`、`deep-benchmark-repair-red.log`。第一次全量中旧“导出本机记录”标签测试及无草稿锚点的旧测试夹具已按新的明确产品语义更新，未删除断言。

## 案例覆盖的精确边界

| 案例 | 已跑的客户端证据 | 尚缺的完整案例证据 |
|---|---|---|
| SYS-003 | reader_input_routing、artifact_repository、prepared_workbench、reader_context 测试核对固定 ID/scope/revision/digest、旧作品只读、参数保存和错误归属拒绝 | 两同名商人重排后的真实浏览器点击、旧纸价与库存、Go 正式结算和跨分支故障回放；不能据 Flutter 夹具宣称 H1–H4 全通过 |
| SYS-004 | 窄语法命令不会截获对白/复合行动；固定 classifier 返回 mixed/clarify 时不提交故事；原输入及相同 request 重试保留 | 真实模型理解否定、条件、引语、同行意愿及独立金额/票数核验 |
| SYS-010 | author/world change 测试验证作者资料只随特定操作、精确 CAS 请求先持久化、私有快照不混入普通 act/ask | 润色/事实纠错的真实语义及两伞后果一致性、并发采纳和原文定位回退 |
| SYS-019 | 新增草稿正式位置、恢复 composition、既有跨分支迟到回执、同编号恢复客户端测试 | 双真实客户端屏障调度、服务端提交/取消线性化与两端独立数据库读回 |
| SYS-025 | 4 宽度 200% 字体 + 模拟 keyboard inset 实际点击；合成 IME/组合键；既有正文 AX、键盘人物链接和焦点测试 | 实体桌面/移动 IME、真实软键盘、屏幕阅读器；跨两段选区与复制；语义阅读锚点仍不能由“offset 没变”证明。当前持久阅读位置主要是像素 offset，字体/布局变化保持同句原文需进一步实现和验证 |
| SYS-026 | 既有 flush-before-classify/state CAS/局部参数恢复/跨 scope/历史只读测试；新增重挂载修复预算与诊断传输测试；Node migration 校验 16 项 | 浏览器真实运行故障 → renderer → host → 模型全链审计；生成 patch 权限和 public water=12 独立 Go 读回；跨设备修复预算未实现 |
| SYS-027 / UIX-001–013 | 已有动态执行、局部草稿与正式执行分离、unknown 地图数据、历史来源和私有笔记隔离的客户端回归 | 13 个具体情境的真实模型生成、输入交互、独立数值/状态核验和目标用户任务完成度均未在本前端回归中执行。没有逐题标 PASS |
| SYS-029 | 既有完整已载历史搜索、书签/笔记分支隔离、封存不行动、引用成功后清除、备份导入不恢复在途请求；新增读者导出端点校验 | 60 页/三分支的真实浏览器完整路径、离线读取与云状态声明、可逆回收及批量筛选作用范围仍需独立实测 |

这些回归是公开基准驱动的开发测试，没有私有 holdout 或盲评性质。没有把测试题、判定器答案或质量分数加入产品模型上下文。
