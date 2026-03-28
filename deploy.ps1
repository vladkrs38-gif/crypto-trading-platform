# KlikBot deploy to klikbot.ru
# Server: root@89.191.226.213
# Path: /var/www/klikbot

$ErrorActionPreference = "Stop"
$SERVER = "root@89.191.226.213"
$REMOTE_PATH = "/var/www/klikbot"
$PROJECT_ROOT = $PSScriptRoot

Write-Host "=== KlikBot Deploy ===" -ForegroundColor Cyan
Write-Host "Target: $SERVER`:$REMOTE_PATH" -ForegroundColor Gray
Write-Host ""

# 0. Backup current version on server
Write-Host "[0/6] Creating backup on server..." -ForegroundColor Yellow
ssh $SERVER "tar -czf /tmp/klikbot-backup-`$(date +%Y%m%d-%H%M%S).tar.gz -C $REMOTE_PATH frontend/dist api/*.py 2>/dev/null && echo 'Backup created' || echo 'Backup skipped'"
Write-Host "  OK" -ForegroundColor Green

# 1. Build frontend
Write-Host "[1/6] Building frontend..." -ForegroundColor Yellow
Push-Location "$PROJECT_ROOT\frontend"
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  OK" -ForegroundColor Green

# 2. Upload API files (only .py, not .db/.env/venv)
Write-Host "[2/6] Uploading API files..." -ForegroundColor Yellow
scp "$PROJECT_ROOT\api\*.py" "${SERVER}:${REMOTE_PATH}/api/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "API upload failed" -ForegroundColor Red
    exit 1
}
scp "$PROJECT_ROOT\api\requirements.txt" "${SERVER}:${REMOTE_PATH}/api/"
Write-Host "  OK" -ForegroundColor Green

# 3. Upload frontend dist
Write-Host "[3/6] Uploading frontend..." -ForegroundColor Yellow
ssh $SERVER "rm -rf $REMOTE_PATH/frontend/dist"
scp -r "$PROJECT_ROOT\frontend\dist" "${SERVER}:${REMOTE_PATH}/frontend/dist"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend upload failed" -ForegroundColor Red
    exit 1
}
ssh $SERVER "chmod -R 755 $REMOTE_PATH/frontend/dist"
Write-Host "  OK" -ForegroundColor Green

# 4. Upload extension if exists
if (Test-Path "$PROJECT_ROOT\frontend\dist\hh-autopilot-extension.zip") {
    Write-Host "[3.5] Extension already in dist" -ForegroundColor Gray
} elseif (Test-Path "$PROJECT_ROOT\extension") {
    Write-Host "[3.5] Packing extension..." -ForegroundColor Yellow
    # Extension can be packed separately if needed
}

# 5. Install dependencies on server
Write-Host "[4/6] Installing dependencies..." -ForegroundColor Yellow
ssh $SERVER "cd $REMOTE_PATH/api && source venv/bin/activate && pip install -r requirements.txt -q 2>&1 | tail -3"
Write-Host "  OK" -ForegroundColor Green

# 5. Restart service
Write-Host "[5/6] Restarting service..." -ForegroundColor Yellow
ssh $SERVER "systemctl restart hh-autopilot && sleep 2 && systemctl is-active hh-autopilot"
Write-Host "  OK" -ForegroundColor Green

# 6. Verify
Write-Host "[6/6] Verifying..." -ForegroundColor Yellow
ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:8001/api/health"
Write-Host ""
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host "Site: https://www.klikbot.ru/" -ForegroundColor Cyan
