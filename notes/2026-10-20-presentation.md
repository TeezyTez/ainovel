# ElseLife 页边记事呈现改造与验证

本文记录已接入实际阅读器的“页边记事”，包括选择依据、代码、真实行动与只读回放证据。验证结果和限制集中在文末；设计判断不当作用户研究结论。

设计与计划分别见 `docs/superpowers/specs/2026-10-20-presentation-design.md`、`docs/superpowers/plans/2026-10-20-presentation.md`。工作区在任务开始时已有大量叙事、协议和恢复改动；本轮范围不能用整个 `git diff` 代替。阅读器原文件副本保存在 `.validation/presentation-20261020/before/`。

## 问题与选择

现有桌面资料栏遍历最新 `view.information`，页眉依赖末页；回读历史正文时，资料和时间可能仍来自最新页。长事实同时成为标题和摘要，重复占用空间；人物的初始记录与后来追加的事实并列，读者需要自行寻找这页带来的变化。正文提及已经使用每页公开快照，文字锚点也已存在，这两项应继续沿用。

本轮目标是连接**正在阅读的页、该页公开记载、相关前文与回读返回位置**。不改写故事事实，不建立第二套 Agent，不修改生成协议、数据库或模型调用频率。阅读位置与正式行动基准仍是两件事：回读旧页时，行动接续当前分支最新正式页。

同材料比较原型位于 `.validation/presentation-20261020/comparison.html`，生成脚本为 `compare.cjs`。它对 NAR-001、NAR-009 各取前三页、正文前 200 字，以及相同的公开资料，比较以下组织方式；截断正文用于有边界的原型比较，不代表完整阅读体验。

| 方向 | 具体收益 | 代价与判断 |
|---|---|---|
| A：累计资料随页 | 修正旧正文配最新资料的问题，操作变化最少 | 累积后仍需要从整表寻找本页新记；作为较简单的对照 |
| B：页边记事 | 本页新记、更新与明确关联的旧记并读；保留“截至此页” | 差异优先可能遮住持续有效的信息，须保留完整累计入口；本轮选择 |
| C：独立变化长流 | 可集中扫过多页变化 | 形成另一条竞争正文的阅读线，增加定位成本；本轮不采用 |

选择 B 是对材料和交互负担的设计判断，不是测得用户更喜欢或更沉浸。桌面复用已有栏位是为正文与记载并读；窄屏、专注阅读通过同一面板进入，不把“常驻”预先等同于新增侧栏。

## 材料、来源与保留案例

以下材料都是已有基准的**合成初始世界＋封存的真实模型后续正式页**，不属于用户经历。本轮回放不再生成、不导入业务库，也不代表长期用户研究或原基准整题通过。

| 材料 | 本轮角色 | 封存来源与选取点 | 已知的呈现压力 |
|---|---|---|---|
| NAR-001 | 代表材料：船期、人情与行动压力 | `.validation/deep-benchmark/20261020T031911Z-nar001-bridge/NAR-001/events.jsonl`，提交 seq 60，4 页 | 第 3 页 ask 没有新资料；第 4 页新增 5 条人物说法、2 条事实，不能将说法全部呈为事实 |
| NAR-009 | 代表材料：普通家庭修椅 | `.validation/deep-benchmark/20261019T092722Z/NAR-009/events.jsonl`，提交 seq 143，7 页 | 日常细节也产生较长记载，胶尚未固化与已经操作需分清；整列内嵌容易压过正文 |
| SYS-006 | 权限与时间回归，**不再称独立保留例** | `.validation/deep-benchmark/20261020T025116Z-boundaries-v44/SYS-006/events.jsonl`，提交 seq 65，5 页 | 秘密建档版本早于首次公开页；该问题已经参与来源语义设计 |
| NAR-017 | 最终保留检查：分章收回图书 | `.validation/deep-benchmark/20261020T031340Z-reading-editorial/NAR-017/events.jsonl`，提交 seq 77，4 页 | 实现构建后首次完整检查长中文、6 条新记／累计 30 条及尚未发生的约定；未据此调整方案，保留独立性 |

提取结果是上述提交事件中的 `data.public_view`，位于 `.validation/presentation-20261020/recorded/<CASE>-public-view.json`。同目录 `manifest.json` 记录原事件文件 SHA-256、来源根、提交序号和材料性质；没有复制 `data.snapshot` 或作者秘密。源运行在后续步骤失败，不取消已经正式提交页的存在；本轮不以所选片段替原运行宣称整体成功。

仅比较 NAR-001、NAR-009 的逐页公开快照所得计数在 `baseline-analysis.json`：

