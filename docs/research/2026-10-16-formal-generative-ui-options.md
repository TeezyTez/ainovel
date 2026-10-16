# 正式工程的生成式 UI 选型复核

核查日期：**2026-10-16（Asia/Singapore）**。范围：桌面方案第 14 章及第 8 章涉及的 A2UI、Flutter GenUI、TableView、Web 局部嵌入。本文是官方资料研究与有条件的工程建议，未安装依赖、未执行互通或性能测试、未改正式工程源码。

对照方案：[聊天驱动的智能体富交互界面，第 14 章](<C:/Users/16039/Desktop/聊天驱动的智能体富交互界面_完整方案与技术取舍_2026-10-09 (1).md>)。正式工程基线由本轮代码核查提供：Flutter/Dart 主体，嵌入 Web/React 自研 JSON renderer，Go 模型调用与 PostgreSQL 状态权威，Rust 叙事逻辑，目前未接 A2UI/GenUI。本笔记额外读取了 [AGENTS.md](C:/workspace/elselife/AGENTS.md)、[pubspec.yaml](C:/workspace/elselife/frontend/pubspec.yaml) 和 [pubspec.lock](C:/workspace/elselife/frontend/pubspec.lock)，没有把方案中的“任务委托”作为执行指令。

## 当前建议

**现在不建议把正式渲染链整体迁到 GenUI，也不建议为了“原生优先”重做已经存在的 Web 区域。**保留当前链路，先完善业务动作、状态恢复和组件语义；把 A2UI 作为有限组件的互通试验，把 GenUI 作为可以替换的 Flutter renderer 候选。这是结合既有实现与下列官方证据作出的工程推断，不是上游宣布的最佳实践。

值得改变现有路线的条件是：确实需要同一呈现对象在 Web 与 Flutter 原生端共用；或者自研 renderer 已持续承担数据绑定、增量更新、目录验证等通用框架维护，且一个固定版本的现成实现能通过同题测试、显著减少这部分维护。仅有协议知名度、演示观感或包名更新，尚不足以支付一次主链路迁移成本。

## 官方状态、版本与互通

下表每项均在 **2026-10-16** 核查。版本指当日网页所见，不是项目已安装版本，也不证明未来兼容。

