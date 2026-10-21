# ElseLife 显式叙事引擎重构

## 目标与授权

用户要求按叙事生成方案实施真正的体系化重构。此前 v3 的提示词、上下文导航和字段恢复不足以完成此目标。本次实现显式、可追踪、可测试的生成流程及持久化叙事状态。延续当前已授权实现，不增加账号或商业系统，不覆盖已有未提交改动。已有 `docs/prompt-engineering-architecture-2026-10-19.md` 保持原样。

## 责任与选择

保留 Flutter / Go / Rust / PostgreSQL。Go 是正式事实、页、分支、版本、租约及提交的唯一权威；Rust 编排模型阶段并产出候选；Flutter 只显示公开进度和正式页。

采用有界阶段流水线及 revision 绑定的后台候选。独立常驻 NPC 服务会造成第二套状态和生命周期；一次模型包办全部工作则无法验证阶段和信息隔离，因此均不采用。阶段调用是同一故事操作内的模型工作，不接回旧 task/workflow 系统。

正式页缩为一个完整场景片段（通常 1–3 段）。每个片段独立审稿和原子提交；提交后后台准备下一次 read。用户继续时可直接消费已审稿候选。不会以打字动画或未提交 token 假装提前发布。

## 生成状态机

`memory → actor(0..2) → plan → evaluate → write → extract → review → decision`

- memory：选择本场目标、相关事实和最多两个角色；生成按角色观察范围分开的 trigger，引用当前证据，未执行的输入仍是 attempt。
- actor：每个角色单独调用，只给该角色 known_by 事实、自身档案和有来源的本场 trigger。Go 禁止加入整份 author_world、seed、全量正文和原始玩家输入；不得给一个角色另一角色的决定。
- plan：输出 2–3 个有差异的走向及因果、代价、后续影响、伏笔操作；不提交世界变化。
- evaluate：独立评价各候选的连续性、人物自主性、因果、后果、节奏和吸引力；代码排除有阻塞问题的候选，按固定分数和稳定次序选取一个。无可用候选则失败。
- write：依据选中走向写短场景正文，遵守人物表达、读者偏好及临时表达要求。
- extract：从实际正文提取 canonical Candidate，正文必须原字一致；附带 narrative_update。事实与人物知情变更必须有正文证据。
- review：独立比对正文、变化、角色知识、玩家授权、伏笔依据与写作质量。Go 记录审核输入的 Candidate 和模型批准结果，最终候选必须与审核输入逐字段相同。
- 可有一次 revise → extract → review，针对具体问题修订；仍不通过则失败，不重试到玩家成功。
- 总模型调用最多 12，最多 2 个角色、1 次修订；回取也计入调用预算。ask 单独走读者投影的 answer/review，不改变时间、事实或叙事笔记，不获得私有作者附件。

阶段容量共同约束：canonical Candidate 最多 24 KiB；scene、每名 actor、每个 plan 与修订问题分别最多 2 KiB；非 Context 的阶段材料（含 prompt/schema）合计最多 36 KiB，provider 对 schema 的额外计算另预留 4 KiB。真实上下文配置仍为 65,536 tokens、输出保留 8,192，不通过虚增配置绕过预算。

v4 不使用 prose-first 降级。旧档案兼容读取；旧生成路径只用于兼容性测试，不是新运行入口的失败回退。

## 共享数据与持久化

`State.narrative?` 是版本化叙事笔记，不是第二份世界事实；随 branch.state 和 page.state 原子保存，历史分支自然取得对应版本。`Candidate.narrative_update?` 是替换笔记的候选，v4 非 ask 必须提供。`Context.pipeline? = {version:1,max_actors:2,max_repairs:1}` 明确启用新状态机；`Context.reading_request?` 是当前回合的表达要求，不更新长期偏好。

NarrativeState 的字段：

