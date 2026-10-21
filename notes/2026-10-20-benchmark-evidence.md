# 基准证据核验修复

本轮改动仅增强本地执行证据核验，不判定叙事质量，不替代真人盲评、留出题或真机测试。

## 原题来源

本次上传的 `ElseLife_深度测试基准_2026-10-19.md` 与 `tests/benchmark/source.md` 原始字节 SHA-256 相同：`37a6ff7987fbc6ebacfadea70f6e8cdffc2abf0d2cfdb2ed1d2d3d729fd679d6`。登记仍保留 78 主例与 13 个 UI 子例，未改动题目与覆盖分母。

## 发现及修复

- `operation_request` 原本只检查题目模式是否可调用产品，没有核对实际请求。现在逐字检查实际 `input`、`mode`、`reading_request`，保留 `read/continue → read` 与 `player → act` 的既有映射。
- 单独对比 ask 的 before/after 原本可被两个一起偏移的快照绕过。现在 before 必须连接上一个独立领域快照；恢复运行连接原正式前缀末快照。模型请求与响应必须属于正在执行、尚未结算的产品操作。
- 恢复原本只检查原事件哈希链和提取出的页列表，未重新检查原操作/模型配对，也未检查连续版本与历史页被改写。现在原证据再次通过完整 native 核验，再检查正式页与对应请求及所有此前页；原运行的 FAIL、模型调用与检查结果保存在独立 `resume_source` 报告中。
- 缺少 `restored_step` 原本仍可能得到 VERIFIED，恢复步骤也可能被后续观察/阻塞改标或再次执行。现在缺标记保持 INCOMPLETE，重执行与改标直接拒绝。RESTORED 不计作本轮模型生成或 PASS。
- v2 的 `fixture.json` 必须存在，其原字节哈希必须与 manifest 一致，解析对象也必须等于实际登记 fixture。恢复 v2 源使用 `source-fixture.json`，无原字节的 v1 明标 `LEGACY_NOT_RECORDED`。
- 配合 Go v2 的 `resume_readback`，核对全部恢复正文、版本、逐页领域快照与原正式前缀一致；v2 缺读回保持 INCOMPLETE。v1 没有此证据，明确标 `LEGACY_NOT_RECORDED`，不追认全页读回。缺少完整祖先附件的嵌套恢复明确拒绝。

## 验证

使用合成事件的负例先重现缺陷：第一组 17 个失败子断言，第二组 6 个失败子断言；随后修复。它们只测试核验工具，合成回答不用于产品验收。

- 初始 `python3 -m unittest discover -s tests -p 'test_benchmark_*.py'`：19 项通过。
- 修改后 `python3 -m unittest discover -s tests -p 'test_*.py'`：44 项通过，16.300 秒，退出 0。通过 WSL 在仓库根目录执行。
- 用更新后的核验器读 `.validation/deep-benchmark/20261019T092722Z`：SYS-001 与 NAR-009 仍为 VERIFIED / FAIL，未改写原事件、根或成绩。
- 核验仍在进行的 `.validation/deep-benchmark/20261020T021825Z-resume` 时，完整原来源可复核，本轮尚未封存/尚有未配对调用的部分保持 INCOMPLETE / INCONCLUSIVE；这是运行中状态，最终结果以收尾证据为准。

文件变更：`tools/benchmark/native.py`、`tests/test_benchmark_native.py`。本地哈希与记录可以检查一致性，不能提供外部公证，也不能证明审查者判断正确。
