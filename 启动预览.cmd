@echo off
REM ===========================================================================
REM  yuri-db 静态站点本地预览启动器
REM
REM  双击即可：启动静态文件服务器 + 自动打开浏览器。
REM  可选：双击不了带参数，就在命令行里跑 ——  启动预览.cmd 9000
REM
REM  为什么需要一个服务器：站点本身是纯静态文件（web\out\），但浏览器不能直接用
REM  file:// 打开 —— Next 的资源路径是绝对路径，站内链接又是 /works/xxx/ 这种
REM  目录形式，file:// 下都会失效。所以需要一个静态文件服务器。
REM
REM  这个脚本不依赖任何常驻会话：重启电脑后再双击一次就行。
REM  关掉最小化的 "yuri-db-static-server" 窗口即可停止服务器。
REM ===========================================================================
setlocal EnableDelayedExpansion
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8899"
set "ROOT=%~dp0web\out"
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo   yuri-db 静态站点预览
echo   ----------------------------------------
echo   端口： %PORT%
echo   目录： %ROOT%
echo.

if not exist "%ROOT%\index.html" (
  echo   [错误] 找不到静态站点。尚未构建，或构建产物被删掉了。
  echo.
  echo   请先构建：
  echo       cd /d "%~dp0web"
  echo       npm run build
  echo.
  pause
  exit /b 1
)

REM 优先用 py launcher，退回 python
set "PY=py -3"
where py >nul 2>&1
if errorlevel 1 set "PY=python"

REM 端口已被占用：确认是本项目的服务器就直接开浏览器，否则明确报错
set "TAKEN="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"TCP.*:%PORT% .*LISTENING"') do set "TAKEN=%%P"
if defined TAKEN (
  echo   端口 %PORT% 已被进程 !TAKEN! 占用。
  echo.
  echo   如果那就是本项目的服务器，直接打开：
  start "" "%URL%"
  echo   否则请换一个端口，例如： 启动预览.cmd 9500
  echo.
  pause
  exit /b 0
)

echo   正在启动服务器...
start "yuri-db-static-server" /min %PY% -m http.server %PORT% --bind 127.0.0.1 --directory "%ROOT%"

REM 等服务器起来再开浏览器，否则可能打开一个空白页
set /a TRIES=0
:waitloop
set /a TRIES+=1
timeout /t 1 /nobreak >nul
netstat -ano | findstr /r /c:"TCP.*:%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  if !TRIES! lss 10 goto waitloop
  echo   [警告] 服务器 10 秒内没起来，仍然尝试打开浏览器。
)

start "" "%URL%"
echo   已打开： %URL%
echo.
echo   关闭最小化的 "yuri-db-static-server" 窗口即可停止服务器。
echo   只关浏览器不会停止服务器。
echo.
timeout /t 6 /nobreak >nul
endlocal
