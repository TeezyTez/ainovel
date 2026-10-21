# ElseLife

本仓库现以 **Flutter/Dart 前端 + Go API + Rust 叙事运行时 + PostgreSQL** 为唯一应用工程。2026-10-19 已用融合后的正式工程替换旧 JavaScript/Node Demo；旧代码保留在 Git 历史中，不再作为工作树中的独立应用或启动入口。

## 工程结构

| 目录 | 职责 |
| --- | --- |
| `frontend/` | Flutter 门户、世界创作、书架、阅读器、资料、设置与草稿恢复 |
| `backend/` | Go API、正式历史、分支、版本、取消、提交与 PostgreSQL 持久化 |
| `algorithms/` | Rust 显式叙事阶段、角色提案、剧情比较、正文与审核、结构验证及历史回取 |
| `contracts/` | 各端共享的 JSON 与 protobuf 协议 |
| `tools/artifact-compiler/`、`tools/artifact-validator/` | Go 调用的交互作品编译与校验工具 |

正式故事只由 Go 写入。前端的首页场景和智能交互区域仍复用已接入正式工程的 Web/React 渲染模块，Node 用于其编译和校验，不是主 API。非 Web 平台的交互作品目前使用备用展示；本次仓库替换没有把这些模块改写成原生 Dart。

## 开发与启动

需要 Flutter/Dart、Go 1.26、Rust/Cargo、Python 3.10+、`protoc`、PostgreSQL 16，以及交互工具使用的 Node.js 24.11+。版本约束以各端清单和锁文件为准。

首次准备：

```sh
python3 -m pip install -r requirements-dev.txt
npm --prefix tools/artifact-compiler ci
cd frontend
flutter pub get
cd ..
make test
make build
```

`make build` 的 Web 默认 API 为 `http://127.0.0.1:18081`，可通过 `make build API_BASE=...` 覆盖。数据库初始化与可配置服务启动分别见 [后端说明](backend/README.md)、[运行时说明](algorithms/README.md)、[前端说明](frontend/README.md)。只在独立开发库执行初始化，不覆盖已有故事数据库。

本机 Windows/WSL 环境已安装上述工具并准备数据库时，可在**仓库根目录**运行：

```powershell
.\tools\start-local.ps1 -Build
.\tools\start-local.ps1 -Check
```

该启动器的 `-Build` 构建 Go/Rust；首次运行前仍需安装 Node 依赖并完成 Flutter Web 构建。页面为 `http://127.0.0.1:18080/`，Go 为 18081，Rust 为 18083。启动器会检查已占用端口的进程身份，无法匹配时不会结束未知进程。本机工具路径和模型选项见启动脚本与后端说明；它不是新机器自动安装器。

## 验证

```sh
python3 tools/verify_project.py
make test
cd frontend && flutter analyze --no-pub
```

Go 的隔离 PostgreSQL、Rust 和交互工具集成测试见 `backend/README.md`；交互编译器测试运行 `npm --prefix tools/artifact-compiler test`。本轮结果见 [替换验证记录](notes/2026-10-19-repository-replacement.md)，功能迁入情况见 [融合记录](INTEGRATION.md)。

叙事生成 v3 的改动、测试、真实模型耗时和限制见 [叙事改造记录](notes/2026-10-19-narrative-generation.md)，完整合成场景正文见 [连续阅读对比](notes/2026-10-19-narrative-reading-samples.md)。

v4 将生成拆为 memory / actor / plan / evaluate / write / extract / review，加入随分支保存的私有叙事笔记和版本绑定的下一段准备。正式应用入口启用 v4 严格流程，本机服务已切换；真实模型结果、失败和性能限制见 [显式叙事引擎记录](notes/2026-10-19-narrative-engine.md)，完整正文见 [v4 阅读样本](notes/2026-10-19-narrative-engine-samples.md)。

默认阅读篇幅、精简提取的真实模型对照及验证边界见 [阅读篇幅与耗时验证](notes/2026-10-20-reading-length-latency.md)。

当前源码叙事引擎为 v4.13，记忆索引与实际证据分离的工程验证见 [记忆证据记录](notes/2026-10-20-memory-evidence-v2-validation.md)。2026-10-21 的重新构建、全量回归与本机真实开场联调见 [本地交付记录](notes/2026-10-21-local-release.md)。

`SOURCE_MANIFEST.json`、`SOURCE_REVISIONS.json` 与 `验证记录.md` 保留源码包的历史来源证据，不代表当前工作树的完整性清单。`tools/verify_source.py` 只用于核对原始未修改源码包；当前迭代以 Git、协议检查和实际测试为准。

## 数据与范围

本工程提供本地单工作区入口，不包含账号、套餐、支付、运营后台或生产安装器。它不自动导入旧 Demo 的故事。模型授权、数据库、用户经历和构建缓存不得加入版本控制。备份、分支和客户端本地记录的数据边界见各端说明。
