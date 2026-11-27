@echo off
chcp 65001 >nul
echo 正在请求 Windows 管理员权限以放行校园网内网 3000 端口与 Node.js 专用网络入站规则...
echo 请在弹出的用户账户控制 (UAC) 窗口中点击「是」确认。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -Verb RunAs -Wait -FilePath 'powershell.exe' -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"netsh advfirewall firewall delete rule name=''Antigravity Phone Chat 3000'' 2>$null; netsh advfirewall firewall add rule name=''Antigravity Phone Chat 3000'' dir=in action=allow protocol=TCP localport=3000 profile=any; Set-NetFirewallRule -DisplayName ''Node.js JavaScript Runtime'' -Profile Any -ErrorAction SilentlyContinue; Write-Host ''防火墙放行完成！''; Start-Sleep 2\"'"
echo.
echo 当前 3000 端口与 Node.js 防火墙状态：
powershell -NoProfile -Command "Get-NetFirewallRule | Where-Object { $_.DisplayName -like '*Node.js*' -or $_.DisplayName -like '*3000*' } | Select-Object DisplayName, Enabled, Action, Profile | Format-Table -AutoSize"
pause
