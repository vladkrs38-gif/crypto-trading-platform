@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo HH Job Helper - Starting...
echo.

:: Backend
echo [1/2] API (port 8000)...
if exist "%ROOT%\api\venv\Scripts\activate.bat" (
    start "HH API" /d "%ROOT%\api" cmd /k "call venv\Scripts\activate.bat && uvicorn main:app --reload --port 8000"
) else (
    echo    venv not found. Run: cd api ^&^& python -m venv venv ^&^& pip install -r requirements.txt
)

timeout /t 2 /nobreak >nul

:: Frontend
echo [2/2] Frontend (port 5173)...
start "HH Frontend" /d "%ROOT%\frontend" cmd /k "if exist node_modules (npm run dev) else (npm install && npm run dev)"
echo.
echo.
echo Open: http://localhost:5173
echo Close both terminal windows to stop.
pause
