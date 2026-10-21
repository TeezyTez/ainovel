# 文学记忆索引与实际证据分离

2026-10-20。对[已批准文学记忆设计](2026-10-20-narrative-memory-design.md)的接口细化。用户已接受本次定稿，并补充 required 缺页的调度规则；下面的接口与实施计划进入开发，正在运行的 v4.12 冻结批次保持原样。设计不是质量验收。本文的目标是落实原设计的“原始依据 + 可重建索引 + 按需工作材料”。

## 需要解决的真实问题

检索摘要回答“这段过去为什么可能有关”；证据回答“这次判断实际依据什么”。两者现在被同一个 `quote` 绑定：

- `MemoryChange.quote` 必填且必须是当前候选正文的连续子串。
- `MemoryMaterial` 的 `source` 粒度仍主要发送该 quote 和部分旧 quote；数据库核过整页不代表模型读到了整页。
- review 同时收到完整 candidate.passage，却还必须复写与 change.quote 完全相等的记忆支持，并判断这一预选摘录是否足够。
- 当前 `prior_sources` 保留同一记忆 ID 的历次更新页，没有表达新摘要另外使用了哪些旧页、哪个版本的事实。

v4.12 的 NAR-010 已完成 10 步，但 17 次 review 中有 7 次拒绝，包含 6 次状态修复及 1 次 mixed 修订。部分修复仅扩大摘录；NAR-017 S01 则收窄摘要以适应短摘录，正文交接事实仍在。这说明索引表达被证据表示方式牵制；不能据此声称所有拒绝都是误杀，也不能以减少拒绝数替代摘要真实性审查。

当前普通 review 本来就只有一份完整 candidate.passage。本改造不虚构一个不存在的“双份 candidate”问题；要去掉的是摘要与单段证明摘录的强制绑定，以及实际存在的历史页、回取页和 quote 复制。

## 选择与范围

采用显式版本化的索引／证据接口。新记忆直接对本阶段已有候选正文审查；涉及过去的判断可以引用本阶段实际提供的正式页或完整权威事实。保留独立 review、一次修复和原调用预算。

其他两个方向暂不合并：

1. 单纯修改 quote 提示或改名不能解除候选、存储、读取和批准协议中的绑定。
2. 为现有 fact／knowledge 支持建立共享 quote 表可以减少重复编码，但不解决文学记忆的证据语义。录制输出可无损压缩，不证明真实模型能正确生成或因此提速；另行验证。

第一期复用按页 ReadRequest。真正的段落／字符窗口是后续协议：不能把整页返回称为窗口，也不能静默截取必要条件来满足容量。

## 不变的边界

- Go 拥有正式历史、分支、base revision、lease／fence、来源 hash、改写失效和原子提交。模型不能签发正式来源。
- candidate 正文在提交前只是一份候选。它可支持本次提取，不属于已发生的正式历史。
- summary 仍审查真假、条件、否定、时间、不确定性、认识归属、关系方向及反例。一次临时表现不能升级为永久人格。
- fact／statement／belief 和 known_by 各自独立。此处的来源 ID 不授予任何 actor 知情；actor 仍只收到 Go 授权的完整事实记录。作者页、摘要、来源目录及其隐藏排序不进入 actor。
- 各阶段重新装包。上阶段曾经读过某页，不等于当前请求包含该页。历史查询完整、来源存在、当前材料已加载、语义充分是不同判断。
- 不增加模型、读取、修复预算，不改变现有段落和正文容量。required 证据放不下仍失败；普通相关记忆不因此全部变成 required。

## 1 三种明确分开的对象

### 1.1 索引条目

保留 id、kind、subject／target、cue、summary、status、retrieval_keys、fact_ids。它们用于发现、连续性解释和按需回源，不是人物权限或事件存在的独立证明。

正式来源由 Go 维护。旧 quote 保留为 locator，说明“从哪里开始找”，不再宣称它自身已覆盖摘要的全部新增含义。新索引不强制生成 locator；需要定位时可提供精确原文提示，但其存在不替代语义审查。

索引投影提供：

- 条目的完整来源数，以及本次可见的有界来源目录；
- 每个来源的类型和固定版本定位；
- 当前请求是否真的提供了对应内容；
- 目录是否省略、索引是否存在历史空缺。

不沿用 `requires_source=false` 表示“足以证明摘要”。旧字段只在兼容读取中解释，新的发送协议使用实际加载状态。

### 1.2 本阶段实际证据目录

