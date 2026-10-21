# 深度基准：阅读锚点恢复回归

本轮延续 `2026-10-19-deep-benchmark-frontend.md` 和 `2026-10-20-deep-benchmark-progress.md`，核对已有未提交的语义阅读锚点与输入修复。测试使用确定的 API 夹具、本机内存日志和 Flutter 合成布局事件；不作为 SYS-019 / SYS-025 整例或实体设备验收通过证明。

## 已复现并修复的问题

| 操作 | 失败证据与根因 | 修复 |
|---|---|---|
| 阅读器保持挂载，同一分支 `open()` 后改字号 | 原字符偏离原位置 171.75px（基础阅读器）/220px（正式阅读器）。`open` 临时清空 current，恢复任务绑定到 seed scope；随后回调因 scope 不符返回，却没有释放恢复锁。 | loading 或没有 current 时不安排恢复；过期 scope 的同一恢复任务释放自身锁，不影响新任务。 |
| 点击分页的“下一页” | 第二页正常显示，但错误弹出“原阅读位置的文字已变化”。分页索引改变时，自动恢复仍寻找已经从组件树移除的上一页。短页无需实际滚动时，也不会自然触发新位置保存。 | 明确导航取消旧恢复/滚动回调并清除旧锚点，再定位用户选择的页；定位结束后安排一帧保存实际新位置，涵盖无滚动动画的短页。 |
| 本地日志写入失败后等待 | 没有新输入，额外 5 帧仍令写入次数从 8 增到 13。`saveReading` 每次重复通知相同错误，通知触发恢复，恢复再次保存，形成逐帧循环。 | 只在字号或错误状态改变时发通知。失败后仍保留错误；存储恢复后，用户重新保存草稿能恢复正常持久化。 |
| 连续阅读第二页时切到分页，或离开阅读器后再以分页打开 | 保存的源文字在第二页，旧的本地分页游标仍为第 0 项，导致第二页消失并错误回退。首次挂载还可能早于分页游标读取完成。 | 布局恢复先按正式页 revision 同步分页游标；首次本地读取未完成时保留源锚点，等读取通知后定位。显式翻页已经清除旧目标，不受此同步覆盖。 |

旧回退用例的 `readingAnchor == null` 断言也得到校正：实际已显示解释并回到 offset 0，后续布局可合法记录**新正文的开头**。现在同时检查视觉回退、保存位置、内存/日志中任何新锚点的正文身份和字符 offset 0，拒绝保留旧正文或复用旧字符序号；没有删除正文失配检查。

## 可复核证据

- 原挂载恢复/主动翻页失败：`.validation/frontend-resume-anchor-red.log`。
- 存储失败循环：`.validation/frontend-resume-storage-red.log`。
- 阅读模式切换失败：`.validation/frontend-resume-mode-red.log`。
- 短页翻页后缺少新锚点：`.validation/frontend-resume-pagination-red.log`。
- 锚点定向：`.validation/frontend-resume-anchor-green.log`，9 passed。
- 静态分析：`.validation/frontend-resume-analyze.log`，退出 0，160 条 info，0 warning/error。
- 最终全量 Flutter：`.validation/frontend-resume-full.log`，退出 0，297 passed。
- `git diff --check -- frontend notes/2026-10-20-benchmark-frontend-anchor.md` 退出 0。

本地执行入口为 `.validation/verify-frontend-resume-20261020.sh`，使用 WSL 的既有 Flutter SDK，`test --no-pub --no-enable-impeller --reporter expanded` 与 `analyze --no-pub --no-fatal-infos`。ASCII 临时目录仅是当前前端目录的分析用软链接，源文件仍在注册项目内。

## 封存正文的浏览器回放

