# 研究台账

一条课题 = 一个问题 + 一次回答。

不是话题，不是文章。写下来的时候必须能指着某句话问「这个结论是量出来的，
还是猜的」。量过的写数字，猜的写「待验证」。台账里允许有没做完的条目，
但不允许有不知道自己在说什么的条目。

## 一条课题长什么样

```
research/topics/webgpu-performance/
  topic.json      元数据，机器读的那一半
  notes.zh.md     正文，中文
  notes.en.md     正文，英文
  data/           可选，实测数据、bench 原始输出
```

`topic.json` 的完整字段在这里：`research/schema.json`。必填的只有七个：

| 字段 | 回答什么问题 |
|---|---|
| `id` | 别人怎么引用它。slug，写进 URL，**永不改** |
| `title` | 一句话说清在做什么 |
| `track` | 归到哪一档，决定谁会找到它 |
| `kind` | 这是读懂的、量过的、记下的，还是定下来的 |
| `status` | 还活着吗 |
| `questions` | 当初到底想问什么，中英各一组（各 1–5 条） |
| `updated` | 最后一次动它是什么时候 |

`questions` 是必填的，原因很实际：标题会骗人，问题不会。半年后回来找一条
记录，你记不住标题，但记得住「WebGPU 在我们这个场景里到底快多少」这句话。
检索主要就靠它。它长这样，因为问题也要两边都能读：

```json
"questions": {
  "zh": ["这个场景在 WebGPU 下每帧少多少 GPU 时间？"],
  "en": ["How much less GPU time per frame under WebGPU?"]
}
```

`en` 可以暂时缺，缺了英文页面就显示中文问题，不会留空。

其余可选：`summary`（列表页用）、`tags`、`verdict`（结论一句话，没结论就不写）、
`links`、`metrics`（指向 `data/` 里的文件）、`owner`、`created`。

## 怎么分类

三档加一条横线，不建树。

树要求你事先决定一个条目「属于」哪个分支。真实的问题通常横跨两个分支：
这次把蠕动挪进顶点着色器，它既是渲染（shader）又是性能（CPU 每帧省了 1.1 ms）。
硬塞进一个分支，下次就找不着了。

**`track` — 影响谁。** 决定归档位置。

- `rendering` 画面怎么生成：几何、着色、后处理
- `performance` 快了慢了、内存、电量
- `data` 存储与查询
- `interface` 排版、交互、可读性
- `tooling` 构建、检查、脚本
- `writing` 对外怎么说

**`kind` — 这是哪种产出。** 决定怎么读。

- `study` 读懂了别人的东西，没动手
- `experiment` 自己量过，有数字
- `note` 记录一个已知结论，给未来的自己
- `decision` 一次取舍，有被否掉的选项

**`status` — 生命周期。** 不是进度条。

- `idea` 想了个问题，还没动
- `active` 正在弄
- `shipped` 结论进了代码
- `paused` 卡住了，原因写在正文里
- `dropped` 放弃了，也写原因

**`series` — 跨分类的专题。** 可以有多条。

有些线索不属于任何一个 track，而是横穿好几个：那个环的形状（`lattice-seam`）、
它怎么爬（`gpu-crawl`）、它搬到 WebGPU 会怎样（`webgpu-performance`），
是一条线上的三件事，分属图形和性能。`track` 只能选一个，`series` 可以挂多个。

系列名写在 `research/taxonomy.json` 里，不能随手编——写错一个 id，
`validate` 会拦下来，而不是悄悄生成一个只有一条的系列。

筛选用 AND：`track` + `kind` + `status` + 标签，任意组合；`--series` 单独筛。

三档分类的名字、顺序、英文译名都在 `research/taxonomy.json` 里。加一个 track
只改这个文件，校验、索引、清单、下拉菜单会一起跟上。`schema.json` 里的 enum
是给编辑器看的副本，`validate` 会检查它有没有和词表跑偏。

## 页面上有三个入口

同一份索引，三种读法，按"我现在知道多少"来分：