Go 在验证原始载荷、完成材料选择和精确去重后，从最终实际模型请求生成目录。每个短 source ID 只在当前操作和批准绑定内有效；ID 由 Go 分配，模型只能选择，不能提交自造 hash 或授权。

允许三种来源：

| 类型 | 实际内容 | 权威与限制 |
| --- | --- | --- |
| candidate | 当前 draft／candidate 的原字正文 | 仅支持本次拟发生内容，未提交；绑定完整候选，不能只有正文 hash |
| formal_page | 固定分支、版本下本阶段实际提供的完整页 | Go 验证页版本和原文 hash；作者可读不代表人物可读 |
| authority_fact | 本阶段实际提供的完整正式事实记录 | 保留 kind、subject、known_by 等全记录语义；固定 as-of revision 与规范记录 hash |

目录只指向载荷中现有的一份内容，不复制正文。发送给模型的每个条目给出清楚的类型、来源定位及对应字段位置；内部注册表保存完整 pin 和指纹。`candidate` 的位置是本次 `draft.passage` 或 `candidate.passage`，没有正式 revision。事实目录不能把 quote 相同的不同事实或不同知情边合并。

索引中“可回取的来源”与此目录是两个集合。locator-only 来源没有本阶段证据 ID；模型必须补读后才能把它作为“已查看依据”引用。来源 ID 不允许跨候选、跨操作、跨分支复用。

所有来源的“已提供”只说明对应字节确实在请求中，不证明模型关注了它，也不证明它蕴涵摘要。

### 1.3 独立审稿的记忆证据选择

新 review 的每条记忆支持包含 `memory_id` 与 `source_ids`，不复写一条预选 quote。source_ids 只能选本阶段证据目录中的 ID；批准必须逐项覆盖新记忆变化，无遗漏、额外项或重复边。

每次新增／更新都必须有当前 candidate 支持它为什么在这轮产生变化。累计含义可以另外使用实际加载的旧页或事实。旧摘要只是待核解释，不能递归充作新的事实证据。

review 仍独立判断这些内容是否实质支持摘要；存在相同页 hash 或有效 source ID 不能使无依据内容获得批准。缺少必要旧条件时返回既有 ReadRequest，读取后重新完成本阶段；预算不够则失败，不能让索引摘要代替缺失证据。

普通 fact supports、knowledge supports、reveal supports 的逐边标准与原文支持机制保持原样。此设计不把文学记忆支持改造变成放宽人物知情校验的入口。

## 2 候选与正式数据的版本化

采用新的 `memory_delta: {version: 2, entries: [...]}` 候选载体，与旧 `memory_changes` 互斥。新 entries 是解释字段，不要求一个充分 quote；如保留定位提示，使用显式 `locator_quote`，且仍检查它确为候选原文。新 engine 只生成 v2；旧结构仅用于旧记录、旧归档的兼容解码和原有验证。

选择独立字段的原因：不能让同一个旧必填 quote 字段在无版本标记时突然改变安全含义，也不能把缺字段悄悄理解成“新协议”。

`State.literary_memory` 进入 version 2。entries 的顶层 id 保持原位置，使用与文学 kind 分开的 `evidence_kind` 判别，两个变体均为闭合 schema：

- `legacy_v1`：完整原 MemoryEntry 字段，加显式判别。quote、source_revision、source_sha256、updated_revision、prior_sources 与 fact_ids 原值保留。
- `source_refs_v2`：解释字段、Go 填入的 updated_revision、非空 evidence_refs、可选 locator_quote；从 v1 真正更新时另保存完整 legacy_entry。以后更新沿用这个 legacy_entry，不递归包裹上一份 v2 条目。该名字表示来源格式，不宣称导入的归档已证明历史审稿行为。

evidence_refs 只允许 `formal_page {revision,text_sha256}` 与 `authority_fact {fact_id,as_of_revision,record_sha256}`。当前采用稿必须以 updated_revision 对应的页引用出现，不再另存一份可能漂移的 current hash。来源数组按完整类型／版本身份规范去重；不按文字相同或 fact ID 相同合并。

可选 locator_quote 第一期仅属于当前 adopted page，原字包含验证仍保留；不允许成为没有归属的任意旧页短句。字段缺失与 null 区分。

新条目保存 Go 解析的完整来源依赖：

- 当前采用稿的正式 revision、正文 hash；
- 累计沿用的旧页来源链，完整保存，不因本轮未发送而删除；
- 本次 review 实际引用的其他正式页；
- 实际引用的事实 ID、as-of revision 和规范完整记录 hash。

