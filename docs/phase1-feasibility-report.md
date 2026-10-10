# 阶段 1 可行性报告
## 日本百合漫画 / 轻小说 连载与出版信息数据库

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0 |
| 生成日期 | 2026-10-09（Asia/Hong_Kong） |
| 对应交付物 | `sources.yaml`（同目录上级） |
| 调研方法 | Lead 直接实测 + 8 个并行调研子代理联网查证；所有结论附证据 URL |
| 阶段约束 | 本阶段**不写任何前端代码** |

---

## 0. 结论摘要（先看这一段）

**总体判定：项目可行，但需要三处对原始需求的修正，否则会在阶段 3 撞墙。**

| 判定项 | 结论 |
|---|---|
| 数据源是否充足 | ✅ **充足**。仅官方可枚举入口就有：百合姫（约 30 部连载）、ガレット、カドコミ **8,151 部 series**、web-ace **13,030 条 URL**、東立 **10,000 条书目**、台灣角川 **14,246 个商品页** |
| 100 部作品入库 | ✅ **可达**，且远超（预计可轻松到 300+ 部有官方来源支撑的作品） |
| 核心字段完整率 > 80% | ⚠️ **部分字段可达，部分字段结构上不可能达到 80%**。见 §4 逐字段评估。`chapter_count`（连载话数）、精确 `start_date`、`official_zh_cn` 是三个硬骨头 |
| 「实时更新」 | ⚠️ **必须改为定时增量**（用户已同意）。最快通道是 アニメ化新闻（1–6h），最慢是繁中出版（周） |
| 每条数据带 source_url + confidence | ✅ 可达，且本阶段已建立 `verified_by` 三级证据体系 |
| 非官方汉化「存在性」标记 | ❌ **建议不自动采集**。这是本方案最大的合规灰区，见 §6.4 |
| `yuri_type` 百合类型分类 | ⚠️ **没有官方来源**。这是编辑主观判断，不满足「每条数据必须有 source_url」。见 §6.5 |
| 运行环境 | ⚠️ **本机无法承担采集**：DNS 污染 + TCP 阻断 + WAF。采集必须跑云端 CI。见 §2 |

### 需要用户拍板的 3 个决策

1. **`unofficial_zh`（非官方汉化）字段**：是**删除**、还是保留为**纯人工登记且不提供任何链接**、还是保留字段但一律填 `unknown`？
   → 我的建议：**保留字段但一律 `unknown`，并在前端以说明文案替代**（见 §6.4）。
2. **`yuri_type` 主观分类**：接受「编辑判断 + 不计入 source_url 强制项」吗？
   → 我的建议：**接受**，但要新增 `classification_basis: editorial | official_tag` 字段区分（见 §6.5）。
3. **采集运行环境**：是否接受「数据管线跑 GitHub Actions，本机只做开发」？
   → 我的建议：**必须接受**，否则阶段 3 无法进行（见 §2）。

---

## 1. 调研范围与方法

### 1.1 覆盖的源类别（7 类）

| 类别 | 覆盖源数 | 代表 |
|---|---|---|
| A 日本书目/ISBN/书影元数据 | 11 项（含 2 项已终止） | NDLサーチ SRU/OpenSearch/OAI-PMH、JAPAN/MARC 批量、openBD、JPRO、楽天ブックス、カーリル |
| B 漫画连载杂志与 Web 平台 | 13 项 | コミック百合姫、ガレット、カドコミ、web-ace、きららWeb、コミックキューン、芳文社、一迅プラス |
| C Web 小说与轻小说文库 | 见 `sources.yaml` | 小説家になろう API、カクヨム、アルファポリス、各文库 |
| D 繁体中文版 | 15 项 | 東立、青文、台灣角川、長鴻、尖端、台灣東販、國家圖書館 ISBN |
| E 简体中文官方授权版 | 16 项 | cppinfo、PDC、天闻角川、豆瓣、B站漫画、快看 |
| F 动画化与新闻 | 见 `sources.yaml` | AniList、MAL 官方 API、コミックナタリー（WAF）、しょぼいカレンダー |
| **G 评价/评分（新增需求）** | **19 项** | 楽天レビュー、openBD 書評、巴哈姆特 ACG、金石堂、Readmoo、豆瓣（禁） |

### 1.2 证据等级

每条源都标注了 `confidence`（high/medium/low）与 `verified_by`：

- `lead_direct` — 本次调研中直接抓取/实测取得（最强）
- `research_agent` — 子代理联网查证并附 evidence_urls
- `search_only` — 仅搜索结果，未打开原文

**诚实声明**：由于本机出网受限（§2），相当一部分结论来自子代理通过搜索与部分可达站点取得，而非我在本机逐一复现。所有此类结论已标注 `verified_by: research_agent`，并在 `sources.yaml` 的 `open_questions` 中标出待复核项。**这些字段在阶段 3 入库前需要在云端 CI 环境中复验。**

### 1.3 本次由 Lead 直接实测的一手证据（`verified_by: lead_direct`）

这一批是**不依赖子代理**的硬证据，可信度最高：

