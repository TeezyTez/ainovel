# Flutter 产品源码抽取记录

## 结果与版本

- 输出：`frontend/`（本文件同级上层目录）。独立 Web 源码工程，已在该导出目录实际完成 pub get / test / analyze / build web。
- 原仓：`/opt/cs/elselife/frontend`，提交 `523c0804da66c16e1834823afd064b64bfe2d1a4`。开始先读原 AGENTS；全程仅从原仓读取，末次 `git status --porcelain` 空、HEAD 不变。未提交、未读 .env、未调用模型。
- 本次构建 SDK：`/opt/cs/sdk/flutter/bin`，Flutter 3.47.5 / Dart 3.13.4。

## 保留的原码

- `lib/experience/` 全部原产品模块：models、controller、screen、edit dialog、client 接口、journal、failure copy、preferences screen、feedback panel；只在必要边界适配，没有改造阅读布局。
- `lib/ui/theme/elselife_theme.dart`、`lib/ui/motion/elselife_{animated_surface,route_motion}.dart`：原主题和动效闭包。
- `lib/data/store/{local_store_factory,store_platform_io,store_platform_web}.dart`：草稿所需 sembast/IndexedDB 闭包。
- `assets/fonts/`：原 Roboto/NotoSansSC 字体及各自 LICENSE。
- 原产品 controller/widget 测试与配套 fixture/test app；账号相关断言已替换为单工作区和 backend scope 隔离测试，不携带账号测试或凭证。
- 保留 read / act / ask、资料与关系、分支、取消与接手、正式历史、阅读字号/位置、草稿、持久 request_id、未知结果恢复、错误分类、内容偏好五字段 CAS、自然语言反馈候选和用户确认流程。

## 必要变更

1. `experience_client.dart`：保留 `ExperienceApi`，移除 ApiClient/Gateway；使用 `package:http` 的 UTF-8 plain JSON HTTP。无 auth header、PSK、假账号/密钥、自动写重试或客户端模型。30s transport timeout 不冒充失败已确定；controller 仍保留 unknown/receipt 查询。
2. `workspace_session.dart`：单 `local-workspace` 状态抽象（不是账号或权限）。owner 和 journal scope 是 `backendURL + workspace + experience + branch`。backend 更换使旧观察失效、旧草稿留在原 scope；同一 backend 的分支/经历不合并。主题和减少动效通过同一 journal 保存，失败可见。
3. `main.dart`：只有产品入口和偏好导航；默认 API 为页面同源，显式 `--dart-define=ELSELIFE_API_BASE=http://127.0.0.1:18081` 可覆盖。移除账号/签入/注册/套餐入口与 shell；没有导入旧 pages、task、sessioncrypto、staff/admin、支付。
4. UI 登录提示改成本地工作区说明；API scope mismatch 文案同步改为工作区。保留原产品界面和本地字体，不重新设计。
5. 本地数据库名改为 `elselife_product_workspace_v1`，避免同源部署时误取旧账号数据库。journal scope 使用 `workspace` 标签；不自动迁移旧账号/匿名草稿。只暴露测试需要的 database 注入参数。
6. 新建最小 pubspec、pubspec.lock、纯 Web index；没有复制 turnstile/旧入口路由脚本，不生成其他平台 runner。保留 IO store 条件分支不代表已支持 native 平台。

## 已亲核的 HTTP DTO 契约

原 ExperienceClient 直接使用对象（没有 `data` 外层包装）；新 client 保持如下路径和响应：

- `GET /v1/experiences` → `{experiences: [...]}`。
- `POST /v1/experiences`、`GET /v1/experiences/{id}?branch_id=...`、`POST /v1/experiences/{id}/branches` → 直接 ExperienceView。
- `POST /v1/experiences/{id}/operations`、`GET /v1/experiences/{id}/operations/{requestId}`、`POST .../{requestId}/cancel` → 直接 ExperienceOperation；cancel 请求为 `{}`。
- `GET /v1/experience-requests/{requestId}` → 直接 receipt 对象。
- `GET/PUT /v1/experience-preferences` → `{preferences: [...]}`；PUT 原样携带 expected/CAS 字段，不抹去未知或自动换新版本。
- `POST /v1/experience-preferences/interpret`，请求 `{text: 原文}` → 直接解释对象。
- 非 2xx：`{error:{code,message}}` 保留 status/code/message；非 JSON 错误保留 HTTP status。成功响应不是 JSON 对象则拒绝，view 的 id/branch 不符则拒绝。

## 可执行验证与外置日志

下面所有命令都在导出目录 `/opt/cs/elselife/exports/elselife-product-source-20261015/frontend` 实际执行，最终退出码均 **0**：

```sh
/opt/cs/sdk/flutter/bin/flutter pub get
/opt/cs/sdk/flutter/bin/flutter test
/opt/cs/sdk/flutter/bin/flutter analyze
/opt/cs/sdk/flutter/bin/flutter build web --no-web-resources-cdn
```

- pub get：`/tmp/elselife-frontend-pub-get.log`。
- test：`/tmp/elselife-frontend-test.log`，最终 **36 tests passed**。
- analyze：`/tmp/elselife-frontend-analyze.log`，**No issues found**。
- build：`/tmp/elselife-frontend-build-web.log`，**Built build/web**；本地 renderer 资源构建，不依赖运行时 CDN；Wasm dry run 成功不等于执行过 Wasm 版本。
- 新 `experience_json_client_test.dart` 覆盖全部 API 方法、UTF-8/URI 编码、CAS body、结构化/非 JSON 错误、无 auth、无重试、超时和错误分支视图；原产品适配测试覆盖主要 controller/widget、IME/长文/字号/位置、unknown/cancel/branch、偏好冲突与待确认草稿。
- 构建输出、`.dart_tool`、插件生成元数据在验证后移除，源码包不携带 build/cache/.git。下载依赖和构建时会重新生成。

## 限制与未验证

- 仅本机开发、单工作区；删除身份底座后不再具备旧账号身份认证/多用户访问隔离，不能将本地 scope 当作服务端授权。多个浏览器连接同一个无 auth 后端共享同一开发工作区；不要公网部署。
- 未运行浏览器真实后端/模型端到端生成；本次测试使用明确位于 test/ 的 fixture/HTTP MockClient，不提供运行时 fixed 故事。后端配套进程的实际契约/真实模型效果由整体集成验证补充。
- 不把本机草稿混作正式历史；正式历史/内容偏好仍由服务端保存。新机器不会自动得到旧 IndexedDB 草稿；账号数据迁移不在此包内。
- 不承诺 native/Linux、生产部署、账号同步或 Wasm target；没有复制或自造 runner。
