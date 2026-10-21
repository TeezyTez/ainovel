# SYS-014 S05 独立币制正控制：最小评估接入设计

状态：独立Go评估入口已实现并完成红→绿、原封存来源预检；尚未运行新模型，未修改通用live/native、旧fixture或封存run。Python独立补充验证器由harness协作者负责。

原题S05逐字是“正控制：在另一新世界正式定义两种币及3比1固定汇率，再提出换算。”H3检查已有确定汇率时能够计算，而不是把留空当作禁止数值的通用规则。此harness语句不是要送给故事模型的玩家输入。基础海边世界没有币制，不能把币制临时补进原世界，也不能用旧S01回答未知来声称H3通过。

## 作用域和预登记

新增独立评估测试文件 `backend/internal/experience/deep_benchmark_currency_control_live_test.go`，build tags为 `integration && codexlive`。单独启用输出目录/源目录/runtime/CLI环境，默认SKIP。本测试与通用 `TestDeepBenchmarkLive` 无接线；旧SYS-014 fixture的S05及旧BLOCKED事件保留不动。

来源固定为 `.validation/deep-benchmark/20261020T031340Z-reading-editorial/SYS-014`，已观察root `d5d84fc7da380d8043862987fa28f9cb752ede97524d66f1f05ddc0095a5abf9`；实现时必须重新验证完整hashchain、root、fixture字节、源构建清单和S05逐字内容，不能只信这里抄录的root。复制完整来源到补充实验目录并绑定源events SHA，原文件不修改。

开模型前把作者选择和实际输入写入预登记文件，并在首个manifest中绑定其字节hash：

- 新世界只定义贝币与岚币。正式规则：“本世界使用贝币和岚币，固定汇率为3枚贝币兑换1枚岚币。”方向由这句明确，不使用含糊“3:1”标签。
- 两个currency实体和一条公开rule，source_revision=1。没有现金余额，没有兑换已经发生的记录，没有预填答案。最小世界时间固定，初始正文只说明上述正式规则；初始化明确为评估者编写的合成前史，不冒充生成或旧世界已有事实。
- 唯一实际ask：“按这里的固定汇率，2枚岚币可以兑换多少枚贝币？”这是换算询问，不是持有2枚岚币的断言，也不是兑换行动。
- 评估端用有理数独立计算期望6枚贝币。期望结果、H3判据、harness说明、来源证据指针不进入seed/opening/state/input/system。后续review看到模型已经生成的答案属于正常产品流程，不应使用全请求中禁止字符“6”这种错误泄漏检测。

## 两个世界和实际产品路径

用两个 `testService` 建立两个不同临时数据库，实际比较DSN不同但不保存或输出DSN。A仅恢复来源全部正式页和快照，B通过已有 `seedDeepFixture` 建立新的币制R1。它们属于不同隔离数据库与逻辑scope；固定helper的experience/branch ID恰好相同不表示同一世界，证据必须标明逻辑作用域。

在任何生成前读回A全部正式页、每版snapshot、当前view/branches和preferences，与来源相符；币制实验完成/失败后再次读取并逐项比较。这里验证的是从封存来源恢复的隔离原世界副本不变，不能称作读取或验证仍在线的原运行DB。来源本身的文件hash也在结束时再次核对。

B初始化必须经过严格State合法性验证及独立数据库读回，确认正式R1文本和公开币制规则后才允许实际请求。然后 `Advance(Mode:"ask", Input:预登记原句, ExpectedRevision:1)`、`GenerateAccepted`，Generator为真正 `*Algorithm`，连接实际Rust和实际CodexCLI，沿用现有模型预算/严格审稿规则。模型调用由 `deepMeasuredModel` 原样记录，不包裹Service.Generator、不提供合成模型回退、不额外重跑求正确答案。

成功执行必须读到正式ask R2，逐字请求绑定，旧正式页完全不变，新R2领域State与R1完全相等（包括story_time、事实、知识、线程和叙事笔记），操作状态确为committed。没有修改世界才是ask结构正确；换算是否正确仍单独检查正文。失败必须保留实际模型结果、操作状态、独立读回及错误，不能把“没有修改”自动算作计算正确。

## 独立证据链与关联

建议事件顺序（待harness确认）为 `supplement_manifest`、`original_readback_before`、`currency_initial_readback`、`currency_operation_request`、原 `model_request/model_result/stage`、`currency_operation_committed` 或 `currency_operation_failure`、`original_readback_after`、`supplement_end`。结束状态只允许REVIEW/FAIL，不能自行宣称整个SYS-014通过。

Manifest绑定case_id=SYS-014、step_id=S05、原step对象、source_root/events_sha/fixture_sha、预登记字节hash、新世界初始化字节hash、新runtime/源码清单/contract/engine/model及合成前史边界。记录逻辑scope，不记录凭据、DSN或用户DB。

Native侧应有独立补充验证器，检查两个完整来源、原S05、币制定义与实际问题均匹配预登记、正式R1已建立且公开、所有请求结果成对、实际模型调用存在、ask R2与请求绑定、原世界全历史/偏好不变及币制世界State不变。它返回“SYS-014/S05有额外正控制证据”，不重写原run的BLOCKED，更不填补S03或反事实变体覆盖。

