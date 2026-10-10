# ============================================================================
#  yuri-db 静态站点本地预览启动器
#
#  为什么需要它：站点本身是纯静态文件（web\out\），但浏览器不能用 file://
#  直接打开 —— Next 的资源路径是绝对路径，站内链接又是 /works/xxx/ 这种目录
#  形式，file:// 下都会失效。所以需要一个静态文件服务器。
#
#  为什么中文交互放在 PowerShell 而不是 .cmd：
#  GBK 中文字符的第二个字节可能正好是 | > & 这类 ASCII 特殊字符，cmd.exe 会把
#  它们当命令解析，导致满屏 "不是内部或外部命令"。所以启动器保持纯 ASCII，
#  中文全部由本脚本输出。本文件必须以「UTF-8 带 BOM」保存。
# ============================================================================

param(
    [int]$Port = 8899,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Line { param([string]$Text = '') Write-Host $Text }

$root = Join-Path $PSScriptRoot 'web\out'
$index = Join-Path $root 'index.html'
$url = "http://127.0.0.1:$Port/"

Write-Line ''
Write-Line '  yuri-db 静态站点预览'
Write-Line '  ----------------------------------------'
Write-Line "  端口： $Port"
Write-Line "  目录： $root"
Write-Line ''

if (-not (Test-Path -LiteralPath $index)) {
    Write-Line '  [错误] 找不到静态站点。尚未构建，或构建产物被删掉了。'
    Write-Line ''
    Write-Line '  请先构建：'
    Write-Line '      cd /d "' + $PSScriptRoot + 'web"'
    Write-Line '      npm run build'
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 1
}

# 端口是否已被占用
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    $owner = (Get-Process -Id $listening[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Write-Line "  端口 $Port 已被占用（进程：$owner）。"
    Write-Line ''
    Write-Line '  如果那就是本项目的预览服务器，直接打开浏览器即可。'
    Write-Line "  否则请换一个端口，例如： 启动预览.cmd 9500"
    Write-Line ''
    if (-not $NoBrowser) { Start-Process $url }
    Write-Line "  网址： $url"
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 0
}

# 优先用 py launcher，退回 python
$python = $null
foreach ($candidate in @(@('py', @('-3')), @('python', @()))) {
    if (Get-Command $candidate[0] -ErrorAction SilentlyContinue) {
        $python = $candidate
        break
    }
}
if (-not $python) {
    Write-Line '  [错误] 找不到 Python。本脚本用 Python 自带的 http.server 提供静态文件。'
    Write-Line '         请安装 Python 3，或改用任意静态文件服务器。'
    Write-Line ''
    Read-Host '  按回车关闭'
    exit 1
}

$pyExe = (Get-Command $python[0]).Source
$pyArgs = @($python[1]) + @('-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', $root)

Write-Line '  正在启动服务器...'
Start-Process -FilePath $pyExe -ArgumentList $pyArgs -WindowStyle Minimized | Out-Null

# 等端口真的开始监听再开浏览器，否则可能打开一个连不上的空白页
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 800
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}

if ($ok) {
    Write-Line '  服务器已就绪。'
} else {
    Write-Line '  [警告] 服务器 15 秒内没起来，仍然尝试打开浏览器。'
}

if (-not $NoBrowser) { Start-Process $url }

Write-Line ''
Write-Line "  已打开： $url"
Write-Line ''
Write-Line '  停止服务器：在任务栏找到最小化的 python 窗口，关掉它。'
Write-Line '  （只关浏览器不会停止服务器。）'
Write-Line ''
if (-not $NoBrowser) { Start-Sleep -Seconds 4 }
