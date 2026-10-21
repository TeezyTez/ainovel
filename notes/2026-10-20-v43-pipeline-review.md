# v4.3 流水线独立代码审查

审查范围：`generation_view.go` 的 ReadingRequest 证据保留、Go/Rust narrative pipeline、容量边界与同操作回取、deep benchmark v2 恢复记录。对照 AGENTS 和上传叙事改造方案，生产目录只读；本轮仅增加审读笔记和 `.validation` 复现脚本，没有重新启动真实模型。

未发现新的可证实生产提交/知识越权/第二次修复绕行缺陷。这是有限定点审查结论，不是安全证明或文学验收：reader 先投影再选取；Go 保留完整 AuthorityState 并最终 Apply；当前回取只合并 base revision，旧快照留在历史；actor 的实际模型输入由 Go 按已物化且 known_by 可见事实重建，不传全局笔记；Go/Rust 共享一次 revise/repair 预算，冻结 draft，修复后仍独立 review，语义引用与知识校验不走结构修复。容量不足保持失败，不以删除权威事实或回退旧流程取巧。

发现并交给对应维护者的三个证据缺陷（均 P2，记录的是修复前位置）：

1. `tools/benchmark/native.py:212` 的普通 operation_committed 分支未验证 public_view 连续追加与旧页不可改，也未核对 expected_revision。删除 view、返回旧 revision1、重写旧页、expected_revision=999 均被接受为 integrity VERIFIED / step REVIEW；移除全部 model_request/result 也仍被接受为 0 calls。后者应结合 v2 的 cold-path preparation-disabled 声明约束，不能误伤真实准备命中。复现：`.validation/pipeline-native-review-20261020T0243.py`。已交 benchmark_harness，未并行修改。
2. `deep_benchmark_live_test.go:223` 恢复时从最新 View 仅改 revision/pages 构造 initial_readback，Reader/Information/Branches 混入末版。真实 `023303Z-nar009-v43-resume` 中这三个字段均等于恢复 r7，且不同于源 r1；交 root 修复。旧记录不覆盖。独立 resume_readback 的全部七页和七快照已另与原源逐项核对相等，见 v4.3 NAR-009 审读。
3. `deep_benchmark_resume_test.go:140` 与 `native.py:70` 仅将初始 snapshot 与 fixture.state 比较，没核对首段 mode/input/text 与 begin/seed/opening。将初始及后续历史中的首段 text、input 或 mode 一致改错，恢复校验仍报告 VERIFIED、resume_readback VERIFIED、RESTORED。复现：`.validation/pipeline-initial-review-20261020T0248.py`；已分别交 root 与 benchmark_harness。

这些复现重封合成记录以测试结构校验，未篡改留存真实证据。验证器从未因此输出整体文学 PASS；缺陷在于记录完整性标签超出了已独立检查的范围。后续修复应有否定回归，并保留旧记录边界。

前一轮实际 Rust/Go 结构回归已通过：最新 `.validation/pipeline-stream-full-go-20261020T023144Z.jsonl` 为 348 pass、3 个预期 helper skip、0 fail；包含同操作回取 omitted fact 后 plan/review/Apply 的真实 Rust 传输、唯一结构修复及 helper 失败 stderr/流式二进制复制。固定模型只用于结构和边界，不提供叙事质量结论。生产事实/知识的语义正确性仍需正式正文审读；v4.3 NAR-009 差异见 `2026-10-20-nar009-v43-model-review.md`。
