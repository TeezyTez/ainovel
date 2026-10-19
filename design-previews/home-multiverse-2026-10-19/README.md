# 首页多宇宙视觉候选

用户曾选择 C 和 D 进行组合试做，查看实际效果后决定恢复原来的虫洞造型，并稍微增强浅色模式的网格对比度。以下候选图保留作设计记录，当前首页未采用切片构图。

- `A-membranes.png`：层叠薄膜。
- `B-lenses.png`：微型透镜。
- `C-slices.png`：平行时空切片（曾试做）。
- `D-paths.png`：简洁分岔路径（曾试做）。
- `prompts.json`：概念图生成提示。
- `reference-home.jpg`：修改前首页的构图参考。

以上 PNG 是概念图，不是浏览器验收截图。正式动效由 `frontend/assets/portal_scene/` 中的本地 WebGL 场景绘制，Flutter 负责首页及产品交互；静态 SVG 与非 Web 的 Dart 绘制提供对应构图。此视觉是叙事隐喻，不是多宇宙或虫洞的物理模拟。

生命周期的验证入口为 `node --test frontend/assets/portal_scene/*.test.mjs`，也已接入 `make test-frontend`。
