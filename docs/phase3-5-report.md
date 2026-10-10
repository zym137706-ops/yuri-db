# 阶段 3–5 交付报告

> 阶段 2 见 `phase2-dedup-strategy.md`（去重策略）与 `../prisma/schema.prisma`、`../schemas/work.schema.json`。
> 生成日期：2026-10-09（Asia/Hong_Kong）

---

## 第六轮：改为纯静态站点（不依赖常驻进程），并保留定时更新

用户要求：「把这个网站转成不依赖后台任务的稳定页面，并且需要兼顾定时更新」。

### 6-1. 架构变化

| | 之前 | 现在 |
|---|---|---|
| 运行方式 | `next start` 常驻 Node 进程 | **`output: 'export'` → `out/` 纯静态文件** |
| 线上要求 | 一台一直开着的服务器 | **任意静态托管**（GitHub Pages / Cloudflare Pages / 对象存储） |
| 筛选 | 服务端读 `searchParams` | **浏览器端**（`useSearchParams` + 内存筛选） |
| 数据库 | 不需要 | 不需要 |

### 6-2. 静态化必须解决的三件事

**a. 没有服务端可读查询参数。** 列表页改成 `'use client'` 组件，
用 `useSearchParams()` 读 URL、在浏览器里筛选；**筛选表单仍是 GET 表单**，
所以筛选网址依然可分享、浏览器前进后退依然正常。`useSearchParams()` 要求
上层有 `<Suspense>`，作品页放在 `app/page.tsx`，动画页放在 `app/anime/layout.tsx`
（`metadata` 也只能放在 layout，因为 client component 不能导出它）。

**b. 4.7 MB 的 `works.json` 不能给浏览器。** 新增
`web/scripts/build-slim.mjs` 生成瘦身投影（835 条 960 KB / 298 条 270 KB）。
关键在于**衍生值必须用真实函数算**：`avg_confidence`、`has_zh_tw`、`has_zh_cn`
都是 import 真实的 `lib/provenance.ts` / `lib/policy.ts` 现算的，不是在 Python 里
复刻一遍——否则列表卡片与详情页会对同一笔记录给出不同数字（本项目踩过这个坑）。
卷数组用 1 元素占位，因为 `workHasZh*Edition` 只判 `.length > 0`，布尔值仍然精确。

**c. 数据不能打进客户端 bundle。** 最初把投影 import 进 client component，
结果**每个预渲染页面都超过 Next 的 60 秒单页预算**。改成放到 `public/data/`
由浏览器 `fetch`：首页 HTML 从 **1.07 MB 降到 20.5 KB**，数据文件还能跨页面缓存。

### 6-3. 快取与体积

`works.json` 太大，静态导出会为每个路由同时产出 HTML 与 RSC `.txt`，
所以 835 个作品页 + 298 个动画页 = **1140 个 HTML、总计 326 MB**。
详情页是完整的预渲染页面（字段与溯源一个不少），这是刻意的取舍：
**详情页可被搜索引擎与无 JavaScript 环境直接读取**，代价是产物体积。

### 6-4. 定时更新（线上没有任何服务器）

```
collect-daily.yml (每日) ─┐
collect-news.yml (每3小时) ├─ commit data/** ─▶ deploy-static.yml
collect-weekly-zh-tw.yml ─┘                    (push 触发 + 每日 04:10 UTC 兜底)
                                                        │
                                                        ▼
                                              GitHub Pages（纯静态）
```

`deploy-static.yml` **刻意不重建数据集**：`data/*.json` 由采集任务 commit，
部署只负责构建与发布。在部署里重新推导数据，会让线上内容取决于 CI 当时算出的
东西，而不是被审查过、被 commit 的那一份。

### 6-5. 两个「本地看不出来、线上必炸」的坑

**a. 每页 60 秒预算会中止整个导出。**
`output: 'export'` 要预渲染 1141 个页面，每页都渲染全部 schema 字段、溯源表与原始记录，
并各自重新读取数 MB 的数据集。Next 默认的单页预渲染预算是 **60 秒**，而这个目录贴着上限跑：

```
Failed to build /works/[slug]/page: /works/w-xxx because it took more than 60 seconds.
Retrying again shortly.        ← attempt 1 of 3
... 三次都失败 -> prerenderEarlyExit -> exit 1（整个导出中止）
```

所以设置 `staticPageGenerationTimeout: 300`。这不是「把错误藏起来」：真的渲染不出来的页面
仍然会失败，只是不再因为机器负载而随机炸掉整个构建。

> 我一开始误判成「重试是良性的、最终会成功」——**错了**。碰巧在 253 秒内跑完只是运气，
> 在更慢的 CI runner 上就会挂。

**b. `basePath` 不会重写你自己写的 `fetch()`。**
GitHub Pages 的**项目站**从 `https://<owner>.github.io/<repo>/` 提供，用户站从域名根提供。
`basePath` 会重写 Next 自己的资源 URL，但**不会**重写应用代码里的 `fetch()`：

```js
fetch('/data/works-slim.json')   // 项目站上会 404，本地根路径完全正常
```

修法是把这个前缀显式内联进去（`next.config.mjs` 的 `env` 注入 `NEXT_PUBLIC_BASE_PATH`），
并且让 `deploy-static.yml` **自动判断**当前仓库是用户站还是项目站：

