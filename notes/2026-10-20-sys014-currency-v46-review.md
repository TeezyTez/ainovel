# SYS-014 S05 独立币制补充实验审查

本次补充样本的汇率方向、算术、单位和只读边界符合预登记条件：2 枚岚币按 3 贝币 : 1 岚币换算为 6 枚贝币。真实 answer 与 review 共 2 次模型调用，正式提交独立币制世界 revision 2；没有执行兑换、生成余额或改变原 SYS-014 世界。此结论仅适用于该补充样本，不回填原 S05，不给整例 PASS。

审查对象：`.validation/deep-benchmark/20261020T041218Z-v46-reading-resume/supplements/SYS-014-currency`。按要求只读核验封口证据，仅新增本说明；没有重编译、模型调用或修改源事件、fixture、coverage。

## 独立执行核验

先读取 `python3 -B tools/benchmark/supplement.py verify-currency --help`，再执行：

```text
python3 -B tools/benchmark/supplement.py verify-currency \
  --run .validation/deep-benchmark/20261020T041218Z-v46-reading-resume/supplements/SYS-014-currency \
  --catalog tests/benchmark/catalog.json
```

退出 0。结果为 `integrity=VERIFIED`、`status=REVIEW`、`model_calls=2`、`answer_event_seq=11`；原来源 `S05=BLOCKED`、`source_status=REVIEW`。自动核验器有意保留 `arithmetic_semantics=REVIEW`，没有用数字匹配替代下面的原文审查。

补充流共 14 个连续事件，顺序为 manifest、原世界读回、币制初始读回、ask 请求、answer 请求/结果/阶段、review 请求/结果/阶段、正式提交、原世界再次读回、原来源文件读回、supplement_end。哈希链与根封口一致；没有第三次调用、修订或操作重试。

| 身份 | 值 |
|---|---|
| 补充事件根 | `9e212a034fd2dde734d888578229c70276450775fbdea393494b06df5a897aa4` |
| 补充 events.jsonl SHA-256 | `f21773a5f243e4bd7459e5950fadcd6adf58e85d41d8ba1796749c364da5cf33` |
| 原 SYS-014 根 | `d5d84fc7da380d8043862987fa28f9cb752ede97524d66f1f05ddc0095a5abf9` |
| 原 events.jsonl SHA-256 | `0a88d7bc33f80f743fd12dbb4e51b9fdf7f6283bcf6b966fa77a69ed2e8150a1` |
| 本次冻结源清单标识 | `6b0a53bb6f4d5682876f4bd57b06af7d7f3316e807fc3e7725031523ebadadde` |
| 本次冷构建 Rust SHA-256 | `ecd35f6c08a2ba14934a8c0682a4af966ccaa725b7b324771dc57c2d3e5a2b2d` |
| 本次 Go 测试程序 SHA-256 | `1fcc3ac2ff44ea586a4d96b1acbb7f956905a630832f9248ce4e52c6ba5af1c0` |

这是本次真实运行的冷构建二进制；没有把此前全后端回归使用的 `518b3e3…` runtime 冒充本次运行身份。补充目录 runtime 实际文件哈希、manifest、父目录 binaries.sha256 和 process 日志一致。

## 完整回答与算术判断

预登记事实和正式 revision 1 原文：

> 本世界使用贝币和岚币，固定汇率为3枚贝币兑换1枚岚币。

实际输入（seq 4 operation_request、seq 5 模型 user input、正式 revision 2 input 一致）：

> 按这里的固定汇率，2枚岚币可以兑换多少枚贝币？

完整正式回答（seq 11，`data.readback.history.public_view.pages[1].text`）：

> 按固定汇率，1枚岚币兑换3枚贝币，因此2枚岚币可以兑换6枚贝币。

回答先正确重述 1 岚币对应 3 贝币，再将所问的 2 岚币乘以每岚币 3 贝币；结果单位为贝币。它没有倒置方向、把比例误当 3 岚币换 1 贝币，或附加手续费、折扣、余额、实际成交。措辞是“可以兑换”的规则解释，没有写成“已经兑换/收款”。因此本次原文的算术语义成立，不只是正文里出现数字 6。

