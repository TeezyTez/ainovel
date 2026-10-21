# 来源受限知识传播：九次固定审稿探索实验与模型代理审读

2026-10-20。执行与审读：`/root/benchmark_harness`；另有 `/root/frontend_regression` 独立核对请求及结果。`human_review=false`，`blinded=false`。这是已知开发样本上的小型机制实验，不是人工盲评、保留集或产品验收。

**九次预登记调用全部完成，零重试、零传输错误、零未执行。B 的通用语义说明在这次负例中比 A 多明确识别一条旧复合记录的过授，并避免了 A 对窄揭露提出的错误补救。C 没有多检出问题，却把三条仍有缺口的新知情边标为 full。三种处理都存在遗漏；本实验不证明知识传播已解决。**

## 实验确实改变了什么

[首调前协议](../.validation/source-knowledge-20261020/experiments/protocol.md)固定了三例、三臂和九次顺序。A 使用准备时 v4.7 的原 Review system/schema；B 只追加[通用语义说明](../.validation/source-knowledge-20261020/experiments/arm-b-appendix.txt)，不改 schema；C 继承 B 的相同语义和未决处置，再要求逐边输出 `scope`、`source_mode`、`prior_evidence_ids`。C 没有额外来源表或独占事实。

三例各自的三臂 user 原字完全一致，只有 `{context,candidate}`。输入名称、作者预期、README、准备脚本和评估表都没有发给模型。三个输入的旧授权目标已经完整可见；本轮没有测“目标因上下文压缩缺失时补取”的模型效果。

负例是此前真实 extract 输出，保持所有缺陷原样。窄交流正控是代理修改的反事实候选，完整交流正控是代理编写的小型档案交接场景；二者均不是人工金标准。来源与修改逐项见[输入说明](../.validation/source-knowledge-20261020/inputs/README.md)及[准备记录](../.validation/source-knowledge-20261020/inputs/preparation.json)。

模型均为 `gpt-6.1-sol`，CodexCLI `low`，输出上限8192，上下文预算65536及既有 verified-byte-bound 检查。每次协作式期限120秒；每批3次、期限480秒；共3批串行。一次请求只调用一次 `Generate`，不接 review 后续修订，不调用 Rust pipeline、Service 或 SQL，不提交正式历史。返回值是既有 CLI adapter 规范化后的 `model.Result`，不是未经处理的 CLI stdout。

九次预定顺序为 negative A → positive B → complete C → positive C → complete A → negative B → complete B → negative C → positive A。顺序是固定交错，**不是随机化**。没有根据前几次结果选择后续条件或补抽。

## 来源、冻结与复现

A 来自 v4.7 NAR014 S07 seq36/call9 的已记录请求。来源共有36个 hashchain 正确的事件，但停在 `model_request`、没有最终 `run_end/root`；本实验只取已记录 system/schema，不能称其来源轨迹已完整封口或原审稿已通过。

准备时原 system 与 Rust `COMMON_PROMPT + Review` 原字一致，schema 与原请求字节一致；Rust 与 contract 文件也匹配原构建清单：

- Rust SHA256：`c28de12280e2f50a8a5a99c6b68b06f93ebd54af2d8d2d3522136328adcbb6ea`。
- contract SHA256：`614415502b6021c77f841d5386f0f18aa03bd38710c3f57e370859b5df481102`。
- 固定 runner 二进制 SHA256：`51feaa53aa97c0bf0d35d61f982d066bb865106eb11a216fadd578dd1efd7349`。
- 执行 CLI SHA256：`1722907aa64401bcc9b34467ef5c2af43f6aef9a5045ef04d11d19dfae4589fb`。

九请求、三 manifest、原协议与 runner 先冻结，三个零调用 Go preflight 均通过。随后根代理授权工作区产品升级 v4.8；九请求未变。独立代理发现版本漂移后曾要求暂停，按冻结副本重新核验通过才开始。原协议中“当前源码”专指准备时；[首调前时间线补充](../.validation/source-knowledge-20261020/experiments/freeze-timeline-addendum.md)保留了这项澄清，未回写原协议哈希。实验不使用后来产品新增的 `review_evidence`。

固定 runner/model adapter/StrictJSON 的编译前后清单相同。冻结副本、请求原字、每份 SHA、三个 manifest、日志均位于[实验目录](../.validation/source-knowledge-20261020/experiments/)。这是本地来源证据，不是外部公证。未读取或复制模型凭据。