```yaml
if [ "$repo" = "${owner}.github.io" ]; then value="" ; else value="/$repo" ; fi
```

两种模式都已实测：带 `/yuri-db` 前缀构建时，HTML 里 **0 个**未加前缀的 `_next` 引用，
客户端 chunk 内联为 `"".concat("/yuri-db","/data/works-slim.json")`，
且 `/yuri-db/`、`/yuri-db/data/works-slim.json`、`/yuri-db/_next/...css` 全部 200。

### 6-6. 这轮踩到的协作问题

同一批 `web/` 文件被两个写者同时修改（我与一个子代理各自独立开始了同一份重构），
两个 `next build` 争抢同一个 `out/`，导致：

- 页面大面积报 `took more than 60 seconds`（资源竞争，而非代码问题）；
- 我的第一次构建直接以 `EBUSY: rmdir ...\web\out` 失败——因为我的静态服务器
  正把 `out/` 当作工作目录锁着。

**教训：构建目录（`out/`、`.next/`）是排他资源。** 起静态服务器预览前要先确认没有构建在跑；
反之亦然。我一度据此误判成「我自己的改动导致超时」，白排查了一轮。

---

## 第五轮：扩展漫画库与轻小说库

用户的三个追加要求：

1. **「只收录了 49 部漫画，貌似不包含轻小说」** → 加入轻小说
2. **「无官方繁体中文版本的文库日文轻小说，需要注明出版文库」** → 记录文库名
3. **「漫画库也要扩展，不局限于台湾出版社已出版的繁中版；很多只有民间汉化组汉化，
   繁中出版社并没有出版」** → 取消「必须有繁中版」这个隐含限制

### 5-1. 结果

| | 之前 | 现在 |
|---|---|---|
| 作品总数 | 49 | **835** |
| 漫画 | 49 | **747** |
| **轻小说** | **0** | **88** |
| 有封面 | 15 (31%) | **811 (97%)** |
| 有作者 | 49 (100%) | 828 (99%) |
| schema 校验错误 | 0 | **0** |

### 5-2. 轻小说从哪来：AniList 的 `format` 区分媒介

AniList 的 `type: MANGA` **同时包含漫画与轻小说**，用 `format` 区分：

| AniList format | 我们记为 |
|---|---|
| `MANGA` / `ONE_SHOT` | `media_type = manga` |
| `NOVEL` | `media_type = light_novel`（ラノベ・Web小説の単行本） |

采集时用 `tags.rank` 过滤（Yuri 标签很宽，含大量擦边作），并**把相关度一并存下来**，
用于回答「为何收录此条」。本次抓到 1,379 条 → 丢弃 R18 159、相关度不足 381 →
保留 **820**（漫画 728 + 轻小说 92）。

> ⚠️ 修复了一个真实 bug：AniList 最常见的 staff 角色串是 **"Story & Art"**，
> 同时含 story 与 art。原本先判 illustrator，导致**所有漫画家都被归为插画师、
> `authors` 在 77% 的记录里为空**。改成「先判作者，且 Story & Art 同时进两栏」后，
> 轻小说作者覆盖 92/92、漫画 721/728。

### 5-3. 出版文库：NDL 的 `seriesTitle`

AniList **不提供出版社与文库**。NDL 国会図書館サーチ 的书志正好有这两个字段：

| NDL 字段 | 含义 |
|---|---|
| `publisher` | 出版社（KADOKAWA / SBクリエイティブ …） |
| **`seriesTitle`** | **文库 / レーベル名**（電撃文庫 / GA文庫 / 角川スニーカー文庫 / 百合姫コミックス …） |
| `category` | 資料種別 —— **必须用来排除「録音資料」** |

> ⚠️ 两个必须处理的坑：
> 1. **`category` 过滤不能省**。NDL 的 title 检索会把动画主题歌 CD 一起返回，
>    不过滤就会把「King Records」当成这本书的出版社。
> 2. **`seriesTitle` 带卷次/整理記号**：「電撃文庫 ; 4034」、
>    「角川スニーカー文庫 ; い-10-3-1」。必须只取分号前的部分，否则文库名不干净。

实测效果（NDL 抽样）：

| 作品 | 出版社 | **文库** |
|---|---|---|
| わたしの百合も、営業だと思った？ | KADOKAWA | **電撃文庫** |
| クラスの姫は私のわんこ | KADOKAWA | **角川スニーカー文庫** |
| 処刑少女の生きる道 | SBクリエイティブ | **GA文庫** |

### 5-4. 完整率不能只看一个总数：引入「来源层级」

把 786 条「只有 AniList 目录」的记录和 49 条「有日方/繁中出版社一手来源」的记录
放在同一个分母里算完整率，会得出一个**没有意义的数字**（publisher 从 100% 掉到 5.9%）。
所以引入层级：

| 层级 | 定义 | n | publisher | magazine | authors | status |
|---|---|---|---|---|---|---|
| **curated** | 有出版社/书目一手来源（百合姫・ガレット・東立・NDL） | 49 | **100%** | **100%** | 100% | 84% |
| **catalogue** | 仅第三方目录（AniList），出版社待 NDL 补全 | 786 | 0% | 0% | 99% | 100% |

