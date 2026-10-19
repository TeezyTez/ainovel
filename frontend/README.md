# ElseLife 产品前端（本地开发工作区）

这是从 Flutter 原仓 `523c0804da66c16e1834823afd064b64bfe2d1a4` 抽出的产品功能源码，不含账号、套餐、支付、staff/admin、旧 task 页面或会话加密。Web 是本导出支持并验证的 target，不含平台 runner。

## 构建与运行

使用 Flutter SDK（本次验证 Flutter 3.47.5 / Dart 3.13.4；pubspec SDK 下限 3.12.2）：

```sh
flutter pub get
flutter test
flutter analyze
flutter build web --no-web-resources-cdn
```

默认 HTTP API 与页面同源。将 `build/web` 交给配套 Go server 静态服务，并从 `http://127.0.0.1:18081/` 打开。

若前端与后端不同源，可显式指定：

```sh
flutter run -d chrome --web-hostname=127.0.0.1 --web-port=18080 --dart-define=ELSELIFE_API_BASE=http://127.0.0.1:18081
# 或
flutter build web --no-web-resources-cdn --dart-define=ELSELIFE_API_BASE=http://127.0.0.1:18081
```

上面的固定开发端口与配套后端允许的 CORS origin 一致；更换端口需要一起调整后端开发 origin。静态资源包括 Flutter renderer，不需要登录、认证密钥或第三方登录脚本。依赖首次下载仍需可用的 Flutter/pub 包源。

## 保留的产品功能

经历列表和创建、正式正文长文阅读、字号/阅读位置、行动与询问（read/act/ask）、资料与关系呈现、操作取消和接手、分支、自然语言反馈理解、明确确认的内容偏好及 CAS、草稿和持久幂等请求/未知结果恢复。原主题、动效与两套本地字体及许可证保留。外观选择和减少动效保存在本地工作区。

JSON client 不发送 authorization，不伪造账号或密钥，不做写请求自动重试。正式故事生成由后端真实模型完成。原 demo 的三个固定预设另存为明确标注的本机演示，与正式模型故事分开保存。

## 数据边界

这是单人单本地工作区，不是多用户或生产安全边界。草稿按 `backendURL + local-workspace + experience + branch` 分离；偏好待确认稿、反馈与外观亦使用独立 scope。存储是新的 `elselife_product_workspace_v1`，不会自动读取或迁移旧账号的 IndexedDB。

服务端历史和内容偏好保存在后端，浏览器保存本机世界版本、草稿/恢复状态、阅读位置、书架整理和固定预设进度。设置中的完整备份同时导出正式故事与本机记录；不恢复正在进行的请求。清理浏览器站点存储会丢失未备份的本机记录。

## Demo 界面融合

`lib/portal_product_screen.dart` 负责页面路由和统一导航，`lib/portal/` 包含首页、世界详情、创作、书架、设置与本机预设；`lib/experience/` 保持正式 controller/协议与阅读器。字体与原场景资源位于 `assets/`，原交互作品和资料视图模块位于 `assets/reader_artifact/`。

当前构建演示由 `../tools/start-local.ps1` 启动，端口18080。模型设置显示 Go 提供的 Codex 配置状态；完整运行和来源校验见 `../INTEGRATION.md`。

详见包内 `../notes/frontend-extraction.md`（抽取范围、变更、验证证据与限制）。
