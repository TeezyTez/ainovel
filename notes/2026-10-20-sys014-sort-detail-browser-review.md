# SYS-014 S03：同源公开资料排序、详情与关闭补充验证

2026-10-20 完成。复用已有 Flutter web 构建，独立 Chrome 实测与独立证据核验通过；没有修改产品、active fixture 或 coverage，没有构建、模型调用或用户数据库连接。原 SYS-014 S03 的基准状态不回填 PASS。

新证据目录：`.validation/sys014-ui-details-20261020T042216Z/`。`check07` 于 04:35:26.798Z～04:36:28.955Z 执行，Chrome `155.0.8059.84`，1440×1000。后续 `visible08` 单独补全实际视口几何证据。入口为独立 loopback `18128/#/story/benchmark-story`；完成后已核对命令行并停止自己的 PID 10116，端口不再监听，未停止其他服务。

## 来源与完整性

- 正式来源：`.validation/deep-benchmark/20261020T031340Z-reading-editorial/SYS-014/events.jsonl`，完整 60 个事件、sealed root、唯一 S02 `operation_committed` seq 34，r3，3 页。没有改用后来的 S04/r4 或币制补充世界。
- root：`d5d84fc7da380d8043862987fa28f9cb752ede97524d66f1f05ddc0095a5abf9`。
- events SHA-256：`0a88d7bc33f80f743fd12dbb4e51b9fdf7f6283bcf6b966fa77a69ed2e8150a1`。
- 回放 public view SHA-256：`890345b0aa1ddacdfa08fca08b548e9963f2076f744607c9f7f897c17a418fca`，逐对象等于原提交事件。服务只发送这份公开视图；来源全轨迹副本不作为 web 静态目录暴露。
- 复用 `.validation/sys014-ui-20261020/build/main.dart.js`，SHA-256 `d4eb0d2c96a1606dbf9e0b3a255c878a2dc1237af8490025ed98638d72dad255`。旧构建前后清单相同；启动与最终独立核验均检查 167 个当前源码/资源文件，全部匹配。

静态期望先由原 view 的 15 项记录生成：6 个命名实体、9 条以正文作显示名称的记录。名称唯一、最长 41 个 UTF-16 单元，不涉及截断和平局。浏览器执行器使用逐字名称定位，独立验证器另以 UTF-16 大端字节比较计算 ordinal 顺序，未调用产品排序函数。

## 已完成的浏览器行为

`check07` 共 76 项断言通过：

- 34 次完整表格顺序比较，包括两方向首次排序、30 次详情返回后的完整 15 项顺序，以及嵌套详情返回。每一方向均实际点击全部 15 个对象。
- 37 次详情正文比较：30 次表格对象，梯子父详情/嵌套交接事实/返回父详情 3 次，卡片与文字摘要各 2 次。以真实鼠标选择可选正文、Ctrl+A 后的 `window.getSelection()` 和实际 textarea 值双重读取，与原记录逐字比较；没有读写系统剪贴板，也未写入或替换 DOM/产品状态。
- 梯子详情中的 4 条相关正式事实集合，精确按原 `related_ids` 校验；打开第 3 版交接事实，核对正文与“记录版本 3”，关闭回父详情，再关闭回完整列表。
- 卡片、文字摘要各升/降序的 4 组完整记录顺序；真实滚动收集原始 ARIA 与截图，未用一条搜索结果代替全表。
- 最后关闭资料面板后，正文页的完整 ARIA 与进入前相同，未退出世界或跳转阅读位置。整个 `public_view` 前后深比较相同，包括全部页面、分支、revision 与公开记录。

另用 `visible08` 补充 4 组可见几何检查，每组 7 个实际滚动位置、15 项均进入视口。每个观测记录保存对应无障碍名称及浏览器 bounding box，要求正文区域处在 y=190～980 的可见范围内；独立验证器重新核对记录 ID/名称、几何范围、去重后的完整顺序及前后原 view。这补足了“ARIA 可能预加载屏幕下方项”的取证边界。

最终独立命令：

```text
node .validation/sys014-details-verify.mjs check07
```

退出 0，`VERIFIED_BROWSER_REPLAY`。独立核对来源全链、原 source 文件仍未变、view 对象、排序、正文、几何和请求；不是只信任执行器的 `passed` 字段。结果为正文差异 0，世界写请求 0，JavaScript `pageerror` 0；check07 客户端 49 个请求，整个新服务期间 475 个请求，全部为 GET/HEAD。

## 原始失败和限制

T3 按要求先 `preview_status`、独立 incognito `preview_open`，能打开且显示正确标题，但两次 `preview_snapshot` 都在 15000ms 超时。已保存 `t3-preview-attempt.json` 并关闭自己的 tab，之后采用已授权的实际 Chrome/Playwright。

新目录的 `check01`～`check06` 失败均保留，旧目录 check1～5 没有覆盖：

- check01：可选正文未获得真实焦点时，Flutter 语义 textarea 的值为空；截图已有正文。
- check02：详情弹出动画未稳定，鼠标取证点未命中正文。
- check03：用按钮 `textContent` 读取语义按钮名称，未取得四条关联事实的无障碍名称。
- check04：列表滚动使“调整呈现”收起，脚本未重新展开就等待排序开关。
- check05：关闭弹层后连续对定位器发送按键重新抢焦点，只删除搜索框中的一个字。
- check06：滚动返回后 `fill` 未进入实际输入焦点，搜索条件未生效。

最终脚本等待详情几何稳定，按真实 UI 展开呈现设置，显式点击并等待焦点后使用全局键盘事件。产品代码未改；这些失败不能据此认定原文丢失、世界变化或实体设备输入失败。确切失败轨迹仍可复核。

独立 verifier 首次还纠正了一项过强假设：旧构建会 GET `fonts.gstatic.com` 的 6 个固定 NotoSansSC WOFF2 分片。完整 URL 已记录，未发送故事参数；最终核验仅允许这六个静态地址，其余非 loopback 请求拒绝。故本次不声称完全离线。只读回放没有 artifact API，正文底部既有该 API 的 `replay_read_only` 提示；它在进入/关闭前后相同，本次不验收真实交互作品加载。

这项结果仅补充 SYS-014 S03 的名称排序、详情身份、记录来历、关闭返回与客户端只读边界。没有证明数值/null 数学排序、同名对象、其他分支、旧节点、13 个 UIX 原题、手机/IME、真实用户易用性或文学质量；模型调用 0，DB 为 null。

## 主要文件摘要

| 文件 | SHA-256 |
| --- | --- |
| `check07-evidence.json` | `0d512c39fa0de799c21a2e345acd423d8ef1bc8d9d7ed7b14eeb7a1c4dc0e061` |
| `visible08-evidence.json` | `e096f9683f5d034908a70b371230f4b32575b769d83013337e131ecf3b771efd` |
| `check07-independent-verification.json` | `e0acb07b8202b2a77e22488e8f8fb93ff5faa6e9f2100c969bc0e23feb0b1f27` |

最终执行器、可见性脚本、服务及独立验证器副本均保存在新证据目录。规划与原题范围取舍见 `.validation/next-fixture-drafts/ui-next.md`。

目录完整性清单 `evidence-seal.json` 绑定 597 个证据文件（不含清单自身），SHA-256 为 `988898b3a3ff8fb4f2189d2cc449f7cb884ecfba60b6027f0c8940058b0b28e7`。这是文件完整性清单，不冒充原生模型事件链。