| # | 实测对象 | 结果 |
|---|---|---|
| 1 | **openBD 利用規約** | 已读全文。确认「本の販促・紹介目的に限り」「禁止第三者に貸与、譲渡、売買」「不得任意改変」 |
| 2 | **openBD 数据规格** | 已读 /spec/，确认 ONIX + hanmoto 扩展字段（含 `lanove` ライトノベルフラグ、`reviews` 書評情報） |
| 3 | **openBD API 实测** | `/v1/get` 返回 302→200 且有数据 |
| 4 | **46 个域名 robots.txt** | 全部抓取留档于 `research/raw/robots/` |
| 5 | **コミック百合姫 官网** | 2026年11月号（**2026-09-16 发售**），作品紹介列出约 30 部连载的作品名+作者 |
| 6 | **ガレット 官网** | No.37（**2026-02-22 发行**、B5判/190頁、10周年記念号），掲載作品带**话数**（乙女の神殿#5 等），RSS 可用 |
| 7 | **カドコミ sitemap** | `sitemap-series.xml` = 1,018,984 bytes、**8,151 部 series**，带 lastmod |
| 8 | **web-ace.jp sitemap** | **13,030 条 URL**（1,624,792 bytes） |
| 9 | **東立 SitemapBooks** | **10,000 条**书目 URL（1,942,100 bytes）；`?page=2` 返回完全相同的字节数 → 分页失效 |
| 10 | **台灣角川 sitemap** | 15,628 条 URL，含 `/zh-hant/pages/girlslove`（百合館） |
| 11 | **DNS 污染** | `api.syosetu.com`→31.13.96.195、`www.pixiv.net`/`app.rakuten.co.jp`→157.240.3.8（均为 Facebook IP） |
| 12 | **PDC robots** | `pdc.capub.cn/robots.txt` = `User-agent: * / Disallow: /` **逐字确认** |
| 13 | **掌阅 robots** | `www.zhangyue.com/robots.txt`：多个具名 bot 白名单 + 末尾 `User-agent: * / Disallow: / / Crawl-delay: 60` **逐字确认** |
| 14 | **快看 robots** | `Disallow: /404.html`、`Disallow: /*?*`、**`Allow: /sitemap/sitemapindex.xml`** **逐字确认** |
| 15 | **cppinfo robots** | `book.cppinfo.cn/robots.txt` = 404（无限制）**逐字确认** |
| 16 | **讲谈社/竹书房/小学馆 robots** | 讲谈社点名 Disallow 多家 AI 爬虫 + `/products/search`；竹书房仅 `*` 禁 `/author/api/`；小学馆 `Crawl-delay: 10` |
| 17 | **natalie.mu WAF** | `robots.txt`=405、`/comic/news/feed`=AWS WAF 挑战页 |
| 18 | **芳文社 robots** | 仅禁 360Spider；**站点为 Shift_JIS** |

---

## 2. 网络实测（**已修正**：本机并非"不可用"）

> ### ⚠️ 修正记录（2026-10-09 晚，阶段 3–5 期间）
> **本节的初版结论是错的，特此更正。**
>
> 初版判定「多个域名被 TCP 阻断／必须全程跑云端 CI」。原因是我主要用 `curl` 与
> `node` 测连通性，而**本机的 curl(schannel) 与 node 的 TLS 栈是坏的**
> （见下 §2.3），于是把「客户端握手失败」误当成了「网络阻断」。
>
> 改用与采集器一致的 **Python `requests`** 复测后，绝大多数「被阻断」的域名
> **其实可达**。我本人恰好违反了本项目自己写下的规则——
> **「网络失败 ≠ 站点拒绝，必须分开记录」**：这次是「客户端故障 ≠ 网络阻断」。
>
> 修正后的结论：**本机可以承担绝大部分采集**（阶段 3 已在本机实际完成
> 東立、百合姫、ガレット、AniList、NDL 的采集）。云端 CI 仍然推荐，
> 理由是**稳定性与定时性**，而非「本机做不到」。

### 2.1 修正后的连通性实测（Python `requests`，2026-10-09）

| 域名 | 结果 | 判定 |
|---|---|---|
| `ndlsearch.ndl.go.jp` | 慢，ReadTimeout；但**采集器实际成功取回 50 条** | ✅ 可达（慢） |
| `app.rakuten.co.jp` | **200** `{"error":"invalid_token"}` — 真实 API 的鉴权拒绝 | ✅ 可达（需双凭据） |
| `www.googleapis.com` | **429** quota exceeded — 真实 Google 配额响应 | ✅ 可达（匿名配额耗尽） |
| `api.calil.jp` | **200**，4.87 MB | ✅ 可达 |
| `isbn.ncl.edu.tw` | **404**（robots.txt 不存在） | ✅ 可达 |
| `www.books.com.tw` | **200**（robots.txt 296 bytes） | ✅ 可达（WAF 时通时不通） |
| `cal.syoboi.jp` | 200 | ✅ 可达 |
| `graphql.anilist.co` | 404（GET 不允许，POST 返回 200 数据） | ✅ 可达 |
| `ga.sbcr.jp` / `comic-action.com` / `prtimes.jp` | 200 | ✅ 可达 |
| `www.ichijinsha.co.jp` / `galetteweb.com` / `comic-walker.com` / `web-ace.jp` / `www.tongli.com.tw` / `www.kadokawa.com.tw` | 200 | ✅ 可达 |
| **`api.syosetu.com`** | DNS 指向 `162.125.80.3`，返回 Apache 通用 **403 Forbidden**（**不是**なろう 的 API 响应） | ❌ **被中间设备劫持** |
| **`www.pixiv.net`** | DNS 指向 Dropbox 段 `108.160.166.148` | ❌ 被劫持 |
| **`api.jikan.moe`** | ReadTimeout | ❌ 不可达 |
| `natalie.mu` | `robots.txt` **405** + `/comic/news/feed` 返回 AWS WAF 挑战页 | ⛔ 站点主动拒绝 |
| `www.alphapolis.co.jp` | `robots.txt` **202** 空响应 + WAF | ⛔ 站点主动拒绝 |

