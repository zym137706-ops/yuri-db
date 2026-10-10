@echo off
REM ===========================================================================
REM  yuri-db static site local preview launcher
REM
REM  Keep this file PURE ASCII. Do not add Chinese text here.
REM  GBK-encoded Chinese can contain a trail byte equal to | > & , and cmd.exe
REM  then parses it as a command, producing a screenful of
REM  "is not recognized as an internal or external command".
REM  All Chinese output is produced by start-preview.ps1 instead.
REM
REM  Usage:  double-click, or   this-file.cmd 9500   to use another port.
REM ===========================================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview.ps1" %*