[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$base = $PSScriptRoot
Write-Host "正在后台启动 Antigravity 掌上控制台守护服务与 Cpolar 隧道..."
Start-Process -FilePath "wscript.exe" -ArgumentList ('//nologo "' + (Join-Path $base 'start_always_on.vbs') + '"') -WorkingDirectory $base
Start-Sleep -Seconds 5
$infoPath = Join-Path $base "连接信息.txt"
if (Test-Path $infoPath) {
    Get-Content $infoPath -Encoding UTF8
} else {
    Write-Host "服务正在初始化，请稍候查看 连接信息.txt"
}
Write-Host ""
Read-Host "按回车键关闭窗口"
