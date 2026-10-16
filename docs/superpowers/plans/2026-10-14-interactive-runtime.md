# 智能交互执行计划

依据：用户已批准执行《SMART-INTERACTION-INVESTIGATION-2026-10-14.md》中的修复与隔离生成界面方向。继续在当前共享工作区实施，不回退其他工作、不改玩家存档、不自动提交。

## 接口与分工

1. 服务端生命周期：`DynamicInteractions.prepare` 区分 `{decision:'keep'|'none',reason}` 与新定义，兼容旧 needed:false；只把同 scope 已审核定义作为可保留 pending；错误不得命中成功缓存。传入 `ui.artifact` 是未授权的界面状态，不是事实或动作依据。先写首次失败重试、keep/none、过期定义测试。
2. 客户端生命周期：`createDynamicControls` 自动失败最多补试一次，失败可见且可手动重试，成功/无需保持去重，取消和过期不能抢写；条件字段随值更新。先写控制器回归。
3. 语义入口与基础图形：`richInteractionRequest(input,{hasArtifact=false}={})` 支持自然整理/路线图和有现有界面的修改请求，保留对白/复合剧情行动保护；关系标签重叠与长标签改进。先写正反例及图形回归。
4. 隔离运行时：新增 view `{type:'interactive',title,description,html,css,script,height?}`；限制总大小，只读概念/准备界面。渲染为 `sandbox=allow-scripts` 的 opaque iframe，CSP、HTML清理、无网络/表单/导航接口。仅提供 `ui.state`、`ui.setState(json)`、`ui.draft(text)`；不提供执行/账本/密钥API。消息核对 frame source 与实例 token。历史界面静态降级。
5. 生成与修复：v7 策略按任务选择固定组件或 interactive；明确展示不等于执行，不虚构未知数据。准备任务采用 medium 推理、较大独立输出预算，其他调用保持现状。语法预检、客户端加载/运行错误及可见性检查提供一次修复与手动恢复；界面状态经严格大小限制送入下一次 prepare。

## 验证

- 每个行为先运行失败测试，再实施；最终 `npm test`、语法检查、diff检查。
- 浏览器在独立端口/临时账本验证：滑块改变结果、草稿按钮、状态恢复、跟进修改、窄屏、错误回退；不能污染4173用户存档。
- 真模型仅在隔离账本验证自动触发、明确生成交互、跟进修改和普通阅读四种情景；记录耗时及局限，不把固定数据当模型结果。
- 独立审查消息边界、缓存状态、旧存档兼容、条件字段刷新、请求取消。

## 进度

- 开始：重新读取当前实现，工作区基线 HEAD 0bf694e；应用已有 three 依赖，保持现状。
