@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   html-to-mp4  --  one-time setup
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found on PATH. Install from https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo WARNING: ffmpeg not on PATH. Install from https://ffmpeg.org/download.html
    echo          and add the bin\ folder to your PATH.
) else (
    for /f "tokens=*" %%v in ('ffmpeg -version 2^>^&1 ^| findstr /i "ffmpeg version"') do echo [OK] %%v & goto :ff_ok
    :ff_ok
)

echo.
echo [1/2] Installing npm dependencies...
call npm install
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )

echo.
echo [2/2] Installing Playwright Chromium (~120 MB, one-time)...
call npx playwright install chromium
if errorlevel 1 ( echo Playwright install failed. & pause & exit /b 1 )

echo.
echo ============================================================
echo   Setup complete.
echo.
echo   Usage:  convert.bat path\to\design.html [options]
echo   Help:   node convert.js --help
echo ============================================================
echo.
pause