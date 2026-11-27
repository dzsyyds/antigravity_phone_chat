[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$base = $PSScriptRoot
Write-Host "正在停止 Antigravity 掌上控制台后台守护与 Cpolar 隧道..."
$pidFile = Join-Path $base "daemon.pid"
if (Test-Path $pidFile) {
    $p = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) -as [int]
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*antigravity_phone_chat*server.js*' -or $_.CommandLine -like '*antigravity_phone_chat*daemon_launcher.mjs*')) -or
    $_.Name -eq 'cpolar.exe'
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "已停止完毕。"
Start-Sleep -Seconds 2