事实的 `source_revision` 不是完整记录版本。后续 known_by 变更不会改写原事件来源版本，所以不能仅用 fact ID／source_revision 声称已绑定某一事实记录。

候选内的 source ID 不直接入正式索引。Go 从已验证的审稿注册表解析成持久引用；只有 commit 将候选来源变成采用稿来源，revision/hash 由 Go 填入。失败提取、被拒审稿、未应用润色和取消操作都不写入。

累计存储的来源不等于本轮实际使用的来源。新条目完整保留旧 evidence_refs／legacy_entry；本轮明确选用的 ID 另保存在批准对象中，不能借累计链追认未提供的旧证据。新 facts 尚是候选，只能由 candidate 来源支持，不能登记为已存在的 authority_fact。

批准凭据必须绑定完整 canonical candidate、操作 pin，以及使用的证据注册表指纹。状态修复即使不改 passage，也必须重新形成独立 review 和批准；不能沿用上次正文 hash 对另一组摘要或知情边放行。

### 批准持久化与预生成交接

扩展现有 Go 私有 `NarrativeApproval`，不建立第二套批准服务。`Candidate.Review` 仍不属于模型 Candidate JSON；准备表的 approval 与正式 operation 的 narrative_approval 保存显式版本化 evidence 对象：

- origin：Go 生成的 operation／preparation 类型、原 ID、体验／分支／base revision／base fence、source_handle 和冻结配置／输入 pin；
- 完整 candidate 指纹及原 canonical candidate；
- 本次 review 的阶段、调用序号、实际请求层级的明确指纹和 registry 指纹；
- 自包含的 registry，以及可从 result.source_ids 与 registry 严格重算的逐记忆解析来源。

origin 从 Service／sourceReader 的可信操作取得，不从模型 Context、frame ID 字符串或模型提供的 fence 猜测。实际请求登记必须在材料选择、去重和容量检查之后；原始 Rust 入口不算最终材料。

预生成允许现有唯一合法交接：preparation ID／base_fence 生成，claimed request ID／base_fence+1 消费。保留原 origin 和 registry，消费时核对 checkPreparationClaim、原 pin、空 read 输入、当前 engine、lease 和完整候选；不能简单要求 origin ID 等于消费者，也不能覆写原 origin 冒充新生成。

准备 ready 的候选／批准一起持久化，commit 事务再次校当前操作或合法交接、解析来源和固定版本，再原子采用。批准 hash 是指纹，不是密码学签名；可信性来自 Go 私有构造与受约束 SQL 路径。正常操作 commit 前崩溃仍按现有策略中断，不新增自动重放；启动时准备失效规则保持。

每轮 review 开始清除上一轮批准、registry 和绑定。不能因为 state repair 保持 passage 原字不变就借用上次候选或证据表。

### 旧数据兼容

旧正式快照和旧归档不批量覆写。读取 v1 时保留原摘要、quote、页链和 fact_ids，并明确标记为 legacy 来源表示：

- 原有 revision/hash/quote 的来源匹配仍验证；
- 不声称 v1 曾记录过它没有记录的“审稿实际读过哪些材料”；
- 旧 fact_ids 不自动补成一个假定的历史 record hash；
- 在新正式提交中转换索引容器时，旧条目仍保留显式 legacy 标记和原有来源，不无依据宣告 v2 语义验收；
- 真正更新旧条目时，以本轮实际证据建立新的 v2 依赖，并保存旧来源链。

没有记忆索引的老档仍按原水位规则工作。新页被检查不表示历史空缺已经补齐。

## 3 按需读取与阶段装包

当前 `ReadSelector.pages`、source_handle、receipt、分页 cursor 和 scope 检查继续使用。单页超容量仍返回 `recall_item_capacity`，不偷偷生成摘要代替原页。

首次编译时可以登记已经在 history 中的正式页。显式 ReadRequest 后，登记同阶段续调真正收到的页；进入下一阶段时重新计算，不能照抄上一阶段的 “loaded”。

允许选择性重装同操作已验证 ReadReply 中的页或事实，形成显式 `evidence_pages`／事实投影，再重新计量当前请求。缓存必须保留原 source_handle、分支／base、receipt 和完整内容；它不允许包含仅为数据库内部来源校验而读取、从未经过该读取路径的页。重装不是新 ReadReply，不更改原 receipt、不退还已使用 read 次数，也不假装重新查询。不能把所有旧回复自动加入每个阶段。每次请求仍核当前 lease／fence；pin 失效则缓存不可用。

去重遵循以下顺序：

