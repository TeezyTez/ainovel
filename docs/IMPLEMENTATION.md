# 此间 · 实现与验证计划

依据用户提供的完整原型文档，直接开发，不另设设计审批环节。空仓库采用原生 ES modules + CSS + Node 24 HTTP 服务，无生产依赖，不是 Telos 正式技术栈。

## 设计
- 六个 hash 路由视图：世界入口、世界详情、世界编辑、故事阅读、我的故事、设置。暖白与紫灰、宋体正文、无叙事图片。
- localStorage 单文档原子写入，失败保留内存且明确报告；JSON 可移植。后端仅代理模型，无服务端存档，密钥仅由环境变量读取。
- WorldDefinition 不可变版本；每个 Branch 固定 worldKey。Turn 持有提交后的 WorldState 快照、events、memory；从旧节点分支复制此前记录与快照，不继承未来。
- DemoProvider 精确 action ID / 完整建议文案匹配，未知输入不推进。三世界各八轮、两处选择与延迟后果。
- RealProvider 请求经本地服务发送；非流式明确等待。事件提案通过版本、实体、类型与边界检查后整体提交。不声称解决语义一致性。

## 模块与接口
- `src/worlds.js`: `PRESET_WORLDS` 数组。世界字段 id,version,title,tagline,description,tags[],pace,era,rules[],characters[{id,name,role,public,goal,secret}],opening,location,identity,goal,seed,custom。
- `src/demo.js`: `demoActions(world, state)` -> [{id,text}]；`demoGenerate({world,state,actionId,input,requestId})` -> {requestId,baseVersion,prose,events[],suggestions[],ended}。state 有 version,step,location,time,facts[],inventory[],relations{},flags{},characters{}。
- 事件格式 {type:'fact'|'item-add'|'item-remove'|'relation'|'location'|'flag',entity?,value,visibility:'player'|'hidden'}。flag entity 必须是 world id 前缀的有限脚本标识；relation entity 是人物 id；其他 entity 可省略。
- `src/core.js`: createSession, getBranch, currentState, commitTurn, forkBranch, validateProposal, validateArchive, exportMarkdown；纯函数边界和可测状态。
- `src/storage.js`: LocalRepository 与默认设置、草稿/事件。
- `src/providers.js`: DemoProvider / RealProvider、请求取消。
- `server.mjs`: 静态文件白名单 + GET /api/config + POST /api/generate。请求 {requestId,world,state,player,preferences,memory,recent,input}；响应使用上述 proposal 格式。配置只返回 available、provider/model 的非敏感说明。限制 payload 和预算、超时，不接受客户端 URL/key。
- `src/app.js`, `src/style.css`, `index.html`: 可访问语义 HTML 和事件代理，文本一律转义。

## 顺序
1. 核心行为测试先失败：分支隔离、原子提交、版本冲突、重复请求、导入防损坏。
2. 实现状态与存储；独立编写三套演示内容和模型代理。
3. 实现所有页面、世界版本编辑、存档、偏好、取消与错误反馈。
4. 执行 Node 测试、HTTP 集成测试、真实浏览器操作和三档尺寸检查。
5. 独立代码审查，修复重要问题，交付启动入口与诚实能力说明。

## 验证边界
真实模型未配置则语义联调标记未验证。结构校验、脚本可玩性、浏览器路径分别记录。
