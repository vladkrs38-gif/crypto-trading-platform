@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo HH Job Helper - First-time setup
echo.

:: API
echo [1/2] API dependencies...
pushd "%ROOT%\api"
if not exist venv (
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Python not found. Install Python 3.10+
        pause
        exit /b 1
    )
)
call venv\Scripts\activate.bat
pip install -r requirements.txt
echo    Done. Create api\.env with DEEPSEEK_API_KEY
popd
echo.

:: Frontend
echo [2/2] Frontend dependencies...
pushd "%ROOT%\frontend"
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed. Make sure you are in the project folder.
    echo Try: cd "%ROOT%\frontend" then npm install
    pause
    exit /b 1
)
echo    Done.
echo.
popd
echo Run start.bat to launch.
pause
