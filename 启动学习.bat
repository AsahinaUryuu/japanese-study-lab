@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-learning.ps1" %*
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Startup failed. Read the message above, then press any key to close.
pause >nul
exit /b 1
