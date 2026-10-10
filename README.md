# 日本百合漫画 / 轻小说 连载与出版信息数据库

面向百合向 ACG 的**可搜索、可筛选、可持续更新**的连载与出版信息数据库。
覆盖：杂志连载、Web 平台、单行本（日版 / 繁中 / 简中官方授权）、连载状态、
百合类型、动画化、以及**日文 / 繁中 / 简中三地评价**。

## 当前进度

| 阶段 | 内容 | 状态 | 交付物 |
|---|---|---|---|
| **1** | 数据源调研 | ✅ 完成 | [`sources.yaml`](sources.yaml) · [`docs/phase1-feasibility-report.md`](docs/phase1-feasibility-report.md) |
| **2** | Schema 与去重策略 | ✅ 完成 | [`prisma/schema.prisma`](prisma/schema.prisma) · [`schemas/work.schema.json`](schemas/work.schema.json) · [`docs/phase2-dedup-strategy.md`](docs/phase2-dedup-strategy.md) |
| **3** | MVP 采集（36 部作品） | ✅ 完成 | [`data/works.json`](data/works.json) · [`data/dataset_report.json`](data/dataset_report.json) · [`docs/phase3-5-report.md`](docs/phase3-5-report.md) |
| **4** | 网站 MVP（Next.js） | ✅ 代码完成，**`tsc --noEmit` 与 `next build` 均已通过**（39 个静态页） | [`web/`](web/) |
| **5** | 自动化更新 | ✅ 已实现，含 2 个可运行但**未在本地验证过**的采集器 | [`.github/workflows/`](.github/workflows/) |

### 作品库：漫画 + 轻小说（本轮扩展）

| | 数量 |
|---|---|
| **作品总数** | **835** |
| 漫画 | 747 |
| **轻小说** | **88** |
| 有封面 | 811（97%） |
| 有作者 | 828（99%） |

- **轻小说来源**：AniList 的 `type: MANGA` 用 `format` 区分——`MANGA`/`ONE_SHOT` → 漫画，
  **`NOVEL` → 轻小说**。按 `tags.rank`（Yuri 相关度）过滤擦边作。
- **出版文库 / レーベル**：AniList 不提供，由 **NDL 的 `seriesTitle`** 补全
  （電撃文庫 / GA文庫 / 角川スニーカー文庫 / 百合姫コミックス …）。
  ⚠️ 必须用 `category` 排除「録音資料」，否则动画主题歌 CD 的「King Records」
  会被当成本书出版社；`seriesTitle` 还要去掉「; 4034」这类卷次记号。
- **收录不以「是否有官方繁中版」为条件**——只有民间汉化的作品同样入库。

**完整率按来源层级判定**（混算会得出没有意义的数字）：

| 层级 | n | publisher | magazine |
|---|---|---|---|
| **curated**（有出版社/书目一手来源） | 49 | **100%** | **100%** |
| **catalogue**（仅 AniList 目录，待 NDL 补全） | 786 | 0% | 0% |

硬门禁只压 curated 层；catalogue 由**每日分批补全任务**（NDL，200 条/天，
合并式写入）逐步升级为 curated。

### 百合動畫目錄

独立的第二份数据集 [`data/anime.json`](data/anime.json)（**298 部**），
不与 Work 混同——原创动画与剧场版没有漫画/小说原作：

```
形態: tv 178 / movie 35 / ova 26 / ona 23 / special 19 / music 8 / tv_short 7
改編: manga 113 / original 109 / other 33 / light_novel 28 / game 7 / visual_novel 3
狀態: finished 285 / announced 11（已宣布未播出）/ airing 2
```

字段覆盖：封面 **100%**、开播时间 **98%**、主要声优 **94%**、制作公司 **91%**、schema 错误 **0**。

**分类对照**（站上预设按钮的精确筛选定义）：