`verify_acceptance.py` 的**硬门禁只压 curated 层**（>80%），catalogue 层给 warning。
把两者混算会让 curated 看起来比实际差，也会让 catalogue 看起来比实际好。

### 5-5. 补全是渐进的，不是一次性的

NDL **禁止并发、频繁 429 与读超时**（第一轮跑 36 个标题用了 30 分钟仍未完成）。
因此补全被设计成**分批累积**：

- `scripts/enrich_works_from_ndl.py` 输出**合并式写入**，`--only-missing` 默认开启；
- `collect-daily.yml` 每天补 200 条（`--limit 200`，轻小说优先）；
- catalogue 记录会随每日任务**逐步升级为 curated**。

> 这是从 `ndl.py` 那次「覆盖式写入会丢掉上一轮成果」的教训直接推广来的——
> 对一个会限流的源，**增量累积是必需的，不是优化**。

### 5-6. 关于「只有民间汉化、没有官方繁中版」的作品

用户指出这类作品也该收录。设计上：

- **收录不以「是否有官方繁中版」为条件**——`title_zh_tw` 为 null 不影响入库；
- 官方繁中版存在时记录 `title_zh_tw` + `zh_tw_volumes` + 出版社（東立已接入）；
- **非官方汉化只按 D1 走纯人工登记、不提供任何链接**，且 `status` 默认为 `unknown`；
- UI 用三值状态区分「已查证无官方版」与「尚未查证」，不会把「没查」显示成「没有」。

---


## 第四轮：百合動畫目錄

用户需求：**新增「百合动画」选项，包含漫改、轻小说改、原创 TV 动画、剧场版；
需要开播时间、主要声优、制作公司；已宣布动画化但未播出的也要收录。**

### 4-1. 为什么它必须是一个独立实体

初版的数据模型把动画当作 `Work` 的附属字段（`anime_status` + `anime_details`）。
这**覆盖不了需求**：

- **原创动画**（109 部）没有漫画/小说原作，也就没有对应的 `Work`；
- **剧场版**（35 部）常常是独立上映，不挂在 TV 系列的 Work 下；
- 用户要的「主要声优」在 `Work` 上也放不下。

所以新增了独立的 `anime` 目录（`schemas/anime.schema.json` + `data/anime.json`），
并在 Prisma 里把 `Anime.workId` 改为**可空**——有关系就关联，没关系也合法。

### 4-2. 数据源：AniList GraphQL（唯一同时满足全部字段的源）

AniList 一次查询就能给出这里需要的每一项：

| 需求 | AniList 字段 |
|---|---|
| 漫改 / 轻小说改 / 原创 | `source` → `MANGA` / `LIGHT_NOVEL` / `ORIGINAL` … |
| TV 动画 / 剧场版 | `format` → `TV` / `MOVIE` / `OVA` / `ONA` |
| 已宣布未播出 | `status = NOT_YET_RELEASED` |
| 开播时间 | `startDate` / `season` / `seasonYear` |
| 主要声优 | `characters(role: MAIN)` 的 **edge** 上的 `voiceActors(language: JAPANESE)` |
| 制作公司 | `studios(isMain: true)` |

> ⚠️ 踩坑记录：`voiceActors` 在 **`CharacterEdge`** 上，不在 `Character` 上。
> 写成 `nodes { voiceActors }` 会直接 400：`Cannot query field "voiceActors" on type "Character"`。

**筛选策略**（AniList 的 Yuri 标签非常宽，含大量擦边作）：
`type: ANIME, tag: "Yuri", sort: [POPULARITY_DESC]`，取 18 页共 876 条，再做三层过滤：

| 过滤 | 丢弃数 |
|---|---|
| R18（`isAdult`） | 402 |
| 非日本制作 | 17 |
| Yuri 标签相关度 < 55 | 159 |
| **保留** | **298** |

### 4-3. 采集结果

```
298 部百合动画
├─ 形態   : tv 178 / movie 35 / ova 26 / ona 23 / special 19 / music 8 / tv_short 7
├─ 改編   : manga 113 / original 109 / other 33 / light_novel 28 / game 7 / visual_novel 3
└─ 狀態   : finished 285 / announced 11 / airing 2
```

字段覆盖：

| 字段 | 覆盖 |
|---|---|
| `cover_url` 封面 | **298 / 298 = 100%** |
| `start_date` 开播时间 | 293 / 298 = 98% |
| `main_cast` 主要声优 | 280 / 298 = 94% |
| `studios` 制作公司 | 271 / 298 = 91% |
| 关联到本站 Work | 7 |
| **schema 校验错误** | **0** |

用户点名的四类**全部非空**，且已被 `verify_acceptance.py` 设为**硬门禁**
（`manga` / `light_novel` / `original` / `movie` 任一类为空即 CI 失败）。

**用户点名的四个分类 → 精确筛选定义与数量**（这是最容易出错的地方）：

