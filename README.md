# idefinity.com

深圳市想法无限科技有限公司的公司站。中文是默认语言，`?lang=en` 切到英文。

页面用 Vite + TypeScript + Three.js 手写，没有 CMS，没有外部字体和 CDN。
首页那个无限环是浏览器里实时渲染的，不是视频也不是贴图。

## 本地跑

需要 Node 22.12 以上。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。看生产构建的话：

```sh
npm run build
npm run preview
```

## 页面

四页横向翻，一页一屏。图不跟着页面走——图一直在那儿，翻页改的是镜头：

| 页 | id | 镜头看的地方 |
| --- | --- | --- |
| 01 概览 | `#top` | 右半边，环的内壁 |
| 02 研究 | `#research` | 左半边，贴得很近 |
| 03 产品 | `#product` | 交叉处，两条股分得开 |
| 04 关于 | `#about` | 退到最远，几乎整个符号 |

整幅画在任何一页都比视口宽，最远的关于页也一样，所以没有哪一页给出全貌。

导航是锚点，`←` `→` `PgUp` `PgDn` `Home` `End` 都能翻，滚轮也能。手机上
（≤900px）改回竖着滚，图缩成文字下面的一条——一屏塞不下那些字，硬塞会更差。

导航里的「研究」和「产品」悬停都会展开一个小菜单。研究那张是最近四条、按方向
分组的入口、以及整张台账；产品那张是每个产品一行，按类型分组（只有一类时不画
分组）。两张菜单都不是写在 HTML 里的，它们是 `research/index.json` 和
`product/index.json` 的视图，所以加一条课题、加一个产品都不用回来改导航。手机上
不展开（没有悬停这回事），换成导航里的「全部研究」「全部产品」。

`research.html` 有两种角色：带 `?id=` 是某一篇，不带就是整张清单。清单有搜索框
和分类按钮，筛选状态写在 URL 里，可以直接发给别人。`product.html` 是同一套办法：
带 `?id=` 是一个产品，不带走目录。

首页四页的中文文案直接写在 `index.html` 里，英文在 `src/i18n.ts` 的 `english`
表里。产品那一页是例外：它的每一个字都来自 `product/items/<slug>/product.json`，
构建时由 `vite.config.ts` 里的一个插件渲染进 HTML，客户端只在切语言时重画。
也就是说没有第二份副本，没开 JavaScript 也照样是一个完整的产品块。

## 那个环

`s / theta` 两个参数铺一张六边形网格，再贴到一条 3D 双纽线上：

- `src/scene/curve.ts` — 曲线、弧长参数化、扫掠坐标系。两股在中点交叉时
  z 方向差 1.05，所以它们是错开的，不会糊在一起。
- `src/scene/lattice.ts` — 六边形顶点按 cell 坐标生成，重合的顶点先焊接。
  这样相邻格子真的共用一条边，不是叠一堆圈。列数取偶数：砖缝错位是每两列
  重复一次，奇数列首尾就对不上，接缝上会留一圈只连两根杆的原子。
- `src/scene/pulse.ts` — 一圈光点，带尾巴和偶尔的回声。热度按弧长距离算，
  所以亮起来的永远是一段连着的边。
- `src/scene/frame-lut.ts` — 曲线烘成一张 2048 采样、四行的半浮点贴图，
  存中心点 / 法线 / 副法线。顶点着色器查它，于是曲线只在启动时算一次。
- `src/scene/material.ts` — 金属材质和它的 `onBeforeCompile` 补丁：磨损、
  微划痕、被光点烫过的热度，还有蠕动本身。
- `src/scene/mesh.ts` — 两个 InstancedMesh（球、连杆）+ 一个 Points 光晕，
  全场景三个 draw call。节点实例只带 `(s, θ, r)`，相位是一个 uniform，
  所以加节点不变慢。
- `src/scene/frames.ts` — 每一页的取景（世界坐标 + 缩放），页与页之间做插值。
- `src/scene/camera.ts` — 镜头横向平移而不是绕轨道转，所以近的那段管子会
  从画面两侧出去，这是「只看见一块」的来源。
