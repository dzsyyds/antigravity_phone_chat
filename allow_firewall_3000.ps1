[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Write-Host "正在请求 Windows 管理员权限以放行校园网内网 3000 端口与 Node.js 入站规则..."
Write-Host "请在弹出的用户账户控制 (UAC) 窗口中点击「是」确认。"
Write-Host ""

$adminCmd = @(
  'netsh advfirewall firewall delete rule name="Antigravity Phone Chat 3000" | Out-Null',
  'netsh advfirewall firewall add rule name="Antigravity Phone Chat 3000" dir=in action=allow protocol=TCP localport=3000 profile=any',
  'Set-NetFirewallRule -DisplayName "Node.js JavaScript Runtime" -Profile Any -ErrorAction SilentlyContinue',
  'Write-Host "防火墙放行完成！"',
  'Start-Sleep -Seconds 2'
) -join "; "

$encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($adminCmd))
try {
    Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
} catch {
    Write-Host "提权已取消或未授予权限: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "当前 3000 端口与 Node.js 防火墙状态："
Get-NetFirewallRule | Where-Object { $_.DisplayName -like '*Node.js*' -or $_.DisplayName -like '*3000*' } |
    Select-Object DisplayName, Enabled, Action, Profile |
    Format-Table -AutoSize
Read-Host "按回车键关闭窗口"