| 用户要的分类 | 精确筛选 | 数量 |
|---|---|---|
| **漫改** | `adaptation_source = manga` | **113**（其中 TV 76） |
| **輕小說改** | `adaptation_source ∈ {light_novel, web_novel, novel, visual_novel, game}` | **38** |
| **原創 TV 動畫** | `adaptation_source = original` **且** `format = tv` | **57** |
| **劇場版** | `format = movie` | **35** |
| **已宣布未播出** | `status = announced` | **11** |

> ⚠️ 注意「原創」的两种口径：`original` 总数是 **109**，但那是**所有形态**的合计
> ——其中 52 部不是 TV（movie 18 / ona 11 / special 8 / music 7 / ova 6 /
> tv_short 1 / other 1）。用户要的是「原创 **TV** 动画」，所以正确数字是 **57**。
> 站点上的预设按钮用的是 `original AND format=tv`，并会把 57 与 109 的差别写在页面上。


### 4-4. 溯源与合规

- 每条动画的 `sources[].basis` 是 **`third_party`**——AniList 是第三方**用户编辑**数据库，
  **不是官方来源**，置信度 0.7，前端会显式标出。要升级成 `official` 需接官方动画官网。
- AniList ToS 禁止把 API 当数据存储/备份、禁止 hoarding，因此**只保留作品介绍所需字段**
  （标题、放送日、集数、制作公司、主要角色与声优、封面链接），不做全量镜像。
- **R18 一律排除**，并且在**数据库层**加了 `CHECK ("isAdult" = false)`，
  不是只在前端过滤。
- 封面沿用同一套政策：**只存链接**，并加 `CHECK ("coverUrl" ~* '^https?://')`
  防止把图片以 `data:` 内联进来变相镜像。

### 4-5. 顺带修好的一个旧问题

为了验证新增的 Prisma 模型，第一次真正运行了 `npx prisma validate`
（此前 npm 不可用，**这个 schema 从写下起从未被验证过**）。它立刻报出：

```
error: Error validating field `source` in model `ChangeLog`:
       missing an opposite relation field on the model `Source`.
```

修好后 schema 通过验证。这条已加入 CI。**"没验证过的东西不要当作已完成"**——
这正是本项目对数据字段的要求，对 schema 同样适用。

---


## 第三轮：封面图与三语标题

用户要求：**每部作品保留日文原名、简体中文译名、繁体中文译名、封面图。**

### 3-1. 成果

| 指标 | 第二轮 | 本轮 |
|---|---|---|
| 作品数 | 36 | **49** |
| `title_ja` | 100% | **100%** |
| `title_zh_tw` | 5.6% | **30.6%**（15 部） |
| `title_zh_cn` | 0% | 0%（见 §3-3） |
| `cover_url` | 0% | **30.6%**（15 部） |
| 核心字段完整率 | 100% | 8 项中 **7 项 100%**，`serialization_status` 73.5%（见 §3-4） |

新增的 13 部作品来自東立「百合姬」系列目录。它们的**日文原名来自東立商品页自带的
「原文書名」栏**——这是可验证的一手字段，所以用 `title_ja` 建 Work 是**有据可依**，
不是猜测。（上一轮这批记录因为拿不到原文书名而被隔离；本轮补齐了 detail 采集，
13 部全部有了原文书名，因此可以正当地入库。）

### 3-2. 封面图：只存链接，绝不镜像

| 源 | 结果 |
|---|---|
| **東立** | ✅ 24 张封面（列表页 `pk_img` + 详情页 `og:image`），去重后覆盖 15 部作品 |
| 台灣角川 | 🟡 商品页有 `og:image`，但**标题是 JS 渲染**，拿不到书名 |
| **openBD** | ❌ **0/7 命中**——我们手上的日版 ISBN 全是 2026 年 10–11 月新刊，JPRO 断供后 openBD 的近刊覆盖率极低 |
| NDL | ❌ 无图（**書影API 已于 2026-03-31 终止**） |

**合规设计**（`components/CoverImage.tsx` 一处收敛）：

1. **只存 URL，不镜像字节**——图片留在出版社自己的 CDN 上；
2. `cover_display_allowed === false` 时**只渲染外连，不渲染 `<img>`**；
3. `referrerPolicy="no-referrer"`，不把本站 URL 泄露给 CDN；
4. 图下固定显示版本徽章 + `© 出版社` + **出处链接**，便于权利人要求下架；
5. `cover_note` 逐条写明授权依据（介绍目的引用）。

### 3-3. 简体中文译名：字段保留，但**拿不到数据**（如实说明）

`title_zh_cn` 字段在 schema、数据库、API、前端全部保留并渲染，当前 49 部全为
`null` + `status: "unchecked"`。原因是**没有可合法读取的来源**：

| 尝试 | 结果 |
|---|---|
| cppinfo（国家出版发行信息公共服务平台，最权威） | ❌ **SSL 握手失败**，多次重试（含 45s 超时）均不可达 |
| 国家版本数据中心 PDC | ⛔ `robots.txt` = `Disallow: /`，明确排除 |
| 豆瓣读书 | ⛔ 《法律声明》明文禁止数据采集与 AI 训练 |
| 天闻角川官网 | ❌ JS 渲染，HTML 里没有书目 |
| 台灣角川商品页 | 🟡 有封面但无标题（JS） |

