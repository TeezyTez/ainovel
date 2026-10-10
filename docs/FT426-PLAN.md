# 方糖个人体验全面重构计划

**Goal:** 按426项规格重构个人阅读、介入、时间、资料、历史、修复与保存体验。
**Architecture:** 保留原生前端、Node服务和两阶段生成。新增独立的时间/已知对象状态层、个人资料与历史查询层、渐进展开的阅读界面；旧存档按需兼容，原世界和原分支保留。
**Tech Stack:** Node.js 24、浏览器 ES modules、CSS、localStorage、本机 Codex。
**Spec:** docs/FT426-source.json（完整426项原文），用户明确排除支付、订阅、社区、公开分享与创作者运营。

用户已明确要求直接全面重构，沿用直接执行授权。当前全部项目文件未提交，不创建空worktree或覆盖现有故事。按独立文件并行开发，主任务集成与真实浏览器验收。

## 全局约束

- 默认正文单栏；常驻继续、输入、发送/停止；情况、时间、经历、调整清晰可达。
- 查询、笔记、收藏、界面导航不推进时间。角色行动与世界内调查需要提交。
- 时间有来源，未知保留未知；现实离线不算故事经过；委托有目标、上限、禁止和接手条件。
- 公共资料只取当前分支已知内容，不将人物秘密或未来构想作为情况/搜索结果。
- 无账户云同步、支付、社区、公开发布；不放假入口或虚假权益、剩余额度。
- 保留旧 schemaVersion=1 存档；新字段可选，所有新状态需可验证重放。

## 模块边界和公共契约

1. `src/experience-state.js` 与 core/model接入：可选 `proposal.experience` 与 `turn.experience`；`applyEvents(before,events,experience?)` 使用第三参数更新 `state.experience`。对象变更和时间均有正文 quote；记录 provenance 使用 state.version，不伪造真实日期。
2. 请求可选 `control={kind,goal,until,limit,forbidden,reserved}`，kind为advance/wait/delegate/read/act/epilogue；其余字符串。`references=[{worldKey,branchId,turnId,quote,objectId}]` 可选，有来源且不等于行动。preferences.boundaries为本局文本。
3. `publicSituation(branch,world,turnId?)` 输出统一公共 `clock,objects,summary`；objects固定`id,kind,name,summary,status,certainty,fields,relatedIds,sourceVersion`。fields数组`{key,label,value}`仅普通文字。`historyEntries(branch,query)` 搜索完整本分支公开原文。
4. `src/reading-ui.js` 纯视图：`readerView({session,branch,world,state,situation,busy,error,notice,settings,intentMode,focusMode})`，`situationView({situation,filter,query,view,sort})`，`objectView({object,branch,world,notes})`，`historyView({branch,query,notes})`，`timeView({control})`。统一使用data-action事件，主任务绑定。配套`src/reading.css`。
5. `src/personal-library.js` 纯函数处理故事收藏、备注、书签、回收箱、锚点、筛选；`src/storage.js` 增加跨标签写入冲突检测，保持 LocalRepository.load/save 接口。
6. `src/app.js` 由主任务独占集成：阅读/对象/历史/时间面板、选择引用、笔记、组织、草稿、错误恢复、显示设置；`experience-views.js` 与首页设置由主任务调整。

## 实施清单

- [x] A. 时间、对象、委托与两阶段输出接入；测试重放、终态、查询不推进、来源和秘密边界。
- [x] B. 阅读与按需资料界面；测试转义、对象稳定ID、空态、历史标识与按钮语义。
- [x] C. 个人资料、历史锚点、回收与多标签冲突；测试不改故事事实、导入和失败保全。
- [x] D. 主任务集成全部交互；加入发现/搜索/收藏、偏好、帮助和修复入口，不增加默认界面负担。
- [x] E. 逐条426项对照，明确完成、适用边界或后置的真实情况；不以组件存在声称语义保证。
- [x] F. 独立审查、全量测试、真实生成与桌面/窄屏浏览器验证；保留现有用户档并启动成品。

## 验证重点

引用对象过期、同名对象与排序；推进遇接手条件不提前执行后续；查询/笔记不变事实；多标签写入不覆盖双方草稿；旧档和修复分支的时间/对象快照；生成中阅读位置、选区、焦点和下一条草稿；所有常用按钮有真实行为和返回路径。

本轮完成以上工程与验证步骤，不等于426项无条件全实现。范围、条件与尚未完成进阶项见FT426-coverage.md。
