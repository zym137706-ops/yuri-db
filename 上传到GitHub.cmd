@echo off
REM ===========================================================================
REM  yuri-db  ->  GitHub upload launcher
REM
REM  Keep this file PURE ASCII. Do not add Chinese text here.
REM  GBK-encoded Chinese can contain a trail byte equal to | > & , and cmd.exe
REM  then parses it as a command, producing a screenful of
REM  "is not recognized as an internal or external command".
REM  All Chinese output is produced by upload-to-github.ps1 instead.
REM ===========================================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload-to-github.ps1" %*