而且对这批作品来说 **`null` 很可能是正确答案**：我们目前的 49 部几乎全是
百合姫コミックス／ガレット 系作品，其中大部分**确实没有官方简体中文版**。

因此本轮刻意新增了一个状态字段来区分三种情况——这三者在数据里都是 `title_zh_cn = null`，
若 UI 不区分，读者会把「没查」误读成「没有」：

| `title_zh_*_status` | 含义 | UI 显示 |
|---|---|---|
| `official` | 有官方译名 | 译名 + 绿色「官方譯名」徽章 |
| `none_known` | **已查证**目前无官方版 | 「目前無官方版本」 |
| `unchecked` | **尚未查证** | 「尚未查證」 |

> ⚠️ 这里踩到一个值得记录的设计坑：该枚举值最初叫 **`"unknown"`**，而
> `verify-provenance.mjs` 立刻报错——因为本项目用字符串 `"unknown"` 表示**缺值哨兵**，
> 于是「值是 unknown」与「值不存在」变得无法区分。已改名为 **`"unchecked"`**。
> 一个词的命名歧义，正好被自动化测试逼了出来。

### 3-4. `serialization_status` 73.5%：这是**诚实的天花板**，不是遗漏

新增的 13 部作品只有繁中零售书目可查，而**零售书目只记录「已出版」，不记录连载状态**；
日方来源（百合姫 目次、NDL）未覆盖这些作品。

可以推定的部分已经推定并明确标注为 `derived`（conf 0.6）：
- `publisher_ja` = 一迅社（東立系列标示「百合姬」→ 百合姫コミックス）→ **100%**
- `magazine_or_platform` = 百合姫コミックス，`kind: label`（**是单行本品牌，不是连载杂志**，
  所以不写成「コミック百合姫」）→ **100%**

不能推定的部分**保持 unknown**：
```json
"serialization_status": {
  "basis": "editorial", "source_url": "", "confidence": 0.0,
  "note": "繁中零售書目只提供「已出版」資訊，不含連載狀態；
           日方來源未覆蓋此作品，因此誠實地留 unknown。"
}
```

因此报告里同时给出两个数字：
- `core_field_completeness`（全体 49 部）：最低 73.5%
- `core_field_completeness_ja_source`（有日方一手来源的作品）：**100%**

把「有来源的作品」和「只有中文零售记录的作品」混在一个分母里，会让前者看起来比实际差。

---


## 第二轮补齐摘要

初版报告里标注了 3 个缺口。本轮把它们逐个处理，并**修正了一个我自己犯的错**。

| # | 初版状态 | 现状 |
|---|---|---|
| 1 | 网站未构建验证 | ✅ **`tsc --noEmit` + `next build` 通过**，39 个静态页，并起服务验证了页面内容 |
| 2 | `anime_status` 未采集 | ✅ **已采集**，匹配到 4 部作品的动画化信息（制作公司 / 形态 / 状态） |
| 3 | `ja_volumes` 为 0 | 🟡 **已打通**，`volume_count_ja` 完整率 0% → 16.7%，并已加分页以枚举完整卷集 |
| — | 「本机网络不可用于采集」 | ❌ **这个结论是错的，已更正**（见可行性报告 §2） |

### 本轮抓出的 3 个真问题

1. **连通性误判（我的错）**：初版用 curl / node 测连通性，而这两个客户端的 TLS 在本机是坏的，
   于是把「客户端握手失败」当成「网络阻断」，在可行性与 `sources.yaml` 里写下了错误结论。
   改用与采集器一致的 Python `requests` 后，NDL、AniList、楽天、カーリル、Google Books
   等**其实都可达**。本项目自己写下的规则是「网络失败 ≠ 站点拒绝」，
   而这次是「客户端故障 ≠ 网络阻断」——同一条纪律。
   `sources.yaml` 的布尔字段已替换为三值 `dev_host_reachability`
   （30 verified_reachable / 8 verified_unreachable / 37 unverified）：
   **未复测的一律记 unverified，而不是留一个假阴性。**

2. **类型检查抓出了 node 脚本抓不到的类型 bug**：`RatingPanel` 把宽松的 `RatingLike[]`
   传给要求严格 `Rating` 的组件。node 的类型剥离只删类型不检查，所以 4 个验证脚本全绿而类型其实不成立。

3. **slug 吞掉续作标记**：`citrus+` 被 slug 成 `citrus`，正好踩中自家去重文档的陷阱 T1。
   现在 `+`→`-plus`、`♪`→`-note`，`citrus+` 的 slug 是 `citrus-plus`。

### 本轮新增的工程约束

- **同一定义只能有一份**：标题/作者/ISBN 归一化抽到 `collectors/normalize.py`，
  采集器与建库脚本共用（此前重复定义已导致过真实 bug）。
- **测试不许硬编码数据快照**：`verify-policy.mjs` 原先写死「36」，
  数据一变成 anime=finished 就误报失败。现全部改为从数据集推导期望值。
- **失败必须分型**：NDL 的 `no_results`（服务确认 0 命中）与
  `unexpected_empty`（有命中但解析为 0，属结构变化）严格区分。

---

## 阶段 3：MVP 采集（已完成）

### 3.1 实采结果

