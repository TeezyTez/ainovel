# ElseLife 叙事生成改造实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. The user has explicitly requested implementation of the supplied proposal; proceed within that scope.

**Goal:** 在已有正式历史与生成协议上改善连续性、人物自主性、选择后果、中文表达和等待体验，交付可复跑的结构检查及真实模型阅读样本。

**Architecture:** Go 仍是唯一正式写入方；Rust 从同一冻结上下文组织生成、回取和验证；Flutter 只展示已提交故事。复用 fact/rule/secret/statement/belief、known_by、source_revision、threads 和原文回取，不建立第二份世界记忆或客户端 Agent。

**Tech Stack:** Flutter/Dart、Go、Rust、PostgreSQL，使用现有模型适配器与工具链。

**Spec:** 用户提供的 `C:\Users\16039\Downloads\ElseLife_叙事生成改造方案_2026-10-19.md`，2026-10-19 明确授权按方案实施。

## Global Constraints

- 保留已有源码、用户未提交文件和正式故事；不接入账号、支付或旧任务系统。
- 本轮优先复用现有协议；若改动共享协议，必须同步四端快照、类型及检查。
- 正文不因可选资料索引失败而消失；未验证资料不得获得权威。
- 当前事实、认知和后果同步提交；不发布未检查的半页正文，不把后续准备当作已经发生。
- 一次虚构行动不推断长期偏好；短期要求仅改变本轮表达。
- 固定响应只验证程序行为；真实质量与速度报告标明样本、测量边界和未验证项。

## Review Focus

1. 一个损坏的可选字段不能连带丢弃独立有效的事实，也不能借恢复绕过知识、来源或玩法检查。
2. 旧物品转移/承诺在正文裁剪后仍有依据；取回历史不能覆盖当前快照。
3. ask 不泄漏秘密或改变状态，read 不替玩家做重大决定，人物获知与读者获知分开。
4. 玩家切换分支、提交新行动或页面销毁后，迟到的展示准备不能阻塞或回写当前阅读状态。
5. 改写正文保持事实、声音、知情与立场；对比评测不得把结构通过当作文学质量得分。

## Task 1: 当前生成路径与叙事组织

**Files:** `algorithms/src/narrative_response.rs`、`algorithms/src/experience.rs`、按职责新增叙事上下文模块及 Rust 测试。

**Interfaces:** 继续消费 `Context`，输出既有 `Candidate`/`ReadRequest`；只在模型输入 `authoring` 中附带派生指导，不写入正式状态。

- [x] 对有效元数据与损坏独立字段并存、回取可达性、ask 隔离、原上下文不变增加回归测试并观察旧实现失败。
- [x] 更新实际发送的提示词：事实/信念/计划分离、有限知情、NPC 目标与拒绝、选择代价、伏笔与缓冲、声音与局部编辑、偏好边界。
- [x] 对重要行动提供有界的候选方向比较指导，常规推进不新增固定串行模型调用；使用已有资料来源与未解决线索。
- [x] 恢复有预算的原文回取输出入口，并保持普通短篇直接生成。
- [x] 独立验证可选资料，保留可验证的组成部分及原字正文。
- [x] 执行默认/no-default-features Rust 测试及 runtime 构建。

## Task 2: Go 上下文与正式状态连续性

**Files:** `backend/internal/experience/generation_view.go`、`narrative.go` 及对应测试。

**Interfaces:** 保留 `compileGeneration`、`applyNarrative`，不新增数据库表或权威副本。

- [x] 增加正文/状态裁剪后的相关主体历史事实保留测试，覆盖人物信念、物品归属、来源和 ask 投影。
- [x] 改进当前明确主体的上下文选择及依赖闭包，仍如实报告省略/容量不足。
- [x] 对候选资料部分失败采用有限、确定的恢复；所有保留下来的组合重新通过完整 Apply。
- [x] 执行 Go 单测、隔离 PostgreSQL 集成和 race 检查。

## Task 3: 阅读等待与个性化边界

**Files:** 根据前端审计定位 `frontend/lib/experience` 内准备/阅读路径及对应测试。

**Interfaces:** 复用正式 revision、branch 和偏好 CAS；不新增世界事实缓存。

- [x] 用受控未完成请求证明展示准备不会占用下一次故事行动的等待链。
- [x] 将独立展示准备与阅读交互解耦，保留过期结果隔离和必要错误展示。
- [x] 核查长期显式偏好与本轮要求的边界；复用已经有效的确认流程。
- [x] 执行 Flutter 相关与全量测试、静态分析、Web 构建。

## Task 4: 表达编辑、连续阅读与交付证据

**Files:** `backend/internal/experience/author_edit.go`、作者辅助测试、新增 opt-in 叙事评测测试与合成场景、`notes/2026-10-19-narrative-generation.md`。

- [x] 加强实际润色请求中的视角、声音、信息边界与删减重复要求；不增加自动接受编辑。
- [x] 建立同开局同输入的连续场景对比，覆盖卖出戒指、私下交账册、同伴拒绝、救人放弃追赶及未知询问。
- [x] 测量每轮模型次数、完整可读正文等待、提交耗时与资料保留；明确目前无分段发布，不伪报首 token 延迟。
- [x] 可用时运行真实模型于隔离测试库，保留合成阅读样本与原始测量；故障不自动重试到理想剧情。
- [x] 审阅全部 diff、共享协议一致性及工程边界，记录实际结果和仍需目标读者/并发负载评测的限制。

## Execution Notes

已有事实/信念、知情来源、分支、偏好确认和原文回取能力无需重复实现。专项训练、未验证的推测流式正文和第二套记忆服务不符合当前证据条件；本轮通过实际生成链路、上下文和评测迭代推进八个方向。

## Completion record

已完成上述实现与本轮验证，详见 `notes/2026-10-19-narrative-generation.md` 和连续阅读样本。独立复审提出的容量预留、跨字段恢复、缺失时间、评测字段问题均已修复；Go/Rust 容量常量有漂移检查。

Ruling: 原有前端已经让自动准备与故事输入并行，因此只增加可取消调度窗口；避免重复实现阻塞解除。

Ruling: 当前发布粒度保持整页；半页发布需要新的状态/提交设计，不能在未建立该机制时把流式 token 当正式正文。

真实样本平均整页等待增加约 34%，速度目标未达；长期阅读质量、并发负载、专项训练和后台摘要尚未验收。未提交、推送或重启正在运行的 Go/Rust 服务。