**DNS 答案是漂移的**：同一域名在不同时刻解析到不同网段
（`api.syosetu.com` 先解析到 Facebook 段 `31.13.96.195`，后为 Dropbox 段
`162.125.80.3`）。因此**不能凭一次 DNS 或一次超时就断言永久阻断**。

### 2.2 修正后的架构结论

1. **本机可以承担采集**（阶段 3 已证明）。云端 CI 仍然推荐，动机是**定时与稳定**，
   不是能力限制。
2. **爬虫必须内置重试 + 退避**，并区分三类结果：
   `network_error`（网络/客户端问题） / `blocked_by_robots`（站点拒绝） / `ok`。
   `CrawlRun` 表用 CHECK 约束强制失败必须带原因。
3. **不要用单一客户端下结论。** 本项目已两次踩到：
   一次是把 curl 的 TLS 故障当网络阻断；一次是把 NDL 的慢当作不可达。
   合规结论必须用**与生产采集器相同的客户端**复现。

### 2.3 本机特有问题（会影响开发，但不影响采集）

| 现象 | 影响 | 规避 |
|---|---|---|
| **`curl`(schannel) 报 `SEC_E_UNTRUSTED_ROOT`** | 无法用 curl 验证 HTTPS | 用 `requests` / `WebFetch` |
| **`node` 对 `registry.npmjs.org` 报 `DEPTH_ZERO_SELF_SIGNED_CERT`** | `npm install` 失败（`--use-system-ca`、`NODE_EXTRA_CA_CERTS`、npm `cafile` 均无效） | 改用镜像：`npm install --registry=https://registry.npmmirror.com` ✅ **已验证可用** |
| `node` 访问 `example.com` 报 ECONNRESET | 个别域名 | 无影响 |

---

## 3. 数据源分层（按可信度与合规性）

### 3.1 P0 — 官方、免费、条款清晰（主数据源）

| 源 | 用途 | 关键约束 |
|---|---|---|
| **NDL 全国書誌 / JAPAN/MARC 批量下载** | ISBN、书名、著者、出版者、出版年月、NDC | 条款最宽：営利・非営利を問わず無償，只需出典表示 |
| **NDLサーチ OAI-PMH** | 全量/增量书目 harvest | 一次 200 件，`from` 必填且期间 ≤1 年 |
| **openBD API** | 书名、系列/レーベル、著者、书影、内容紹介、`lanove` 标志、**书评刊登元数据** | ⚠️ 禁止向第三方再配布；不得改変；删除请求须即配合 |
| **コミック百合姫 官网** | 连载阵容、号数、单行本新刊 | 已实测可抓 |
| **カドコミ sitemap** | 8,151 部 series、更新日 | 禁 `/?`、`/api/`、`/auth/` |
| **web-ace sitemap** | 13,030 URL、连载话数（第N話） | robots 几乎全开 |
| **東立 BooksDetail** | 繁中：原文書名、集數、譯者、出版日期、ISBN | sitemap 上限 10,000 |
| **NCL ISBN 書目庫** | 繁中权威书目、譯者、CIP | 需 POST + csrftoken；批量需登录 |
| **cppinfo.cn** | 简中权威书目（ISBN 直链出全字段） | robots 404（无限制） |

### 3.2 P1 — 可用但有门槛

| 源 | 门槛 |
|---|---|
| 楽天ブックス API | 需 **App ID + Access Key 双凭据**（旧教程已过期），有 branding 义务 |
| カーリル API | 需 appkey，强制回链，1000 req/h |
| 巴哈姆特 ACG 資料庫 | 繁中侧最佳评分源，robots `Allow: /` + sitemap |
| 金石堂 | robots 宽松，SSR 直接含评论 |
| AniList / MAL 官方 | 有速率与「禁止存储/囤积」限制 |
| 小説家になろう API | 需确认ジャンル定义能否识别百合 |

### 3.3 P2 — 不要自动采集（明确排除）