| 分类 | 筛选 | 数量 |
|---|---|---|
| 漫改 | `adaptation_source = manga` | 113（TV 76） |
| 輕小說改 | `light_novel / web_novel / novel / visual_novel / game` | 38 |
| **原創 TV 動畫** | `original` **且** `format = tv` | **57**（`original` 总数 109，其余 52 部为 OVA/ONA/劇場版等） |
| 劇場版 | `format = movie` | 35 |
| 已宣布未播出 | `status = announced` | 11 |


- 来源：AniList GraphQL（`tag: "Yuri"` + `POPULARITY_DESC`），经 R18／非日本／相关度三层过滤
- 溯源 basis 为 **`third_party`**（AniList 是用户编辑数据库，**不是官方源**），置信度 0.7
- **R18 排除并在 DB 层加 CHECK 强制**；封面只存链接（同样有 CHECK 防止 `data:` 内联镜像）

### 静态站点：不依赖任何常驻进程

站点用 **`output: 'export'`** 构建成**纯静态文件**（`web/out/`），
**不需要服务器、不需要数据库、不需要主机上的 cron**。

```
data/*.json  ──build──▶  web/out/  ──▶  任意静态托管（GitHub Pages / Cloudflare Pages / 对象存储）
```

### 筛选为什么还能用

静态站点不能在服务端读查询参数，所以筛选改成**浏览器端**：

- `web/scripts/build-slim.mjs` 在构建前生成**瘦身投影**：
  `data/works.json`（4.7 MB）→ `web/lib/works-slim.json`（960 KB），
  `data/anime.json`（1.9 MB）→ `web/lib/anime-slim.json`（270 KB）；
- 投影里的 `avg_confidence` / `has_zh_tw` / `has_zh_cn` 是**用真实的 lib 函数算出来的**
  （不是在 Python 里复刻一遍——那正是本项目踩过的「两处定义不一致」bug）；
- 列表页变成 `'use client'` 组件，用 `useSearchParams()` 读 URL 后**在浏览器里筛选**；
- 筛选表单仍是 GET 表单，所以**网址依旧可分享**；
- 作品/动画**详情页是预渲染的完整页面**，字段与溯源一点没少。

### 本地预览（不需要 Node 服务）

```bash
cd web && npm run build          # 产出 web/out/
npx --yes serve out -l 3000      # 或任意静态文件服务器
# 浏览器打开 http://127.0.0.1:3000
```

> 注意：直接用 `file://` 打开 `out/index.html` **不行**——Next 的资源路径是绝对路径，
> 需要一个静态文件服务器（任意一种都行，不限于 Node）。

### 定时更新（线上没有任何服务器）

| 环节 | 由谁负责 |
|---|---|
| 采集数据 | `collect-daily.yml`（每日）/ `collect-news.yml`（每 3 小时）/ `collect-weekly-zh-tw.yml`（每周）→ commit 回仓库 |
| 构建 + 发布静态站 | `deploy-static.yml`：`data/**` 或 `web/**` 有 push 时触发；另有**每日 04:10 UTC 兜底 cron** |
| 全量校验 | `verify-monthly.yml`（每月） |

数据一 commit，push 就触发重建与发布；因此**更新是定时的，但线上流量只打到静态文件**。

## 验收标准对照

| 验收标准 | 状态 |
|---|---|
| 至少 100 部作品入库 | ⏳ 当前 **49 部**（36 日方一手 + 13 東立目录，后者含已验证的「原文書名」） |
| 核心字段完整率 > 80% | ✅ 8 项中 **7 项 100%**；`serialization_status` 73.5%（繁中零售书目不含连载状态，见报告 §3-4）。**有日方一手来源的作品为 100%** |
| 每条记录有 source_url 和 last_checked | ✅ 硬门禁校验，0 违规 |
| 支持按杂志、出版社、连载状态、动画化状态筛选 | ✅ 已实现并实测 |
| 每日自动更新并有变更日志 | ✅ workflow + `make_changelog.py` |
| 不包含盗版内容或链接 | ✅ 域名 denylist 检查，命中 0 |
| **每部作品保留日文原名 + 繁中/简中译名 + 封面图** | ✅ 字段与 UI 均已就绪：`title_ja` 100%、`title_zh_tw` 30.6%、`title_zh_cn` 字段保留但来源不可达（见下）、`cover_url` 30.6% |
| **百合動畫：漫改／輕小說改／原創 TV／劇場版，含開播時間、主要聲優、製作公司、已宣布未播出** | ✅ **298 部**，四类全部非空并已设为硬门禁；開播時間 98%、聲優 94%、製作公司 91% |

