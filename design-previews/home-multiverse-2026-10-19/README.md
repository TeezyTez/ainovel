# 首页多宇宙视觉候选

用户选择 C 和 D 后，正式首页采用两者的组合：C 的四片平行时空薄片、D 的细路径与少量穿行光点。整体缩小，使用灰紫与浅青色，保留标题与按钮周围的留白。

- `A-membranes.png`：层叠薄膜。
- `B-lenses.png`：微型透镜。
- `C-slices.png`：平行时空切片（选中）。
- `D-paths.png`：简洁分岔路径（选中）。
- `prompts.json`：概念图生成提示。
- `reference-home.jpg`：修改前首页的构图参考。

以上 PNG 是概念图，不是浏览器验收截图。正式动效由 `frontend/assets/portal_scene/` 中的本地 WebGL 场景绘制，Flutter 负责首页及产品交互；静态 SVG 与非 Web 的 Dart 绘制提供对应构图。此视觉是叙事隐喻，不是多宇宙或虫洞的物理模拟。

路径和生命周期的验证入口为 `node --test frontend/assets/portal_scene/*.test.mjs`，也已接入 `make test-frontend`。
