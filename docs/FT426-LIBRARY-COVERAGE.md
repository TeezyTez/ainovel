# FT426：发现、个人资料与本机保存覆盖

2026-10-10。本文件记录模块能力及边界；视图函数存在不等于页面事件已集成或浏览器验收通过。

## 已实现的模块能力

| 范围 | 实现与真实边界 |
| --- | --- |
| FT004、FT018–019 | 发现页提供“替我挑一个”动作接口；按一个标签排除，与文字、收藏、隐藏和包含标签条件同时生效。“换个顺序”按传入 seed 稳定轮换筛选后的现有开局，不假称新增库存或智能推荐批次；实际挑选与 seed 更新由控制器绑定。 |
| FT013–016、FT020–022 | `discoveryView` 展示开局简介、已有参与说明、真实题材标签；支持标题/简介/标签文字筛选及独立的开局收藏状态，带清空条件和无结果退路。只显示每个世界最新模板版本；不改旧故事世界版本。 |
| FT024、FT052 | 开局可隐藏并在折叠的隐藏列表恢复，不删除已有经历。书架批量整理默认折叠，只列当前筛选结果；提供所选封存、恢复与移入回收箱，交由控制器明确确认后执行。 |
| FT017 | 实现本机文字匹配并显示匹配范围，不声称支持语义理解或智能推荐。输入的长句只有其文字实际匹配时才命中。 |
| FT041–049 | `libraryView` 与 `filterSessions` 支持实际停点摘要、故事时间与本机更新时间分离、当前分支完整正文搜索、分类、置顶、备注、分组、封存与回收恢复。回收箱保留原历史，不写固定保留天数，不提供永久删除。 |
| FT008、FT050、FT098、FT107、FT280 | 分支内保存阅读锚点、未提交引用与意图。锚点先寻找原段落；修订后不能唯一定位时回到该回合开头并返回原因，不误跳到同序号的新段落。异世界或异分支来源拒绝。保存个人资料不推进时间。 |
| FT083、FT087–088、FT091、FT100、FT274–275、FT278–279 | 书签、片段收藏、私笔记与草稿引用带 worldKey、branchId、turnId、quote、sourceVersion。检查正文来源和对象身份；已修订的原句可作为旧版本收藏保留，发送前必须重新通过当前引用校验。模块本身不把个人资料放入事实、事件或模型上下文。 |
| FT043、FT272、FT279、FT355 | 搜索完整当前分支正文、输入、故事名、用户备注与分组，不局限于最后摘要或屏内段落；不检索人物后台秘密、隐藏事件或其他分支。尚未实现历史分页/虚拟滚动。 |
| FT344–347、FT350–351 | LocalRepository 保留 load/save，成功写入后才前移基线。另一个标签修改持久字符串后，旧页 save 抛 STORAGE_CONFLICT，不覆写它；预览 readExternal 不接受新基线，acceptExternal 显式重载。写入失败不修改传入数据库，也不更新基线。读取损坏后禁止保存覆盖原数据。 |
| FT378、FT382–384 | 仅本机个人数据。完整 JSON 合并保留个人引用，重新生成 sessionId 不令分支来源失效；冲突的同名世界版本拒绝整个合并。没有账户、公共发布或云同步承诺。浏览器清除数据仍可能丢失本机档，应另存备份。 |

## 前台集成契约

`src/library-ui.js` 导出 `discoveryView({worlds,sessions,getExperience,recap,available,query,tag,excludeTag,favorites,onlyFavorites,excluded,orderSeed})` 和 `libraryView({sessions,query,category,group,sort})`，返回经过文本转义的 HTML。样式为 `src/library.css`，仅作用于 `.library-surface`。

- `#discovery-form` 字段：query、tag、excludeTag、onlyFavorites；按钮 favorite-world 携带 world id。reset-discovery 清空筛选。可选输入 excluded 为隐藏 world id 数组；exclude-world 隐藏，restore-excluded 恢复。
- surprise-world 从当前可见卡片中挑选；shuffle-worlds 更新 orderSeed（默认 0，按匹配条数取余轮换）。无结果时挑选按钮禁用，不足两项时重排按钮禁用。两个动作均不自行生成正文或启动故事。
- `#library-form` 字段：query、category、group、sort。category 为 active/ended/archived/pinned/trash/all；all 不含回收箱。reset-library 清空筛选。
- 故事操作：pin-story、story-note（备注与分组）、rename-story、archive-story、trash-story、restore-story，均携带 session id。回收箱不显示继续按钮；已封存/结束卡片标为回看。
- 折叠的 `#library-batch-form` 中 checkbox name 为 select-story，value 为 session id；按钮为 batch-archive、batch-restore、batch-trash。回收箱仅提供批量恢复。
- 开局链接 `#/world/:id`；已有故事链接 `#/story/:id`。回到发现的续读卡排除回收箱、封存和完结故事。
- 元数据编辑函数返回克隆，调用方负责采用新对象与可靠保存。原生字段查找、搜索、收藏本身都不会调用模型。

## 不冒充已经完成的范围

FT019 只实现现有开局重排，不声称有新增推荐批次；FT024只实现具体开局的可逆隐藏，不声称进行智能推荐学习。FT275 的按人物筛选收藏、FT271 的语义时间段搜索和FT288分支比较也不在这些模块的交付中。

FT375–377、FT379–381、FT385–386 所需账户、云端身份与公开发布能力不在当前本机产品范围，不展示假登录、跨设备同步或虚假数据政策。FT092片段公开分享、支付订阅与社区功能亦未开启。

本机跨标签保护是同步 localStorage 的乐观“读取后比较再写入”，不是跨进程原子 CAS，也不是服务端全局提交锁；极窄的真正同时写入窗口不能声称已从协议上消除。UI 必须在冲突时保留页内数据库/草稿，让用户明确选择，而不能自动重载覆盖。

## 已执行验证

`tests/personal-library.test.mjs` 验证私笔记不改变事实或模型上下文、全分支正文搜索、回收恢复保留历史、来源隔离、旧版来源留存、对象更新过期、锚点修订回退。`tests/storage.test.mjs` 验证两个 repository 交错读写、冲突后的双方草稿保全、失败重试、损坏数据防覆盖。`tests/transfer.test.mjs` 验证旧导入行为与带个人来源的独立 session 导入。

`tests/library-ui.test.mjs` 验证实际筛选、收藏状态、单标签排除、相同 seed 稳定重排且不增加库存、续读排除回收箱、模板版本去重、正文全量搜索、分类/动作契约、空态退路和 HTML 转义。视图截图、键盘导航、真实点击与持久恢复仍需要主任务在应用集成后验收。