| 材料 | 各页公开资料总数 | 相对前页的新增数 | 同 ID 更新 |
|---|---|---|---|
| NAR-001 | 6、11、11、18 | 开场不比较；5、0、7 | 后续各页均为 0 |
| NAR-009 | 5、8、13、18、24、29、34 | 开场不比较；3、5、5、6、5、5 | 后续各页均为 0 |

基线中第 1 页只是初始记载，不记成从前一页“新增”；产品入口相应称“开场记载”。这些数字反映公开记录的差异，不等于故事事件数量。ask 没有新增记录，也不意味着正文没有带来新的理解或上下文。NAR-009 的后续正文约 322–444 字，支持采用短页尾入口和按需展开，而不把全部资料重复铺在正文中。

## 权威来源与显示派生

| 内容 | 实际来源 | 本轮能做什么、不能据此断言什么 |
|---|---|---|
| 正式页、版本、分支 | Go `backend/internal/experience/service.go` 与 PostgreSQL | 前端只读取；提交、取消与 fence 仍由原服务负责 |
| 历史公开资料 | `Service.Get` 从每页持久化状态调用 `ProjectReader(snapshot, page.Revision)` | 旧页只能用当页快照；不能从最新资料补写旧页 |
| 公开权限 | `generation_view.go` 的 `ReaderState`、`types.go` 的 `Project` | 隐藏对象、隐藏主体和关联在序列化前过滤；不将作者快照送入 UI |
| `recorded_revision` | 原事实 `SourceRevision`，经公开投影后返回 | 是建档版本，不是获知时间、事件发生时间或可引用正文页 |
| 首次公开定位 | 同分支已保存公开快照中，相同 ID 和展示内容首次出现的页 | 只称“第 N 页的记载”，不能据此声称正文包含逐字证据 |
| 新记与更新 | 两版公开资料的确定性比较 | 新公开不等于新发生；更新不自动等于事实被推翻 |
| 前文关联 | 服务端返回的明确 `related_ids`，及共享这些公开关联的旧记录 | 展示关联材料；不新增关系、不推断因果或人物动机 |
| 返回位置、展开状态 | 原阅读器文字锚点与本机作用域 | 是阅读状态，不改变世界或待发送草稿 |

正式 Go `Information` 不输出 `source_version`；前端保留这个可选字段用于本机演示等来源。不能用它或 `recorded_revision` 替代历史公开快照检查。相关既有回归见 `reader_fact_history_test.go` 与 `notes/2026-10-20-public-fact-record-versions.md`。

## 实际代码职责

| 文件 | 本轮职责 |
|---|---|
| `frontend/lib/experience/reader_page_context.dart` | 纯 Dart 页快照索引、公开内容签名、新记/更新、首次公开页、受明确关联约束的旧记；索引按 View 缓存 |
| `frontend/lib/experience/reader_notebook.dart` | 短页尾入口、页码、开场/新记/截至此页切换、类型文案、完整内容和前文展开；长列表按需构建 |
| `frontend/lib/experience/reader_notebook_host.dart` | 桌面/窄屏入口、正在阅读页、历史详情、同一作用域的来源跳转与返回；解释回读与行动基准 |
| `frontend/lib/experience/experience_screen.dart` | 接入已有阅读器布局、页尾、工具栏和行动区；切换作用域时清除旧返回目标 |
| `frontend/lib/experience/reader_position.dart` | 沿用源文字坐标锚点，并在恢复布局后同步阅读页 |
| `frontend/lib/experience/reader_tools.dart` | 既有跳页与分页工具衔接阅读页、定位 epoch |
| `frontend/test/experience/reader_page_context_test.dart` | 快照、迟公开、缺失历史、关联、签名与分支等边界 |
| `frontend/test/experience/reader_notebook_test.dart`、`reader_notebook_restore_test.dart`、`reader_notebook_source_test.dart` | 旧页隔离、200% 字号、同 ID 元数据更新、旧游标恢复、带动画与延迟保存的窄屏来源／返回 |

`reader_initial_record_test.dart`、`reader_parity_test.dart`、`reader_tools_test.dart` 的旧入口改为经“页边记事 → 全部资料”进入；原有搜索、来源、草稿与引用断言保留。无后端、共享合同、数据库迁移或新依赖。

历史页快照缺失时不比较、不回填未来；最新页缺逐页快照时可兼容使用**同一最新版本**的顶层公开资料。资料签名包含文本、名称、类型、状态、确定性、显示字段与规范化关联，忽略仅建档/来源元数据的变化。列表与关联次序调整不应制造叙事变化。