| 入口 | 在哪 | 什么时候用 |
|---|---|---|
| 面板 | 首页第二页 | 只想看看最近在弄什么。只放最新的四条，多的交给下一档 |
| 下拉 | 导航「研究」悬停 | 记得大概方向，想直接跳过去。按 track 分组，带计数 |
| 台账页 | `research.html` | 不知道要找什么，边看边收窄。有搜索框和分类按钮 |

`research.html` 一个文件两种角色：带 `?id=` 是某一篇，不带就是整张清单。
清单的筛选状态写在 URL 里（`?track=rendering&q=shader`），所以「你看这几条」
可以直接发给人。

## 怎么找

三档，从快到慢：

1. **按 id** — 精确命中，`research show gpu-crawl`。外部链接用这一档。
2. **按轨道和状态** — `research list --track=performance`。索引里就有，不用读正文。
3. **全文** — `research search "接缝"`。

全文搜索没上倒排索引，也没上分词器。全部条目读进内存做线性扫描 + 打分：

- 中文按 **2-gram** 切。「晶格接缝」切成 晶格 / 格接 / 接缝 三个 gram。
  覆盖几个 gram 就是几分，不依赖词典，不会因为生词失效。
- 英文按词切，去停用词。
- 字段权重：标题 ×3，问题 ×2.5，标签 ×2，摘要 ×2，正文 ×1。
- 同一个 gram 在一篇里出现十次算一次，避免长文压过短文。

量级判断：几十条课题、每条几千字，线性扫一遍是几毫秒，比查一个索引服务还快。
真到五百条以上再考虑倒排，`index.json` 里已经留了 `terms` 的位置。

## 怎么进出

**导出**是一份单文件 JSON，叫包，扩展名 `.rtopic.json`：

```json
{
  "schema": "idefinity.research.bundle/1",
  "exported": "2026-10-25T09:00:00.000Z",
  "topics": [
    {
      "meta": { "id": "webgpu-performance", "title": { "zh": "...", "en": "..." } },
      "notes": { "zh": "...", "en": "..." },
      "data": { "data/baseline.json": "..." }
    }
  ]
}
```

单个 JSON 而不是 tar/zip 的理由：文本能直接 diff、能贴进邮件、能用 `jq` 拆开看，
不用为了一个课题记住一套打包工具。二进制文件转 base64 塞进同一个文件。

**导入**接受两种输入：一个包，或者一个目录（含 `topic.json` 的）。流程是
读 → 校验 → 写。校验不过就整个拒绝，不会留半条坏数据在库里。

冲突默认报错，不带参数不改任何东西：

- `--force` 覆盖同 id 的条目
- `--as <new-id>` 换一个 id 存进来（比较两份分支时用）

为什么不是数据库、不是 submodule：课题是纯文本，文本的版本控制就是 git 本身。
导出包解决的是「发给别人」和「备份到别处」，那是另一个问题。等真有跨仓库检索
的需求再上数据库，那时迁移成本也就是重跑一次 `research index`。

## 命令

```bash
npm run research -- list                      # 全部，按更新时间倒序
npm run research -- list --track=performance
npm run research -- list --series=loop
npm run research -- search "着色器 CPU"
npm run research -- show gpu-crawl
npm run research -- new loop-dpr --track=performance
npm run research -- validate                 # 校验全部条目
npm run research -- index                    # 生成站点读的那份索引
npm run research -- export webgpu-performance --out /tmp/topic.json
npm run research -- import /tmp/topic.json --as webgpu-performance-copy
npm run research -- stats
```

`npm run build` 会自动跑 `index`，所以你只要写课题，页面自己会变。

## 加一条新课题

1. `npm run research -- new <id> --track=rendering --kind=experiment`
2. 改 `topic.json`：`title`、`questions` 先写，正文可以空着
3. `notes.zh.md` 写中文，`notes.en.md` 写英文（英文可以先空，`validate` 会提醒）
4. `npm run research -- validate`
5. `npm run build`

正文里能用的 Markdown：标题、段落、列表、代码块、行内代码、粗体、链接、表格、引用。
渲染器是 `src/markdown.ts`，八十行，支持的语法就这么些，多写的会原样显示。