实际命令如下，执行脚本只运行了一次；其独占开始文件与输出目录会拒绝复用：

```bash
# 首先构建隔离 runner 并做三批零调用 preflight
bash .validation/source-knowledge-20261020/experiments/build-preflight.sh
# 之后按固定三批九次调用
bash .validation/source-knowledge-20261020/experiments/run-nine.sh
# 全部封口后只读分析原输出
python3 .validation/source-knowledge-20261020/experiments/analyze.py
```

## 九个单元全部结果

三批均封口为 `COMPLETED`；Go 测试输出的 PASS 只说明隔离执行器记录成功。模型判断和叙事验收分开。原结果逐项绑定到[analysis.json](../.validation/source-knowledge-20261020/experiments/analysis.json)，文件 SHA 也保存在各批 `run.json`。

| 全局序号 | 输入/臂 | 传输 | approved | 模型 issues 的实质 | 单次毫秒 | 输出 text UTF-8 字节 |
|---|---|---|---|---|---:|---:|
| 01 | negative A | OBSERVED | false | 三条旧记录过授；12:58精度 | 51,503 | 8,348 |
| 02 | positive B | OBSERVED | false | 仅12:58精度 | 54,315 | 8,973 |
| 03 | complete C | OBSERVED | true | 无 | 22,590 | 2,509 |
| 04 | positive C | OBSERVED | false | 仅12:58精度 | 97,711 | 19,647 |
| 05 | complete A | OBSERVED | true | 无 | 25,225 | 2,055 |
| 06 | negative B | OBSERVED | false | 四条旧记录过授、诗选整包秘密范围；12:58精度 | 70,477 | 12,470 |
| 07 | complete B | OBSERVED | true | 无 | 23,173 | 2,079 |
| 08 | negative C | OBSERVED | false | 四条旧记录过授、诗选整包秘密范围；12:58精度 | 69,368 | 14,677 |
| 09 | positive A | OBSERVED | false | 要求追加旧秘密公开与整包知情；12:58精度 | 46,942 | 7,612 |

传输完成9/9，ERROR 0/9，NOT_RUN 0/9。独立程序检查：严格 JSON、各臂 schema、新事实支持集合、知情边集合、公开支持集合及所有 quote 非空且为正文原字子串，均9/9成立；无重复、缺失或额外边。总计207条quote均为原字子串；issues 序列化大小均未超过产品2048字节限制。**这些程序检查不验证中文语义。**

合计三例47条待审边，各出现三臂，共141个输出边记录；并非141个独立样本。所有141个边记录已结合目标内容和正文审读，下面按同一事实的接收者分组呈现。九次均存在相关 quote，不意味着 quote 覆盖整条内容。

计时使用已修正的 monotonic 起点，九次 `elapsed_ms` 合计461,304毫秒。各批自身为128,456、193,452、139,526毫秒；包含不同范围的装载/记录开销，不与墙钟时间混算。每个处理只有一次样本，不能据此声称某臂总体更快。UTF-8 字节也不等于 token；未知 usage 不作补估。

## 负例：旧知情边逐条核对

| 接收者 ← 旧目标 | 正文实际提供与缺口 | A | B | C |
|---|---|---|---|---|
| xiu ← plants-return-r4 | 只听“都拿到了…这两本还在袋子里”；未听第二只未封箱、扉页核验、11:06登记等完整流程 | issues明确指出 | 明确指出 | partial，明确指出 |
| xiu ← field-return-r3 | 同一概括不含扉页标记、10:28登记、向教师展示等 | 明确指出 | 明确指出 | partial，明确指出 |
| xiu ← tide-shelved-r2 | “已经放回店里”不含至09:40、放回书架 | 未明确指出；detail引言提到回店，不等于指出此缺口 | 明确指出09:40前上架 | partial，明确指出09:40 |
| xiu ← lu-appointment-r4 | “两点半去陆棠那儿。约好了说说话”不含此前扶箱、封箱、搬箱等 | 明确指出 | 明确指出 | partial，明确指出 |
| jy ← poems-damage | 展示断线、散叶、缺角不支持“缺失页角没有藏图或其他秘密” | 未指出 | 明确指出 | partial，明确指出 |