人物说法、人物相信、初次记载继续分别标注。相关前文默认只在展开时读取，最多显示三条，完整资料仍可访问；这种限额控制展示量，不声称已找全全部相关历史。来源跳转先保存原文字锚点，提供“回到刚才”；分支变化清除返回目标。最新资料另有明确入口，不冒充当前回读页的资料。

## 新真实模型流程

本轮只为验证新建一段独立正式故事，没有接续、改名、分支或删除已有用户故事，没有修改模型配置、偏好或服务设置。

- 标题：`院中补凳`；公开种子为人工编写的日常场景，明确标为呈现验证故事。
- Experience：`exp_bb9301e87f2bd333b79fe1bce185f5b2`。
- Branch：`branch_a3608770c5fa950f9d9bd269a8712e09`。
- 唯一开场请求：`presentation_validation_20261020_courtyard_begin_v1`。
- 向 `http://127.0.0.1:18081/v1/experiences` POST 后收到 202，随后只 GET 同一操作；没有失败重生或换种子。
- `begin-terminal.json` 确认 `committed`、`base_revision=0`、`committed_revision=1`；`begin-public-view.json` 保存 1 页和 20 条公开资料。
- 请求开始记录为 2026-10-20 06:14:51 UTC；06:17:34 UTC 轮询首次记录提交。20 秒轮询只能给出约 163 秒的观察上界，不是精确模型推理耗时。
- `/v1/model-status` 返回 gpt-6.1-sol、本机 Codex 配置可用；`checked=configuration` 本身不代表上游探测。正式开场的操作和读回另行留证。

证据目录 `.validation/presentation-20261020/live/` 包含 `manifest.json`、`begin-request.json`、`begin-response.json`、`begin-poll.jsonl`、`begin-terminal.json`、`begin-public-view.json`。

随后在实际 18080 阅读器输入并点击发送：“我先扶住短凳，看看松动的是哪一处，请阿陶帮我扶稳，但先不拧螺丝。”浏览器记录 POST 202；请求 `ab49852e-265d-4672-bfcf-145f07410229` 最终 `committed`，正式版本 1→2，原输入逐字保留。没有更换输入或重新生成以追求某种结果。

生成期间仍显示第 1 页的已提交记载，并可写下一条草稿“等阿陶说完，再决定要不要动螺丝。”结果到达后，旧页记事仍停在第 1 页；当前行动基准明确为第 2 页。草稿保留并显示原有版本核对提示。点击回到最新后，正文和记事转到第 2 页，出现 5 条新公开记录（3 条事实、2 条人物说法）。正文记录裂纹深度仍不确定、螺丝未动；这些是此次模型结果，不是本轮前端推断。

展开裂纹记录，按已有“短凳”关联查看开场记载，再点“第 1 页的记载 ↗”，返回入口保留第 2 页；点击“回到刚才”恢复原位置。退出到“我的世界”再进入，仍在第 2 页，下一条草稿保留；明确核对后发送按钮可用，未提交第二次 act。系统将经历自动命名为“接缝旁的裂纹”，因此现在应在书架查找该名称。

`live/comparison.json` 逐项核对第 1 页原文与公开资料快照不变。整页 JSON 并非完全相同：现有可选作品流程补附了 `interaction_snapshot`，已明确保留这个差异，不宣称整页字节不变。全局经历标题仍沿用产品最新命名；本轮按页限制的是记事内容和时间，不将全局标题伪装成历史快照。

`live/act-latest-operation.json`、`act-public-view.json`、`comparison.json` 与 `browser-evidence.json` 保存正式状态和交互证据。回读／返回录像为本机附件 `d4275bfa-2eaf-4e2d-ae77-628ed5f5573d-b4273483-a107-453c-a611-7ca3544335c5-mp4.mp4`；录像属于导航提示小修正前的版本，最终截图另列。

## 运行与回放

正式工程仍是 Flutter/Dart＋Go＋Rust＋PostgreSQL。本机正式页面为 `http://127.0.0.1:18080/`，Go 18081，Rust 18083。已有服务只需在仓库根目录使用 `.\tools\start-local.ps1 -Check` 核验；启动器不是新机安装器，也不负责替换未知进程或初始化既有数据库。

下面是本轮对应的复跑命令；除另有明确结果的命令外，不将这里的命令清单当作已执行通过记录。Flutter/Go 等须按项目 README 预先安装。

```sh
cd frontend
flutter test --no-pub test/experience/reader_page_context_test.dart test/experience/reader_notebook_test.dart test/experience/reader_notebook_restore_test.dart test/experience/reader_notebook_source_test.dart
flutter test --no-pub
flutter analyze --no-pub --no-fatal-infos
flutter build web --release --no-pub --no-web-resources-cdn --dart-define=ELSELIFE_API_BASE=http://127.0.0.1:18081
cd ..
python3 tools/verify_project.py
```

