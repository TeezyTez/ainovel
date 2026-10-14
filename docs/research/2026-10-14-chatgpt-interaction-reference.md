# ChatGPT 聊天内交互：公开能力、实现边界与可复用路径

调查日期：2026-10-14。范围：官方公开文档；未访问用户聊天记录，未修改应用代码。本文回答外部产品参考与工程选择，不能替代本仓库调用日志和渲染链路的诊断。下文“已证实”指官方明确记载；“推断/建议”是据此作出的工程判断。

## 1. 先区分三个对象

| 对象 | 已公开的用途 | 不应混同的内容 |
| --- | --- | --- |
| ChatGPT Visualizations | 在聊天里生成可探索的交互解释 | 不是第三方组件开发协议的实现说明 |
| MCP Apps / Apps SDK 相关 UI | 工具关联 UI 资源，由兼容宿主展示 | 不能据此倒推出内置 Visualizations 的架构 |
| ChatKit | 给开发者自有产品提供聊天组件、widgets 与 actions | 不是复制 ChatGPT 完整产品体验的开关 |

当前开发者文档已将新 UI 的推荐基础写成 MCP Apps 标准；`window.openai` 是兼容别名和可选 ChatGPT 扩展。阅读旧 Apps SDK 示例时应与当前推荐路径区分。[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)

## 2. Visualizations：已证实的可观察行为