当前生产前端通过 `flutter build web --release --no-pub --no-web-resources-cdn`，输出到独立的 `.validation/frontend-browser-replay-build`。仅在 `127.0.0.1:18125` 启动只读回放服务，读取 `.validation/deep-benchmark/20261019T092722Z/NAR-009/events.jsonl` 的最后一次正式提交（seq 143、revision 7、7 页）；标题加上“封存正文回放”。服务没有数据库或模型连接，所有 POST/PUT/PATCH/DELETE 都记录并拒绝。此验证复用已封存正文，不构成新一次真实模型端到端测试。

T3 preview 可以建立独立隐私页并导航，但同一 snapshot 连续两次返回 `Preview automation snapshot timed out after 15000ms.`，evaluate 也超时；CUA 返回 `No browser is available`。随后改用本机 Chrome 155.0.8059.84 的独立临时配置目录与 headless 模式，通过键盘启用 Flutter 语义层，再执行实际点击、输入、滚轮、视口缩放和刷新。没有打开现有用户配置或数据库。

| 浏览器操作 | 实测结果 |
|---|---|
| 保存“仅本机验证：不买票，也不委托人物行动。20261020-ui-replay”私人笔记，刷新后重新进入笔记面板 | 笔记可见；IndexedDB 的当前体验/分支记录保留 `kind=note`、源 `revision=1` 与相同文字。 |
| 将 revision 3 的段首（正文字符 offset 112）滚动到阅读视口顶部下方 4px | 保存源身份和字符 offset；初始滚动像素 offset 为 1341。 |
| 字号 18→26 | 段高从 234px 变为 376px；段首相对视口 Y 为 3.80px，源字符 offset 仍为 112；滚动像素 offset 变为 1593，说明不是沿用旧像素值。 |
| 视口从 1280×900 改为 390×844，再刷新 | 段高变为 704.19px；重排和刷新后的相对 Y 均为 3.80px，源身份/offset 112 不变，持久化像素 offset 为 2578。 |

两条验证均 `passed=true`、浏览器 `pageerror=[]`，累计 `mutation_requests=[]`，前后公开视图 SHA-256 相同。公开视图 hash 为 `55849d0c10310d07766eeb1db214645fe100392bbd20086e24d442f5a4a852c7`；原 events 文件 hash 为 `75a6f9a2fea6075255ac41cbba5adc0681446bf421f27f47dba4b051f8c7e01d`。已查看窄屏正文与刷新后笔记截图。回放不提供生成 UI artifact，页面底部的对应“重试显示”提示来自刻意返回的只读 503，不属于本次交互通过项。

复核入口为 `.validation/frontend-browser-replay-server.py` 与 `.validation/frontend-browser-replay.mjs`（`notes` / `anchor` 阶段）。证据目录 `.validation/frontend-browser-replay/` 内含 `manifest.json`、`notes.evidence.json`、`anchor.evidence.json`、`final-audit.json`、各阶段截图、语义快照和本地存储快照。以 evidence 内的服务内存审计及 `final-audit.json` 为准；追加式 `requests.jsonl` 在并发读取期间存在一行拼接，不用于计算断言。上述临时工具、构建和隔离浏览器数据均保持在忽略的 `.validation/` 中。

## 覆盖范围与剩余验收

本轮实际核验同一正文字符在字号、行高、宽度重排以及连续/分页切换前后的视口位置（容差 2px），同一挂载和重开恢复、分支隔离、旧正文替换/重复段落的保守回退、主动翻页、存储失败循环及恢复。输入类回归仍验证组合输入保留、组合快捷键不误发送、过期行动草稿不静默换版本，以及四个宽度在 200% 字体和模拟键盘 inset 下的发送/停止入口。

未执行实体桌面/移动 IME、真实软键盘、屏幕阅读器，也未补齐跨段真实选区/剪贴板、双真实客户端调度、60 页三分支完整浏览器路径或目标读者评价。headless Chrome 的窄视口与语义层交互不替代这些验收。本轮没有将这些项目改写为 PASS，没有调用真实模型或改变正式历史权威边界。
