# 深度基准：混合输入、角色信念与人物声音夹具

本轮新增 `SYS-004.json`、`SYS-007.json`、`NAR-014.json`，位于 `backend/internal/experience/testdata/deep_benchmark/`。直接读取 `tests/benchmark/catalog.json` 中对应 `raw_markdown`，保留全部步骤 ID、顺序、原模式与逐字输入，并绑定原文件 SHA-256 和题目起始行。此处只是评估侧初始世界与执行策略接入，不是模型内容或整例通过声明。

## 初始化与知识边界

| 夹具 | 初始化 | 未伪造的条件 |
|---|---|---|
| SYS-004 | 渡口、10枚、只答应问价、尚未选路线或买票；快船4枚/20分钟、慢船2枚/35分钟；同伴自主决定。 | 没有填慢船最晚开航时间、同伴同意、票券、扣款或已准备的 UI artifact。可见路线表先是原题世界事实。 |
| SYS-007 | 作者固定的转移/收信前史使用 revision 1 State；客观包裹未毁、假信的 `statement`、宋/许各自的 `belief` 分开记录。 | 假信08:00焚毁声明及许的信念不在开场、`known=true` 事实中；私有角色 `known_by` 隔离。没有编造更早正式页、当前入库单持有/出示许可、12:00核验成功或后续信念更新。 |
| NAR-014 | 面包店订单因烤箱延迟而晚20分钟，玩家为临时合伙人；人物表达习惯属于原题已知人物材料，私人目标/具体知识单独隔离。 | 没有植入客户答应、赔偿、合同条款、客户联系方式或检查员未说的打算；盲辨、评分锚点、读者评价和判定规则不送入世界/开场。 |

SYS-007 的 S03 保持玩家真实出示尝试。原固定前提没有明确玩家持有入库单，因此不替玩家授予权限或宣告出示成功；模型可以依据实际场景说明访问条件。不能把每个未知情节都改成评估门禁。若实际未能出示，保留该合法响应并将“宋经证据更新”的探针记为未到达。S04 只要求 S03 有真实结果，随后观察宋的实际安排，并不强制他已改变认识。

## 执行策略与尚缺的真实绑定

- SYS-004 S01 需实际路线表和混合输入入口，`evidence_gate=mixed-input-router-and-route-table-ui`；S02 依赖 S01。通用 Go adapter 直走 `Advance(act)`，不能冒充 UI 路由。S03 仍为两个真实澄清分支的 harness 控制，不能发给模型当世界输入。S04 的否定询问可独立执行；S05 需要真实 S04 及 `slow-boat-confirmed-conditions` 证据审读，不能仅凭“提交了一页”就认定所指条件已确认。S06 引用不执行请求可独立执行；S07 依赖实际 S05/S06。
- SYS-007 S05 需要真实到场、12:00最新实物/连续保管/不可复制封签的观察拍点、其后的反应拍点，以及独立的旧入库单对照。当前没有此 harness 绑定，故 S06 依赖 S05 并保持 BLOCKED。S07 可查询实际已到达的知识状态。S08 的第12/24轮回访不以文字概述冒充已执行。
- NAR-014 有7个步骤使用现有 act/continue 映射；S06 原模式是 `editorial_request`，并非 continue。进一步检查找到现有 `Service.Assist(Kind="polish")`，已新增独立评估 helper 将逐字请求与当时正式末页绑定为编辑候选，不偷换为行动、普通续读或长期偏好。不自动 Fork、接受或替换原段；S07/S08仍接续实际正式历史，已应用编辑后的文学效果/后续范围尚未覆盖。S08不擅自添加后日谈许可；故事提前自然结束时保存未覆盖范围。

`requires_steps` / `evidence_gate` / `omissions` 都是评估侧策略，不是模型世界事实。未知门禁默认保守阻塞；批准一份缺少真实执行入口的材料不能替代实现那个入口。

## SYS-004 的下一步具体入口

真实 UI 路由是 `frontend/lib/experience/reader_tools.dart` 的 `_routeReaderInput` → `ReaderArtifactRepository.routeInput(..., phase: 'ui')` → `POST /v1/experiences/{id}/artifacts/prepare` → `Service.PrepareArtifact`。请求为：

```json
{
  "request_id": "unique-evaluator-routing-id",
  "branch_id": "benchmark-main",
  "expected_revision": 1,
  "input_routing": true,
  "intent": "先问同伴愿不愿意坐快船；如果他不愿意就留在岸上，不付款。顺便把路线表字号放大。"
}
```

