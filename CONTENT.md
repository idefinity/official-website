# 内容放在哪，怎么分类

站点上会长的东西只有两类：研究记录、产品。这份文件说的是它们各占哪个目录，
按什么分类，条目涨起来以后先动哪一处。

一句话：**目录名是地址，分类是标签。** 地址要稳定，标签可以随便改。

## 现在长这样

```
research/
  taxonomy.json        分类词表：有哪些 track、kind、status、series，中英叫什么
  schema.json          一条课题能有哪些字段（给编辑器和 validate 用）
  index.json           生成物，别手改
  topics/<slug>/       一条一个目录
product/
  catalog.json         两条轴：category、stage，中英叫什么
  schema.json          一个产品能有哪些字段
  index.json           生成物，别手改
  items/<slug>/        一个产品一个目录
```

`public/research/` 和 `dist/` 都是构建产物，删了能重建。

## 目录为什么不分层

`research/topics/` 一直是平的，没有 `topics/rendering/`、`topics/performance/`。
三个理由，按重要性排：

1. **slug 就是 URL。** `research.html?id=gpu-crawl` 里的 `gpu-crawl` 就是目录名。
   按分类分目录，哪天决定把「性能」并进「图形」，所有链接一起断——包括别人
   贴在群里的、搜索引擎记着的、README 里引用的。
2. **`git mv` 一次目录，这条记录的提交历史就断了。** 研究记录的价值有一半在
   历史里：哪天改的、为什么改、当时量到什么数。`git log --follow` 能追文件，
   追不了「这堆东西换了个爹」。
3. **一条记录常常不属于任何一格。** 把蠕动挪进顶点着色器，既是图形也是性能。
   目录只能装一个，标签可以装两个。

所以分类写在 `topic.json` 里，页面按它分组，命令行按它筛。换个说法：目录结构
回答「这个文件叫什么」，元数据回答「它是什么」。

## 分类：三条轴，一条横线

| 字段 | 取值 | 约束 | 回答的问题 |
|---|---|---|---|
| `track` | rendering / performance / data / interface / tooling / writing | 选一个 | 影响谁 |
| `kind` | study / experiment / note / decision | 选一个 | 这是读懂的、量过的、记下的，还是定下来的 |
| `status` | idea / active / shipped / paused / dropped | 选一个 | 还活着吗 |
| `series` | taxonomy 里声明过的 id | 可多个 | 横穿分类的那条线 |

前三个字段的取值和顺序在 `research/taxonomy.json`，不在代码里。加一个 track
只改这一个 JSON，校验、索引、首页清单、导航下拉会一起跟上。`schema.json` 里的
enum 是给编辑器补全用的副本，`validate` 会比对两处有没有跑偏。

`series` 是唯一能跨 track 的字段。现在只有一个：`loop`，装着那个环的形状
（`lattice-seam`）和它怎么爬（`gpu-crawl`）。以后哪天要写「这个环搬到 WebGPU
会怎样」，它属于 `performance`，但还在 `loop` 这条线上。

为什么不是一棵树：树要求你事先决定一个条目「属于」哪一支。做这个决定的时候，
你往往还不知道它会变成什么。分类可以后补，URL 不能后改。

## 数量涨了，先动哪里

现在的量级是 3 条。下面按量级说，每档只列该动的那一处，不提前优化。

**3–30 条：什么都不用动。**
清单页一次列出全部，浏览器渲染三十行是几毫秒。搜索是本地字符串匹配，不联网。

**30–150 条：动清单页，不动目录。**
`index.json` 现在 3 条约 6 KB，一百条约 200 KB，一次拉下来还行，但渲染一百多行
DOM 会开始拖输入延迟。这时加的是清单页的分页或分批渲染（先画 30 行，滚到底再
画下一批）。目录仍然是平的。

**150 条以上：动索引，不动目录。**
到这一步再做 `index.json` 的拆分：一份只带标题和分类的瘦索引，正文照旧一篇一个
请求。有人会想「按首字母分桶吧」，不要——文件系统不需要你帮它找文件，`ls` 和
`rg` 已经够快，而分桶会把 URL 改掉。

**任何一种量级，都不要把 `notes.zh.md` 拆成多文件。**
一篇文章就是一篇。拆开之后导出包、diff、给别人看，都变麻烦，换不来什么。

## 什么时候该新建一个集合

如果一份内容需要单独的 schema（字段不一样）、单独的读者（比如客户）、或者单独
的发布节奏，就新建一个顶层集合，而不是塞进 `research/topics/` 里加个分类。

