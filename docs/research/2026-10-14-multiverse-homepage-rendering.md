# 动态多重平行世界首页：渲染方案研究

日期：2026-10-14。状态：研究与设计建议，未实现、未安装依赖、未做性能实测。

用户方向：持续动态、鼠标响应、滚动穿越都需要。延续已认可的黑白主界面与局部虹彩虫洞。本文研究技术选择；不声称已在浏览器观察月之暗面官网的动态行为，也不以官网品牌工具直接决定本产品架构。

## 参考官网的证据边界

主 agent 于 2026-10-14 通过 `Invoke-WebRequest` 获取并检查 [月之暗面官网](https://www.moonshot.cn/) 实际返回的 HTML，确认引用 `unicornStudio-2.1.4.umd.js`，内嵌 `script#hero-scene-data` JSON。该场景声明 `options.fps=60`、`dpi=1.5`；这是配置目标，不是实测帧率。其 history 数据包括 `godrays` 的 `trackMouse=.61`/`momentum=.76`、`replicate` 的 `animating=true`、`voronoi` 的 `animating=true`/`trackMouse=.8`、`chromab` 的 `animating=true`/`trackMouse=.25`、`liquify` 的 `animating=true`/`trackMouse=.2`/`momentum=1`，以及 `beam` 的 `animating=true`。证据由主 agent 在本次任务中提供，本文作者未重复下载。

这些字段支持“官网声明了时间动画与指针相关的着色器视觉”的判断，不能仅凭 history 数据确认每层在最终画面中的可见贡献。两次 IAB 加载超时，因此没有验证实际动态观感，也没有验证官网是否存在滚动穿越。用户要滚动穿越属于本项目新增设计目标。

## 当前代码事实

- 首页由 `src/library-ui.js:64` 输出标题、创建入口和 `universeSculpture()`。`src/multiverse-art.js` 生成确定性的 SVG 虫洞群，使用七个不同位置和尺度的 `<use>` 节点。
- `src/multiverse.css:99–114` 将雕塑限制在最大 268px，并以 18–38 秒 CSS 漂浮、8–13 秒线流和 24 秒环流制造运动；`src/interface-motion.js:39–46` 给出约 ±4° 鼠标倾斜和 ±10px 漂移。因此已有持续运动与鼠标响应，但主体仍是局部装饰，没有贯穿首屏的空间镜头。
- 世界卡片当前使用 `.world-scene` JPG 背景（`src/multiverse.css:131–135`）。`worldAtmosphere()` 不输出 canvas（`src/library-ui.js:36`）。虽有 `src/world-field.js` Canvas2D 场景和 `app.js:134` 的 mount 调用，但 mount 在宿主没有 canvas 时跳过（`world-field.js:296`）。不能把首页现状称为正在运行的 Canvas2D 场景。
- 可复用的 Canvas2D 代码包含港湾、山岳、书籍、茶馆图形；具有 DPR 1.5 上限、可见性观察、页面隐藏暂停、系统/应用减少动态效果和触摸禁用指针倾斜（`world-field.js:249–318`）。其绘制循环在入场和鼠标缓动结束后停止，若用于持续动态首屏需改调度。
- `package.json` 无 Three.js 等依赖；`index.html` 直接加载原生 ES module。`app.js:134` 的 render 会替换页面 DOM，新场景必须显式处理卸载、再挂载及资源释放。

## 方案比较

以下成本和适合度为针对本项目的工程推断，非基准测试结论。

| 路线 | 能表达的首页 | 与现有代码契合度 | 主要代价 | 判断 |
| --- | --- | --- | --- | --- |
| 现有 SVG / Canvas2D 延伸 | 分层门洞、光流、多个世界慢漂；鼠标改变层间偏移；滚动以缩放和平移模拟靠近 | 最高；已有图形和交互偏好规则，但 Canvas 需要接线 | 大幅度空间穿越和光学变形需要自行实现；二维图形视觉语言可能偏插画 | 适合先验证构图和节奏，也适合作为降级 |
| Three.js / WebGL 场景 | 真正的前后层级与透视镜头；一个主虫洞、多个远近世界；随鼠标改变观察角度；滚动推进镜头 | 中等；可保留 HTML 文案、导航、卡片与素材，新建独立首页场景模块 | 新依赖、着色器/纹理预算、GPU 生命周期、设备验证 | 对“三者都要”的长期交互方向最合适，推荐 |
| 预渲染视频 + HTML 前景 | 已制作好的电影感动态底图；前景文字/按钮/少量光效响应指针 | 代码接入简单；需生产横竖屏素材与静态海报 | 视频内世界无法根据任意指针位置改变视角；滚动逐帧 seek 的效果须按编码和设备实测 | 若主要目标是固定镜头的品牌展示，可用；不作为自由穿越主方案 |
| Unicorn Studio 制作后嵌入 | 编辑器创作的着色器视觉与事件效果 | 需要额外创作工具及运行时，和产品状态集成需定义变量 | 长期版本/场景资产维护依赖工具工作流 | 品牌首屏备选；不必因参考官网使用而跟随 |

技术依据：Three.js 的 `PerspectiveCamera` 用透视投影模拟镜头，`ShaderMaterial` 允许自定义着色器；当前 `WebGLRenderer` 使用 WebGL2，自 r163 起不支持 WebGL1。上述判断不意味着必须制作完整 3D 游戏世界。[PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)、[ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html)、[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)

已有 Canvas 绘图可通过 `CanvasTexture` 作为纹理复用；该 API 接收 canvas 元素。建议将静态图形一次绘制后上传，动态变化留给位置和着色器参数，而非默认每帧重绘全部插画。这是复用路线建议。[CanvasTexture](https://threejs.org/docs/pages/CanvasTexture.html)

Unicorn Studio 官方运行时支持发布场景或托管 JSON、渲染比例、DPI、FPS、懒加载和禁用移动鼠标交互，并明确要求 SPA 卸载时销毁场景。其文档支持将场景变量作为代码集成点，场景支持制作时定义的滚动和鼠标状态。因此可以作为更快生产独立品牌首屏的候选路线；本次不安装或连接该工具。[官方 SDK](https://github.com/hiunicornstudio/unicornstudio.js/)

## 推荐的场景边界（方案，尚未实现）

建议用一个 WebGL 画布承担首屏宇宙，以 HTML 承担可读文字与真实操作。黑白界面继续稳定，虹彩集中在门洞边缘、光流与少量世界轮廓，避免整屏彩色背景削弱文字。

场景只需要一个主虫洞、3–5 个远景世界轮廓、少量背景星点或线条。世界可使用现有 JPG 的局部纹理或新的原创静态素材，先不建设可漫游的完整 3D 场景。这是控制制作量与设备负担的设计建议。

若选择 Three.js，建议仅写少量原创着色器，围绕虹彩门缘和轻微空间折射服务构图；不复制参考站的场景或着色器素材。若优先追求快速完成作者预设的品牌首屏，Unicorn Studio 也合理。两者都不应让全页和每张世界卡进入持续重渲染。

把运动拆成三个独立输入：

1. 时间：负责极慢的门洞呼吸、光流与世界自转；停下鼠标后画面仍活着。
2. 指针：负责有限视差和局部光学偏移；只在首屏范围生效，不改全站鼠标行为。
3. 页面滚动进度：负责从远观世界群、靠近主入口，到打开世界目录的短镜头；保留原生滚动和直接进入世界的链接。

建议滚动镜头只占一个短章节，避免用户每次回首页必须看长动画。进入目录后首屏停止渲染。当前探索目标是空间叙事，不需要把列表、存档与阅读页全部变成 3D。

## 性能、移动端与动态效果偏好

下列阈值是初始验证预算，非已达成指标：桌面目标 60fps、移动端可接受档 30fps；初始 DPR 上限 1.5，低档 1.0；只运行一个主要 WebGL 画布。持续帧耗时偏高时逐级降低分辨率、光效和远景数量，不按手机型号硬编码能力。

依据与实施含义：

- WebGL 官方实践建议降低背缓冲尺寸、批量绘制并控制显存预算；因此可先降像素分辨率与 draw calls，再考虑复杂后期。不会仅因使用 GPU 就保证流畅。[MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- Canvas2D 优化文档建议缓存重复绘图和分离静态/动态层；因此若做轻量预研，应缓存背景和世界图像，仅重绘变化层。[MDN Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- `IntersectionObserver` 可异步通知元素与视口的交叉变化；`Page Visibility API` 可识别页面隐藏。用前者暂停离屏首屏，用后者暂停后台渲染，恢复时重置时间差以避免跳帧。[Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)、[Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- Three.js `WebGLRenderer.dispose()` 释放该实例分配的 GPU 资源。需同样整理几何体、材质、纹理的生命周期，防止首页反复进入后资源累积。[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- `prefers-reduced-motion` 表达系统减少动态效果的偏好。已有应用 `.reduce-motion` 开关也必须一起尊重：取消持续运动、指针视差和滚动穿越，显示完整静态构图，并保留所有链接与按钮。[MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- 移动端建议保留低速环境运动和短滚动过渡，不用陀螺仪，也不把桌面 hover 当作必要导航。竖屏重新安排门洞与文案位置，避免简单裁切横版构图。这些是本项目的设计建议。
- 若采用视频，使用静音、内联播放及独立海报；处理自动播放失败，保持页面仍可用。`muted`/`playsinline`/`poster` 有明确 HTML 定义，但自动播放仍受浏览器策略影响，不能承诺所有环境自动播放。[video 元素](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)、[Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)

## 最小验证范围

建议下一步仅做可丢弃首屏样机来回答三个问题：门洞是否看起来像可进入的世界，三种运动是否自然融合，世界目录是否仍可立即使用。样机要包含真实滚动、鼠标响应、自动漂流、静态降级和窄屏构图。

验证时记录桌面与真实手机的帧耗时、页面隐藏/离屏暂停、返回首页多次后的资源数量、WebGL 初始化失败、减少动态效果开关切换、触摸与键盘导航。没有这些测量前，不对“手机流畅”“几乎不耗电”或素材下载体积作承诺。