seq 6 的原始 answer result passage 与上述全文相同。seq 8 review 所审 Candidate 与正式页的 passage/story_time/outcome/suggestions 逐字段绑定，seq 9 为 `approved=true`、`issues=[]`、各支持数组为空；核验器还将 Candidate 绑定回实际 answer 原结果。review 自报批准不单独作为通过依据。

seq 5 的真实模型 user 材料仅含标准 ask 上下文、两种公开币种、一条固定汇率事实、原始问题和 revision 1 开场。没有预置答案 6、参考计算表、评分、原 SYS-014 生活事实或 S05 harness 文本。预登记 JSON 仅有 version/currencies/rule/input；币制 fixture 只有两个实体、一条规则、空 threads，未初始化现金或交易。

## 独立世界、历史和零经济变化

币制世界由评估方建立最小合成 revision 1，然后才经真实 Go/Rust/CLI ask 生成 revision 2。seq 3 初始 State 与 seq 11 的 revision 1、revision 2 全量 State 相等，包含故事时刻“商港开市时”、全部实体、事实、known/known_by/source_revision 和 threads。仍只有两个币种实体及一条汇率规则，未新增余额、持有量、付款、兑换或物权事实。偏好前后相等，初始正式页原字保留；新增问答页、展示标题和操作元数据属于正式记录变化，不是经济事件。

原世界以封存 SYS-014 的 4 页及对应快照恢复到另一独立测试数据库，未连接原运行数据库或用户数据库。角色/隔离键分别为 `original-restored` 和 `currency-positive-control`；两库可复用 experience/branch 名称，因此没有靠名字不同冒充物理隔离。实际 evaluator 调用两次 testService，并检查两个 DSN 不同，证据不暴露 DSN。该隔离结论仍是冻结执行器及其读回提供的证据，不是外部公证。

核验器把原世界全部 `stored_pages` 与四版 `snapshots` 绑定回来源事件，逐版核对。另独立比较 seq 2 与 seq 12 的完整读回对象，精确相等，包含公共 View、分支、所有历史页/快照、偏好、存储标题和标题绑定；不是只看最新 revision 或摘要。

标题结果为 `VERIFIED_COMMITTED_INITIAL_LEGACY_UNRECORDED`：原来源 revision 1 未记录当时标题，恢复用明确标记的“合成世界初始记录”，不能声称该初始标题获得原来源验证。revision 2–4 标题分别为“目前已知的个人情况”“先拿去用”“搬过门槛”，已按源正式提交绑定；这个旧证据限制没有被补写抹除。

seq 13 原来源文件读回为 unchanged=true。审查又直接对磁盘上的旧目录 `.validation/deep-benchmark/20261020T031340Z-reading-editorial/SYS-014` 与补充目录 `source-*` 副本计算哈希：events.jsonl、root.sha256、fixture.json 三份均逐字节一致。源构建清单副本与旧父目录清单一致；current-build-manifest.json 与新父目录 source-manifest.json、source-manifest-after-build.json 两份均逐字节一致。独立核验器检查原 SYS-014 S05 仍为 BLOCKED。

## 时长与结论范围

seq 11 记录单个 ask operation `elapsed_ms=18218`；父目录 currency-process.log 记录整个隔离实验 22.94s。前者含 answer/review 生成与操作完成，并非两个模型单独耗时的求和指标；后者还含初始化等实验开销，不作生产延迟成绩。

本次新增证据支持：另一新世界正式定义两币 3:1 后，真实 ask 能正确解释 2 岚币为 6 贝币，保持领域与原世界不变。原运行的 S05 仍为 BLOCKED；补充证据单独绑定 S05，不替换旧结果。不能据此宣布 SYS-014 全例、界面排序、无来源数值边界、其他汇率或完整体验评价均通过。