四条预登记已确认旧过授的**明确检出**：A 3/4，B 4/4，C 4/4。诗选的消极全称范围另列：A未指出，B/C指出。不能把这五条拆成多个时间／动作子命题夸大样本，也不能因为 A 已整体拒绝就补算其未说明的第四条。

例如 B 原话为：“xiu→tide-shelved-r2未获知09:40前上架”；A 的原问题说明只明确列了 field、plants、lu。B/C 比 A 多显示的是**一次反馈完整性差异**。三者对负例本来都拒绝，所以这里没有观察到“新增阻止了一次正式错误提交”；没有执行后续 revise，也不知道更完整意见会不会带来更正确的修订。

`reveal_fact_ids=["poems-damage"]` 另需区分读者公开与人物知情。三臂都给出损伤原句，但它不独立支持秘密的所有子句。B/C issue明确反对给 jy 的整条授权，没有单独、清晰解释 reader reveal 是否应缩窄；不能将一条人物知情 issue 冒充两种权限都已审对。story-scope 的读者信息也不能自动成为 jy 的个人知识。

## 负例：全部16条新 fact.known_by 边

| 新目标与接收者 | 完整正文判读 | A/B 的表现 | C 的表现 |
|---|---|---|---|
| poems-inspection-r5：jy、xiu | 损伤展示、请求记缺口、拒绝补字确实发生；“拿来时已有缺角”保持于砚说明的归属 | 两边均列相关引用；A截段未覆盖初到时间/桌面状态，B扩展为完整前段；没有否认合法观察 | 两边 full；引文覆盖完整前段；jy mixed、xiu direct_experience合理 |
| poems-assistance-r5：jy、xiu | 扶书、倒水确实发生；正文是季砚“接了半块”，未充分支持候选“两人分食半块” | **两边缺陷都未指出**；只引“季砚跟着松手、扶住” | **两边错误 full**；同样只引扶书，prior=[]，未覆盖喝水、分饼，更未修复候选份额问题 |
| jy-undecided-statement-r5：jy、xiu | 说者陈述“还没定。船是五点”，另一人当场听见；不是世界强行替他决定 | 两边合法交流被保留，无错误要求升级为听者 belief | 两边 full；说者 direct、听者 communication，归属正确 |
| jy-idleness-r5：jy、xiu | 季砚自己陈述闲时找事/擦书架；于砚可知他说过，不自动证明全部生活史 | 两边保留 statement，无否认 | 两边 full；说者 direct、听者 communication |
| xiu-idleness-r5：xiu、jy | 于砚自己的收材料/买菜陈述，季砚听见 | 两边保留；A/B引文省略问题“没书修的时候”，未成为完整证据但不是候选动作虚构 | 两边 full；完整问答引用，来源归属合理 |
| poems-repair-r5：jy、xiu | 重缝、压放、12:47核验、缺角仍在均实际发生，旧“尚未重缝”不禁止后续成功 | 均未错误阻止修书完成；A部分引文只截检查段；B对jy更完整、对xiu只截后段 | 两边 full；长引文包含修缝至核验全部 |
| poems-return-r5：jy、xiu | 登记还书真实；jy原本知道袋内两书名，xiu仅听“这两本”，现有证据未建立其获知具体名称的来源 | jy合法；**xiu整条新记录附带两书名的缺口未指出** | jy full，引用有效原知情 `jy-departure-r4` 补两书名；**xiu full错误**，prior=[]，正文仍未说明专名 |
| meal-agreement-r5：jy、xiu | 洗手、14:30谈话告知、邀面、答应等待存在，没有把未来饭局写成已完成；12:58精度存在下述歧义 | 两边都因精度被指出，无否认普通邀约 | 两边 partial，issue同为精度；不算已证实传播错误检出 |

C 在负例21条边中给出14 full、7 partial。其中5个旧授权与2个时间争议边为 partial；**至少3个 full 有已确认缺口**，即 assistance两边和return→xiu。其余合法动作不能因为这三项遗漏被一并否认。

C 对 jy→poems-return-r5 的 `prior_evidence_ids=["jy-departure-r4"]` 在程序上存在、原知情含 jy，语义上确实记有袋中两书名，因此这一项有实质帮助。它没有把这条仅 jy 原知的信息错误挂到 xiu 的 prior 数组；但 xiu 最终仍被标 full，说明空 prior 与 full 的存在本身不能证明推理正确。