| 源 | 排除理由 |
|---|---|
| **コミックナタリー** | AWS WAF，`robots.txt` 返回 405 → 不得绕过（本地验证码/挑战绕过违反 R2）。改为人工登记 |
| **豆瓣读书** | API 2019-10 关闭；《法律声明》明文禁止爬虫、数据摘录与 AI 训练 |
| **国家版本数据中心 PDC** | `robots.txt` = `Disallow: /`（全站禁止） |
| **掌阅 zhangyue.com** | `robots.txt` = `Disallow: /` + `Crawl-delay: 60` |
| **Pubu** | robots 白名单制，末尾明写「禁止一切未列名爬虫」 |
| **Kobo 评分后端** | `ratingsapi.kobo.com/robots.txt` = `Disallow: /` |
| **ebookjapan 评论区** | robots 对**所有 UA（含 Googlebot）** Disallow `/review` |
| **Amazon 星级/评论** | 运营政策禁止在 PA API 之外展示评论或星级 |
| **PDC / 全国图书馆参考咨询联盟** | 仅人工核验 |

### 3.4 已确认失效 / 需改写（重要，避免照着旧教程开发）

| 事项 | 现状 | 影响 |
|---|---|---|
| **NDL 書影API** | **2026-03-31 服务終了**（因 JPRO 利用規約改定） | 任何依赖 NDL 书影的管线已断 |
| **Amazon PA-API 5.0** | 2026-04-30 deprecated、2026-05-15 端点退役，返回 403 `AccessDeniedException` | 必须迁移到 Creators API（OAuth2），且不提供评论正文 |
| **openBD 数据上游** | 2023-06-05 起 JPRO 停止向版元ドットコム配信；2023-08-29 起改用 NDL CC-BY 書誌「代替書誌情報」 | **书影收录范围大幅下降**，命中率必须逐 ISBN 实测 |
| **楽天 Books API 认证** | 从「仅 App ID」升级为 **App ID + Access Key** | 实测无凭据：新 host 400、旧 host 401 |
| **一迅プラス 域名** | `ichijin-plus.com` → `ichicomi.com`（301） | 硬编码旧域名会失败 |
| **コミックNewtype URL** | `comic.webnewtype.com` → `web-ace.jp/comicnewtype/` | 同上 |
| **きららミラク** | 已終刊（2017 年 12 月号，非 2015） | 别当成现役杂志 |
| **コミックキューン** | `comiccune.jp` 已 canonical 到 `kadokawa.co.jp/label/comiccune/`；**仍在刊**（至 2026 年 11 月号） | 「已 Web 移行休刊」是误传 |
| **ガレット** | **健在**，No.37 = 2026-02-22，自主制作百合志 | 别当成已停刊 |
| **Google Books API** | 本次全部 429（配额耗尽） | 覆盖率仍是 unknown，**未做推断** |

### 3.5 本次调研新发现的「高价值源」（原需求清单里没有，但强烈建议纳入）

| 源 | 为什么重要 | 直接支撑的字段 |
|---|---|---|
| **しょぼいカレンダー `db.php`** | 有**官方公开 API**、1 req/s、无需认证；`SubTitles` 给出各话副标题、`StTime` 给出放送日时、`LastUpdate` 可做增量 —— 是**「连载话数 / 放送日期」最强的公开来源** | `anime_details.broadcast_date`、话数 |
| **巴哈姆特 ACG 資料庫** | robots `Allow: /` + sitemap，**同一作品分列漫畫/動畫/輕小說并各自带评分与评价人数** —— 繁中侧唯一「评分 + 作品层级 + robots 友善」三者兼备 | 繁中评价、`media_type` 交叉校验 |
| **東立 BooksDetail** | 直接给 **原文書名 + 集數 + 譯者 + 出版日期 + ISBN**，还有「百合姬專區 ThemeGL」 | `zh_tw_volumes[]`、`volume_count_zh_tw` |
| **國家圖書館 ISBN/CIP（isbn.ncl.edu.tw）** | 国家级权威书目，有**公开的每月新書書目 PDF**（免登入）→ 能覆盖尚未上架的新卷 | `zh_tw_volumes[]` 权威校验 |
| **cppinfo.cn** | 中宣部运营，**ISBN 直链返回书名/著者/译者/出版社/定价/出版时间**，robots 无限制 | `official_zh_cn` |
| **GA文庫 `sitemap.rss`** | 商品 URL 就是 **`/product/<ISBN>/`** —— ISBN 直接是主键，所有轻小说文库中可读性最好，**应作为其他文库的模板** | `ja_volumes[].isbn` |
| **HJ文庫 官方書誌検索** | HTML 表格**直接返回 ISBN + 出版年月日 + 定価 + シリーズ**（1,921 件），无需二次反查 | `ja_volumes[]` 全字段 |
| **一迅社 発売カレンダー `data.ichijinsha.co.jp/month/YYYY-MM`** | 月别 HTML 列出タイトル/著者/発売日/書影 | `ja_volumes[]` |
| **カクヨム `tags/百合`** | **官方百合标签，2026-10-09 时点 17,287 作品** —— Web 百合小说最干净的官方入口 | `genres`、Web 小说发现 |
| **なろう API 的 `is_gl` / `isgl`** | なろう**没有百合ジャンル**，但 API 有 `is_gl` 字段（来自关键词「ガールズラブ」） | 百合判定（Web 小说） |
| **電ファミ news sitemap** | 无 RSS 但有 `newsSitemap.xml`（含 `<news:title>`） | 新闻发现 |
| **アニメ！アニメ！ `/rss20/index.rdf`** | **natalie 被 WAF 挡住后的主力替代源**，无 WAF | 动画化新闻 |

