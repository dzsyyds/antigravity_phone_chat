@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在停止 Antigravity 掌上控制台后台守护与 Cpolar 隧道...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pidFile = Join-Path '%~dp0' 'daemon.pid';" ^
  "if (Test-Path $pidFile) { $p = [int](Get-Content $pidFile | Select-Object -First 1); Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Remove-Item $pidFile -Force -ErrorAction SilentlyContinue };" ^
  "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*antigravity_phone_chat*server.js*' -or $_.CommandLine -like '*antigravity_phone_chat*daemon_launcher.mjs*')) -or $_.Name -eq 'cpolar.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo 已停止完毕。
timeout /t 2 /nobreak >nul
