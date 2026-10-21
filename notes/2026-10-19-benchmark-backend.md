# 深度基准：后端边界实测与修复

本轮使用 `ElseLife_深度测试基准_2026-10-19.md` 的验收事项。以下是固定候选、真实 Go 服务和隔离 PostgreSQL 的边界回归，不代表整例、真实模型文学效果、真人阅读或真机验收通过。

## 四个先失败后修复的问题

| 对应边界 | 首次实际失败 | 原因与改动 |
| --- | --- | --- |
| SYS-017 S01/S02，H1 | Get/List 的 `information` 返回了「乌柏相信秘密联盟已经成立」和 `fact:hidden-belief`，同响应 `reader.information` 没有返回 | 两套投影分别实现了 Known 判断。`Project` 现在先走唯一的 `ReaderState`，隐藏主体的命题、关联和计数一起过滤。 |
| SYS-007 H1；SYS-016 的模型入口边界 | 宋的 actor 输入 `facts` 正确只有甲仓，但 notebook 的 goals/voice/stance 含乙仓 | director notebook 在全世界权限下生成，给它附几个合法 fact ID 不能证明整段自由文字的知情来源。actor 现在只获得自己 `known_by` 授权的事实；人物动机也必须通过这些事实提供。director notebook 保留给导演使用。 |
| SYS-001 H3 的角色知情边界 | 只把玩家 `Known` 位从 false 改 true，黎桑的 actor 输入随之改变；没有传播事件 | actor 复用了存储 Fact DTO。新增私有 actor DTO，不序列化玩家 Known、其他角色 KnownBy 和 reader 展示载荷。 |
| SYS-001 H3 的读者知情边界 | 只给邵舟增加一条私下 KnownBy 边，ReaderState/ask 输入随之包含邵舟 ID | 玩家知道命题不等于知道每个角色的私下知情情况。读者投影清空 KnownBy；可公开的获知/传播事件仍以独立已知事实表达。 |

首次失败由实际 `go test` 输出确认；修复后的机器日志为 `.validation/benchmark-backend-boundaries.jsonl`。以上回归均有正控制：合法公开资料、宋自己的取件目标、角色已知事实继续可用，未关闭整个资料/actor 功能。

## 新增可分享导出与作者备份的边界

`GET /v1/reader-export` 输出 `format=elselife-reader-export, version=1`。导出同一 MVCC 快照下本工作区的全部经历和分支，只包含正式正文、建议、故事时刻与各页当时的 ReaderProjection。没有 seed、玩家 input、完整 State、AuthorWorld、Notebook 或互动定义代码。

测试先导出未公开秘密，再正式公开一条秘密，然后从发现前节点分叉。当前分支可导出这条已经公开的信息；旧页和旧节点分支保持原来的可见性。其他工作区的导出为空。

`GET /v1/archive` 仍是明确的作者完整备份，用于无损恢复隐藏事实和笔记；前端把它标为作者备份并说明包含未揭示内容。它不是普通阅读分享格式，也不把本地单工作区开发入口宣称为生产权限系统。

## 新增独立数据库/进程证据

| 测试 | 实际执行范围 | 不作的覆盖声明 |
| --- | --- | --- |
| `TestBenchmarkSYS017HiddenSubjectCannotBypassReaderProjection` | 同一真实服务 Get/List/Reader 一致投影；独立 SQL 确认隐藏权威数据仍在、读操作不改状态 | 不代替完整 UI、检索延迟侧信道或真实模型泄漏测试 |
| `TestBenchmarkSYS017ReaderExportPreservesHistoricalRevealBoundaries` | 读者导出、正式揭示、旧页、历史分叉、独立工作区、完整作者备份 | 不宣称所有导出和生产角色鉴权已经验收 |
| `TestBenchmarkSYS018BusinessIdentityCommitsOnceWithoutRollingBackReceipt` | 同 K 三并发受理与生成，仅一次正式结果；同 K 异 payload 冲突；新 K2 同文可执行；旧 K 回执不回滚当前状态；SQL page/commit 计数 | 候选是固定事实，不是金额执行器测试；尚未覆盖此例真实网络代理断连和 UI 反馈 |
| `TestBenchmarkSYS020RealProcessDeathPreservesAtomicDelivery` | 数据库 trigger 在提交事务内暂停，真实 kill 子 Go 进程；另一次在 commit 后、预备分发前 kill。SQL 状态/正式页/回执全部有或全无；重启回取不重调模型 | 不把固定候选当真实模型质量；当前架构没有异步叙事索引消费者，未假造队列乱序和向量重建测试 |
| 同 SYS-020 正控制 | 收信人收到封口信后立即知道「收到」，仍不知道内文；之后独立授权拆读并正式提交后立即获得内文；notebook 与正式结果同事务保留 | 不把收到信自动解释为读过；不宣称真实模型已通过所有传播场景 |

进程故障日志保留实际 PID 与 `before_commit` / `after_commit_before_preparation` 故障点。被杀的是本测试启动的子进程，数据库是测试独立临时数据库；本机运行中的用户产品服务和存档未被这些测试终止或修改。

## 运行

在 WSL 的 backend 目录使用 `/opt/elselife-tools/go/bin/go test -race -tags=integration ./internal/experience -run TestBenchmark -count=1`。实际 Rust transport/完整 Go 回归使用 `.validation/verify-benchmark-backend.sh`，输出 `.validation/benchmark-go-integration.jsonl`。

`TestBenchmarkSYS020CrashProcessHelper` 是子进程入口，常规测试收集时明确 skip；不能把这个辅助入口计为一个已执行基准案例。

本轮完整 Go `-race -tags=integration -count=1 ./...`：330 个测试/子测试记录通过、2 个预期子进程 helper 跳过；`go build ./...` 和 `go vet ./...` 通过。此计数是工程测试数，不能解释为 330 个基准检查点或 78 个主案例通过。