**反向清单（已休刊，勿误采）**：つぼみ（2012-12 休刊）、コミック百合姫S（2010-09 废刊）、百合姉妹（2005-07 废刊）、ニコニコ百合姫（2016-10 终了）、きららミラク（2017-12 号以后休刊）。
2024–2026 **未确认有百合专门商业新杂志创刊**；新动向为ぶんか社「orSiS」（2025-10-08）与 KADOKAWA 富士見ファンタジア文庫「GirlsLine」。

---

## 4. 逐字段可行性评估（对照原需求数据模型）

这是本报告最需要用户细看的部分。**「完整率 > 80%」这条验收标准，对下列字段是做不到的。**

| 字段 | 可行性 | 主要来源 | 预估完整率 | 说明 |
|---|---|---|---|---|
| `id` | ✅ | 自建 | 100% | 建议 `isbn13` 优先，无 ISBN 时用 `sha1(title_ja+author)` |
| `title_ja` | ✅ | NDL / openBD / 官网 | ~100% | 核心 |
| `title_zh_tw` | ✅ | 東立/青文/角川商品页 | ~85% | 繁中版存在的作品才可能有 |
| `title_zh_cn` | ⚠️ | cppinfo / PDC（人工） | ~30–50% | 简中授权作品本来就少 |
| `title_en` | ⚠️ | AniList / MAL | ~60% | 无动画化的作品通常没有英文名 |
| `authors` / `illustrators` | ✅ | openBD Contributor / 官网 | ~95% | |
| `media_type` | ✅ | 自建（来源性质判定） | 100% | |
| `publisher_ja` | ✅ | openBD Imprint / NDL | ~98% | |
| `magazine_or_platform` | ✅ | 官网 | ~80% | 单行本可能已无连载平台 |
| `serialization_status` | ⚠️ | 官网 + 人工 | ~70% | **没有统一字段**。openBD 只有 `ProductAvailability`/`zaiko`/`datezeppan`，不等于连载状态 |
| `start_date` | ⚠️ | 官网连载开始日 | **~50%** | 官方常只公布「创刊号」；NDL 只有出版年月 → 精确到日很难 |
| `end_date` | ⚠️ | 官网完结告知 | **~40%** | 完结作品才有；且常需人工从新闻里取 |
| **`chapter_count`** | ❌ | web-ace（第N話）、ガレット（#号数） | **~30%** | **最难的字段**。杂志连载几乎不公布累计话数。建议改为 `latest_chapter_label`（字符串，如「第12話」「#5」）而非整数 |
| `volume_count_ja` | ✅ | NDL / openBD / 官网 | ~95% | 可通过 ISBN 枚举同系列推断 |
| `volume_count_zh_tw` | ⚠️ | 東立「集數」/ 青文 / NCL | ~75% | 東立最好（BooksDetail 直接给「第N集」） |
| `genres` | ⚠️ | 官方标签（なろうジャンル、カクヨムタグ、ichicomi /genres/yuri） | ~60% | 官方百合标签只覆盖部分平台 |
| **`yuri_type`** | ⚠️ | **无官方来源** | — | 见 §6.5，需改为编辑判断 |
| `anime_status` | ✅ | 官方动画官网 + AniList/MAL | ~95% | `none` 也可判定（无记录即可，但需标 confidence 低） |
| `ja_volumes[]` | ✅ | openBD / NDL / 楽天 | ~90% | ISBN 是稳定连接键 |
| `zh_tw_volumes[]` | ⚠️ | 東立/青文/NCL | ~70% | 需逐卷枚举；NCL 数据最权威 |
| `official_zh_cn` | ⚠️ | cppinfo（ISBN 直链）+ 出版社官方号 | **~30%** | 需人工；且要区分「实体书 ISBN」与「数字授权」 |
| **`unofficial_zh`** | ❌ | — | — | **建议不采集**，见 §6.4 |
| `sources[]` / `last_checked` | ✅ | 强制字段 | 100% | 本方案已建立机制 |

### 4.1 建议对数据模型做的 4 处修改

1. **`chapter_count: int` → `latest_chapter_label: string` + `chapter_count: int|null`**
   理由：官方来源给的是「第12話」「#5」这类标签，强行转 int 会制造假数据。
2. **新增 `classification_basis`**：区分 `official_tag` / `editorial`，让 `yuri_type` 与 `genres` 的来源可追溯。
3. **新增 `volume_count_zh_cn`**：目前模型只有 `official_zh_cn.latest_volume`，但数字授权（B站漫画）与实体书是两回事，建议分开。
4. **`confidence` 拆成两个**：`source_confidence`（来源可信度）与 `field_confidence`（该字段这次的把握）。一个源可信度高，不代表某个字段填得对。

---

## 5. 评价/评分板块的可行性（新增需求）

用户新增需求：**汇总简体、繁体中文及日文评价**。专项调研 19 个源后，结论如下。

### 5.1 三地可行性判定