回放服务脚本 `.validation/presentation-20261020/replay_server.py` 已以隐藏 WSL Python helper 启动；启动记录 `replay-launch.json` 与 `replay/manifest.json`。补齐空作品目录路由后，仅重启了本任务 helper，最新 Windows PID 11192、WSL PID 23970。它先绑定所有端口，任一占用就失败，不终止已有进程。复跑前先确认旧 helper 是否仍在监听，不重复启动。

```sh
# 仓库根目录；页面需由主线程构建到独立目录，四端口共用同源 API。
cd frontend
flutter build web --release --no-pub --no-web-resources-cdn --output=../.validation/presentation-20261020/replay-build
cd ..
python3 .validation/presentation-20261020/replay_server.py
```

上面的回放构建**不可**设置 API 指向 18081；否则会连接正式服务。也不可固定为某一个回放端口，四端口必须各自使用同源地址。本机可通过 `wsl --exec python3 /mnt/c/workspace/AI小说游戏/.validation/presentation-20261020/replay_server.py` 启动脚本；已有 helper 无需重启，静态构建就绪后直接可读。

| 端口 | 材料 | 阅读路径 |
|---|---|---|
| 18128 | NAR-001 | `/#/story/benchmark-story` |
| 18129 | NAR-009 | `/#/story/benchmark-story` |
| 18130 | SYS-006 | `/#/story/benchmark-story` |
| 18131 | NAR-017 | `/#/story/benchmark-story` |

四组材料原始 ID 都是 `benchmark-story`；分端口避免改写 ID，也隔离浏览器阅读锚点和本机状态。每端口 `/v1/experiences` 仅列本材料，读取返回原文件字节；写入全部 405 并留日志。服务没有数据库或模型，不代理正式 API。`/healthz` 报告静态构建是否就绪，`/__replay_manifest`、`/__replay_fixtures` 提供来源，`/__replay_audit` 返回请求、写入尝试与当前/初始文件哈希。

## 最终验证结果

所有命令在本工作区执行，Flutter 使用本机 WSL `/opt/elselife-tools/flutter`。`.validation/presentation-check.sh` 记录相同参数；`analyze` 通过 ASCII 临时链接进入同一源码目录，未修改分析规则。

| 检查 | 实际结果与证据 |
|---|---|
| 测试先失败再修复 | `red.log` 记录旧页隔离／缺历史／连续滚动的初始失败；`focused.log` 记录状态元数据虽被算为更新却未显示的失败。新增窄屏测试用 60ms 保存延迟与 16ms 帧节奏复现来源跳转被拉回；修复后原断言通过，没有删除检查 |
| 完整 Flutter 测试 | 最终 `flutter test --no-pub --no-enable-impeller --reporter expanded`，**326 项通过，exit 0**；`all.log`。覆盖已有生成、取消、恢复、分支、草稿等回归，不将固定夹具当成模型质量证据 |
| 静态分析 | 最终 `flutter analyze --no-pub --no-fatal-infos`，exit 0，**0 error／0 warning，160 info**；`analyze.log`。保留仓库提示级诊断，未声称零诊断 |
| 共享合同与结构 | `python3 tools/verify_project.py`：PASS，正式入口、合同快照、Rust 固定版本与旧业务移除检查通过；本轮文件 `git diff --check` 无空白错误 |
| 正式 Web 构建 | 最终 `flutter build web --release --no-pub --no-web-resources-cdn --dart-define=ELSELIFE_API_BASE=http://127.0.0.1:18081`，exit 0；`build.log`。浏览器确认脚本 `release=4117062452` |
| 独立回放构建 | 相同参数但不设 API define，输出到 `replay-build`，exit 0；`replay-build.log`。修复复查确认 `release=2851238105` |
| 同材料比较 | A/B/C 原型通过 `html_preview` 实际检查，无控制台错误。最终同一开场前后截图、真实结果与窄屏回读证据见 `delivery-visual.html`，另有浏览器原图 |
| 代表性材料 | NAR-001 p2：5 新记／11 总，保留人物说法；p3 ask：0 新记，显示“本页资料未变”。NAR-009 p7：5 新记／34 总，桌面与 390px 抽屉均检查 |
| SYS-006 时间边界 | p1/p2 不含霜月6日秘密；p3 首次公开 3 条，原事实回读来源是第 3 页，非建档第 1 页；从 p3 回 p2 再次检查无后页资料泄露 |
| NAR-017 独立保留检查 | 实现后首次完整阅读 p4，6 新记／30 总；中文长段、人物说法、未发生约定可读，正文与记事均滚至末尾；未据此改方案 |
| 真实行动与重访 | begin＋一次浏览器 act 正式提交；等待时下一条草稿可写；第 2 页的新记与正式快照一致；来源回读／返回、退出再入，以及最终构建完整重载后从书架重入均保留阅读页与非空草稿。核对后发送可用，未声称第二次 act 已执行 |
| 窄屏实际复查 | NAR-009 原 p7→p6 跳转缺陷已复现并修复。最终 p6 回合号 y=99、首段 y=201；返回 p7 回合号 y=99、首段 y=180，与跳前相同。`browser/verification-after-fix.json` |
| 布局与交互条件 | 浏览器：1280×800 与 390×844、连续／分页；Flutter：390×844、200% 文本、减少运动与动画开启。原有键盘提交与草稿测试仍通过。未进行真机 IME、屏幕阅读器或长时间阅读实验 |
| 独立审阅 | 按本轮文件及三份开始备份审阅，修正元数据对照遗漏、旧像素分页 hydration、恢复上下文同步；二次审阅覆盖弹层关闭与滚动动画 scope/epoch，未留 Important/Critical 发现 |