这是一项自然出现的原知情补足观察，**不能替代预登记中缺少的专用正反控制**：尚未给同一角色构造“有旧依据/无旧依据”的唯一差异配对，也没有检验错误 prior ID、过期状态或多条旧证据组合在真实模型中的表现。

## 窄交流正控：20条边与错误补救

此反事实删除了五个旧 whole grant，保留原世界记录；损伤、修补等实际可见内容用范围准确的新事实承载。两条新增 statement 记录真实交流，不要求听者把他人陈述列为自己的 belief。

| 新目标 | jy/xiu 两边的语义与三臂结果 |
|---|---|
| poems-inspection-r5 | 真实损伤展示与说明；三臂都列两边。C完整引文/full。A额外要求公开旧secret及jy整包知情，见下文。 |
| poems-assistance-r5 | 改为于砚拿纸包并说是早上剩饼、季砚接半块，避免共同分食份额臆测。A/B相关quote仅扶书；C长引文覆盖全部，双方full，未因引用格式强迫新增动作。 |
| jy-undecided-statement-r5 | 双方听见本人去留未定，三臂均保留，C说者direct/听者communication。 |
| jy-idleness-r5 | 本人陈述与听闻均保留，未升级世界历史真相。C两边full。 |
| xiu-idleness-r5 | 同样保留陈述归属和听闻；C两边full，原问答完整。 |
| poems-repair-r5 | 普通修书完成合法，三臂未要求继续拖延。C两边full，引文覆盖收线、压放和核验；A/B部分摘录不足不能当整条证明。 |
| poems-return-r5 | 改为“另外两本”，不把名称附送给xiu；登记/包书/入袋真实。三臂两边保留，C两边full。 |
| meal-agreement-r5 | 邀约与等待均真实，两边都因12:58精度被三臂质疑；C两边partial。不能据此判两个知情接收者确实不该获知邀约。 |
| jy-book-report-r5 | “都拿到了。《潮汐表》已经放回店里，这两本还在袋子里”原话，jy/xiu均可知说过；三臂两边保留。 |
| jy-appointment-report-r5 | “两点半去陆棠那儿。约好了说说话”原话；三臂两边保留，不附带此前封搬箱。 |

新增两条 statement 的4条边在三臂中都被完整列出且未被否认，未要求听者接受为真或变成听者自己的 belief。C 对这些边分别标说者 direct、听者 communication，合理。C本例18 full、2 partial，未见上述负例的三项新边错误，因反事实已把对应目标收窄。

A-positive 的 `missing_secret_reveal` 原话要求：“reveal_fact_ids为空，未登记既有秘密的公开及季砚对此的知情变化。”这是**不当补救意见**：候选已经用 `poems-inspection-r5` 登记可见损伤及双方知情；未获来源的“没有其他秘密”仍在旧 secret 内。若机械照该意见加整个旧 ID，会恢复我们试图避免的整包授权。需要保存实际揭露，不意味着必须把包含未揭露子句的旧记录整体公开。B/C没有提出这一要求。

三臂 positive 仍全部 approved=false，原因还包括12:58，故不能报告“B/C正控通过”。也不能将 A 的整次拒绝纯粹归因于错误意见：它同时提出了有争议的时间精度问题。可确认的是一个错误修订方向，以及B/C本次没有该方向。

## 时间精度是控制歧义，不强记误杀

所有 negative/positive 六次都质疑 `meal-agreement-r5` 的12:58。冻结 writer 的 `candidate.story_time` 本身为12:58，但正文只有“钟已经快一点了”。段末时间锚可与约13:00兼容；是否足以给中间“出门/邀面/答应”这一特定事件、以及两人的知情记录赋精确分钟，实验和现行合同没有预先定义清楚。B-negative虽断言story_time不能替代正文，也不能由此把模型自己的规则解释当外部真值。

因此：

- complete正控的整体误拒绝为0/3；每臂仅一个简单场景。
- positive被拒绝3/3，但时间问题均标为控制歧义，**不能宣布已确认3/3误杀或0/3误杀**。
- A-positive有一条可确认不当补救意见；B/C没有该意见。
- 两条窄statement的12个跨臂边判断都未被错误否认；这不是全部正控语义正确率。

保持原输入、输出和所有分母，不删掉12:58后重跑，也不根据结果追加更易通过的第十次。本次只登记后续需要明确“元数据时间锚与具体事件时间”的产品语义；不得用实验之后的新解释回写本轮判定。