判断标准是**字段**，不是数量。「公告」和「课题」都只有十条的时候，它们也不该
放一起——公告需要发布日期和有效期，课题需要问题和结论。

## 产品：一个目录，三个入口

产品从首页面板里搬出来了，因为不止一个产品。形状和研究那套一样：

```
product/items/graphfin/
  product.json     元数据：名字、一句话、阶段、能力、规格、链接
  notes.zh.md      正文，中文
  notes.en.md      正文，英文
```

**为什么不再写在 `index.html` 里。** 只有一个产品的时候，建一套目录、schema、
索引、详情页，换来的是同一段文案维护两份：HTML 里一份给无 JS 兜底，JSON 里
一份给渲染。现在只有 JSON 一份——构建时 `vite.config.ts` 里的一个插件把首页
那一块渲染进 HTML，客户端只在切语言时重画。改文案只改 JSON，无 JS 仍然看到
完整的产品块。

**三条判断，和研究不一样的地方：**

1. **只有两条轴。** `category` 是「这是什么」，`stage` 是「做到哪一步」。第三个
   轴通常意味着该拆成两个产品了；先看 `facts`（许可证、引擎、语言、部署）够不够用。
2. **`stage` 有顺序。** 构想 → 内测 → 公测 → 稳定，停止维护的沉到最后。课题的
   `status` 是一组并列的生命周期，产品的 `stage` 是一条路。
3. **产品可以引用课题，反过来不写。** 字段 `research` 存 topic id，只在产品这边
   声明一次，详情页把它们列成「相关研究」。两边都写，迟早有一边忘了改。

`order` 决定首页面板上谁当主角：最小的那个。没填就按名字排。停止维护的产品
无论 `order` 多少都不占主位。

**目录名就是地址**，和研究同一条规矩：`product.html?id=<slug>` 里的 slug 就是
文件夹名。`stage` 改名不断链，id 改名断。

产品多了先动哪里：三个以内什么都不用动；目录页的卡片开始挤（十几个）时，先靠
已有的分类筛选收窄，再谈分页；五十个以上才考虑把 `index.json` 拆瘦。**不要按
category 分目录**——那个理由和课题那一节说的三个理由是同三条。

## 加一条课题## 加一条课题

```bash
npm run research -- new loop-dpr --track=performance --kind=experiment
# 改 topic.json 的 title / questions，两个 notes 文件写正文
npm run research -- validate
npm run build          # 会先跑 index，页面上就有了
```

`new` 生成的模板里 `series` 是空数组。要挂系列，先确认它已经在
`research/taxonomy.json` 里。

## 加一个产品

```bash
npm run product -- new loop-ui --category=interface
# 改 product.json 的 name / tagline / stage / notice，再写 highlights
npm run product -- validate
npm run build          # 会先跑产品索引，页面和导航下拉一起更新
```

`order` 决定首页主位：首页只给一个产品当主角，填之前想一下是谁。

## 这些规则谁在守

`scripts/check.mjs`（149 项）里有几条是专门盯这套结构的：

- 首页清单只画最新的四条，多的必须交给台账页
- 下拉菜单里的每一条都指向文章页，每个分类链接都带 `?track=`
- 台账页的筛选真能把行数减下去，搜不到时给空状态而不是空白
- 一条课题必须有问题（中英至少中文），必须有正文，`data/` 里的文件必须被引用
- 首页产品面板和 `product/index.json` 对得上；短屏不顶到页脚；索引取不到时
  还留得住构建时写进去的那一块
- 目录页每个卡片指向自己的详情页；只有一个分类时不画筛选按钮
- 产品页的能力条数、规格条数、链接必须和 JSON 一致；不存在的 id 老实说没有
- 晶格的连杆数必须是节点数的 1.5 倍（这条跟内容无关，但同样是不该悄悄坏掉的东西）

`npm run research -- validate` 另外管三件事：分类必须在词表里、`series` 必须
声明过、`schema.json` 的 enum 不能和 `taxonomy.json` 跑偏。

`npm run product -- validate` 管三件事：`category` / `stage` 必须在 `catalog.json`
里、`schema.json` 的 enum 不能和它跑偏、`research` 指向的课题必须真的存在。

## 一条判断，收尾

遇到「这个要不要单独建目录」的问题，问自己：**半年后我改了这个分类，链接会不会
断？** 会断，就别用目录存分类。不会断，随你。