- `src/scene/scene.ts` — IBL、ACES 色调映射、景深、桌面端 bloom，以及
  可见性、尺寸变化、上下文丢失的处理。

性能预算：桌面 7 圈 × 46 列（644 个节点、966 根连杆），移动端 6 圈 × 40 列，
最多 1.75 / 1.35 DPR，30 / 24 fps。窗口不可见就停渲染；`prefers-reduced-motion`
下只画一帧静止画面。

### 实测（Apple M5 / Chromium / 1440×900 @ DPR 2，画布 2520×1575）

| | |
|---|---|
| 帧率 | 30.0 fps，帧间隔 p50 33.3 ms / p95 34.0 ms |
| 主线程 | 每帧 **1.39 ms**（其中脚本 0.93），约 4% 单核 |
| 主线程（蠕动上 GPU 之前） | 每帧 2.5 ms |
| JS 堆 | 7–10 MB |
| 常驻内存 | 整个标签页约 250 MB（静态页约 110 MB，图再加约 140 MB） |

**是 GPU 重，不是 CPU 重。** 去掉帧率上限后能稳在 60 fps（4 MP 画布），
主线程 1.2 ms 左右——时间是花在 GPU 上，不是 JavaScript 上。压到 30 fps
之后 GPU 有一半时间是空的，所以这是一张很"省"的页面：默认状态下没有一帧
是靠 CPU 抢出来的。

**内存基本都花在 HDR 渲染目标上。** 4 MP 的画布上，合成器两个 RGBA16F 缓冲
各带一张深度贴图、景深那张还要 mipmap、再叠五级 bloom，加起来约 150 MB 显存。
这跟格子数量无关——600 颗节点和 960 根连杆的几何数据才几 MB。

降一档分辨率就等比例降：DPR 1 时画布 1440×900，渲染目标约 1/3，内存和设备
上的 GPU 时间都跟着掉。

> 帧率这里踩过一个坑：`1000 / 30 = 33.33 ms` 正好压在 vsync 边界上，浏览器
> 报上来的帧时间常常是 33.32，比较失败就跳过这一帧，于是 30 fps 悄悄变成 20。
> 判断里留 5 ms 余量才是真的 30。

重测：`npm run build && npm run preview`，然后 `npm run bench`（默认打
`http://127.0.0.1:4173/`，可以传 URL 和秒数）。它数的是真正显示的帧，
不是 `requestAnimationFrame` 的回调次数——后者会虚高。

## 纹路会爬

环的形体不动，动的是**格子本身**：整张六边形网格沿着环往前挪，像蛇身上的
花纹在爬。因为 `s` 是个圈，整体平移不改变任何两个节点的弧长距离，所以接缝
不会撕开，格子也不会被拉变形。

位置本来每帧在 CPU 上算：644 个节点、966 根连杆，1610 个矩阵。现在整段挪进了
顶点着色器——节点只带 `(s, θ, r)` 三个常数，相位是一个 uniform：

```glsl
float u = fract(node.x + uCrawl) + 0.000244140625;
vec3 centre = texture2D(uFrames, vec2(u, 0.125)).xyz;
vec3 normal = texture2D(uFrames, vec2(u, 0.375)).xyz;
vec3 binormal = texture2D(uFrames, vec2(u, 0.625)).xyz;
```

那半个纹素的偏移不是装饰：`RepeatWrapping` 下 `fract` 正好落在纹素边界上，
双线性过滤会把首尾各取一半，接缝处就糊出一条一毫米宽的带子。主线程因此从
2.5 ms 降到 1.39 ms，实测和踩到的两个坑记在 `research/topics/gpu-crawl/`。

按 0.034 圈/秒算，一圈约 29 秒，也就是每秒爬过一格半六边形。

这个数决定了它看起来是不是活的：太快像传送带，太慢像图片。`mesh.ts` 里的
`CRAWL_SPEED` 就是它。

翻页时会给一个冲量（`LoopMesh.nudge`）：速度在约 80 毫秒内冲到常态的 3 倍左右，
然后按 `exp(-3.2t)` 往下掉，一秒左右回到原速。

