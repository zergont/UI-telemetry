# =============================================================
# CG Dashboard - nginx setup script (Windows)
#
# Actions:
#   1. Download nginx (if missing)
#   2. Generate self-signed SSL certificate (if missing)
#   3. Write nginx.conf with reverse proxy config
#   4. Validate configuration
#   5. Start / reload nginx
#   6. Add Windows Firewall rule
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-nginx.ps1
# =============================================================

param(
    [string]$NginxDir  = "D:\nginx",
    [string]$NginxVer  = "1.27.3",
    [string]$Domain    = "ngs.myds.me",
    [int]$Port         = 9443
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== CG Dashboard - nginx setup ===" -ForegroundColor Cyan
Write-Host "  nginx dir  : $NginxDir"
Write-Host "  nginx ver  : $NginxVer"
Write-Host "  domain     : $Domain"
Write-Host "  port       : $Port"
Write-Host ""

# ---------------------------------------------------------
# 1. Download nginx if not present
# ---------------------------------------------------------
$nginxExe = Join-Path $NginxDir "nginx.exe"

if (-not (Test-Path $nginxExe)) {
    Write-Host "[1/6] Downloading nginx $NginxVer ..." -ForegroundColor Yellow

    $zipUrl  = "https://nginx.org/download/nginx-$NginxVer.zip"
    $zipPath = Join-Path $env:TEMP "nginx-$NginxVer.zip"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

    $extractDir = Join-Path $env:TEMP "nginx-extract"
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir

    $innerDir = Get-ChildItem $extractDir -Directory | Select-Object -First 1

    if (-not (Test-Path $NginxDir)) {
        New-Item -ItemType Directory -Path $NginxDir -Force | Out-Null
    }
    Copy-Item -Path (Join-Path $innerDir.FullName "*") -Destination $NginxDir -Recurse -Force

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "  nginx installed to $NginxDir" -ForegroundColor Green
} else {
    Write-Host "[1/6] nginx already installed: $nginxExe" -ForegroundColor Green
}

# ---------------------------------------------------------
# 2. Generate self-signed SSL certificate
# ---------------------------------------------------------
$sslDir  = Join-Path $NginxDir "ssl"
$crtFile = Join-Path $sslDir "cg-selfsigned.crt"
$keyFile = Join-Path $sslDir "cg-selfsigned.key"

if (-not (Test-Path $crtFile)) {
    Write-Host "[2/6] Generating self-signed SSL certificate ..." -ForegroundColor Yellow

    if (-not (Test-Path $sslDir)) {
        New-Item -ItemType Directory -Path $sslDir -Force | Out-Null
    }

    # Try to find openssl (Git for Windows, MSYS2, etc.)
    $openssl = $null
    $candidates = @(
        "openssl",
        "C:\Program Files\Git\usr\bin\openssl.exe",
        "C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
        "C:\msys64\usr\bin\openssl.exe"
    )
    foreach ($c in $candidates) {
        if (-not $openssl) {
            $cmd = Get-Command $c -ErrorAction SilentlyContinue
            if ($cmd) { $openssl = $c }
        }
    }

    if ($openssl) {
        Write-Host "  Using openssl: $openssl"
        # openssl writes progress to stderr; suppress PS error handling
        $prevPref = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $openssl req -x509 -nodes -days 3650 `
            -newkey rsa:2048 `
            -keyout $keyFile `
            -out $crtFile `
            -subj "/CN=$Domain/O=CG Dashboard/C=RU" `
            -addext "subjectAltName=DNS:$Domain" 2>&1 | Out-Null
        $ErrorActionPreference = $prevPref
    } else {
        Write-Host ""
        Write-Host "  ERROR: openssl not found!" -ForegroundColor Red
        Write-Host "  Install Git for Windows (https://git-scm.com) - it includes openssl." -ForegroundColor Red
        Write-Host "  Then re-run this script." -ForegroundColor Red
        Write-Host ""
        exit 1
    }

    if (Test-Path $crtFile) {
        Write-Host "  Certificate: $crtFile" -ForegroundColor Green
        Write-Host "  Key:         $keyFile" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: certificate was not created!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[2/6] SSL certificate already exists" -ForegroundColor Green
}

# ---------------------------------------------------------
# 3. Write nginx.conf
# ---------------------------------------------------------
Write-Host "[3/6] Writing nginx configuration ..." -ForegroundColor Yellow

$confDir  = Join-Path $NginxDir "conf"
$confDest = Join-Path $confDir "nginx.conf"

# Backup original config (first time only)
$confBak = Join-Path $confDir "nginx.conf.original"
if ((Test-Path $confDest) -and -not (Test-Path $confBak)) {
    Copy-Item $confDest $confBak
}

# Build nginx.conf content
$nginxConf = @"
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout  65;

    # --- rate-limit zone for share-link views ---
    limit_req_zone `$binary_remote_addr zone=share_view:1m rate=10r/m;

    server {
        listen       $Port ssl;
        server_name  $Domain;

        # ---------- TLS ----------
        ssl_certificate      ../ssl/cg-selfsigned.crt;
        ssl_certificate_key  ../ssl/cg-selfsigned.key;
        ssl_protocols        TLSv1.2 TLSv1.3;
        ssl_ciphers          HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache    shared:SSL:2m;
        ssl_session_timeout  10m;

        # ---------- Logging ----------
        access_log  logs/cg-access.log;
        error_log   logs/cg-error.log;

        # ---------- Proxy defaults ----------
        proxy_http_version  1.1;
        proxy_set_header    Host              `$host;
        proxy_set_header    X-Real-IP         `$remote_addr;
        proxy_set_header    X-Forwarded-For   `$proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto `$scheme;

        # ---------- WebSocket /ws ----------
        location /ws {
            proxy_pass         http://127.0.0.1:5555;
            proxy_set_header   Upgrade    `$http_upgrade;
            proxy_set_header   Connection "upgrade";
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # ---------- Share-link view (rate-limited) ----------
        location /view/ {
            limit_req zone=share_view burst=5 nodelay;
            proxy_pass http://127.0.0.1:5555;
        }

        # ---------- API + static ----------
        location / {
            proxy_pass http://127.0.0.1:5555;
        }
    }
}
"@

# Write without BOM (nginx cannot parse BOM)
[System.IO.File]::WriteAllText($confDest, $nginxConf, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  Config written: $confDest" -ForegroundColor Green

# ---------------------------------------------------------
# 4. Validate configuration
# ---------------------------------------------------------
Write-Host "[4/6] Validating nginx configuration ..." -ForegroundColor Yellow

$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
Push-Location $NginxDir
$testResult = & $nginxExe -t 2>&1
$testExitCode = $LASTEXITCODE
Pop-Location
$ErrorActionPreference = $prevPref

$testStr = $testResult -join "`n"
if ($testExitCode -eq 0 -or $testStr -match "syntax is ok") {
    Write-Host "  nginx -t: OK" -ForegroundColor Green
} else {
    Write-Host "  nginx -t ERROR:" -ForegroundColor Red
    Write-Host $testStr
    exit 1
}

# ---------------------------------------------------------
# 5. Start / reload nginx
# ---------------------------------------------------------
Write-Host "[5/6] Starting nginx ..." -ForegroundColor Yellow

$running = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if ($running) {
    $pids = ($running | ForEach-Object { $_.Id }) -join ", "
    Write-Host "  nginx already running (PID $pids), reloading..."
    Push-Location $NginxDir
    & $nginxExe -s reload
    Pop-Location
} else {
    Push-Location $NginxDir
    Start-Process -FilePath $nginxExe -WindowStyle Hidden
    Pop-Location
}

Start-Sleep -Seconds 1

$check = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if ($check) {
    Write-Host ""
    Write-Host "=== nginx is running! ===" -ForegroundColor Green
    Write-Host "  https://${Domain}:${Port}" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Management:" -ForegroundColor Gray
    Write-Host "    Reload: Push-Location $NginxDir; .\nginx.exe -s reload; Pop-Location" -ForegroundColor Gray
    Write-Host "    Stop:   Push-Location $NginxDir; .\nginx.exe -s stop; Pop-Location" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "  ERROR: nginx failed to start!" -ForegroundColor Red
    $errLog = Join-Path $NginxDir "logs\cg-error.log"
    Write-Host "  Check logs: $errLog" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------
# 6. Windows Firewall rule
# ---------------------------------------------------------
$fwName = "CG Dashboard HTTPS ($Port)"
$existing = Get-NetFirewallRule -DisplayName $fwName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "[6/6] Adding Windows Firewall rule: $fwName" -ForegroundColor Yellow
    try {
        New-NetFirewallRule `
            -DisplayName $fwName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort $Port `
            -Action Allow `
            -Profile Any | Out-Null
        Write-Host "  Firewall rule added" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to add firewall rule (admin rights required)" -ForegroundColor Red
        Write-Host "  Add manually: port $Port TCP inbound" -ForegroundColor Yellow
    }
} else {
    Write-Host "[6/6] Firewall rule already exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done! Remember to configure port forwarding on your router:" -ForegroundColor Cyan
Write-Host "  WAN:$Port -> LAN_IP_ACER:$Port (TCP)" -ForegroundColor Cyan
Write-Host ""