必须以真实模型的 `intent_decision` 和绑定 `routing_scope` 为证据。`story/mixed/clarify` 的 `output` 必须为 null；`commitArtifactIntent` 可保存回执，但不提交世界行动。mixed/clarify 后，客户端消费路由回执、显示澄清，不再进入 action 阶段。若实际路由为 story，才接现有 `InterpretArtifactInput`（`POST .../artifacts/input`）及后续明示行动路径。应保存每阶段原输入、真实模型请求/响应、artifact head/state revision、世界独立快照；S03 两条澄清结果需分别在真实隔离分支执行。

路线表最低合法准备态可以是 `schemaVersion=1` 的 definition：`id=route-table`，`fields=[]`、`steps=[]`、`actions=[]`，单个 `table` view，列为“路线/票价/航程”，两行为“快船/4枚/20分钟”和“慢船/2枚/35分钟”；`game=null`，不附带购票效果或新资源。正式服务固定 scope/revision，不由候选任意签发。可先以真实 `PrepareArtifact` 从已公开开场生成并读回；若评估预置固定 UI，应单独标记为合成展示前提，不能当成模型生成质量证据。

已用当前 `tools/artifact-validator/validate.mjs` 对上述最小准备态进行**合成校验预检**，返回成功且 actions/resources 均为空。入口 `.validation/sys004-route-table-preflight.mjs`，请求与结果在 `.validation/sys004-route-table-preflight.json`。它没有调用模型、写服务端或运行浏览器。后续仍需真正渲染和修改字号；不能给原生 table 偷加不支持的 `fontSize` 字段后就宣布通过，需使用当前可验证的正式定义并检查实际显示结果。

## 验证记录

`.validation/check-sys004-sys007-nar014.py` 调用既有 `native.validate_fixture`，三份夹具的逐字输入/模式/顺序、来源 hash/行号全部通过；另检查所有 known_by 指向角色、来源 revision 合法、初始模型材料没有评估元数据、假信与信念的公开边界，以及上述门禁/依赖策略。检查退出 0。

Go 的 `TestDeepBenchmarkFixturesEstablishValidPrivateWorlds` 使用当前产品 `StrictJSON`、`validateArchiveState` 和 `ReaderState` 检查 State 与隐藏事实投影；已在共享 harness 编辑稳定后独立重跑，全部10份夹具通过、退出0。此前两次尝试分别碰到编辑中的 helper 未定义及局部 `bytes` 变量遮蔽导入包，均由对应负责人修复，没有修改或放宽检查。

没有在此轮启动这三例的真实模型运行，没有替代人工文学审读，也没有把缺少的控制记为通过。

## NAR-014 单段编辑候选入口

独立新文件 `backend/internal/experience/deep_benchmark_editorial_test.go` 的 `runDeepEditorial` 调用真实 `Service.Assist`，请求为 `Kind=polish`、当前 branch/revision 与 S06 原文。先独立读回正式 View、State、已确认偏好和原页；模型只收到产品已有 polish 协议中的原正文与逐字要求。helper 在 `editorial_request` / `editorial_result` 中保存前后材料、候选、局部实际模型调用数、耗时、`applied=false`、错误；嵌套 measured model 继续记录原始 model_request/result。只读结论同时检查 View（包括全部正式页/分支）、State、偏好，不能只看一个自报布尔值。模型失败或取消后仍执行有时限的独立只读回取。

先以未实现 stub 运行期望用例，得到 `editorial adapter not implemented` 的真实失败，再实现 helper。最终 `go test -race -tags=integration,codexlive -count=1 ./internal/experience -run '^TestDeepBenchmark(Editorial|Fixtures)' -v` 退出0：3个 editorial 顶层回归（含 model-failure / invalid-candidate 子例）与10份夹具检查通过。日志 `.validation/editorial-helper-green-20261020.log`，复跑入口 `.validation/verify-editorial-helper-20261020.sh`。

这些回归使用隔离 PostgreSQL、真实 Service、合成历史和固定模型候选，验证绑定/持久化边界而非编辑文学质量。另检查完整 archive 不变、原页原请求精确进入模型、既有偏好不被“只这一段”修改；模拟并发真实 Advance 时，过期候选被拒绝且 read_only_verified 为 false。live/native 接线与独立事件链校验由 harness 负责人实现。含编辑事件的恢复暂应拒绝：编辑候选没有正式新页，不能在恢复到后续页后把旧 S06 自动重跑到错误原段。

## NAR-017 只读复核

额外独立比对 root 编写的 `NAR-017.json` 与原始题目：09:00/17:00、四书名与书脊/页角损伤属于原题要求开局封存的作者细节；去留授权、约六章范围及无藏宝图来自初始材料。未来归还、修复、去留没有预定，Lu/Xiu动机和书损保持私有，未发现初始化失真或评分 oracle 投送。S07保留 ask，S08原样 continue 并明确 epilogue 许可。已反馈一处措辞：教师家这个粗位置已固定，未知的是具体放置处，omissions 应避免笼统写“location unknown”。没有修改 root 的夹具。