冲量不能靠 `setProgress` 的相邻差来判断。宽屏上的一次翻页是一段 550 毫秒的缓动，
传到这里已经拆成二十几帧，每帧只走百分之四——按单帧算出来的力接近零，画面上
什么都看不出来。所以 `goTo()` 在开始滑动时直接说一声（`pageTurn()`）。
`setProgress` 里还留着一条按大台阶判断的兜底，管手机上的滚动跳转和拖拽松手；
两条共用一个冷却窗口，一次翻页只抽一下。

冷却按 `performance.now()` 算，不用场景自己的时钟。那个时钟只在渲染帧里累加，
机器一慢，真实时间过去两秒它才走零点几秒，判断会永远不成立。

这里有个容易写错的地方：`CRAWL_EASE`（速度追目标的快慢）如果太低，冲量还没
到位就被衰减吃掉了，曲线峰顶只剩 2.4 倍——看着像是「稍微快了一点」，没有
「抽一下」的意思。它和 `BOOST_DECAY` 的比例决定这一下的性格。

场景每帧把当前相位和速度写到 `#scene-host` 的 `data-crawl` / `data-crawl-speed`
上——不参与渲染，只为了让 `check` 能分清「在爬」和「卡死」。

## 翻页为什么自己写

一开始用的是 `overflow-x: auto` + `scroll-snap-type: x mandatory`，结果是
`scrollTo({behavior:"smooth"})` 直接被吸附取消，翻页变成硬切；把 snap 去掉，
smooth 在无头 Chromium 里也不动。与其猜浏览器，不如自己拿一条
`translate3d` 的轨道 + 时间函数，进度是连续值，镜头也就能跟着连续地走。

滑动时两张面板同时在走，各自带着自己的压暗渐变，所以中途会露出整幅画面一瞬
——这是翻页该有的那一下。

## 兜底图

`public/loop-fallback.jpg` 是一张真实的渲染帧，用于 WebGL 不可用、上下文
丢失、以及没开 JavaScript 的情况。它拍的是退得最远的那一页，其它页靠缩放和
平移这张图来近似；拍不到的地方会被夹住，宁可构图不准，也不留黑边。

改了画面之后重新生成：

```sh
npm run build && npm run capture
```

脚本会自己起预览服务、等到画面稳定、截下图，顺便把结果拷一份进 `dist/`。

## 检查

```sh
npm run build
npm run preview &
npm run check
```

157 项，跑的是几件容易悄悄坏掉的事：翻页（键盘、滚轮、导航、深链接）、
中英切换、无 JavaScript、WebGL 失败、移动端堆叠、横向溢出、备案号、
纹路有没有在爬、翻页时有没有加速、加速之后有没有收回来、
静态图上的说明文字有没有跟着改成「静态一帧」，
格子的连杆数是不是正好是节点数的 1.5 倍（少一根就是接缝上有原子没接上，
肉眼看起来像两颗球叠在一起），
研究面板有没有读到索引、面板是不是只画了最新四条、多出来的有没有交给台账页、
导航下拉里的条目和分类链接指得对不对、Esc 能不能关掉它、
台账页的筛选真能不能把行数减下去、搜不到时给的是空状态还是空白、
文章页中英两版能不能打开、不存在的 slug 会不会老实说没有、
卡片里的分类标签有没有跑到正文那一列去、
产品面板是不是从索引来的、短屏会不会顶到页脚上、索引挂了还留不留得住构建时
写进去的那一块、目录页的卡片是不是每个都指向自己的详情页、产品页的事实和链接
有没有少、不存在的 id 会不会老实说没有、导航里两张菜单会不会同时开着、
sitemap 里有没有漏掉任何一个产品和研究条目。

最后一条是这轮改样式时踩的：`.note p` 这个选择器连 `.note-tag` 一起选中了，
把分类标签拽到右栏，和摘要印在同一行上。短屏那版有一个不重叠的断言，宽屏这版
没有，于是漏了——两版现在都有。

## 研究台账

`research/` 里一条课题一个目录：`topic.json` 是元数据，`notes.zh.md` /
`notes.en.md` 是正文，`data/` 放实测数据。首页的研究面板、导航下拉、台账页和
`research.html?id=<slug>` 都由它生成，正文不用手抄两遍。

