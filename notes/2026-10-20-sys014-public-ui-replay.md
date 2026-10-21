# SYS-014 S02 公开资料浏览器回放独立复核（2026-10-20）

结论：`.validation/sys014-ui-20261020/check5.evidence.json` 的 18 项公开原文呈现断言有来源和浏览器证据支撑。此处是已封存正式内容的只读 UI 回放，没有数据库或模型；不能将原真实运行的 S03 BLOCKED 改写为整步 PASS，也不能据此验收数值空值排序、混合资源计量或 S05 两币种汇率正控制。

来源绑定：真实运行 `.validation/deep-benchmark/20261020T031340Z-reading-editorial/SYS-014/events.jsonl` 共 60 事件，逐行序号、previous_sha256、末行 run_end 与根已独立复算。根为 `d5d84fc7da380d8043862987fa28f9cb752ede97524d66f1f05ddc0095a5abf9`，events SHA-256 为 `0a88d7bc33f80f743fd12dbb4e51b9fdf7f6283bcf6b966fa77a69ed2e8150a1`。回放唯一数据来自 S02 operation_committed seq34 的 public_view：r3、3 页；public-view.json 与该对象逐项相等，文件 SHA-256 为 `890345b0aa1ddacdfa08fca08b548e9963f2076f744607c9f7f897c17a418fca`。这不是之后 S04 的 r4。

构建来源：`.validation/build-sys014-ui.sh` 执行 Flutter release web、--no-pub、--no-web-resources-cdn；build.log 记录成功（82.9s，含非阻断 wasm dry-run 警告）。source-before.json / source-after.json 字节一致，均绑定 frontend 的 pubspec*、lib、assets、contracts、web 共 167 文件，SHA-256 `c862d0fb82c22a132c625f971b1223c063e7423ab9ea07b6857f34713815ee39`；本次复核时 167 项与现文件均一致。main.dart.js 实算 SHA-256 `d4eb0d2c96a1606dbf9e0b3a255c878a2dc1237af8490025ed98638d72dad255`，匹配 binary.sha256。构建产物与原模型运行来源分别记录，未声称同一编译时点。

Chrome 155.0.8059.84、1440×1000，check5 成功，无 pageerror。卡片 / 表格 / 文字摘要 × 名称正序 / 倒序 × 以下三条原文共 18 个唯一断言；每项均保留 aria 文本，正序另有截图：
- 零值：店铺现有灯油为0瓶。
- 未知：玩家不知道家中地下储水池的储水量，尚无已记录的测量结果。
- 不适用：这里是日常海边社区，没有等级、金币、魔法或量化关系系统；信誉等级在这个世界不适用。

每种形式与方向先恢复 15 条混合已知记录，再逐项搜索至 1 条记录，等待可访问树出现完整原文。脚本操作并记录名称倒序开关，未比较 15 项的完整排序序列；卡片/摘要有可视窗口限制。因此准确结论是“排序切换后原文仍可查阅”，不是任意排序算法已验证。表格截图可见对象名，较宽的“已知情况”列可能位于水平滚动区域；aria 含完整文本不等于所有列在一屏内可见。

check5 前后 current_view_sha256 均为上述公开视图哈希；mutation_requests=[]。requests.jsonl 独立检查的 67 条 API 请求全部为 GET，未触发 act/read/编辑/模型。回放服务器本身也拒绝 POST/PUT/PATCH/DELETE；这个安全兜底不能代替本次确实观察到 0 mutation 的记录。check5.evidence.json SHA-256：`793e2de89a57c2b81cb3295201de868a23bea97ed9afb4204187b48964786eeb`。

check1–4 均保留为失败，不删除、不折算成成功。证据直接支持的原因如下：
- check：3 项后 mixed 的“15 条”断言失败；失败 aria 仍为“信誉等级”搜索、1 条记录。
- check2：首条灯油断言过早失败；aria 搜索栏已有灯油，但列表仍是 15 条原混合资料。
- check3：page.waitForFunction 30s 超时；失败 aria 已含灯油原文和 1 条记录，等待条件未完成，不能据此认定产品丢失原文。
- check4：3 项后等待“15 条”超时；aria 仍有信誉等级筛选。check5 改为真实键盘全选/退格清空并等待计数及 aria 更新后完成；这些失败反映自动化清空/同步问题的证据，不用后来的成功抹去。

独立复算脚本：`.validation/sys014-ui-independent-audit.cjs`。复核只读取封存数据、脚本、manifest、aria 和截图，未重跑模型，也未修改源事件或产品源码。