```text
version: 1
through_revision: integer
episodes[0..8]: {id,summary,from_revision,to_revision,fact_ids[]}
characters[0..16]: {entity_id,goals[0..4],relationships[0..8]:{entity_id,stance,fact_ids[]},voice,belief_fact_ids[],updated_revision}
arcs[0..16]: {thread_id,status:open|resolved|abandoned,tension:0..5,next_beats[0..3],payoff_conditions[0..4],fact_ids[],updated_revision}
style: {voice,perspective,pace:slow|balanced|fast,detail:brief|balanced|rich,avoid[0..8],preference_refs[0..16]}
```

Go 校验引用类型、范围、笔记大小及版本；所有事实仍使用原 canonical facts/entities/threads。belief_fact_ids 只能引用该角色的 statement/belief。arcs 是可修改未来意图，不是已发生事实。ReaderState/ask 永远剥离 narrative。归档导入同样验证，旧档案无字段可读。

ModelCallRequest 增加 `narrative_stage=5`、`narrative_actor_id=6`。其他 protobuf 字段和 frame 坐标不变。Go 强制阶段顺序、模型预算、唯一 actor 和最终审核绑定；阶段不是根据提示词文本猜测。正式页与共享合同所有快照、hash、类型、验证和测试同步更新。

阶段统一输出 JSON `{result: ...}`。extract 的 result 为 `{candidate_json:string}`，字符串立即按 canonical Candidate 严格解码，不恢复或降级；该包装避免重复大型 gameplay schema。review 的 result 为 `{approved:boolean,issues:[{code,detail}],supports:[{fact_id,quote}],knowledge_supports:[{subject_id,fact_id,quote}],reveal_supports:[{type:fact|entity|thread,id,quote}]}`；正文引用必须为对应 Candidate.passage 的非空连续子串，新增事实、知情变化及已有隐藏对象的公开逐条覆盖。ask 不含状态更新或笔记更新。Go 不信任候选自报“审核通过”。

## 后台准备与并发

新增临时 preparation 表，绑定工作区/经历/分支/base_revision/base_fence、state/preferences/author_world/engine 摘要，有状态、租约、候选、审核回执及 claimed_request_id。一个分支同版本最多一份准备；后台生成完成只能标 ready，不能写正式历史。只在阅读后准备一次，不自动重试失败。

read 接受事务中核对所有绑定，claim 到新的 operation/fence；GenerateAccepted 仍用当前完整 authority 执行 Apply 并原子提交。act/ask、分支、版本、偏好和临时阅读要求改变使不匹配候选失效。晚到结果用条件写入拒绝；取消不阻塞玩家输入；重启时失效或租约过期的准备不复用。preparation 不导出。

后台记忆整理在已提交页之上进行；摘要与角色/伏笔准备可随候选保存，只有正式消费后形成新版本叙事笔记。当前世界变化必须在当前提交中生效。

## HTTP 与阅读体验

- Operation.progress? = `{seq,phase}`，phase 只用公开枚举 preparing/remembering/characters/planning/evaluating/writing/extracting/checking/revising/committing。
- GET `/v1/experiences/{id}/preparation?branch_id=...&base_revision=...` 返回 `{experience_id,branch_id,base_revision,status}`；status 为 preparing/ready/unavailable，不含隐藏内容。
- AdvanceRequest.reading_request? 随原 request_id journal、操作记录和冻结 Context 保存；用于下一段的明确文风反馈只消费一次。长期偏好继续使用现有 CAS 和确认流程。
- 前端继续只显示 committed 后的正式 View；进度和准备状态不能覆盖正文、草稿或恢复记录，错版本及迟到响应丢弃。

## 验收

固定模型测试明确标为协议/隔离/状态机测试：验证 actor 私有信息隔离、候选评分选择、审核拒绝与内容绑定、单次修订、预算、持久化笔记、归档与分支、后台晚到竞态、缓存命中仍经新 fence、偏好和临时要求失效、前端未知结果恢复。真实模型评测记录各阶段耗时、总耗时、缓存命中等待及连续故事正文；不能用结构通过代替叙事质量。真实模型失败保留证据，不把失败样本删掉。

本次需完成本地构建、检查、真实模型链路验证；公网发布不在此次重构范围。运行服务切换前检查没有活动故事生成，迁移保留已有故事。
