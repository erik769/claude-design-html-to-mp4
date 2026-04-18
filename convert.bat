@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
    echo Usage: convert.bat ^<path\to\design.html^> [options]
    echo.
    echo Examples:
    echo   convert.bat design.html
    echo   convert.bat design.html --duration 10 --fps 60
    echo   convert.bat design.html --out out.mp4 --width 1280 --height 720
    echo.
    echo Full help:  node convert.js --help
    exit /b 1
)

node "%~dp0convert.js" %*