结构通过只到REVIEW。最终H3须有与这条新证据root及正式回答页绑定的独立审读：引用计算结论原句、独立运算方向与数值、检查没有反向换算/无依据手续费/把结果仍称未知，也没有把询问写成已成交。不能单用正文含字符“6”判PASS；自然中文“六枚贝币”等等价表达允许，由独立审读记录判断，不修改产品输出schema强迫机器评分格式。

## 测试边界

先以固定模型和实际Rust验证评估helper的调度/提交/读回：成功ask不改State；模型拒绝、错误结果或未提交应保留；初始正式币制读回漂移必须在调用模型前阻断；原世界旧snapshot漂移不得遗漏；不修改来源文件。固定模型只能测试这些边界，绝不能产生H3通过记录。

来源/关联验证的负控包括root/events/fixture/prereg篡改、币种或汇率方向变化、实际input不同、错误scope、缺失模型结果、额外问答、旧页改写和已有结果重定位。真实运行至少须有一个新操作真正经过Go/Rust/CLI，不以固定JSON或人编“6”代替。

## 已实现的接口与验证

实际新文件为 `backend/internal/experience/deep_benchmark_currency_control_live_test.go`；没有触及正式产品代码、原 `deep_benchmark_live_test.go` 或SYS-014 fixture。

`decodeDeepCurrencySource` 检查完整来源链/封印、已登记fixture的原字节、原构建清单hash与fixture绑定、唯一原S05 BLOCKED、逐字harness步骤及模型请求结果配对，再复用 `decodeDeepReplay` 恢复连续历史。Live入口还固定原source root与events SHA：`d5d84fc7da380d8043862987fa28f9cb752ede97524d66f1f05ddc0095a5abf9` / `0a88d7bc33f80f743fd12dbb4e51b9fdf7f6283bcf6b966fa77a69ed2e8150a1`，不能事后换一份前史。

`runDeepCurrencyControl` 要求真正的 `*Algorithm`、不同数据库连接和不同account作用域；真实入口另比较两个临时DSN不同，但不保存DSN。原世界由 `readDeepRestored` 检查所有stored原页/逐版snapshot以及当前投影合法迁移，前后完整读回含scope/view/branches/preferences逐项相等。币制通过同一个 `seedDeepFixture` 初始化，故两DB里的experience/branch ID可相同，以数据库和role/account区分，不为评估方便修改产品ID。初始化独立读回必须与预登记完全一致，才允许一次ask。

固定模型故意返回“这是合成回答，仅验证询问与状态隔离，不声称换算正确。”，证明结构成功并不会直接产生数值正确判断。实际Rust/Service完整路径确认ask只提交一个正式回答，两个领域snapshot完全相等。模型失败保留failed操作/调用数/错误；初始化漂移在模型前阻断；模型调用期间篡改原世界R1旧snapshot在结束读回时被检测。初次stub红见 `.validation/currency-helper-red-20261020.log`，最终绿见 `.validation/currency-helper-final-20261020.log`。

最终命令为 `go test -race -tags=integration,codexlive -count=1 ./internal/experience -run '^TestDeepBenchmarkCurrency' -v`，使用实际Rust SHA `fc2131a65c2c567987dc88ffb15dee2cb3ac7d734ca0b636ebf883e12c5e7826`：3个顶层测试及9个子测试通过，10.144s；真正Live入口因未指定输出目录明确SKIP。来源预检已经在独立DB恢复原SYS-014全部4个正式页，未调用模型。

真实入口 `TestDeepBenchmarkCurrencyControlLive` 需要 `ELSELIFE_CURRENCY_CONTROL_SOURCE`（原case目录）、`ELSELIFE_CURRENCY_CONTROL_DIR`（不存在的新子目录）、`ELSELIFE_CURRENCY_CONTROL_SOURCE_SHA256`（本次冻结源码清单hash），以及已有CLI/runtime设置。输出父目录的 `source-manifest.json` 必须匹配本次hash；旧构建清单存为 `source-build-manifest.json`，本次存为 `current-build-manifest.json`，避免混用。`preregistration.json` 只含version、两个币名、正式汇率句和实际问题；`currency-fixture.json`含完整合成初始化，无期望答案。

证据字段已向harness同步：readback为 `{scope:{role,account,experience_id,branch_id},history:deepRestoredReadback,preferences}`；manifest使用 `source_events_sha256` / `source_fixture_sha256`；失败readback才有error。正式操作结束后另写 `source_files_readback`，记录重新读取原events/root/fixture的逐文件SHA、是否一致与独立错误，再封存 `supplement_end`。该事件与DB恢复副本前后比较是不同证据，不能把本次恢复副本误称为原运行数据库。

已向协调者报告Go SOURCE STABLE，等待Python验证器收口后统一冻结和授权的唯一真实ask执行。尚无H3通过结论，原S05 BLOCKED仍保留。
