# Остановка nginx
param([string]$NginxDir = "D:\nginx")

$nginxExe = Join-Path $NginxDir "nginx.exe"
if (Get-Process -Name "nginx" -ErrorAction SilentlyContinue) {
    Push-Location $NginxDir
    & $nginxExe -s stop
    Pop-Location
    Write-Host "nginx остановлен" -ForegroundColor Green
} else {
    Write-Host "nginx не запущен" -ForegroundColor Yellow
}
