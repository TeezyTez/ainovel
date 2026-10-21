# NAR-001 v4.4 再次引用失败与 CLI 输入层审查

2026-10-20，独立只读核验；没有修改封存候选或审核结果，没有调用新模型。本页在受控新实验前记录已知事实，不预判修复效果。

原失败：`.validation/deep-benchmark/20261020T025916Z-countercontrol-v44/NAR-001/`，根 `cb07a80a250451bca050b535d214e932ceecbcfc6d25cb6e3036e0decc4286f9`，events SHA-256 `493dcf87a60b47be70a8850ff024ba89c3d1103076161d882e208f308757d0ec`。链序号/前哈希/末根独立核验一致。S01 seq31报narrative_evidence_missing，205198 ms/9 calls，末项run_end=FAIL，未提交新页。

## 冻结候选与失败归类

- seq23 extract.result.candidate_json解码后的完整候选，等于seq25原review请求candidate，也等于seq28 repair_review请求candidate；两次user content逐字一致。不是重审时换正文。
- 两次请求均恰好 `[system, user]`，剥离system后只有一个user，确实命中root正在修的单user桥接路径；没有AuthorWorld或多段对话。
- 原候选passage SHA-256 `753b85eed244e788d5d50e39296dc4e44469dcb6dcdb82a3f46b66b05f35fd76`，包含4个真实LF，没有字面反斜杠n。
- seq26 review与seq29 repair_review均approved=true、issues=[]，5个fact支持和15个knowledge支持的ID覆盖完整、唯一、合法；无reveal，且所有quote非空。
- 两次均恰好3个fact支持不在正文中：`r2-yu-inspection`、`r2-yu-assessment`、`r2-north-departure-cancelled`。每个错误quote含2个字面反斜杠n、0个真实LF；其他支持均逐字匹配。把这两处转义改成LF会与正文相符，只用于定位差异，**不是允许产品归一化quote的方案**。

因此既有严格拒绝正确；唯一repair预算已用尽后仍失败也正确。进一步放宽精确子串校验或再循环审稿会改变基准含义。

## 已证实的桥接行为与最小修复

原`backend/internal/capability/model/codex_cli.go`先收到已经JSON序列化的user.content，再`json.Marshal(conversation)`，最后把“Conversation messages in JSON...”与该数组直接写给CLI stdin。CLI收到的不是原API消息内容，而是包了一层JSON转义的字符串。该路径由代码确定，封存请求可重建；单user正文数据为13347 UTF-8字节，外层messages JSON为14371字节（不含前置说明）。**二次序列化的存在已证实；它对模型这次错误的因果贡献仍需新的固定候选实验核验。** 序列化本身没有破坏JSON可逆性，问题是把两层编码文本交给模型理解。

root的新方案只在conversation恰有一个user时将其Content逐字写入stdin。system继续独立instructions文件；多消息或单assistant仍保留角色/顺序封套。没有修改候选协议、prompt正文、quote判定、模型输出或repair预算，也没有新增passage副本/增加容量overhead。单user传输字节减少，原Request预算计算对该路径不会因本改动更宽松。

独立审阅`codex_prompt_encoding_test.go`确认测试启动真实fake CLI子进程并读回stdin，验证actual LF、literal反斜杠n、引号与伪system文本逐字保留；多消息仍按原角色顺序解码。没有发现将正文提升为system或将recorded候选替换的通路。范围限制：多user/AuthorWorld仍走原外层JSON路径，不能泛称所有入口的引用问题已经解决。

下一次受控实验应只重发原seq25 request一次，保留候选/schema/system不变，不提交世界状态。即使该审核逐字通过，也只支持该固定输入的传输修复效果，不把原失败run改写为成功，不等于完整NAR-001或跨例文学验收。

只读复核脚本：`.validation/nar001-v44-wire-review.py`、`nar001-v44-bound-review-input.py`。

## 后续单次受控实验的独立复核

实验 `.validation/quote-bridge/20261020T031240Z-original-review/` 已封存，根 `bd16cb7daf40b3547b5a73be056edae86ed11c61e95980933991063d79fd08dd`，events SHA-256 `8e3cfbad7d0d1067a37e48c2db1b2881c66b3d3a5f8e8c27e125d48e084802a5`，冻结源树 `de298b7ad7c87d4ada39d647e0c160b4742459195d461fbe40fe93e3c312d30d`。独立脚本完整核验了新事件链和复制的source-events与原失败文件逐字相等。

新model_request全部已序列化字段与原seq25相等，包括system/user全文、schema、model和max_output_tokens；候选仍为上列SHA。仅原本不序列化的ContextTokenLimit恢复为原声明65536，没有改审稿内容或扩大调用。唯一模型调用耗时32202 ms，返回5个fact支持、15个knowledge支持，全部ID覆盖完整、唯一、合法，全部quote为原正文精确连续子串。其中**3条quote确实含真实LF，0条含字面反斜杠n**，并非单纯改用段内短句避开问题。Go独立批准验证也通过，末项明确为STRUCTURAL_APPROVAL_ONLY，没有数据库/Service或世界提交。

这为该固定输入上的桥接修复提供了实测支持；一次随机生成结果不能证明所有模型/所有请求均已消除转义错误。原NAR-001失败仍是FAIL，不回写结果，也不把受控审稿当完整S01或文学验收。

进一步只读审查未发现单user直送新增的权限或角色顺序错误：实际Role=system的消息才进入独立trusted instructions文件；正文中的伪role/system文本仍在user content中，未解析为新指令角色；多消息路径保留原角色和顺序。既有context预算、输出schema、工具禁用、错误清洗与候选批准约束未因直送放宽。多user路径仍保持旧外层编码，列为本次范围限制，未在没有证据时声称其已经出现新的语义损坏。

独立复核脚本 `.validation/quote-bridge-independent-pipeline-review.py`，只读日志，不调用模型、不修改结果。