| 地区 | 结论 | 最佳源 |
|---|---|---|
| **日文** | ✅ **可做**（聚合值 + 书评元数据） | 楽天 `reviewAverage`/`reviewCount`（官方 API）、openBD 书评刊登索引、宝島社年度榜单 |
| **繁中** | ✅ **可做**（最好的一个） | **巴哈姆特 ACG 資料庫**：robots `Allow: /` + sitemap，提供「網友評價平均分 + 評價人數」，且同作品分列漫畫/動畫/輕小說 |
| **简中** | ❌ **基本不可做** | 豆瓣 API 已关且明文禁爬；掌阅/PDC 全站 Disallow；B站有验证码风控；快看「评分」是 UGC 长帖而非统一分值 |

**简中的替代方案**（建议）：
- 站内评分位统一显示「暂无站内评分」，并提供豆瓣/微信读书/京东/当当/B站漫画的**官方条目页外链**；
- 用**机构榜单**替代用户评分：「中国好书」、「国家图书馆文津图书奖」（可合规引用名单+外链）；
- 或**自建用户评分体系**（这是唯一能真正拿到简中评分的合规路径）。

### 5.2 强制合规设计：三层模型 + 正文永不落地

```
[A] 评分层（可入库数值）
    rating_snapshot(source_id, region, work_id,
                    score_value, score_scale,      -- 必须显式记录口径
                    score_count, source_url, retrieved_at, license_note)

[B] 书评/榜单元数据层（可入库，无正文）
    review_meta(source_id, work_id, outlet, reviewer,
                published_date, source_url)

[C] 评论正文层 —— 【不存在】
    数据库不设正文列。前端一律渲染为「N 条评论 → 跳转原站」卡片。
```

**五条强制策略**：
- **P1** 不设评论正文列。
- **P2** 只存聚合分数与件数，并显式记录 `score_scale`（5分制/10分制/100分制）。
- **P3** 不同源分数**不得合并计算**（楽天 5 分制 vs AniList 100 分制 vs MAL 10 分制）。
- **P4** 源条款/robots 禁止者，只做链接不展示数值（Amazon、豆瓣、Kobo、Pubu）。
- **P5** 每条评分必须带 `source_url` + `retrieved_at`。

**法律依据**：用户评论是第三方著作物。日本著作权法第 32 条的引用要件（出处明示、主从关系、不改变原意）是短引用的边界；中国《著作权法》与台湾《著作權法》同理。**默认不转载**是唯一能规模化的安全策略。

### 5.3 一个必须注意的技术陷阱

**Readmoo 的 robots.txt 对 AI 爬虫整站 Disallow**（GPTBot/ClaudeBot/anthropic-ai/Bytespider…），并注明不遵守者由 WAF 阻挡。
→ 如果阶段 5 的采集脚本或开发流程使用 AI Agent 抓取，**即属违规**。采集器必须使用可识别的、非 AI 命名的 UA，并遵守 `Crawl-delay: 10`。

同类点名拒绝的情况：`kodansha.co.jp`、`takeshobo.co.jp`、`bookwalker.jp`、`honto.jp`、`myanimelist.net`、`books.com.tw`（`ai-train=no`）、`egmanga.com.tw`（`ai-train=no, search=yes`）。

**推论**：`egmanga` 的 `ai-train=no, search=yes, ai-input=yes` 提供了清晰的分界——**可以索引与展示，不可用于训练**。建议全项目遵守同一口径。

---

## 6. 风险与不可行项（诚实清单）

### 6.1 技术风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 本机网络阻断导致开发受阻 | **高** | 采集跑 GitHub Actions；本地用保存的 HTML fixture 开发 |
| 站点改版导致选择器失效 | 高 | 优先 sitemap/API，HTML 解析必须配 fixture 回归测试 |
| カドコミ `__NEXT_DATA__` 结构变化 | 中 | 同上；加结构校验告警 |
| 東立 sitemap 固定 10,000 条、分页失效 | 中 | 用 ThemeGL 专区 + 分类页 + NCL ISBN 补齐 |
| 芳文社站点是 **Shift_JIS** | 中 | 采集器显式指定编码，否则乱码入库 |
| openBD `/coverage` 响应体极大 | 低 | 流式处理，勿全量入内存 |

### 6.2 法务/条款风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| openBD 禁止「第三者に貸与、譲渡、売買」 | **高** | **不对外提供 openBD 派生字段的批量数据转储**；只按需渲染，并提供删除请求受理窗口 |
| 书影（封面）权利源头是 JPRO | **高** | 默认不镜像书影；只存 URL。若要镜像须走 JPO 契约 |
| 评价正文著作权 | 高 | §5.2 三层模型 |
| 亚马逊星级政策 | 中 | 不展示 |
| 绕过 WAF/验证码的诱惑 | 中 | 明令禁止（R2）；`natalie.mu` 等列为人工源 |

### 6.3 「实时」的服务端成本

用户已同意改为定时增量。建议节奏（与 `sources.yaml` 中 `update_frequency` 对齐）：

