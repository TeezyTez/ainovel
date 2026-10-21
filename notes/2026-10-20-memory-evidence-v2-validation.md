# v4.13 记忆索引与证据分离：工程验证

本记录对应已批准的 [v2 设计](../docs/superpowers/specs/2026-10-20-memory-index-evidence-separation.md) 与 [实施计划](../docs/superpowers/plans/2026-10-20-memory-index-evidence-separation.md)。它记录工程闭合，不宣称真实模型内容或原始 benchmark 已通过。

## 实际改变

- 新管线输出 `memory_delta`，索引摘要与证据分开；旧记忆仍保留原表示。检索材料明确列出来源目录及当前是否实际加载，不再用短 quote 冒充完整依据。
- Go 从各作者阶段实际请求中的候选正文、正式页和完整权威事实登记来源。独立审稿使用本次目录中的 `source_ids`；Go 将其解析为持久来源，在最终请求、完整候选及正式提交间绑定。
- 首次缺必要旧页保留原补读机会，读取额度耗尽仍缺页则在发送前拒绝。缓存按精确事实版本及完整记录哈希选取，不重装同 ID 的所有旧版本。
- 准备任务保留原 origin，经数据库 claim 交接；提交事务复查来源与完整索引。作者 Repair/Assist 不能绕过新批准路径；归档只验证来源，不伪造历史审稿认证。
- 角色输入继续由已授权事实组成，作者摘要、页和来源目录不进入 actor。来源存在、实际加载、语义充分、角色知情分别判断。

不增加模型调用、补读或共享修复额度，不扩大正文、候选和上下文预算；没有修改原题以降低验收要求。

## 最后增量与失败证据

外部只读审查发现 `repair_state` 实际输入是 `candidate + issues`，原目录只登记 `draft`。新增真实状态机控制复现缺失，再按 `/candidate/passage` 登记实际正文，无正文副本、无 required 页或新批准凭据。

原 RED、首次修后失败及最终 GREEN 分别保存在：

- `.validation/memory-evidence-v2-20261020/repair-carrier-red`
- `.validation/memory-evidence-v2-20261020/repair-carrier-green`
- `.validation/memory-evidence-v2-20261020/repair-carrier-green-second`

首次修后失败来自新测试错误要求拒稿记录为 nil。生产必须保留拒稿来绑定修复意见；最终断言检查拒稿逐值不变、`Approved=false`、批准用 `evidencePacket=nil`。没有删除生产拒稿来换绿。

独立回核见 `.validation/draft-shape-20261020/memory-evidence-b3-closure-20261020T154602Z.md`。生产 `memory_evidence.go` SHA256 为 `ec4fa2e6fa41c0ab41da2c6148423f92dbd39bdf267ac2821c7da3940e1944ec`；此前两项缓存/读额度 P2 的真实 RED 和修后证据也保留。

## 已执行工程验证

所有目录位于 `.validation/memory-evidence-v2-20261020/`：

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Python 全套 | 104 PASS，0 FAIL/SKIP | `python-full` |
| Rust 默认特性全套及运行时构建 | 151 PASS，0 FAIL/ignored | `rust-v413-final` |
| Rust 无默认特性全套 | 145 PASS，0 FAIL/ignored | `rust-v413-no-default` |
| 完整后端 `-race -tags=integration,codexlive -p 1 -count=1 ./...` | 1148 PASS，0 FAIL，26 显式 SKIP | `backend-v413-full-first` |
| 实际 Rust writer schema 导出前置 | 7 PASS，0 FAIL/SKIP | 同目录 `schema-prerequisite.jsonl` |

计数包含子测试；schema 前置与全套存在覆盖重叠，不能相加当成不同测试数。26 跳过项逐项保存在 full summary，真实模型配置未开启。固定 provider、协议和数据库控制不等于文学质量。

完整后端运行期间源码及运行时哈希均稳定。随后无默认特性测试替换了共享缓存运行时，此变化保存在其 `runtime_unchanged=false`，不追溯修改 full 结果。独立 channel 恢复构建另录 `rust-v413-channel-restore`；新真实批次仍从冻结源码在独立目录冷构建。

## 仍需真实验证

新版本尚未获得原题质量验收。下一批为原 NAR-010、014、017，26 步，保持原输入、预算及失败封口规则。旧 v4.12 批次的 15 次提交、两次失败与 REVIEW 状态不改写，也不能归给 v4.13。

新外置审计需识别 v2 的来源与材料；旧计数器依赖 v1 `source_revision/quote`，不能原样使用。实际请求可核目录、已发送内容与后续提交链；未录制的私有批准凭据不能声称已由外置审计认证。摘要的条件、否定、认识归属、人格化风险和全文叙事质量仍需独立阅读。
