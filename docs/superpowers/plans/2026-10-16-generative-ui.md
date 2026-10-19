# 任务驱动的智能界面实施计划

> 执行方式：使用 subagent-driven-development，将 Go 上下文、Flutter 展示、局部状态迁移并行拆分；主任务负责真实模型与浏览器验证、架构报告和发布。

**Goal:** 根据当前任务选择正文、视觉或真实可操作工具，避免每轮附表及旧界面污染，保持故事权威与用户局部输入。

**Architecture:** 沿用 Flutter + Go + Rust 与受控 JS/React 混合渲染。模型只提出界面；Go 校验并提交版本；客户端只拥有局部交互状态，不建立第二套世界事实。

**Tech Stack:** Go、Flutter/Dart、既有 Node 校验器与 React 编译器、PostgreSQL；不增加框架或账号系统。

**Spec:** 用户提供的 `C:\Users\16039\Downloads\ChatGPT_Generative_UI_技术架构.md`；对应架构决策记录在 `notes/2026-10-16-generative-ui-architecture.md`。

## 全局约束

- 对齐任务体验，不宣称复刻未公开的 OpenAI 内部技术栈。
- 只使用公开材料；begin seed 不是玩家公开输入。
- 普通对话允许正常 none；明确交互要求不能降为静态表格。
- 本地试算、模型修订、正式行动三条路径必须分离。
- 不修改正式用户经历；测试使用隔离数据库和虚构材料。
- 不提交 Git；不引入新协议字段破坏现有存档重验证。

## 重点审查

- 已完成的历史图表要求不应成为当前自动任务。
- none 不应因正式 game 状态残留又显示旧表。
- 跨正文 revision 的过期 artifact 不得附在最新页，错误恢复入口仍需存在。
- 修改当前工具应保留参数，不把无关工具或其他 scope 的状态带入。
- 静默之外应有主动生成正例；结构通过不代表控件能运行。

## 任务 1：界面决策与当前语境

文件：`backend/internal/experience/artifact_prompt.txt`、`artifacts.go`、`artifact_context_test.go`、`artifact_context_integration_test.go`。

- [x] 先测试 currentTurn、begin 隐私、触发类型和分支隔离。
- [x] 输入 currentTurn 与 automatic/requested/input，让历史只作背景。
- [x] 将过度积极的统一展示提示改为按用途选择；补充真实控件、事实依据、组件注册表及状态接口。
- [x] 运行定向 Go 单元/隔离数据库测试。

## 任务 2：正文与生成界面的正确归属

文件：`frontend/lib/experience/reader_artifact_repository.dart`、`reader_tools.dart`、`reader_prepared_workbench.dart` 及对应 Flutter 测试。

- [x] 先复现 stale 与 sourceGame 空而 state.game 非空的展示问题。
- [x] 最新页只展示当前有效 artifact；保留失败恢复、历史与手动查看。
- [x] 展示判定优先当前 definition/sourceGame；仅旧协议无 sourceGame 时兼容回退，非空提案也需实际可渲染状态。
- [x] 运行定向 Flutter 测试及分析。
- [x] 补齐当前有效界面的自由追问分类入口与提交前局部状态保存，覆盖失败恢复和连续编辑。

## 任务 3：跨界面修订保留局部输入

文件：`tools/artifact-validator/retained-state.mjs`、`validate.mjs`、`validate.test.mjs`。

- [x] 测试当前 patch 修改脚本摘要后参数丢失。
- [x] prepare 阶段迁移正确的节点状态，严格绑定 scope；不改变 validate 存档路径。
- [x] 测试显式 map/drop、初始值、完整替换和跨 scope 隔离，包括声明式工具的步骤与参数重置。
- [x] 运行 Node 测试和 Go artifact 集成测试。

## 任务 4：真实运行、文档与发布

文件：`backend/internal/experience/artifact_design_live_test.go`、架构报告。

- [x] 真实模型测试普通对话、旧要求、多维度主动比较、关系、时序、试算、可点击机制图，以及自然追问修订。
- [x] 真实生成结果使用正式 renderer，实际改变参数和点击部件；不以类型断言代替交互验收。
- [x] 独立复核；运行相关回归、构建 Flutter Web/Go。
- [x] 发布到现有本地入口；仅在无进行中操作时重启已验证身份的 Go 服务。
- [x] 记录验证结果及尚未实现的流式、跨端、事实来源与运行质量能力。
