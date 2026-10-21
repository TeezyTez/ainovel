# 逐字 fixture 与正式历史核验补强

执行者：`/root/benchmark_harness`；2026-10-20。本文记录评估器适配和机制回归，不是叙事通过声明。原题仍为 `tests/benchmark/source.md`，SHA-256 `37a6ff7987fbc6ebacfadea70f6e8cdffc2abf0d2cfdb2ed1d2d3d729fd679d6`；未更改原题、catalog 或覆盖分母。原题内容、期望答案、评分标准没有整包交给模型。

## 新增逐字路线

`backend/internal/experience/testdata/deep_benchmark/SYS-005.json` 对应原文 1098 行。只初始化 14:00 的茶铺、6 枚现金、每个完整小时扣 1 枚、店员普通售茶职责，以及签名/借贷/搬家由玩家决定的世界规则。15:20 来访和 16:00 熟客是未发生的安排，不是预先提交的事件；固定安静区间是题目明确要求的精确停点世界。没有把“必须停在 15:20、最后 5 枚”作为结果注入状态；委托和停止条件仍由逐字 S01 正式输入表达。

可执行 S01/S03/S04/S05，S02 为独立状态与历史观察。S06 缺技术恢复和取消未提交候选的控制绑定，保持 BLOCKED。S07 明确 `requires_steps: [S06]`，不会用一次普通快照冒充取消候选未发布的证据。移除访客/改为 15:00 上限变体尚未接入。

`SYS-006.json` 对应原文 1256 行。只初始化霜月 10 日、最后见面霜月 2 日、林澈实际离城霜月 6 日、信使当天携信到场以及霜月 12 日尚未执行的寄件计划。离城日期与信件内容在初态是隐藏事实，读者投影不可见；S02 必须真实接信阅读才可形成新知。初态没有公历年份。S01–S03 与明确授权等待的 S06 可独立运行；S04 的客户端钟偏移/真正离线恢复、S07 旧节点分支及折叠原文展开缺绑定。S05 的 `requires_steps: [S04]` 防止未经离线恢复就运行“回来后”的假恢复情境。没有把原题要求的 72 小时离线操作变成故事内时间经过。

初始化记录仍是合成前史，不是模型生成的正文。两个 fixture 每一步 ID、mode、input 均逐字绑定 catalog；新增元数据只约束评估器执行，不改变原题依赖或输入含义。

## FUN-001 审查与保守门禁

原 fixture 的隐藏真相、个人权限片、可靠机械时钟、连续影像和最短路程、余的误导说法、主管的批准规则均为原题明确的世界数据，不是待生成的答案。发现的主要适配缺陷是步骤 10 输入“按主管允许的方式查验文件筒。”预设实际许可；原适配器只在 omissions 中说明条件，仍会在第 09 步申请后无条件发出第 10 步。条件注释不能成为已批准的证据。

额外真实性审查：原题 11874 行明确的是失窃发生于 20:42，没有指定玩家开始调查为 20:50；旧 fixture 的 `story_time: 当晚20:50` 是未经说明的作者选择。此外，玩家初始材料没有公开余的防潮文件筒，旧 fixture 却将 tube entity 标成 known=true。两者未直接公开犯人与藏物真相，但不能当作原题已给的玩家知识或时刻。root 已授权在当前源码冻结完成后，把当前时间改为未指定精确钟点的“当晚”、tube 初态设为未知；失窃 20:42 的固定事实保持。当前冻结的 SYS005/006 运行不受此后修改影响。

现第 10 步有 `requires_steps: [09]` 及 `evidence_gate: search-approval`，第 11–13 步依赖第 10 步。`deepStepBlockedReason` 只接受实际完成集，unsupported harness 不加入；恢复的正式已提交步骤可加入。当前任何 evidence gate 都保持关闭并记录具体原因。未伪造批准事实，未通过改写玩家输入跳过许可。Go 恢复来源解析和 Python 独立核验同样拒绝门禁被绕过的正式操作。

后续外部决策已实现消费入口：先运行至 09，独立读取正式正文和同版本权威快照；由独立评估者判断是否真的批准了具体查验方式。`ELSELIFE_DEEP_GATE_DECISIONS` 指向决策目录，`CASE-STEP.json` 保存来源事件根、case/step/gate、`allow` 或 `deny`、确切正文/快照字段引用、评估者及 `method: model_review`。Go 仅在恢复运行验证原始来源事件字节、链根和 fixture，并要求至少一对正文与快照引用来自同一已提交前置步骤；将决策原字节保存为 `gate-STEP.json`，在新事件链绑定其哈希和完整对象。Python 独立重算字节哈希、来源及引用后才允许 `allow` 放行，`deny` 继续阻塞。JSON pointer 只能解析到原快照文本字段，空/虚构引用或错源均拒绝。未创建任何真实批准记录；首轮仍默认停在门禁前。引用存在性与来源绑定只能证明评估依据，不能让模型评审变成人审或整题 PASS，也不能代替判断具体许可语义。单层恢复限制仍在。

## 独立历史证据漏洞与修复

另一 agent 的负控制暴露普通 native 轨迹只更新 snapshot，而连续历史验证仅在恢复来源 `replay_pages` 内发生。实际重封合成流后，下列 5 项原先都被接受：删除 `public_view`、提交视图退回 revision 1、改写已有初页、请求 `expected_revision=999`、删除所有模型调用。回归先红后绿。