| 任务 | 频率 | 依据 |
|---|---|---|
| 动画化新闻 | 1–6 小时 | 官方动画官网 + 新闻 |
| 新刊发售（日版） | 每日 | 各社新刊页 + openBD |
| 连载话数/更新 | 每日或每周 | web-ace 日次更新、カドコミ lastmod |
| 繁中出版 | 每周 | 東立/青文/NCL |
| **全量校验** | 每月 | JAPAN/MARC 全件年 4 回（3/6/9/12 月） |

### 6.4 `unofficial_zh`（非官方汉化）—— 建议不自动采集

**理由**：

1. **判定「是否存在汉化」必须接触汉化信息源**，而本项目 R1 明确禁止访问、搜索、记录汉化发布页。
2. 即使是「只标记有无」，**「有无」这个事实本身来自对盗版生态的观测**，仍需要建立对盗版站的采集或人工巡查流程 —— 这与红线冲突。
3. 一旦数据库里出现「某作品有汉化」这一行，它就成了**盗版获取的导航信息**，无论是否给链接。
4. 中国的著作权行政与平台治理环境下，这一字段对站点是**净负资产**，而对用户的增量价值很低（正版读者关心的是有没有正版中文版）。

**建议方案（推荐）**：保留字段但**一律填 `unknown`**，前端以固定说明文案呈现：

> 「本数据库只收录官方授权中文版信息。非官方翻译不在收录范围，因此不作标注。」

如果用户坚持要保留该项能力，**唯一可接受的做法**是：纯人工、只记布尔值、永不提供链接与译者/组名、并在数据库 README 写明来源为人工观察且不具法律意义。**但我不建议这样做。**

### 6.5 `yuri_type`（百合类型分类）—— 无官方来源

用户要的 `正统百合 | 轻百合 | S | GL | 微百合` 分级**不存在任何官方数据源**。官方能提供的最多是：

- なろう 的 `ジャンル`（但百合常落在「恋爱」）
- カクヨム 的标签
- 一迅プラス 的 `/genres/yuri`
- 《コミック百合姫》本身就是百合专门志（→ 该杂志连载可高置信标为百合）
- ガレット 同理

**问题**：这直接违反「每条数据必须带 source_url」。主观分类**没有 source_url**。

**建议方案**：接受这是**编辑判断**，但做到三点：
1. 新增 `classification_basis: official_tag | editorial` 字段；
2. 编辑判断的条目 `sources[]` 里不伪造来源，而是记录 `name: "编辑分类"`, `url: ""`, `confidence: <0.4>`；
3. 前端明确区分「官方标注」与「编辑判断」两种徽章。

**不可接受的替代**：用 AI 批量打标签冒充有来源的数据。那等于编造。

---

## 7. 建议的采集架构（阶段 3/5 预研）

```
GitHub Actions (cron)
   │
   ├── [robots 门禁]  每源检查 robots.txt + 冷却期，失败即跳过并告警
   ├── [限速器]       per-host token bucket，尊重 Crawl-delay
   ├── [采集器]       API / sitemap / RSS 优先，HTML 兜底
   │                   UA: YuriDBBot/0.1 (+URL; contact)
   ├── [原始层]       raw/ 原样存储 + sha256 + retrieved_at  （可追溯、可复现）
   ├── [标准化层]     ISBN-13 归一、标题 NFKC、日期 ISO8601
   ├── [去重层]       §阶段2 设计
   ├── [校验层]       字段级 confidence 计算 + 完整性报表
   └── [发布层]       change_log 生成 → DB upsert
```

**四条设计原则**：
1. **原始层与标准化层分离**：openBD 条款禁止「任意改変」，所以**必须保留原始响应**，标准化结果另存。
2. **每个字段可追溯到具体抓取记录**，而非只记源 URL。
3. **网络失败 ≠ 合规禁止**：两者必须分开记录，否则会污染合规结论（§2.2）。
4. **变更日志（change log）是主产物**，不是副产品 —— 验收标准要求「每日自动更新并有变更日志」。

---

## 8. 验收标准的可行性对照

| 验收标准 | 可行性 | 说明 |
|---|---|---|
| 至少 100 部作品入库 | ✅ 完全可行 | 官方可枚举入口远超此数 |
| 核心字段完整率 > 80% | ⚠️ **需重定义「核心字段」** | 建议把「核心字段」限定为：title_ja / authors / media_type / publisher_ja / serialization_status / volume_count_ja / sources / last_checked —— 这些可达 >90%。把 `chapter_count`、精确日期、`official_zh_cn` 列为「扩展字段」，单独统计完整率 |
| 每条记录有 source_url 和 last_checked | ✅ | 强制写入，CI 门禁校验 |
| 支持按杂志、出版社、连载状态、动画化状态筛选 | ✅ | 数据模型已支持 |
| 每日自动更新并有变更日志 | ✅ | GH Actions cron |
| 不包含盗版内容或链接 | ✅ | 靠 R1 门禁 + 测试断言（见下） |

**建议新增的 CI 断言**（把合规变成可测试项）：
- 断言：数据库中不存在域名属于黑名单（盗版站）的 URL；
- 断言：所有 `review` 相关表**没有正文列**；
- 断言：`unofficial_zh` 若存在，其值只能是 `unknown`；
- 断言：`sources[].url` 非空（除 `classification_basis: editorial` 的条目）。

