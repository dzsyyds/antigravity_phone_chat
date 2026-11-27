@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在后台启动 Antigravity 掌上控制台守护服务与 Cpolar 隧道...
wscript //nologo "%~dp0start_always_on.vbs"
timeout /t 5 /nobreak >nul
if exist "%~dp0连接信息.txt" (
    type "%~dp0连接信息.txt"
) else (
    echo 服务正在初始化，请稍候查看 连接信息.txt
)
echo.
pause