四份回放 public-view 原文件和服务输出 SHA-256 一致，均 `fixture_unchanged=true`。`browser/verification-before-fix.json` 保留最初观察与移动端失败；`verification-after-fix.json` 保留针对同一材料的复查，未将修复后的代表例改称独立保留例。

窄屏延迟保存的 RED/GREEN 未另存日志文件：终端 session `46780` 记录源页 y=-1788.9994 的失败，`79357` 记录相关 21 项通过。落盘复核使用最终 `all.log` 与同材料浏览器修复前后记录。

关键截图（原图在本机 T3 附件目录）：

- 同一开场原版：`browser-screenshot-127-0-0-1-mvgb2i26-71fa9fd7.png`；新版：`browser-screenshot-127-0-0-1-mvgbpndk-4a3f30f2.png`。
- 最终构建、真实第 2 页重入：`browser-screenshot-127-0-0-1-mvgcuvqe-a7d242b7.png`；非空草稿和发送可用见 `live/final-reload-evidence.json`。
- 最终窄屏来源第 6 页：`browser-screenshot-127-0-0-1-mvgcq1dm-39b37a80.png`；返回第 7 页：`browser-screenshot-127-0-0-1-mvgcr69g-f124026c.png`。

最终 `main.dart.js` SHA-256：正式构建 `104f6c1a523d14d1dbf3af5f329a52aec040fa9f31629ec2659522b60f6cb2cd`；回放构建 `6589be6659ced558bf8dee4339c71a5eb8d2d4be116f522fc2ee548064420a54`。二者 API 地址配置不同，不能互换。

## 已知边界

- 回放只提供封存的公开故事视图与空作品目录。原客户端每个 origin 自动尝试过一次可选作品准备 POST，均被 405 拒绝并留审计；未连接模型或业务库。末页可能显示作品恢复提示，这属于回放设施的明确限制。NAR-001 最初缺目录路由的 GET 503 也保留在记录中。最终移动导航复查没有新增写请求。
- 关联最多展示三条，严格依赖现有 `related_ids`。源资料关联稀疏时，不能替读者补出更丰富的关系。首次公开页也是记录定位，不是已核验的逐字原文引证。
- 不改写源记录：SYS-006 中已公开事实仍包含原来的“尚未阅读”等旧时措辞。全局经历标题仍使用最新命名；历史记事与页眉时间按正在读的页限定。
- 直接对已打开阅读器重复导航同一 `#/story/...` 曾出现基线已有的 `Null check operator used on a null value` 路由错误并返回首页。本轮没有修改路由；验证与交付入口采用“首页 → 我的世界 → 对应经历”。完整文档重载后按这个入口恢复成功，不宣称深链接已修复。
- 本次没有新增主动生成失败实测。失败／取消／结果未知依靠现有自动测试，本次真实模型链为一次成功开场＋一次成功行动。新模型结果与封存回放分开记录。

真实 begin／act 证明各自的 Go→Rust→模型→正式提交链；回放只支持呈现与交互检查。自动测试不证明审美成功，单次浏览器操作不证明真实手机输入、长期使用或全部流派。没有目标读者研究时，不宣称理解、喜爱或沉浸已经提高。`.validation/` 与构建目录已确认由 Git 忽略；没有提交缓存、凭据、真实数据库或用户经历，也未对外发布。