| 指标 | 结果 |
|---|---|
| 入库作品数 | **36 部**（目标 20 部 ✅） |
| Schema 校验错误 | **0** |
| **核心字段完整率** | **100%**（8/8 字段全部填齐；验收标准要求 > 80% ✅） |
| 跨语言关联成功 | 7 条東立记录 → 2 部日文原作（经「原文書名」） |
| 待关联（无法确认日文原名） | 17 条（已隔离，未编造 `title_ja`） |
| 原始响应留档 | 70 个文件（`data/raw/`）+ `manifest.jsonl`（含 sha256） |
| 变更日志 | 36 条 `created` |

核心字段完整率**逐字段 100%**：

```
title_ja  authors  media_type  publisher_ja
serialization_status  magazine_or_platform  sources  last_checked
```

### 3.2 覆盖的源与运行状态

| 源 | 状态 | 产出 |
|---|---|---|
| コミック百合姫 公式（一迅社） | ok | 32 部连载作品 |
| ガレット 公式（自主制作百合コミック誌） | ok | 4 部连载作品 + **话数标签** |
| 東立出版社 ThemeGL（百合姬系列） | ok | 24 条繁中书目 |
| 東立出版社 書籍詳細 ×24 | ok | **原文書名 / 集數 / 譯者 / 出版日期 / ISBN** |
| openBD | ok | 0 命中（见下） |

采集器满足阶段 1 的全部合规要求：可识别 UA、**robots.txt 门禁**、per-host 限速、
原始层与标准化层分离、**网络失败与 robots 拒绝分开记录**。

### 3.3 三个必须如实说明的问题

**（1）`serialization_status` 是推定，不是官方声明。**
百合姫 官网「作品紹介」页收录的作品，我按「当前连载」处理，但**无法排除已完结作品
仍留在一览里**。因此该字段写为 `basis: derived`、`confidence: 0.6`，并在
`field_sources.serialization_status.note` 里写明了推定依据与不确定性。
→ 这不是「官方说它连载中」，复核需要看当期杂志目次。

**（2）17 条繁中书目未能关联，且我没有给它们编造日文原名。**
東立书目里「上伊那ぼたん」「雨夜の月」「わたしが恋人になれるわけないじゃん」等
**不在我们的 36 部日文作品范围内**，所以对不上。它们被隔离在
`data/zh_tw_pending_linkage.json`，而不是拿中文标题冒充 `title_ja`。
→ 要扩大关联率，正确做法是**先扩充日文侧作品池**，而不是放宽匹配阈值。

**（3）openBD 命中 0 是正确行为，不是 bug。**
我们手上只有東立给的**台湾 ISBN（978-626-…）**，而 openBD 是**日本出版数据库**，
不收台湾书。要真正用上 openBD（日版单行本 ISBN / 书影 / `lanove` 标志），
必须先拿到**日版 ISBN**——这需要一个日版书目源（NDL 全国書誌 / JAPAN/MARC），
而这两个源在阶段 1 实测**在本机不可达**，需要在 GitHub Actions 里跑。

### 3.4 已验证的可复用能力

- **東立「原文書名」是可行的跨语言锚点**——本次 7 条记录、2 部作品关联成功，
  证明了 `docs/phase2-dedup-strategy.md` §4 的设计在真实数据上成立。
- **同一部作品的多版本（通常版/限定版）会被识别为多条 Volume**（如
  `きみが死ぬまで恋をしたい` 第 9 集有 3 个 ISBN）。这是预期行为，因为
  `Volume.edition` 仍属预留字段（dedup 文档 §7），当前不合并。

---

## 阶段 4：网站 MVP（代码完成，构建未验证）

技术栈：Next.js 15 App Router + TypeScript + Tailwind v4 + Prisma（可选）。
代码位于 `web/`（31 个文件），**读取 `data/works.json`、`dataset_report.json`、
`change_log.json` 与 `sources.yaml` 即可运行，默认路径不依赖数据库**
（`verify-imports.mjs` 断言没有任何页面/组件 import `lib/prisma.ts`）。

功能：搜索（标题/作者/出版社/杂志）、组合筛选（状态/媒介/百合类型/动画化/有无中文版，
且反映到 URL query）、作品详情页（**逐字段溯源 + 逐字段置信度**）、变更日志、
数据源页（94 条）、数据质量面板。

### 4.1 已通过的验证（4 个脚本，均用原生 node 跑真实代码 + 真实数据）

| 脚本 | 结果 |
|---|---|
| `assert-data-contract.mjs` | **CONTRACT OK** |
| `verify-imports.mjs` | 84 个 import 全部可解析、187 个具名 import 存在、23 个文件括号平衡 |
| `verify-policy.mjs` | **102 项检查通过**（评分 P1–P5、D1、筛选逻辑） |
| `verify-provenance.mjs` | **65 项检查通过**（对全部 36 部作品） |

这些脚本执行的是**真实的** `lib/policy.ts` / `lib/provenance.ts`，不是重新实现的副本。

### 4.2 「渲染每一个字段」是机器可证的

`lib/schema-fields.json` 是字段清单的唯一真源，契约脚本证明它与
`schemas/work.schema.json` 的 `properties` **双向一一对应**（42 个顶层字段 + 10 组嵌套键集）。
因此 UI 既不能凭空多出字段，也不能静默漏字段。

