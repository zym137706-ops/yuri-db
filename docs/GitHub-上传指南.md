# 把这个站点上传到 GitHub（零基础版）

> 你不需要懂编程。整个流程只有 **4 步**，其中 3 步是在网页上点按钮，
> 第 2 步双击一个脚本、粘贴一个网址。
>
> 预计耗时：15 分钟（其中大半是在等 GitHub 构建）。

---

## 先花 1 分钟理解你要做的是什么

用你熟悉的东西打个比方：

| 名词 | 是什么 | 类比 |
|---|---|---|
| **GitHub** | 一个网站，可以存放代码和文件，并且能免费帮你「跑程序」 | 有点像 Figshare/Zenodo，但能自动执行任务 |
| **仓库（repository / repo）** | 你在 GitHub 上的一个文件夹 | 一个项目的独立目录 |
| **push（推送）** | 把你电脑上的文件传上去 | 上传 |
| **GitHub Pages** | GitHub 附赠的静态网页托管服务 | 免费给你一个能打开的网址 |
| **Actions** | GitHub 免费提供的「自动执行任务」功能 | 定时自动跑脚本 |

**最终效果**：你得到一个网址，形如

```
https://你的用户名.github.io/yuri-db/
```

任何人（包括手机）都能打开。而且**你电脑关机也不影响**——页面是 GitHub 的服务器在提供。

---

## 第一步：在 GitHub 上建一个「空仓库」

1. 浏览器登录 GitHub，打开 **https://github.com/new**

2. **Repository name**（仓库名）填：

   ```
   yuri-db
   ```

3. **Description**（描述）可填可不填，比如：

   ```
   日本百合漫画／轻小说／动画资料库（含字段级溯源）
   ```

4. **Public / Private 选 `Public`**

   > ⚠️ 必须选 Public。GitHub Pages（免费托管网页的功能）**只对公开仓库免费**。
   > 这个项目本身也不含任何隐私数据。

5. **⚠️ 这一步最容易出错 —— 下面这三个勾选项，一个都不要勾：**

   | 选项 | 要不要勾 |
   |---|---|
   | Add a README file | ❌ **不要勾** |
   | Add .gitignore | ❌ **不要勾** |
   | Choose a license | ❌ **不要勾** |

   **为什么？** 如果你勾了，GitHub 会先替你在仓库里放一个文件、生成一次提交。
   而你电脑上的文件夹已经有 278 个文件和它自己的提交历史，两边就「撞车」了，
   上传会被拒绝，并提示 `rejected / fetch first`。这是新手最常踩的坑。

   我们要的是一个**完全空**的仓库。

6. 点最下方的绿色按钮 **Create repository**

7. 创建完成后，页面中间会显示一段网址，形如：

   ```
   https://github.com/你的用户名/yuri-db.git
   ```

   **把这个网址复制下来**（点右边的小图标即可复制）。下一步要用。

---

## 第二步：上传（双击一个脚本）

