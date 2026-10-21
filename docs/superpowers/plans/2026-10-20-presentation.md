# ElseLife 页边记事实施计划

> **For agentic workers:** 主线程执行集成；独立纯投影任务并行委派。使用测试先行和完成前验证；附件已授权范围内直接实现，不新增确认关卡。

**Goal:** 让阅读页、公开记载、前文关联和回读返回在实际阅读器中保持一致。

**Architecture:** 纯 Dart 页快照索引负责公开资料差异与首次公开定位；Flutter 记事组件负责展示；现有阅读器负责视口、跳转、草稿和生成操作。复用现有 `ExperiencePage.reader` 和源文字锚点。

**Tech Stack:** Flutter 3.47.5 / Dart 3.13.4，现有组件与主题，无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-20-presentation-design.md`

## 约束与复核重点

- 历史只读该页快照；不以最新资料补空白，不以建档版本当发现版本。
- 新增资料不是新发生的事件；相关记录不是因果判断。
- 回读不改变 act/read/ask 的正式最新版本，草稿继续受原校验保护。
- 分支切换、异步生成完成、窄屏重排不能复用旧分支的返回目标。
- 大量记录使用懒列表；正文入口保持短小；完整原文可访问。

## 任务 1 公开页快照索引

**Files:** 新建 `frontend/lib/experience/reader_page_context.dart`、`frontend/test/experience/reader_page_context_test.dart`。

**Interfaces:** `ReaderPageContextIndex(view).at(revision)` 提供页面快照和差异；`appearanceOf(item, throughRevision:)` 返回最早公开页；`earlierRelated(item, revision:, limit:)` 返回明确关联的旧记。

- [x] 测试迟公开／快照缺失／同 ID 更新／次序变化／明确关联／分支隔离。
- [x] 运行并确认预期失败，再实现索引与不可变结果。
- [x] 定向测试通过；将接口交给主线程。

## 任务 2 记事面板与阅读器集成

**Files:** 新建 `reader_notebook.dart`、`reader_notebook_host.dart`、`reader_notebook_test.dart`；修改 `experience_screen.dart`、`reader_position.dart`、`reader_tools.dart`。

**Interfaces:** 记事组件消费任务 1 的索引，通过 `onSource(int)` 和 `onInspect(...)` 回调通知阅读器。阅读器持有源锚点返回目标，限制在同一 scope。

- [x] 先增加真实阅读器 widget 边界断言，确认旧页泄露后页资料的失败。
- [x] 实现简短页尾入口、桌面／窄屏共用面板、差异与截至此页视图、关联旧记。
- [x] 以视口源锚点同步页眉和记事页；回读时明确行动接续最新页。
- [x] 来源跳转保存锚点，返回恢复字位置；分支变化清空；保留全部旧工具入口。
- [x] 定向测试覆盖回读、返回、草稿、空快照和窄屏字号。

## 任务 3 运行与证据

**Files:** `notes/2026-10-20-presentation.md`；临时比较、构建与运行证据保存在 `.validation/presentation-20261020/`。

- [x] 同材料比较候选，记录选择与代价。
- [x] Flutter 全量测试、analyze、Web 构建、`tools/verify_project.py`。
- [x] 新建专属验证故事，浏览器完成行动／等待／结果／继续可用／回读／返回／重开；异常由测试和实际状态共同检查。
- [x] 检查第二种材料及保留反例；桌面、390px、放大字体与减少运动。
- [x] 独立审查本轮文件及相对任务开始备份的差异，修正有依据的问题，记录最终证据与限制。

## 执行记录

- 已核验本机 18080 / 18081 / 18083 服务；真实页面可读。
- 已保存待修改文件的开始状态到 `.validation/presentation-20261020/before/`。不提交整个脏工作树，不移动既有工程。
- 已创建唯一的新验证故事，稳定幂等请求 `presentation_validation_20261020_courtyard_begin_v1`；结果另记。
- 已完成正式 act、资料对照、回读返回、非空草稿与重入恢复；日常窄屏实测发现的动画／延迟保存竞争已在同一材料复查通过。
- 最终全量 326 项通过，分析 0 error／0 warning（160 info），正式／回放 Web 构建与项目协议检查通过。完整证据与适用边界见 `notes/2026-10-20-presentation.md`。
