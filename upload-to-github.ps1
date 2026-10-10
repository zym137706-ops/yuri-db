# ============================================================================
#  把 yuri-db 上传到 GitHub
#
#  为什么中文交互放在 PowerShell 而不是 .cmd：
#  GBK 编码的中文字符，第二个字节可能正好是 | > & 这类 ASCII 特殊字符，
#  cmd.exe 会把它们当成命令去解析，导致满屏 "不是内部或外部命令"。
#  所以启动器（.cmd）保持纯 ASCII，中文全部由本脚本输出。
#
#  本文件必须以「UTF-8 带 BOM」保存，否则 Windows PowerShell 5.1 会按 ANSI
#  读取，中文同样会乱码。
# ============================================================================

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Line { param([string]$Text = '') Write-Host $Text }

Write-Line ''
Write-Line '  ============================================================'
Write-Line '    把 yuri-db 上传到 GitHub'
Write-Line '  ============================================================'
Write-Line ''
Write-Line '    开始之前，请确认你已经建好了空仓库：'
Write-Line '        https://github.com/new'
Write-Line ''
Write-Line '    仓库名建议填： yuri-db'
Write-Line '    必须选 Public'
Write-Line '    三个初始化选项（README / .gitignore / license）一个都不要勾'
Write-Line ''
Write-Line '    建好后页面上会显示一个网址，形如：'
Write-Line '        https://github.com/你的用户名/yuri-db.git'
Write-Line ''

# 允许把网址当参数传进来；否则交互输入
$repo = $args[0]

# 如果没给网址，但 origin 已经配置好了，就直接用它 ——
# 这样双击后只需按一次回车，不用再粘贴网址。
if ([string]::IsNullOrWhiteSpace($repo)) {
    Push-Location -LiteralPath $PSScriptRoot
    $existingOrigin = git remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) { $existingOrigin = $null }
    Pop-Location
    if (-not [string]::IsNullOrWhiteSpace($existingOrigin)) {
        Write-Line '    检测到已配置的仓库地址，直接使用：'
        Write-Line "        $existingOrigin"
        Write-Line ''
        $repo = $existingOrigin
    } else {
        $repo = Read-Host '  请把那个网址粘贴到这里，然后按回车'
    }
}
$repo = $repo.Trim().Trim('"').Trim("'")

if ([string]::IsNullOrWhiteSpace($repo)) {
    Write-Line ''
    Write-Line '    [错误] 没有输入网址。'
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 1
}

if ($repo -notmatch 'github\.com') {
    Write-Line ''
    Write-Line '    [错误] 这看起来不是 GitHub 仓库网址：'
    Write-Line "        $repo"
    Write-Line ''
    Write-Line '    正确格式应该是：'
    Write-Line '        https://github.com/你的用户名/yuri-db.git'
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 1
}

# 回到脚本所在目录（仓库根目录）
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path '.git')) {
    Write-Line ''
    Write-Line '    [错误] 当前目录不是 git 仓库，找不到 .git 文件夹。'
    Write-Line "        $PSScriptRoot"
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 1
}

Write-Line ''
Write-Line "    目标仓库： $repo"
Write-Line ''

# 已有 origin 就更新地址，没有就新增
$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existing)) {
    git remote add origin $repo | Out-Null
    Write-Line '    已设置远程仓库地址。'
} else {
    git remote set-url origin $repo | Out-Null
    Write-Line '    已更新远程仓库地址。'
}

Write-Line ''
Write-Line '    开始上传（278 个文件，约 30MB）...'
Write-Line ''
Write-Line '    如果接下来弹出窗口或浏览器页面要你登录 GitHub，请正常登录授权。'
Write-Line '    那是 Git 自带的官方登录工具（Git Credential Manager），'
Write-Line '    你的密码不会经过本脚本。'
Write-Line ''
Write-Line '    ------------------------------------------------------------'

git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 -c http.postBuffer=524288000 push -u origin main
$rc = $LASTEXITCODE

Write-Line '    ------------------------------------------------------------'
Write-Line ''

if ($rc -ne 0) {
    Write-Line '    [上传失败]'
    Write-Line ''
    Write-Line '    最常见的原因，请逐条对照：'
    Write-Line ''
    Write-Line '      1. 建仓库时勾选了 "Add a README file"'
    Write-Line '         -> 仓库里已经有一个提交，和本地历史冲突，会被拒绝。'
    Write-Line '         -> 办法：删掉这个仓库重建，三个初始化选项全部不勾。'
    Write-Line ''
    Write-Line '      2. 网址抄错，或结尾漏了 .git'
    Write-Line '         -> 回 GitHub 页面重新复制完整网址。'
    Write-Line ''
    Write-Line '      3. 登录窗口被关掉，或没完成授权'
    Write-Line '         -> 直接重新双击本脚本再试一次。'
    Write-Line ''
    Write-Line '      4. 提示 Repository not found'
    Write-Line '         -> 仓库名或用户名拼错，或者仓库还没建成。'
    Write-Line ''
    Write-Line '      5. 提示 Authentication failed'
    Write-Line '         -> 改用 Personal Access Token 登录，'
    Write-Line '            步骤见 docs\GitHub-上传指南.md 最后一段。'
    Write-Line ''
    Write-Line '    如果以上都不对，把上面那段报错复制给 AI 助手。'
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 1
}

Write-Line ''
Write-Line '  ============================================================'
Write-Line '    上传成功！'
Write-Line '  ============================================================'
Write-Line ''
Write-Line '    接下来还有 2 步（只需做一次），才能拿到能打开的网址：'
Write-Line ''
Write-Line '    第 1 步：开启 GitHub Pages'
Write-Line '       在仓库页面点  Settings  ->  左侧 Pages'
Write-Line '       把 "Build and deployment" 的 Source 改成  GitHub Actions'
Write-Line '       然后点 Save'
Write-Line '       （千万不要选 Deploy from a branch）'
Write-Line ''
Write-Line '    第 2 步：等它构建'
Write-Line '       点仓库上方的  Actions  标签'
Write-Line '       看到  deploy-static  变成绿色对勾（第一次约 5-10 分钟）'
Write-Line '       然后回  Settings -> Pages ，顶部会显示你的网址'
Write-Line ''
Write-Line '    详细说明（图文步骤）见：'
Write-Line '       docs\GitHub-上传指南.md'
Write-Line ''
Read-Host '  按回车关闭'
exit 0