ChatGPT 可以在明显有助于回答时自行选择可视格式，用户也能用 `@Visualize` 明确请求。官方示例包含参数滑动、动画暂停/重启、文本编辑和逐步演示。用户可在同一聊天继续要求调整；后续结果可能是替换版本。可视化通常是生成时的信息快照。它需要生成时间，也可能失败；文档不承诺每次自动触发或恒定质量。账号和平台的可用性存在差异。[Visualizations](https://learn.chatgpt.com/docs/visualizations)

**未知：**这份公开文档没有说明内置功能的前端框架、生成代码格式、专用模型、系统提示词、工具选择算法、自动修复循环或部署架构。因此“GPT 聊天端的效果来自 React / MCP Apps / 某个专用 API”都不能作为已证实结论。可确认的是产品行为；其内部实现没有在上述资料中给出。

## 3. MCP Apps UI：已证实的宿主能力

工具通过 `_meta.ui.resourceUri` 关联界面资源；组件在 ChatGPT 的 iframe 中运行，通过 `postMessage` 上的 JSON-RPC 桥接宿主。标准提供初始化、工具输入/结果通知、`tools/call`、`ui/message` 和 `ui/update-model-context`。官方区分服务端业务数据、组件临时状态和开发者存储的长期状态，推荐服务端校验并返回权威结果。[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)

`structuredContent` 和 `content` 可同时交给模型与组件；工具结果 `_meta` 只给组件。ChatGPT 额外提供 widget 状态快照、显示模式请求和宿主模态框等能力。资源元数据可声明连接、静态资源及嵌套框架允许域；这些宿主能力需要实际实现，普通网页引入同名组件库不会自动获得。[Plugin UI reference](https://developers.openai.com/plugins/reference)

组件受到隔离 iframe 与严格 CSP 限制，部分浏览器 API 不可用，嵌套框架默认禁用。这里是第三方插件组件的安全边界，不能延伸为 Visualizations 的内部沙箱描述。[Security & Privacy](https://developers.openai.com/plugins/guides/security-privacy)

## 4. 触发与生成质量是两个问题

官方明确说明：第三方工具的名称、描述和参数文档会影响模型何时调用工具。它建议建立显式请求、隐含需求和不该触发三类样例，分别记录工具选择、参数及组件是否出现，评估准确率与召回率。这是 MCP 工具的公开机制；内置 Visualizations 的精确选择规则仍未知。[Optimize Metadata](https://developers.openai.com/plugins/guides/optimize-metadata)

**推断/建议：**用户的“触发少”应先拆成四个可观测结果：模型没有提出界面、界面请求被策略拒绝、生成结果解析失败、结果生成但界面没展示。若只观察最终有没有卡片，无法判断是哪一层的问题。“生成不好”另需区分任务理解、数据准确性、可执行性、视觉设计和操作反馈。它们与触发率应分别测量。

**推断/建议：**自动出现界面的目标是“当前任务用哪个操作能减少打字和往返”，而不是“识别到某个页面/表单关键词就生成”。小说游戏可用关系筛选、角色比较、时间轴定位、数值推演作为候选任务；是否需要界面要由上下文中的实际操作需求决定。

## 5. 为什么 React 不是充分条件

官方 MCP UI 快速入门用一个包含 HTML、CSS、JavaScript 的文件实现待办界面，React 只是更复杂示例的一个选择。这证明第三方聊天内交互不以 React 为必要条件。[MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)

**推断：**React 能改善复杂组件组织与状态更新，但不会独立补齐任务理解、调用选择、输入数据、事件桥接、服务端更新、模型上下文同步或失败恢复。反过来，若本仓库的渲染能力局限于若干结构化卡片，换框架也不会自动得到自由交互图解。应先明确期望是“稳定的业务操作卡片”还是“可生成的新交互解释”，再选承载方式。

官方界面指南偏向聊天中的单一目的小卡片：重点操作控制在两个以内，避免深层导航和嵌套滚动；复杂探索再扩展显示区域。这可直接作为本产品的设计参考，但不是内置可视化的渲染规格。[UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)

## 6. 合理复用路径

### A. 保留自有应用，补齐消息到操作的闭环

**建议：**优先把输出、渲染和行为约定清楚：消息包含界面意图与数据；渲染器生成界面；控件发出明确事件；服务端处理并返回最新状态；必要的信息进入下一轮模型上下文。小范围业务界面可以复用已有组件和数据模型，先验证三种代表场景。此路线是产品架构建议，不是声称复制了 ChatGPT 内部实现。

### B. 使用 ChatKit 的公开 widgets/actions 能力

ChatKit 提供可在聊天中显示的预建或自定义 widget；Widget Builder 可生成 JSON，按钮操作可把 action payload 交给应用后端。[ChatKit widgets](https://developers.openai.com/api/docs/guides/chatkit-widgets)

自有服务端集成能提供聊天中的卡片、表单、列表及流式 widget 更新。[Advanced integrations with ChatKit](https://developers.openai.com/api/docs/guides/custom-chatkit)

Actions 可在用户点击后更新 widget、运行推理或流式添加消息，无需用户再输入一条聊天消息；开发者仍负责处理动作及状态。[Actions in ChatKit](https://developers.openai.com/api/docs/guides/chatkit-actions)

**建议：**这条路径适合评估“聊天里自动出现可操作小界面”的现成基础设施。它不是 Visualizations 生成器的公开替代品，是否替换现有聊天层仍需评估集成成本和既有业务契合度。

### C. 将业务做成 ChatGPT 插件

**建议：**若目标是让用户直接在 ChatGPT 内操作小说游戏数据，可评估 MCP 工具与 UI 资源。该路线进入 ChatGPT 宿主，需遵循它的协议和权限；若用户仍使用本网站，本网站并不会因此自动获得 ChatGPT 的宿主桥接。

### D. 自由生成交互解释

**建议：**若需要任意新交互，应另行评估隔离执行、依赖管理、超时、错误反馈与修复机制；不要把这一能力与结构化操作卡片混为一个承诺。当前所读官方资料没有给出可直接嵌入本网站、完整复用内置 Visualizations 的公开接口。

## 7. 本轮可以下的结论

- 已证实：ChatGPT 支持主动选择可视表达，公开开发者方案也支持聊天内嵌 UI 与操作回传。
- 已证实：第三方 UI 的关键能力包括协议、宿主桥接、状态归属与设计规范；React 是可选界面实现方式。
- 未证实：ChatGPT 内置 Visualizations 使用何种完整技术栈，或本仓库问题是否由框架造成。
- 建议：先用代表性对话分别测触发和操作成功，再决定扩展现有架构、引入 ChatKit、开发 ChatGPT 插件或增加自由生成沙箱。

核对方式：实际打开上述一手页面并阅读对应正文；没有采用搜索摘要作为唯一依据。资料反映调查日的公开说明，可能随产品更新变化。