1. 核对原请求中的候选、来源 pin、已知事实全文与权限。
2. 选择本阶段必要材料；保留已有 required 保障。
3. 对同分支、同版本、同 hash、逐值相同的内容去重。元数据冲突或正文不同必须报错，不能择一覆盖。
4. 为最终实际内容分配目录 ID；核对所有发送给模型的引用均有真实目标。
5. 计量最终 system、schema、消息和目录的实际 UTF-8 字节，再运行现有容量检查。内存内去重不豁免 wire 容量。

required old memory 当前强制 source 粒度。新实现不能直接把它降为 locator，然后声称只是省字节。对 candidate 明确更新的旧记忆 ID，第一期保留旧索引及有界来源目录（完整链仍在存储），并将该条目最近更新的正式页列为本次审稿 required 证据：先使用 history 或已绑定缓存，缺失则在原预算内补读；仍缺失不得批准。这个最小锚点不代表摘要全部历史含义已经证实，涉及更早条件、承诺或认知时仍须补足相应依据。新 ID 累计旧条件也受独立语义审查约束，不能利用“新增”绕开旧来源。

缺失与超容量分开调度：首次 review 缺页时，编译器允许发送明确的 required 页 locator／缺口，让模型进入现有 ReadRequest 路径；此时 Go 禁止批准与写入。不能在 before 阶段直接失败，使模型没有补读机会。一次补读后仍缺必要页、已无合法补读预算，或已取得的完整页放不下时明确失败，不自动降成 locator 继续。

硬门槛在 review／repair_review 批准前执行，不追溯要求 extract 的输入包含它刚刚输出的旧 ID 所属页。repair_state 或重新 extract 改删条目后，从完整新 candidate 重新计算 required，不沿用上次缺口。r3／r80 两页各自及合计能容纳、但连续范围一次取不到时，归类为 selector／剩余读取预算的获取限制，不能误报为目标内容超容量；partial 回复不算所需集合已完成。

这一规则比仅保留旧 quote 的表示保障更强，须用实际容量及不连续多页案例检验其可用性；不能把它称为纯去重。它只针对候选实际更新的旧 ID，不把所有相关或 active 记忆设为 required。其他基于完整正式事实的判断可以直接使用这些事实，不强迫重读整页。原 ReadRequest.pages 只有连续范围，每阶段一次补读，cursor 不是无限续读许可。

本期不默认加载全部旧来源，不自动把数据库内部的来源校验查询转成未计量的模型材料读取，不累积所有旧 ReadReply。

## 4 Go 与 Rust 的职责

Go：

- 从固定 authority 和实际页形成索引投影与本阶段证据注册表；
- 校验原请求后去重、计量、记录最终 actual model_request；
- 校验 memory support ID 是否确实来自该 review 请求，保留批准绑定；
- 解析持久来源，提交时复核 operation／branch／base／fence，原子保存正式页、状态和索引；
- 在读取、分支、作者改写、归档导入中验证新旧来源。

Rust：

- 输出版本化候选和新 memory support 形状，拒绝混用新旧字段；
- 保留阶段顺序、原始请求授权、五草稿字段冻结、有限修复和补读预算；
- 对其可见来源检查结构与类型；Go 注入的实际材料引用由 Go 最终验证，不能把 Rust 的旧入口视图当成最终模型载荷；
- 同步替换 extract／repair_extract／repair_state／review／repair_review 的记忆语义，避免旧“quote必须充分”与新协议同时存在。

共享合同、四端快照、pins、Go／Rust 类型与验证、前端归档兼容同步修改。协议有判别版本；旧 engine 的批准不能被新 engine 当成新批准。

## 5 失效、归档和审计

作者修改某页时，所有直接或累计依赖该页的索引失效并回退水位；事实编辑仍保守失效相关派生索引，不能因新来源表而漏掉旧隐含依赖。父分支原历史保持可查，子分支不得借父分支 hash 冒充自己的来源。

归档已有 `ArchivePage {Page,State,Title,CreatedAt}`，因此能逐版本验证 fact 引用，无需新建一份原文存储。使用现有保留整数精度、排序对象键的 Go canonical JSON 规则；完整记录包括 known_by、kind、subject 和 reader 等可选字段，不只 hash text，不改数组顺序。

含 v2 记忆的导出使用 archive version 2，新 reader 同时读取 archive 1／2；旧归档原样保留。不能保持旧外层版本而宣称旧应用还能导入新语义。前端归档入口同步接受新格式。

归档导入逐项验证：