### 三语标题与封面（本轮新增）

- **日文原名 / 繁體中文譯名 / 簡體中文譯名** 三个字段**一律渲染**，缺值时区分
  「已查證無官方版」（`none_known`）与「尚未查證」（`unchecked`）——这两者在数据里都是
  `null`，不区分会让读者把「没查」当成「没有」。
- **封面只存 URL，绝不镜像**：`cover_display_allowed === false` 时只渲染外连；
  带 `referrerPolicy="no-referrer"`、版本徽章、`© 出版社` 与出处链接，便于权利人下架。
- `title_zh_cn` 目前全为 `null`：**没有可合法读取的来源**（cppinfo SSL 不可达、
  PDC 全站 `Disallow: /`、豆瓣明文禁采、天闻角川 JS 渲染）。对这批百合姫系作品而言，
  「无官方简中版」很可能就是正确答案。


### 已补齐的缺口（第二轮）

1. **网站构建** — `npm install --registry=https://registry.npmmirror.com` +
   `tsc --noEmit` + `npm run build` 全部通过，并起服务验证了页面内容。
   本机 Node 对 `registry.npmjs.org` 的 TLS 被替换成自签名证书，故必须走镜像。
2. **`anime_status`** — 已由 `collectors/anime.py`（AniList GraphQL）采集，
   匹配到 4 部作品的动画化信息（含制作公司与放送形态）。
3. **`ja_volumes`** — 已由 `collectors/ndl.py`（NDL 国会図書館サーチ）采集，
   4 部作品补上日版 ISBN；`volume_count_ja` 完整率 0% → 11.1%。

### 仍存在的限制（如实标注）

1. **`collectors/anime.py` 与 `collectors/ndl.py` 是第二轮的产物**；
   `ndl.py` 已有解析器单元测试（`scripts/test_ndl_parser.py`），但**整体仍在完善中**
   ——NDL 首次全量跑遇到 13/36 次 429 限流，已加退避重试但未跑完整轮次。
2. **`anime_status` 的溯源是 `third_party`（AniList），不是官方动画站**，
   置信度 0.7。要升级为官方来源需接 `an_official_site`。
3. **作品数 36 < 验收标准的 100**。扩大规模需要先扩充日文侧作品池
   （`zh_tw_pending_linkage.json` 里 17 条繁中书目正等着对回日文原作）。


## 三条硬红线（全项目适用）

1. **不访问、不索引、不存储**任何盗版站 / 漫画聚合站 / 汉化组发布页的内容与链接。
2. **不绕过**付费墙、登录墙、验证码或 AWS WAF 挑战。
3. **不存储评论正文**（第三方著作权）。评价只存聚合分数与件数 + 原文链接。

## 环境要求（重要，已修正）

**本机可以承担采集** —— 阶段 3–5 的東立、百合姫、ガレット、AniList、NDL 采集
都是在本机完成的。云端 CI 仍然推荐，理由是**定时与稳定**，不是能力限制。

本机有两个特有问题（只影响工具选择，不影响采集）：

| 现象 | 规避 |
|---|---|
| `curl`(schannel) 报 `SEC_E_UNTRUSTED_ROOT` | 用 Python `requests` 或 WebFetch，**不要用 curl 判定连通性** |
| Node 对 `registry.npmjs.org` 报自签名证书 | `npm install --registry=https://registry.npmmirror.com`（已验证可用） |