现在普通运行与恢复来源共用逐页验证：初页必须是 fixture 指定的 begin/seed/opening/revision 1；每次提交必须恰好追加一页，旧页完全相同；请求 expected_revision、mode/input 必须对应追加页；当前冷路径提交必须有实际模型调用，若记录 `model_calls` 则与请求事件数量一致；观察的 snapshot、revision 和全部 pages 须与最近独立记录相同。未由工具自动裁定正文与状态的语义一致性。

另复现“初页与后续历史中的初页一起替换”的漏洞：因为前后仍一致，原恢复解析会接受替换 text/input/mode/revision。Go 解码与 Python 初页身份绑定均已补强，保留负控制。Go 新策略字段使用 `omitempty`，未配置策略的旧 fixture JSON 形状不变；未修改 v1/v2 既有证据字节。

独立评估器仍不是外部公证：掌握整个证据目录的人能重写整条链与根，必须由独立方保留冻结根。结构记录不证明文学效果。

## 本轮验证

- WSL `python3 -m unittest discover -s tests -p 'test_*.py' -q`：59 tests，13.759 秒，全部通过；随后 observation 模式负控制又复现普通 act 可伪装观察，补充 `mode == observe` 拒绝及快照/历史不匹配负控制。
- 完成 observation 补强后 60 tests 全绿；再完成外部门禁后最终 61 tests，15.726 秒，全绿。
- Go `TestDeepBenchmark[ECSFLG]` 最终通过：新增 gate 的有效/拒绝决定、错根、错 case/step/gate、非法 method、缺 reviewer、虚构 quote、错 pointer、缺快照、错事件/版本、非恢复运行和不同源字节；有效与拒绝决定都实际写入临时文件和事件，独立核对原字节与哈希。没有用合成文本证明真实许可或文学效果。
- WSL Go `go test -tags=integration,codexlive ./internal/experience -run 'TestDeepBenchmark[SFL]' -count=1`：通过。覆盖实际完成/未完成依赖、保守门禁、旧 JSON 形状、所有 fixture StrictJSON 与状态校验、隐藏事实不进 reader projection。
- WSL Go `go test -tags=integration,codexlive ./internal/experience -run TestDeepBenchmarkReplay -count=1`：通过。覆盖原有不可变恢复、4 类一致初页替换、依赖/门禁绕过。先红记录为初页替换 4 个失败、策略绕过 2 个失败。
- 真实历史只读重新核验：`20261019T092722Z` 的 SYS-001/NAR-009 均 VERIFIED / FAIL；`20261020T021825Z-resume` 两例均 VERIFIED / REVIEW，恢复前失败继续保留。REVIEW 不表示语义通过。
- `20261020T023454Z-fresh-v43` 检查当时 NAR-001 已 VERIFIED / FAIL，NAR-009 还在运行，保持 INCOMPLETE / INCONCLUSIVE。运行结果会继续变化，本条不是最终报告。

Root 另修复初页读回把最新 View 顶层信息混进 revision 1 的问题；旧历史页和快照原字未改，早期运行的顶层初始投影混版局限须保留。上述 Python 校验确认了页和快照的连续性，不因它们通过就宣称旧 View 全部顶层字段正确。

结局策略另按 root 审查修正：自然 ending 后 ask/observe 仍可执行；harness 是否支持由实际控制绑定判断；推进动作无 epilogue 仍未触达。读取最新故事 outcome 时跳过 ask 页，避免问答页把此前结局重置为 continues。私密 canary 检查扩至每次 ask，并依 ask 前的 reader-known 领域事实/对象/线程排除已公开内容；ask 自己非法公开秘密不能作为豁免。它仍只是字面泄漏控制，不证明公开过程合法或全部语义保密。

## 第二轮：真实 editorial 候选接线

frontend_regression agent 提供独立 `deep_benchmark_editorial_test.go`，已用隔离 PostgreSQL 验证真实 `Service.Assist` 的只读提案、模型失败、无效输出和并发正式推进。这里接入 live 的 `editorial_request`，将真实 measured model 交给该 helper；不把请求送入 act/read，也不自动 Fork 或应用提案。`editorial_request/result` 保留当前正式原段、逐字请求、候选文本、原 revision/branch、前后 full View/领域 State/PreferenceSnapshots、模型调用、耗时和错误。

Python 独立核验精确请求与原页来源，并比较完整 View、snapshot、preferences，不能靠 `read_only_verified=true` 或 `applied=false` 自报通过。正文被替换、状态变化、额外分支或长期偏好变化均 FAIL；缺请求/模型调用/配对/原始偏好证据拒绝或 INCOMPLETE。提案生成成功只给步骤 REVIEW，不证明修改后的文风、事实保持或后续声音已经改善。

当前非提交编辑产物尚无恢复策略。Go/Python 明确拒绝含 editorial 事件的恢复来源，避免在后来最新段上重跑“只这一段”假装原段编辑；普通原运行仍可独立核验。此限制已在 README 说明。

FUN-001 的两个初始化假设已落实修正：tube `known=false`，当前 `story_time=当晚`；原题失窃 20:42 固定事实保持。修改后的初态属于下一批冻结输入，旧证据仍原样保存。

第二轮最终验证：Python 全套 66 tests / 14.948 秒通过。Go 在包含 PostgreSQL 16 工具路径下执行 `go test -tags=integration,codexlive ./internal/experience -run TestDeepBenchmark -count=1`，4.892 秒通过（Live 无真实模型环境则跳过，其余为 evaluator 结构/数据库回归）；新增 editorial 来源恢复拒绝后，Replay 控制再通过。最初未含 PG PATH 的 invocation 明确失败于找不到 initdb，修正环境后成功，不把该失败当产品失败。