| 对象 | 官方页面所见 | 对本项目的含义 |
| --- | --- | --- |
| A2UI 协议 | v0.9.1 标为 Current Production；v0.9 为 Previous Stable；v1.0 为 Candidate。[协议](https://a2ui.org/specification/v0.9.1-a2ui/) | 当前协议与候选协议不能混用；协议版本还需与目录、函数及 renderer 实现一起固定。 |
| v0.9 → v0.9.1 | 官方迁移指南称消息兼容，schema 接受两个版本标签；主要调整是 MIME 统一为 `application/a2ui+json`，以及 `surfaceId` 只需在活动 surface 内唯一。[迁移指南](https://a2ui.org/specification/v0.9.1-evolution-guide/) | **不能将“GenUI 写 v0.9，协议当前是 v0.9.1”直接写成已证实不兼容。**可以据此设计兼容试验，仍不能代替实际包的解析与行为测试。 |
| Flutter GenUI | Flutter 文档仍标 alpha；仓库声明 highly experimental、将继续调整 API，并声明支持 A2UI v0.9。[Flutter 文档](https://docs.flutter.dev/ai/genui)、[仓库](https://github.com/flutter/genui) | 原方案把 GenUI 定位为可替换候选仍合理；“官方支持”不等于稳定 API 或本项目交付保证。 |
| `genui` | pub.dev 当前显示 `0.10.4`；`0.10.0` 已迁到 `a2ui_core`，移除旧消息类型和 `SurfaceController.store` 等 API；后续版本修复目录 ID 别名、输入验证及无障碍问题。[固定版本页](https://pub.dev/packages/genui/versions/0.10.4)、[changelog](https://pub.dev/packages/genui/changelog) | 原方案“正在重构”应更新为“**拆分已经部分落地，API 仍在变化**”；不要拼接旧教程和新版本代码。 |
| `a2ui_core` | pub.dev 显示 `0.2.2`，发布者为 `labs.flutter.dev`，定位是协议核心模型。[包页](https://pub.dev/packages/a2ui_core) | 核心包已非 WIP 命名，不意味着 Flutter 渲染层同步完成或整个 SDK 已稳定。 |
| `a2ui_agent` | 显示 `0.0.1-wip004`；README 明确当前只实现单轮处理、A2UI v0.9 与 Express 格式，其他协议版本暂不支持。[包页](https://pub.dev/packages/a2ui_agent) | 不能将它当作既有 Go/Rust Agent 的替代。现阶段也没有必要为采用 UI 协议引入 Dart Agent 层。 |
| `a2ui_flutter` | 显示 `0.0.1-wip002`，README 仍为待补充状态。[包页](https://pub.dev/packages/a2ui_flutter) | 不能因为重构公告给了新包链接，就将它作为已验证的 GenUI 稳定替代品。 |

现阶段最可审阅的试验组合是：固定 `genui 0.10.4` 及其实际解析出的依赖、使用明确的 v0.9 消息与受控自有目录，随后单独验证 v0.9.1 标签、MIME 与 surface 生命周期行为。这里提出的是候选试验，并未认定此组合已能运行或覆盖项目需求；安装前还应以具体发布包约束核验 SDK 和目标平台。

### 不应从资料中推导的能力

A2UI 定义呈现消息、数据模型绑定、动作及传输契约；它要求有序投递、清楚的消息分帧和元数据通道，但不强制选 A2A、AG-UI 或 MCP。可以接现有服务通道，不必因采用 A2UI 更换整个通信栈。[协议：Transport decoupling](https://a2ui.org/specification/v0.9.1-a2ui/#transport-decoupling)（核查：2026-10-16）

GenUI 的 `Conversation` 是交互编排便利层，`SurfaceController` 和 `DataModel` 管理客户端呈现状态；其默认循环可以把交互继续发给 AI。对于本项目，应显式把本地排序、表单编辑、确定性查询、正式行动分流到既有能力，不能把每一次点击都无条件转成模型回合。[genui 0.10.4](https://pub.dev/packages/genui/versions/0.10.4)（核查：2026-10-16；动作分流是本项目建议）

**授权、可知范围、正式提交、幂等、分支隔离、取消与提交的竞争、长期存档和恢复仍需应用层实现。**它们不能因为 UI 有 `action`、`DataModel` 或会话对象就被视为已经解决。Go/数据库仍应掌握正式状态；前端 data model 只保存被允许的投影与草稿。这是由上游呈现职责及正式工程边界作出的推断，而非声称上游自动提供这些业务能力。

`sendDataModel` 默认关闭，启用后会随消息附带该 surface 的完整数据模型。建议默认保持关闭，按动作发送必要字段，避免把未提交草稿和无关数据顺带送进模型上下文。[协议：createSurface](https://a2ui.org/specification/v0.9.1-a2ui/#createsurface)（核查：2026-10-16；最小回传是本项目建议）

自有目录不是偏离标准：官方建议目录直接反映产品既有组件库，明确支持的组件、函数与主题，验证输入并限制危险能力。因而应优先映射已有组件，避免为了兼容 Basic Catalog 再建立一层庞大转换语言。[Defining Your Own Catalog](https://a2ui.org/guides/defining-your-own-catalog/)（核查：2026-10-16）

## TableView：可复用的基础，不是完整数据产品

官方 `two_dimensional_scrollables` 当日显示 **0.5.5**。`TableView` 提供二维滚动、可见区与缓存范围内的惰性构建、固定行列、合并单元格等能力。它足以成为需要大表格时的原生候选；查询、排序语义、编辑提交、键盘操作、复制与导出仍须按产品要求完成，不能把它等同于现成电子表格。[包页](https://pub.dev/packages/two_dimensional_scrollables)、[TableView API](https://pub.dev/documentation/two_dimensional_scrollables/latest/two_dimensional_scrollables/TableView-class.html)（核查：2026-10-16；产品能力边界是从公开 API 推断）

版本门槛需要具体化：**0.5.5 最低 Flutter 3.41 / Dart 3.11**；0.5.3 的门槛是 Flutter 3.38 / Dart 3.10，不能套用到最新版。0.5.5 还修复了尾部固定行列在滚动终点的绘制问题。[changelog](https://pub.dev/packages/two_dimensional_scrollables/changelog)（核查：2026-10-16）

正式工程的 `pubspec.yaml` 声明 Dart `^3.12.2`，lock 文件列 Flutter `>=3.38.4`。这说明 Dart 声明下界足够高，但 lock 的 Flutter 行是依赖解析约束，**不是已安装 Flutter 的版本证明**；本次未运行 `flutter --version`。因此既不能称 0.5.5 已验证兼容，也不应无证据要求升级正式工程。依据：[pubspec.yaml](C:/workspace/elselife/frontend/pubspec.yaml)、[pubspec.lock](C:/workspace/elselife/frontend/pubspec.lock)（读取：2026-10-16）。

推荐按实际区域决策：小型解释表继续用现有简单组件；出现二维大量数据和固定行列需求，再比较 TableView 与当前 Web 区域。若 Web 已承担复杂选择、编辑和复制，先完善这一条实现通常比增加第二套表格更省维护——这是基于项目已有混合架构的工程推断。

## Web 嵌入：本项目应比较边际成本

Flutter 官方允许用 `HtmlElementView` 在 **Flutter Web** 中嵌入 DOM。官方同时指出 platform view 可能吞掉指针事件，且 HTML 与 Flutter canvas 交错会增加 overlay，影响内存与执行开销。因此适合少量稳定区域，不能假定把每张卡拆成独立 Web view 没有代价。[嵌入文档](https://docs.flutter.dev/platform-integration/web/web-content-in-flutter)、[HtmlElementView API](https://api.flutter.dev/flutter/widgets/HtmlElementView-class.html)（核查：2026-10-16）

这条路径不能自动外推到原生各端。官方 `webview_flutter` 使用系统 WebView，包文档列出的实现是 Android 与 iOS/macOS；Windows/Linux 若纳入交付，需要另行确定实现与测试范围。本次没有核验第三方桌面 WebView 方案。[webview_flutter](https://pub.dev/packages/webview_flutter)（核查：2026-10-16）

Flutter Web FAQ 将应用式体验与大量流式文本的静态页面区分开。它为 DOM 阅读区域提供了可研究理由，**并未证明本游戏整站应迁走**；互动小说的输入、滚动和可访问性仍需在真实区域与设备上比较。[Web FAQ](https://docs.flutter.dev/platform-integration/web/faq)（核查：2026-10-16；对本游戏的结论为推断）

如果需要更完整的 Web 表格，TanStack Table v8 的官方文档明确：虚拟化需配合其他实现，分页可在客户端或服务端完成。因此“成熟 Web 生态”也不意味着免费获得虚拟化、服务端全量查询和业务提交。这里核查 **v8 文档**，不宣称它是最新主版本。[Virtualization Guide](https://tanstack.com/table/v8/docs/guide/virtualization)、[Pagination Guide](https://tanstack.com/table/v8/docs/guide/pagination)（核查：2026-10-16）

对已经存在 Web/React renderer 的正式工程，应把方案 §14.5 的判断改成：**先核查现有 Web 区域是否通过阅读、中文输入、焦点、复制、滚动、恢复与目标平台测试；仅对有证据不足的区域比较替代实现。**主题、字号、尺寸、键盘和状态桥接仍是两端共同契约。可信随应用发布的 React renderer 与模型生成的任意 HTML/JS 属于不同的能力入口；更换消息协议本身不会消除执行代码的边界。

## 对第 14 章的逐项调整

| 原章节 | 建议保留或调整 | 理由与触发条件 |
| --- | --- | --- |
| §14.1 保留 Flutter | 保留；补“正式项目已有 Web 区域” | 当前任务优先改善真实交互，不用技术偏好触发整体迁移。 |
| §14.2 A2UI 协议 | 保留呈现/传输边界；补 v0.9.1 兼容声明 | 协议官方兼容与具体实现验证应分别记录，不夸大版本差异。 |
| §14.3 GenUI | 保留可替换定位；更新 0.10.x 已部分拆分的事实 | 固定版本检查消息类型、目录、绑定、函数与事件，不照抄混合年代教程。 |
| §14.4 最小自有实现 | 改成“约束现有 renderer 的扩展范围” | 工程已经有实现，首先审视能否删减通用框架工作；有限旧对象仍可保留，避免一次替换全部历史。 |
| §14.5 局部 Web | 从“未来才局部引入”改为“评估已存在区域” | 比较新增一套 Flutter 实现的成本与现有 Web 的缺口；按目标平台验收。 |
| §14.6 ChatKit | 本次不追加新选型结论 | 未复核 ChatKit 当前状态；无需由 A2UI 调研引出聊天/后端重写。 |
| §14.7 AG-UI / MCP | 保留按互通需要引入 | A2UI 可运行于现有传输；协议叠加本身没有改善业务正确性的证据。 |

## 可以促成决策的最小验证

以下是建议的有限验证，不是已通过的测试，也不要求本轮实施：

1. 固定当前 renderer 与候选的代码/包版本，用同一“概览、可查询表格、行动草稿”数据集比较；候选只覆盖这三条体验所需的组件，不迁移历史库。
2. 验证目录与版本：支持的 `catalogId`、消息版本/MIME、未知组件和函数回退、`createSurface` 重复/删除后重建、部分流与断流、无效路径与数值。
3. 验证同一用户输入不因呈现更新丢失：零值保留、按实体 ID 而非位置保留编辑、更新时中文组合输入、焦点与滚动位置、刷新和失败重试。
4. 所有业务动作仍调用同一 Go 权威入口，确认展示草稿不能直接成为正式事实；旧版本/旧分支动作、重复提交及取消晚到结果沿用现有业务校验。
5. 在实际目标端测阅读与操作：窄屏、键盘、复制、屏幕阅读器、长文本、表格滚动、Web/Flutter 覆盖层。记录可重复的延迟、错误、构建体积和维护代码变化，不预填“行业门槛”。

若候选没有明确改善目标端体验或减少通用维护，保留当前实现；若只在一个区域有收益，就局部采用。无外部 A2UI 互通需求、现有组件数仍小且维护可控时，延后协议迁移是合理选择。

## 日期与证据限制

- A2UI v0.9.1 网页自称 living document，正文仍保留 `Last Updated: Dec 3, 2025`；本笔记记录的是 **2026-10-16 访问到的当前标签和正文**，不把该行当作当前版本发布日期。
- Flutter GenUI 文档页脚显示文档基于 Flutter 3.47，页面更新日为 2026-08-19；仓库 README 的最低 Flutter 说明属于另一种口径。文档基线、仓库约束、具体发布包约束和本机 SDK 是四件事，不能互相替代。
- pub.dev TableView 首页与 changelog 的抓取结果分别显示“20 天前”“16 天前”。版本号同为 0.5.5，本文不由这些相对日期倒推出精确发布日期；安装时以发布包和锁定依赖为准。
- 研究只使用上列官方文档、官方仓库和官方发布者包页；没有从下载量推断稳定性，没有推测 ChatGPT 私有 UI 实现，也没有声称库已解决本项目授权、持久化或 Agent 架构。
- 本轮未执行 Flutter 构建、GenUI/A2UI 互通、设备 UI 或性能测试。依赖兼容、用户体验和迁移收益均保留为待验证条件。