### 4.3 验证抓出的两个真实 bug（已修）

1. 评分条宽度出现 `84.00000000000001`（`4.2/5*100` 的 IEEE-754 泄漏直接进了 CSS）
   → 新增 `ratingPercent()` 做舍入。
2. 「平均字段置信度」在两处定义不同（列表卡只看 `field_confidence`，
   详情页还回退到 `field_sources.confidence`）→ 统一委托给同一个 view model。

### 4.4 一个需要记录的设计判定：editorial 字段确实带 URL

管线**确实**会给 editorial 行附一个上下文 URL（例如 `genres` 是 editorial，
但带了掲載誌页面的 URL，共 36 行）。所以「editorial ⇒ 不显示链接」不能只靠组件约定，
被下沉到数据层：`FieldView.linkableSourceUrl` 在 `basis==='editorial'` 时强制为 `null`，
测试断言全部 36 部作品的每个 editorial view 都是 null。

### 4.5 构建验证：**已通过**（第二轮补齐）

初版报告写「npm 因 TLS 信任问题无法安装依赖」。这个诊断不完整——真正的原因是
**本机 Node 对 `registry.npmjs.org` 的 TLS 被中间设备替换成自签名证书**
（`node https://www.ichijinsha.co.jp` 返回 200，而 `registry.npmjs.org` 报
`DEPTH_ZERO_SELF_SIGNED_CERT`）。`--use-system-ca`、`NODE_EXTRA_CA_CERTS`、
npm `cafile` 均无效。

**改用镜像后成功**：

```bash
npm install --registry=https://registry.npmmirror.com   # 81 packages, 46s
npx tsc --noEmit                                          # exit 0
npm run build                                             # ✓ 39 static pages
```

`npm run build` 结果：

```
✓ Compiled successfully in 28.4s
✓ Generating static pages (39/39)
● /works/[slug]  → citrus, w-161124df31, … (+33 more paths)
```

并且实际起服务验证了内容（`next start` + HTTP 探测）：

| 路径 | 状态 | 大小 |
|---|---|---|
| `/` | 200 | 177 KB |
| `/changelog` | 200 | 110 KB |
| `/sources` | 200 | 443 KB（94 条数据源） |
| `/data-quality` | 200 | 167 KB |
| `/works/citrus` | 200 | 172 KB |

`/works/citrus` 页面内含真实内容：`citrus`、`サブロウタ`、`コミック百合姫`、`一迅社`、
`編輯判斷` 徽章、`溯源` 区块。

### 4.6 `tsc --noEmit` 抓出了一个 node 脚本抓不到的真 bug

`RatingPanel.tsx` 把 `groupRatingsByScale()` 返回的宽松类型 `RatingLike[]` 传给了
要求严格 `Rating` 的 `RatingRow`。node 的 `--experimental-strip-types` 只**剥离**
类型不做检查，所以 4 个验证脚本全部通过、而类型其实是不成立的。
→ 这正好说明：**类型检查不能用「脚本能跑」替代**。

修正：`RatingRow` 接受 `RatingLike`（与 `policy.ts` 一致），公开 props 仍是 `Rating[]`。

### 4.7 slug 修正：续作标记不再被吞掉

`make_slug("citrus+")` 会把 `+` 当作非字母数字删掉，得到 `/works/citrus`——
这正好踩中 `docs/phase2-dedup-strategy.md` 的陷阱 T1（续作 vs 本篇）。
若日后 `citrus` 与 `citrus+` 同时入库，两者 slug 会撞车。

修正：`normalize.make_slug` 先把续作标记编码成可读后缀
（`+`→`-plus`、`♪`→`-note`、`Ⅱ`→`-2` …），现在 `citrus+` 的 slug 是 `citrus-plus`。


---

## 阶段 5：自动化更新

### 5.1 Workflow 清单

| 文件 | 频率 | 内容 |
|---|---|---|
| `.github/workflows/collect-daily.yml` | 每日 01:00 UTC | 全量增量采集 → 标准化 → schema 校验 → 变更日志 → 合规自检 → 提交 |
| `.github/workflows/collect-news.yml` | 每 3 小时 | RSS 新闻采集 + 变更日志 |
| `.github/workflows/collect-weekly-zh-tw.yml` | 每周一 | 繁中侧重采（含東立 detail 页） |
| `.github/workflows/verify-monthly.yml` | 每月 1 日 | 全量重采 + 验收门槛 + 数据源健康报告 |
| `.github/workflows/ci.yml` | push / PR | schema 回归测试、离线重建、验收门槛、denylist、Web 构建 |

### 5.2 配套脚本（均已本地实测通过）

| 脚本 | 作用 | 实测结果 |
|---|---|---|
| `scripts/build_dataset.py` | 标准化 + 去重 + schema 校验 | 36 部，0 错误 |
| `scripts/validate_schema.py` | D1/D2/D3 规则的**正反用例** | 正例 PASS，**11/11 反例被正确拒绝** |
| `scripts/make_changelog.py` | 快照/git 差分 → 变更日志 | 36 条记录 |
| `scripts/verify_acceptance.py` | 验收门槛（硬门禁 vs 目标） | 全部硬门禁通过 |
| `scripts/source_health.py` | 网络失败 / robots 拒绝分列 | 33 条 ok |
| `collectors/news.py` | RSS 新闻采集 | 5 个 feed，340 条解析成功 |