1. 打开文件夹 `C:\DSH\yuri-db\`

2. 双击 **`上传到GitHub.cmd`**

3. 窗口里会提示你粘贴网址 → **右键粘贴**（或 Ctrl+V）刚才复制的网址 → 按回车

4. 接下来会发生两件事：

   **a.** 开始上传（278 个文件、约 30 MB，通常 10～60 秒）

   **b.** **可能**会弹出一个小窗口或浏览器页面，让你登录 GitHub

   > 这是 Git 自带的登录工具（Git Credential Manager），不是钓鱼。
   > 点 **Sign in with your browser** → 浏览器里授权 → 回到窗口。
   > 你的密码**不会**经过这个脚本，是直接交给 GitHub 官方工具的。

5. 看到 **「上传成功！」** 就成了。

> **如果提示上传失败**，先翻到本文档最后的「出错对照表」。

---

## 第三步：开启 GitHub Pages（让网址生效）

上传成功还不等于有网址——要告诉 GitHub「请把这个仓库里的网页发布出来」。

1. 回到你的仓库页面，点上方的 **Settings**（设置）

2. 左侧栏找到 **Pages**，点进去

3. 在 **Build and deployment** 下面找到 **Source**（来源）

4. 把下拉框从 `Deploy from a branch` 改成 **`GitHub Actions`**

   > ⚠️ 一定选 `GitHub Actions`，**不要**选 `Deploy from a branch`。
   > 因为本项目是 Next.js 构建出来的，必须由 Actions 先构建再发布。

5. 点 **Save**（保存）

---

## 第四步：等它构建，然后拿到网址

1. 点仓库上方的 **Actions** 标签页

2. 你会看到 **deploy-static** 正在运行（黄色圆点 = 进行中）

3. 等它变成 **绿色对勾**（第一次约 5～10 分钟）

4. 回到 **Settings → Pages**，页面顶部会显示：

   ```
   Your site is live at https://你的用户名.github.io/yuri-db/
   ```

   **这就是你的网址。** 手机浏览器也能打开。

> 如果 Actions 页面没有正在运行的任务：点左侧的 **deploy-static** →
> 右边会出现 **Run workflow** 按钮 → 点它 → 再点绿色的 **Run workflow**。

---

## 以后怎么更新？（这部分是自动的）

你**什么都不用做**。仓库里已经配置好了定时任务：

| 任务 | 频率 | 作用 |
|---|---|---|
| collect-daily | 每天 1 次 | 采集新数据，自动提交回仓库 |
| collect-news | 每 3 小时 | 抓动画化消息 |
| collect-weekly-zh-tw | 每周 1 次 | 更新繁中版信息 |
| deploy-static | 数据一变就触发 | 重新构建并发布网站 |

流程是：**采集到新数据 → 自动提交 → 自动触发重新构建 → 网址内容更新**。
你不需要打开电脑。

> 数据变化不会「实时」反映，是**定时**更新。这是刻意的设计：
> 所有数据都要经过校验与溯源检查才会进入网站。

---

## 出错对照表

### 上传时

| 提示 | 原因 | 怎么办 |
|---|---|---|
| `rejected ... fetch first` 或 `Updates were rejected` | 建仓库时勾了 README/.gitignore，仓库非空 | 删掉这个仓库重建（初始化选项全不勾）；或者告诉 AI 助手「仓库不是空的，帮我处理」 |
| `remote origin already exists` | 之前设过远程地址 | 脚本已自动处理；若仍报错，说明要换地址 |
| `Authentication failed` | 登录窗口被关掉，或授权没完成 | 重新双击脚本再试一次；如果反复失败，见下方「另一个登录办法」 |
| `Repository not found` | 网址抄错，或结尾漏了 `.git` | 回 GitHub 复制完整网址 |
| 卡住不动很久 | 网络问题 | 关掉窗口重新双击 |

### Actions 里部署失败

1. 点进失败的那次运行（红色 ✗）
2. 展开红色的步骤，把报错信息**复制给 AI 助手**，让它帮你判断
3. 常见原因：
   - Pages 没开，或 Source 没选 `GitHub Actions`
   - 构建超时（本项目 1140 个页面，第一次会比较慢）

### 另一个登录办法（如果弹窗登录反复失败）

如果 Git 的登录窗口怎么都过不去，改用 **Personal Access Token**：

1. GitHub 右上角头像 → **Settings** → 左下 **Developer settings**
2. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
3. Note 随便填（如 `yuri-db upload`），Expiration 选 90 天
4. 勾选 **`repo`** 这一个权限（勾它会自动带上下面几个）
5. 生成后**立刻复制**那串 `ghp_...`（离开页面就再也看不到）
6. 双击上传脚本，当窗口提示输入
   `Username: 填你的GitHub用户名`
   `Password: 粘贴那串 ghp_...`（粘贴时屏幕上不会显示任何字符，这是正常的）
7. 回车

---

## 关于仓库里的两个「名字」

- **提交作者**：目前提交记录显示的作者是 `yuri-db <yuri-db@users.noreply.github.com>`。
  它只是一个标签，**不影响登录、不影响功能**。
  想改成你自己的名字，让 AI 助手帮你跑一条命令即可。
- **仓库名**：建议用 `yuri-db`。如果你用了别的名字也没关系——
  `deploy-static.yml` 会自动按仓库名计算网址前缀，不用手改。

---

## 你不打算公开的话

如果只想自己看、不想让网页公开：**别做第三步**，也不要选 Public。
那就继续用本地的 `启动预览.cmd`（双击即可）。

GitHub Pages 免费版只支持公开仓库，这一点没有绕过的办法。
