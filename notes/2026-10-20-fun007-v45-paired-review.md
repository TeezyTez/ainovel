# FUN-001/07 v4.4/v4.5 首审稿配对：独立 model_review

作者：benchmark_harness 独立 agent，method=`model_review`。这是对封存结果的模型辅助审读，不是真人盲评，也不宣称完整 FUN 轨迹通过。

实验目录 `.validation/stage-pair/20261020T033835Z-v45/pair` 已逐行独立重算事件 hash、前序链及终结 root：`bfa7dea6e70e3555c2993557d910ae5cb40eae9fb6a8fc3a1833a1fce3446911`。终结状态 `COMPLETED_REVIEW_PAIR`。实际两条 model_request 独立比较：model/schema/max_output_tokens 和全部 user 原字一致，唯一差异为 system 内容；顺序固定 old→new，各一次，没有错误、重试或后续修订。

原正式来源 root 仍为 `d9d249b6ac607519a3e4342d2d7903cc1057615cbc791cab29039db0a7a88f58`，正式只到 06/revision 7；07 首稿是失败候选。本次不改变这些字节和正式历史。

| 配对臂 | 原事件 | 审稿结果 | issues 原句 |
|---|---|---|---|
| old v4.4 | seq 5 | approved=false，1 issue | `actor_action_not_addressed`：“actors明确要求调查者出示签字登记并依法尝试开筒查验；正文却未呈现出示、尝试或受阻过程，仅将查验留待下一步。虽符合selected_plan，却未承接本轮已给定的行动，应解决两者冲突，不能无说明地跳过尝试。” |
| new v4.5 | seq 7 | approved=false，1 issue | `unsupported_character_knowledge`：“主管此前不在yu-denial-r4的known_by中，既有问询为分别进行。正文未描写调查者转述或主管查阅口述记录，却让主管准确引用余的原否认及其确认时段；主管对该事实的新增知情缺少获取过程，不能用其自行说出内容作为来源。” |

旧臂仍把 actors 的计划提议称为“本轮已给定的行动”，即使承认首稿符合 selected_plan，也要求开筒或尝试开筒。这与玩家本步“调柜旁走廊记录，核对余是否真的一直待在办公室”及当前 selected_plan 留待下一步的范围冲突。已有主管许可并不等于玩家在此步选择执行。

新臂没有要求实现开筒提议，且保留了真实的主管知情来源缺口。两个结果均拒绝首稿，因而本次修复迹象并不是放松审稿至 approved=true。两臂精确引用诊断均为 0 mismatch，结构检查结果均为 `narrative_review_rejected`，符合它们的拒绝内容。

这一次配对支持“v4.5 在同一失败材料上没有把 actor 提议升级成玩家命令”的局部观察。固定顺序、单次随机模型输出不提供普遍因果或稳定率证据；新版本完整 FUN-001 轨迹、合法知情传递以及后续开筒授权仍需独立真实运行。没有据此给 H 项、全文质量或 case 标 PASS。