### 5.3 两个原缺口：**均已补齐**（第二轮）

**原缺口 1：`anime_status` 没有自动采集 → 已解决。**

- しょぼいカレンダー：**确认不可用于发现**。实测 `TitleLookup` 明确返回
  `400 TIDが指定されていません/指定方法が間違っています`，`Title`/`Limit`/`Fields`
  等检索参数一律不支持；`ProgLookup` 的 `StTime`+`Range` 亦返回空。
  ⇒ 它只能在**已知 TID** 时使用（TID 可由 Annict 的 `syobocalTid` 取得）。
- **AniList GraphQL（POST）实测可用**，于是实现了 `collectors/anime.py`：
  查询 `type: ANIME, tag: "Yuri"`（AniList 的 genres 里没有 yuri，必须用 tag），
  再按「动画原题名」与「relation 里 MANGA 的原题名」双向匹配到我们的作品。

  实测结果：抓取 150 部百合动画，**匹配到 4 部我们的连载作品**：

  | 作品 | 状态 | 制作 | 形态 |
  |---|---|---|---|
  | きみが死ぬまで恋をしたい | finished | ROLL2 | tv |
  | ささやくように恋を唄う | finished | CLOUDHEARTS | tv |
  | 私の推しは悪役令嬢。 | finished | Platinum Vision | tv |
  | 私の百合はお仕事です！ | finished | Passione | tv |

  溯源依据写为 **`basis: "third_party"`**（为此在 schema / Prisma / 前端标签三处
  新增了该枚举值）——AniList 是第三方用户编辑数据库，**不是官方动画站**，
  置信度给 0.7，note 里注明「公式アニメサイトでの確認が望ましい」。
  AniList ToS 禁止把 API 当数据存储与大量囤积，因此**只保留比对结果，不镜像目录**。

**原缺口 2：`ja_volumes` 为 0 → 部分解决。**

- 路径穷举结果：Google Books API 匿名配额已耗尽（**HTTP 429**，多次重试均然）；
  一迅社 `data.ichijinsha.co.jp` 的发布日历是 JS 应用，HTML 里没有数据；
  ⇒ **只剩 NDL 一条合法路径**。
- 实现了 `collectors/ndl.py`（OpenSearch）。**实测 NDL 可达**（此前误判为阻断，
  见可行性报告 §2 修正记录）。第一次全量跑：14 成功 / **13 次 429 限流** /
  7 次超时 / 2 次零结果。加上退避重试与 `--delay 3.0` 后第二次：
  **27 成功 / 0 限流 / 1 超时 / 8 次真实零结果**，记录数 **116 → 249**。
  ⇒ 证明「把限流当成失败去调参」比「重试策略写死」更有效。

- **分页是必需的**：NDL 的 `title=` 检索一页被最新的几条占据，
  单页只会得到**最新一卷**。因此 `ndl.py` 增加了 `idx` 分页（`--pages`），
  以枚举完整卷集。**输出改为合并写入**——NDL 限流严重，部分成功的运行是常态，
  覆盖式写入会让上一次的成果白白丢失。

- 溯源与精度上的三处处理：
  1. **`no_results`（服务确认 0 条命中）** 与
     **`unexpected_empty`（报告有命中但解析出 0 条）** 严格区分——后者是响应结构
     变化，绝不能被当成「这部作品没有单行本」；
  2. **`release_date` 支持月精度**（NDL 给的是 `2019-06`）。schema 原本强制
     `YYYY-MM-DD`，会把月精度数据全部丢弃；现放宽为 `YYYY | YYYY-MM | YYYY-MM-DD`；
  3. **`volume_count_ja` 标为 `derived`**，note 写明「NDL 已知卷的最大值，
     缺卷时会比实际刊行数小，应当作下限值」。

- 补充匹配规则：NDL 书目标题通常带书系括号
  （例「ささやくように恋を唄う 12 (百合姫コミックス)」），归一化后无法与作品名精确相等，
  因此允许**前缀匹配**（并加长度下限 ≥4，防止短标题吞掉无关作品）。


### 5.4 为什么有些源永远不接进管线

`verify-monthly.yml` 里的 `source_health.py` 会检查「声明为 `do_not_collect` 的源
是否出现了成功的采集记录」。当前 0 违规。这是把阶段 1 的合规结论变成**可执行的断言**，
而不是只写在文档里。

---

## 附：阶段 3–5 的诚实度自评

| 项 | 状态 |
|---|---|
| 数据是否编造 | **否**。未确认的字段一律 `null`/`unknown`；17 条无法关联的繁中记录被隔离而非猜测 |
| 是否绕过反爬 | **否**。natalie.mu（WAF）、豆瓣、PDC、掌阅（全站 Disallow）等一律未采集 |
| 是否含盗版链接 | **否**。`research/compliance_check.py` 对 112 个引用域名做 denylist 检查，命中 0 |
| 是否夸大完成度 | 已显式标出 3 个缺口：Web 未构建验证、动画化未采集、日版单行本未采集 |
