# HH AutoPilot deploy to proplatforma.ru/hh
# Server: root@89.191.226.213
# Path: /var/www/plat3/hh

$ErrorActionPreference = "Stop"
$SERVER = "root@89.191.226.213"
$REMOTE_PATH = "/var/www/plat3/hh"
$PROJECT_ROOT = $PSScriptRoot

Write-Host "=== HH AutoPilot Deploy ===" -ForegroundColor Cyan
Write-Host "Target: $SERVER`:$REMOTE_PATH" -ForegroundColor Gray
Write-Host ""

# 1. Build frontend
Write-Host "[1/5] Building frontend..." -ForegroundColor Yellow
Push-Location "$PROJECT_ROOT\frontend"
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  OK" -ForegroundColor Green

# 2. Create deploy package (exclude venv, browser_data)
Write-Host "[2/5] Creating deploy package..." -ForegroundColor Yellow
$tmpDir = "$env:TEMP\hh-deploy-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path "$tmpDir\api" -Force | Out-Null
New-Item -ItemType Directory -Path "$tmpDir\frontend" -Force | Out-Null

robocopy "$PROJECT_ROOT\api" "$tmpDir\api" /E /XD venv .browser_data /XF *.db .env /NFL /NDL /NJH /NJS
Copy-Item -Path "$PROJECT_ROOT\frontend\dist" -Destination "$tmpDir\frontend\dist" -Recurse -Force
if (Test-Path "$PROJECT_ROOT\hh-autopilot.service") {
    Copy-Item "$PROJECT_ROOT\hh-autopilot.service" "$tmpDir" -Force
}
if (Test-Path "$PROJECT_ROOT\proplatforma-nginx.conf") {
    Copy-Item "$PROJECT_ROOT\proplatforma-nginx.conf" "$tmpDir" -Force
}

Write-Host "  OK" -ForegroundColor Green

# 3. Upload to server
Write-Host "[3/5] Uploading to server..." -ForegroundColor Yellow
ssh $SERVER "mkdir -p $REMOTE_PATH"
scp -r "$tmpDir\*" "${SERVER}:${REMOTE_PATH}/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Upload failed" -ForegroundColor Red
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  OK" -ForegroundColor Green

# 4. Install dependencies and restart on server
Write-Host "[4/5] Setting up on server..." -ForegroundColor Yellow
ssh $SERVER @"
cd $REMOTE_PATH/api
if [ ! -d venv ]; then
  python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt -q
playwright install chromium 2>/dev/null || true
playwright install-deps chromium 2>/dev/null || true
"@
Write-Host "  OK" -ForegroundColor Green

# 5. Restart service (if systemd)
Write-Host "[5/5] Restarting service..." -ForegroundColor Yellow
ssh $SERVER @"
if systemctl is-active --quiet hh-autopilot 2>/dev/null; then
  sudo systemctl restart hh-autopilot
  echo 'Service restarted'
else
  echo 'No systemd service. Run manually: cd $REMOTE_PATH/api && source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8001'
fi
"@
Write-Host "  OK" -ForegroundColor Green

# 6. Update nginx config if present
Write-Host "[6] Updating nginx config..." -ForegroundColor Yellow
ssh $SERVER @"
if [ -f $REMOTE_PATH/proplatforma-nginx.conf ]; then
  cp $REMOTE_PATH/proplatforma-nginx.conf /etc/nginx/sites-available/proplatforma
  nginx -t && systemctl reload nginx && echo 'Nginx reloaded' || echo 'Nginx config test failed'
fi
"@
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host "Site: http://proplatforma.ru/hh/" -ForegroundColor Cyan
Write-Host ""
Write-Host "Nginx config needed (add to proplatforma.ru server block):" -ForegroundColor Yellow
Write-Host @"
    location /hh/api/ {
        rewrite ^/hh/api(.*) /api`$1 break;
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
    }
    location /hh {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
    }
"@
