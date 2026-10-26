# 产品目录

一个产品 = 一个目录，一份元数据，两篇说明。

产品页不是营销页。它要说清三件事：这是什么、现在到哪一步了、去哪儿看真东西。
说不了的就不写，而不是先占个位置。

## 一个产品长什么样

```
product/items/graphfin/
  product.json    元数据，机器读的那一半
  notes.zh.md     正文，中文
  notes.en.md     正文，英文
```

完整字段在 `product/schema.json`。必填的八个：

| 字段 | 回答什么问题 |
|---|---|
| `id` | 别人怎么引用它。slug，写进 `product.html?id=`，**永不改** |
| `name` | 它叫什么。专有名词，中英同形，所以不翻译 |
| `tagline` | 一句话说清是什么，给只读一行的人 |
| `summary` | 两三句，首页面板和详情页开头用 |
| `category` | 它是哪一类东西 |
| `stage` | 做到哪一步了 |
| `highlights` | 1–6 条能力，按读者该遇到的顺序排 |
| `updated` | 最后一次动它是什么时候 |

可选：`version`、`notice`（阶段旁边那句提醒）、`facts`（许可证、引擎、语言、部署）、
`links`（仓库、文档、下载、演示）、`research`（哪些课题促成了它）、`order`、`owner`、`created`。

`version` 不带 `v`，页面上自己加。`notice` 存在的理由很实际：`stage: alpha` 说的是
流程位置，说不清「能不能上生产」；那句话得单独写，而且不许含糊。

## 怎么分类

两条轴，都是单选，顺序写死在 `product/catalog.json` 里。

**`category` — 这是什么。**

- `database` 存数据、查数据的东西
- `interface` 让人看懂数据的东西
- `tooling` 开发和维护时用的东西
- `service` 跑起来持续提供的东西

**`stage` — 做到哪一步。** 有先后顺序，不是并列标签：

`concept` → `alpha` → `beta` → `stable`，另有 `retired`（停止维护，沉到目录末尾）。

只有两个轴，不是因为产品简单，是因为第三个轴往往意味着「该拆成两个产品了」。
需要按客户分、按平台分的时候，先看 `facts` 够不够用；真不够，再谈加轴。

## 页面上有三个入口

| 入口 | 在哪 | 什么时候用 |
|---|---|---|
| 面板 | 首页第三页 | 主推的那一个，完整能力 + 其余产品的短行 |
| 下拉 | 导航「产品」悬停 | 记得名字，直接跳过去 |
| 目录页 | `product.html` | 看全貌。带 `?id=` 是单个产品详情 |

面板主推 `order` 最小的那个；`retired` 的永远排在后面，不占主位。

`product.html?id=<slug>` 的 slug 就是目录名。和课题一样：**目录名是地址，
分类是标签**——哪天把 `database` 并进 `tooling`，所有链接都不该断。

## 怎么进出

和课题同一套形状，方便互相搬：

- 导出：`.product.json` 单文件，`schema` 是 `idefinity.product.bundle/1`
- 导入：接受包，或一个含 `product.json` 的目录；先校验，不过就整条拒绝
- 冲突：默认报错，`--force` 覆盖，`--as <new-id>` 换个 id 存进来

## 命令

```bash
npm run product -- list
npm run product -- list --category=database --stage=alpha
npm run product -- search "图"
npm run product -- show graphfin
npm run product -- new <id> --category=database
npm run product -- validate
npm run product -- index
npm run product -- export graphfin --out /tmp/graphfin.json
npm run product -- import /tmp/graphfin.json
npm run product -- stats
```

`npm run build` 会先跑一次 `index`，页面自己会变。

## 加一个产品

1. `npm run product -- new <id> --category=database`
2. 改 `product.json`：先写 `name`、`tagline`、`stage`、`notice`，再写 `highlights`
3. 两篇 `notes` 写清「能做什么 / 还不能做什么 / 为什么这么做」
4. `npm run product -- validate`
5. `npm run build`

`order` 决定首页面板的位置。没填就按名字排，第一个就是主推——填之前想一下，
首页只给一个产品当主角。

`sitemap.xml` 不用改：构建时从产品索引和研究索引生成，加了产品就有。手工维护的
清单只会漏，上一版就漏了全部研究条目。