---

## 9. 待用户确认的开放问题

1. **`unofficial_zh` 字段如何处理？**（§6.4，我建议一律 `unknown` + 说明文案）
2. **`yuri_type` 是否接受为编辑判断？**（§6.5）
3. **采集是否确定跑 GitHub Actions？**（§2，本机不可用）
4. **部署区域**：面向日本数据源，建议新加坡/东京，是否接受？
5. **站点性质**：个人项目 / 公开可访问（验收标准写「可公开访问」）？若公开，openBD 的「再配布禁止」与书影问题需要更保守的处理，并需要「删除请求」受理渠道（邮箱/表单）。
6. **简中评分**：是否接受「暂无站内评分 + 外链 + 机构榜单」的替代方案，还是要自建用户评分体系？
7. **阶段 3 的 20 部代表作清单**：是否由我在阶段 2 结束时提出候选（建议优先选「官方来源齐全」的作品，以保证字段完整率）？

---

## 10. 阶段 1 交付物清单

| 文件 | 说明 |
|---|---|
| `../sources.yaml` | **主交付物**。**75 条数据源 + 19 条评价源 = 94 条**，另含 `field_source_map`（26 个字段的来源优先级）。每条含：可获取字段、认证要求、更新频率、robots.txt 实测、条款发现、反爬风险、合规风险、建议采集方式、证据 URL、可信度、`verified_by`、2026 现状、本机可达性 |
| `phase1-feasibility-report.md` | 本文件 |
| `../research/raw/robots/*.txt` | 46 个域名的 robots.txt 原始抓取（证据留存） |
| `../research/raw/robots-summary.txt` | robots 抓取结果汇总 |
| `../research/raw/connectivity-retest.txt` | 18 个 URL 的串行连通性重测记录 |
| `../research/raw/*.xml` | 站点地图证据（comic-walker 8,151 series、web-ace 13,030 URL、東立 10,000 书目、台灣角川 15,628 URL…） |
| `../research/raw/galette-no37.html` `yurihime.html` | 官方连载页原始样本（阶段 3 的 fixture 种子） |
| `../research/raw/phase1-workflow-2-output.txt` | 调研子代理原始输出（可追溯） |
| `../research/extract_text.py` | HTML→文本取证脚本（处理 Shift_JIS/UTF-8 混用） |
| `../research/parse_workflow_output.py` | 子代理输出解析脚本 |
| `../research/fix_yaml_bold.py` | YAML 安全修复脚本（引号化以 `**` 开头的值，跳过 block scalar） |

### 10.1 已知的、需要用户知悉的结论修正

调研过程中修正/推翻了若干流行说法，这些**如果按旧信息开发会踩坑**：

| 旧说法（网络常见） | 实测结论 |
|---|---|
| 「コミックキューン 已 Web 移行休刊」 | **仍在刊**，至少到 2026 年 11 月号；`comiccune.jp` 只是 canonical 到了 KADOKAWA 标签页 |
| 「ガレット 已停刊」 | **健在**，No.37 = 2026-02-22，且官方 RSS 可用 |
| 「きららミラク 2015 年休刊」 | **2017 年 12 月号**（6巻12号）以后休刊 |
| 「spp.com.tw / 金石堂 / 讀冊 / Readmoo 连不上」 | 从云端/子代理环境**可访问**；只有 `books.com.tw` 与 `eslite.com` 持续 403（WAF） |
| 「Amazon 可以拿评论数据」 | PA-API v5 已废弃；且新旧 API 都**不提供评论正文**，政策也禁止在 API 外展示星级 |
| 「楽天 Books API 只要 App ID」 | 已升级为 **App ID + Access Key 双凭据** |
| 「台湾角川是 Shopify，可用 `/products/x.json`」 | 是 **SHOPLINE**，`/products/{handle}.json` 返回 HTML，**没有商品 JSON** |
| 「NDL 可以提供书影」 | 書影API **2026-03-31 已终止** |
| 「一迅プラス = ichijin-plus.com」 | 已 301 到 **ichicomi.com** |
| 「pixiv 有官方 API 可以做小说采集」 | **官方公开 API 不存在**，且指南禁止程序化收集作品 |
| 「カクヨム 可以随便抓」 | 规约第 12/13 条（超出私人使用范围的复制/营利利用）使「抓取→建库→发布」风险高 |
| 「電撃文庫/富士見/MF文庫J 有独立官网」 | `dengekibunko.jp` / `fantasiabunko.jp` / `mfbunkoj.jp` **全部 301** 到 `kadokawa.co.jp/label/*` |

---

## 11. 下一步（阶段 2）

按用户工作流，阶段 2 = **Schema 与去重策略**，输出 `schema.json` / `schema.prisma`，说明如何用 ISBN、日文原名、作者、出版社去重。

我会在阶段 2 直接落实本报告的 4 处模型修改建议（§4.1）与评价三层模型（§5.2），并给出：
- 完整 schema（含约束、索引、字段级 confidence）
- 去重算法（ISBN 优先 → 标题+作者+出版社模糊匹配 → 人工复核队列）
- `change_log` 表设计

**等待用户确认后再进入阶段 2。**
