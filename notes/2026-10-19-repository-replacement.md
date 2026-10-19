# 正式工程替换记录（2026-10-19）

## 范围

按用户要求，用 `C:\workspace\elselife` 中融合后的正式工程替换现有 Git 仓库的旧 Demo。保留原提交历史，当前开发根目录就是本仓库；推送目标为远程 `main`。旧目录内容在替换前已移到本机临时目录中的独立备份，未上传其中的故事、环境配置或缓存。

- 导入 Flutter/Dart、Go、Rust、PostgreSQL 协议及实现；复制时逐文件 SHA-256 比较通过。
- 移除旧根目录 `package.json`、`server.mjs`、`src/` 及旧 Demo 的独立测试、构建和启动入口；不携带 `demo-source/` 副本。
- 启动脚本统一为 `tools/start-local.ps1` / `.sh`，路径从仓库根推导；构建显式配置 Go API 地址。
- 用 `tools/verify_project.py` 检查当前工程入口、共享协议、Rust hash pin 和旧应用移除情况。旧快照校验依赖已缺失的 MIGRATION_MANIFEST 和 demo 副本，因此退役；原始 SOURCE 清单继续保留为历史来源证据。
- 补全缓存、授权、环境和用户数据忽略规则，固定跨平台行尾。
- 修复交互校验测试的文件 URL 转换，使中文目录也能运行 worker；未改变产品行为。

本次替换沿用正式工程已有的 Web/React 场景与交互作品、Node 编译/校验工具及 Rust 运行时，没有将这些部分重新实现为 Dart/Go。

## 本轮验证

| 项目 | 实际命令 / 结果 |
| --- | --- |
| 工程与协议 | `python tools/verify_project.py` 通过；四份经历 JSON 的 Git blob 相同 |
| Python 合同 | `python3 -B -m unittest discover -s tests -p 'test_experience_boundary.py' -v`：9 项通过 |
| Go | `GOWORK=off GOPROXY=off go test -count=1 ./...`、`go build ./...`、`go vet ./...` 均通过 |
| Go 集成 / race | `go test -race -json -tags=integration -count=1 ./...`：162 个顶层测试、含子测试 241 项通过；唯一跳过为父测试专用的失败清理 helper |
| Rust | 默认 feature 44 项通过；`--no-default-features` 测试通过；`algorithm-runtime` 构建通过。清理本 crate 的旧缓存后再次验证了新根的输入路径 |
| Node 编译器 | `npm --prefix tools/artifact-compiler test`：4 项通过 |
| Node 校验器 | `node --test tools/artifact-validator/validate.test.mjs`：16 项通过 |
| Flutter 静态分析 | 0 error、0 warning、154 条既有 info。默认分析因 info 返回非零；`--no-fatal-infos` 返回 0，不宣称无 lint |
| Flutter 测试 | `flutter test --no-pub --no-enable-impeller --reporter expanded`：244 项全部通过 |
| Flutter Web | `flutter build web --release --no-pub --no-web-resources-cdn --dart-define=ELSELIFE_API_BASE=http://127.0.0.1:18081` 构建通过 |

数据库集成使用自动创建并清理的独立临时 PostgreSQL 实例，未连接真实故事库。Go↔Rust 和 Node worker 的集成路径均实际运行；本轮未调用真实模型或执行生产部署。

## 本机环境注意事项

验证使用 WSL Ubuntu 24.04、Go 1.26.0、Rust/Cargo 1.99.0、PostgreSQL 16、Flutter 3.47.5 / Dart 3.13.4、Windows Node 24.20.0。

Flutter 3.47.5 的 analyze LSP 客户端按字符数而非 UTF-8 字节数发送 Content-Length，中文工作目录会导致初始化 JSON 截断。本轮用指向当前前端的 ASCII 符号链接作为显式 analyze 目标验证，没有拷贝旧源码或修改 SDK。

DrvFS 上普通 Linux 用户可写但不能 chmod Windows 挂载文件，导致 shader 编译中断；测试与构建改由 root 执行，仅通过该进程的环境变量指定 SDK safe.directory 和现有 pub cache，没有修改全局配置。失败编译留下的 Vulkan-only unit_test_assets 也已精确清理，Web 发布产物保留。无界面测试使用 `--no-enable-impeller`。

原 `验证记录.md` 和其他日期的 notes 属于历史验证；不能把它们的结果当成本轮执行证据。