- 页来源属于该分支正确版本且全文 hash 一致；
- fact 来源在给定 as-of revision 存在，完整记录规范 hash 一致；
- locator 若存在，确为相应原文；
- legacy 标记没有伪装成新批准；新引用类型、版本、重复和越界均拒绝。

审计分开记录：来源匹配、当前实际发送、模型声明使用、语义审查结果、正式写入、后续取回、后续提交。不得将这七件事压成一个 “memory PASS”。

新的模型输入／输出审计同时保存原始记录及 Go 解析结果。旧 run 仍按原协议审计，不重写旧失败，也不通过新规则给旧记录追授批准。

作者 Repair 的现有 `ReviewCandidate` 是结构验证，不返回新叙事审稿凭据。因此第一期作者 Repair 候选禁止 `memory_delta`，包括空 delta；辅助作者修订的 schema 也不产生它。保留作者修订其他内容的功能和原失效规则，不静默丢弃传入 delta，不让空 delta 在无批准时推进水位。

普通 v2 生成的 Apply 必须使用 Go 验证的来源解析结果；缺凭据不得退回旧 quote 路径。归档普通页读取已保存 State 并验证依赖，不调用模型、不追授 live 批准；作者 Repair 的归档回放同样不接受未经批准的新 delta。不得增加 `skip_review` 或根据调用者字符串猜测“可信归档”的后门。

## 6 需要先通过的工程与语义验证

工程测试使用固定内容，明确只证明协议、来源和预算：

- 新旧候选互斥；v1 原样往返；v2 旧条目转换保留来源，不造历史审稿证据。
- 新候选来源未提交前不是正式页；失败／取消／stale fence 无写入；采用稿 hash 绑定修订后的正文。
- 登记但未实际发送的来源、跨阶段旧 ID、另一候选／分支／版本 ID、伪造 hash 一律拒绝。
- 相同正文但不同 candidate state 不能复用批准。
- 相同 quote 对应多个 facts／known_by 边时不合并权限；actor 输入不出现作者目录或摘要。
- 旧来源链和额外历史页／fact 依赖经过存储、读取、分支、失效、归档均可验证。
- 当前正文与同一历史页只发送一份；字段冲突先拒绝再去重；目录开销纳入最终计量；required 仍放不下则失败。
- 读取次数、调用保留、一次修复及最终 bytes 的边界不增加。

以下反例必须独立进行语义验证，机械引用合法不能替代：

1. 同页前段共同坐下、尾段递菜继续吃饭，摘要可以同时记载；不强迫复制中间大段无关文字作为单连续 quote。
2. 旧约定“晚归发消息，不限回家时间”，本页“收到消息”。缺旧条件时不得推成限制回家时间，必须取得旧条件依据。
3. “今天暂不接活”不能记成一贯厌恶工作。
4. 旧来源的借伞条件加本页归还，可累计总结；当前页不必重演借伞史。
5. 计划想借 1000 元、正文只点头，不能靠计划或 context 补演答应借钱。
6. 正文有休息和返回厨房时，可以审摘要是否准确；原 locator 只摘摇扇不再自动构成状态错误，但未见这些经历的角色仍不能获得知情。
7. 保留 NAR-017 S01 原摘要与全文：新审查应判断交接／检查／归架是否有真实依据，不能为了保住短 locator 被迫删去有用经历。

随后冻结新源码，按原题、原授权与原预算运行真实模型。报告正式完成率、实际修复原因、来源链和内容质量，也报告延迟及输入／输出量。没有配对重复实验时不把运行差异单独归因于接口改造；工程通过不等于整套 benchmark 或文学质量通过。

## 实现前尚须关闭的具体设计检查

- 核对作者 Repair／非叙事 Apply／归档恢复等入口，确保没有绕过 v2 批准而将模型来源变为权威的路径。
- 当前 `RecordModel` 记录的是 Go 重组的 protobuf stage 请求，之后 `modelCallWithAuthor` 还会附加作者世界消息。实施时明确绑定 stage 与最终 model.Request 两层，不能将前者 hash 冒称完整 provider 请求，也不能把作者附加材料自动登记成已批准记忆来源。
- required 旧条目的 source 保障须转成明确的必要来源规则和负控；不能仅以“模型会自己补读”取代现有强制材料。
- 实测 source 目录和新 schema 在现有最小容量载体中的字节，不以“少复制quote所以一定放得下”代替检查。

这些检查由只读接口映射和独立反审完成后写入实施计划；当前没有待用户提供的业务偏好或凭据。