## 完整交流正控：三种处理都允许

三臂均 approved=true、issues=[]，各6条边完整。逐条比较：

| chen ← 目标 | 完整来源 | 三臂结果与C分类 |
|---|---|---|
| box-transfer-r1 | 可信多年搭档语音逐项说明今日09:10封蓝盒、门内矮柜，陈禾完整听到并据此登记 | 均支持；C communication/full，不要求再验盒 |
| lin-message-r1 | 正文明确09:12来源和全句语音，包含旧statement全部内容 | 均支持；C communication/full，不把它改成chen自己的belief |
| seal-layout-r1 | 陈禾看清白托盘、红圆章左/黑方章右、均无盖 | 均支持；C direct_experience/full |
| chen-message-r2 | 自己09:20点开并完整听取留言这一动作 | 均支持；C direct_experience/full；与留言内容通过交流获知不矛盾 |
| chen-register-r2 | 自己依报告勾簿、登记位置并打开目录 | 均支持；C direct_experience/full |
| chen-seals-r2 | 自己目视完整布局、取笔、继续工作 | 均支持；C direct_experience/full |

三条新事实仅给陈禾，离场林岳没有被追加知情；没有将“听到P”“相信P”“世界P为真”混成同一事件。蓝盒位置原本已是世界真事实，本段只新增接收者知情。C此例所有 prior=[] 合理，正文内容已足够，不能把空 prior 一概当遗漏。

## 选择与不能声称的结论

若现在要做最小产品选择，本次观察支持优先试 B，而不是引入 C 的共享 schema：B/C的明确旧过授检出相同，均避免 A 的错误整包补救；C的显式字段没有发现更多实质缺陷，反而留下3个容易被程序误信的 full。C-positive本次为覆盖跨段目标输出19,647字节、耗97,711毫秒，对比B-positive8,973字节、54,315毫秒，只能描述这两次样本，不能估计一般成本。

根代理在全部九次结束后决定采用 B 的简明政策，不引入 C schema，并计划在抽取阶段补充范围准确的记录规则。**本实验只测固定 Review 请求；没有直接测新 extract/repair_extract政策、程序hydration与产品全链路的组合。** 这部分只能由后续产品回归与从头真实基准检验，不可借九次结果提前认可。

需要保留的限制：

1. 每case×arm只有一次，固定交错且没有随机化；同一模型、已见开发样本、代理设计和非盲代理审读，不能估计普遍错误率或作因果优越性结论。141条边彼此强相关。
2. 负例同时包含多种错误；整体拒绝没有区分力，反馈检出和修订效果是不同结果。本轮零 revise、零正式提交，没有观察未来场景中是否真的减少泄漏。
3. positive的时间控制不纯；complete只是容易的完整可信交流。没有覆盖欺骗、否认、相互矛盾报告、过时事实、原知情缺失与补足配对，也没有新场景保留或真人评判。
4. 原字引用、ID存在、scope/source字段都不能代替语义证明。三种处理共同漏掉份额和新事实附带书名，说明只盯旧 grants 仍不够。
5. 产品 v4.8 的只读目标补齐修复有独立程序价值，但三个输入本来就全可见，本实验无法量化它的模型收益。来源版本与分支/fence必须继续由代码保证，语义仍需概率性审稿和读者评估。

下一步使用已准备但未运行的[从头基准脚本](../.validation/run-source-knowledge-fresh.sh)，在最终产品代码和回归稳定后冻结源码：原样 NAR010（10步误信/秘密）、NAR017（8步连续生活）、NAR009（8步正常任务完成）。不改原题、不继承旧生成历史、不添加本实验答案。独立数据库、固定源码/Rust/Go产物后，分别核对授权范围、合法成功、状态变化和真实正文；完成步骤与叙事质量分开。执行仍由根代理在统一冻结后启动，本报告没有启动该批模型。

独立复读记录见[frontend代理审查](../.validation/source-knowledge-20261020/review-frontend.md)，本轮完成时 SHA256 为 `971a37ba474861c83ab9ae6798a8ff47963fc9dd5c7fa24e4e90c4b2413b2982`。该代理另行重算三个run的全部file_sha及207条quote，结果相同；语义复读也确认三条错误full与A的不当整包补救。它参与正控准备，不宣称与输入作者独立；两份代理意见不能冒充真人盲评。