分类的词表在 `research/taxonomy.json`：有哪些方向、哪些产出类型、哪些状态、
哪些跨方向的系列，中英各叫什么。加一个方向只改这个文件，代码里没有第二份清单。

```sh
npm run research -- list --track=performance
npm run research -- search "接缝"
npm run research -- validate
npm run research -- export gpu-crawl --out /tmp/gpu-crawl.rtopic.json
npm run research -- import /tmp/gpu-crawl.rtopic.json --as gpu-crawl-copy
```

`npm run build` 会先跑一次 `index`，把 `research/index.json` 和每个课题的载荷
写进 `public/research/`，所以写完课题直接构建就行。分类规则、检索怎么打分、
导入导出包长什么样，都写在 `research/README.md`。

条目多起来以后往哪放、什么时候该把产品也拆成目录、为什么分类不写进路径，
写在 `CONTENT.md`。

删一条课题就是删目录。研究面板里另有三张手写卡片，是给没开 JavaScript 的人
兜底的，改课题时记得一起改——`check` 只数得出它们有三张，读不出内容对不对。

## 产品目录

`product/items/<slug>/` 一个产品一个目录：`product.json` 是元数据（名字、一句话、
阶段、能力、规格、链接），`notes.zh.md` / `notes.en.md` 是正文。首页产品面板、
导航下拉、`product.html` 目录和 `product.html?id=<slug>` 详情都由它生成。

两条轴写在 `product/catalog.json`：`category`（数据库 / 界面 / 工具 / 服务）和
`stage`（构想 → 内测 → 公测 → 稳定，另有停止维护）。`order` 决定谁上首页主位。

```sh
npm run product -- list --category=database
npm run product -- show graphfin
npm run product -- validate
npm run product -- export graphfin --out /tmp/graphfin.product.json
```

`npm run build` 会先跑一次产品索引，把 `product/index.json` 和每个产品的载荷写进
`public/product/`。加一个产品的步骤、字段为什么是这些、什么时候该加第三条轴，
写在 `product/README.md`。

## 部署

构建产物是纯静态文件，`dist/` 直接丢到任何静态托管都行（当前 `base` 是 `/`，
部署在域名根目录）。如果挂在子路径下，构建时设 `SITE_BASE_PATH=/子路径/`。

`sitemap.xml` 是构建时生成的，不是仓库里的一个手写文件：`vite.config.ts` 从
`product/index.json` 和 `research/index.json` 里读条目，每一条都写成一个 URL，
`lastmod` 取该条目自己的 `updated`。加产品、加课题，地图自己跟上；`check` 会
回头核对每个 id 都在里面。域名写死在这个插件里的 `SITE` 常量，换域名改一行。

服务器在哪、机器什么规格、上面还打算跑 GraphFin 和语音应用时该怎么排布，
这些写在内部运维文档里，不进这个仓库（里面有主机地址、端口和网络结构）。
想知道部署顺序，找公司里的人要。

## 还没做

- 产品目录里现在只有 GraphFin 一款。框架（数据、索引、目录页、详情页、下拉、
  构建注入）已经齐了，第二款是往里加一个目录，不是改代码。
- 产品页的「相关研究」只在产品自己声明了 `research` 时才出现；GraphFin 现在
  没有对应课题，所以这一段是空的。
- 英文版是人工翻译的，没有做 hreflang 和英文独立 URL，只靠 `?lang=en`。
- 没有 Cookie、没有统计脚本。要加的话先想清楚加什么。
- 触屏平板横屏时靠拖拽翻页，没有惯性；手机上没有这个问题（改成竖排了）。

## 许可

- 站点代码（HTML、CSS、TypeScript、`scripts/`）：GNU Affero General Public License v3.0 或更高版本，全文见 `LICENSE`。
- `research/`、`product/` 下的正文，以及站点图片和文档：GNU Free Documentation License v1.3 或更高版本，全文见 `LICENSE-CONTENT`。
- GraphFin 本身仍按 Apache 2.0 发布，不受这里的选择影响。
- 第三方依赖（three.js、Vite、Playwright 等）保留各自的许可证。

`package.json` 的 `license` 字段只标代码那一份；内容那份写在这里。