**确实不可达/被拒的**：`api.syosetu.com`（被中间设备劫持，返回非なろう 的 403）、
`www.pixiv.net`、`api.jikan.moe`（超时）、`natalie.mu`（WAF 405）、
`www.alphapolis.co.jp`（WAF 202）。

⚠️ **教训**：连通性结论必须用**与生产采集器相同的客户端**复现。本项目已两次
因为用了坏掉的客户端（curl、node）而误判「域名被阻断」。


## 目录结构

```
sources.yaml                           # 阶段1：94 条数据源
docs/
  phase1-feasibility-report.md         # 阶段1 可行性报告
  phase2-dedup-strategy.md             # 阶段2 去重策略
  phase3-5-report.md                   # 阶段3-5 交付报告（含诚实度自评）
prisma/
  schema.prisma                        # PostgreSQL / Prisma schema
  constraints.sql                      # CHECK 约束（把 D1/D2/D3 变成 DB 层强制）
schemas/
  work.schema.json                     # Work 交换格式（JSON Schema 2020-12）
  anime.schema.json                    # 百合動畫目錄格式
collectors/
  base.py                              # HTTP + robots 门禁 + 限速 + 原始留档
  normalize.py                         # 归一化单一真源（标题/作者/ISBN）
  sources.py                           # 百合姫 / ガレット / 東立 / openBD
  anime.py                             # 百合動畫目錄（AniList）+ 作品动画状态回填
  ndl.py                               # NDL 国会図書館サーチ（日版 ISBN，含分页与 429 退避）
  news.py                              # RSS 新闻（含产出率警告）
  run.py                               # 主编采集 CLI
scripts/
  build_dataset.py                     # 作品：标准化 + 去重 + schema 校验
  build_anime_dataset.py               # 動畫：标准化 + schema 校验
  validate_schema.py                   # D1/D2/D3 正反用例（11 个反例）
  test_ndl_parser.py                   # NDL 解析器单元测试
  make_changelog.py                    # 变更日志
  verify_acceptance.py                 # 验收门槛（硬门禁 vs 目标，含動畫四分类门禁）
  source_health.py                     # 网络失败 / robots 拒绝分列
  validate_workflows.py                # workflow YAML + 引用脚本存在性
data/
  works.json                           # 49 部作品（schema 合规）
  anime.json                           # 298 部百合動畫（schema 合规）
  anime_catalog.json                   # 動畫采集原始目录
  anime_report.json                    # 動畫覆盖统计
  dataset_report.json                  # 作品完整率与统计
  change_log.json                      # 变更日志
  source_health.json                   # 数据源健康
  raw/                                 # 原始响应留档 + manifest.jsonl(sha256)
web/                                   # 阶段4：Next.js 站点（静态导出）
  scripts/build-slim.mjs               # 生成客户端瘦身投影（用真实 lib 函数算衍生值）
  lib/works-slim.json                  # 835 条作品投影（生成物）
  lib/anime-slim.json                  # 298 条动画投影（生成物）
  out/                                 # next build 产出的纯静态站点（可部署）
.github/workflows/                     # 阶段5：定时采集 + 静态部署 + CI
research/                              # 阶段1 取证脚本与原始证据
```

## 常用命令

```bash
# 数据管线
python collectors/run.py --delay 2.0 --details 24   # 采集
python scripts/build_dataset.py                      # 标准化 + 去重 + 校验
python scripts/make_changelog.py                     # 变更日志
python scripts/verify_acceptance.py                  # 验收门槛
python scripts/source_health.py                      # 数据源健康
python scripts/validate_schema.py                    # schema 回归测试
python collectors/news.py --since-days 7             # 新闻

# 合规自检（盗版域名 denylist）
python research/compliance_check.py

# 前端（需可用网络）
cd web && npm install && npm run dev
```
