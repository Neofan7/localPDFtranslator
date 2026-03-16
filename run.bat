@echo off
cd /d "%~dp0"
title PDF Immersive Translator

echo.
echo   ==========================================
echo     PDF Immersive Translator
echo   ==========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js is not installed!
    echo.
    echo   Please download and install Node.js from:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Check if node_modules exists, if not run npm install
if not exist "%~dp0node_modules" (
    echo   First run - installing dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo   [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo.
)

:: Kill any existing process on port 3000
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo   Stopping old process on port 3000 ^(PID %%P^)...
    taskkill /F /PID %%P >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Start server in background
echo   Starting server...
start /b node server.js

:: Wait for server to start, then open browser
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo   ==========================================
echo     Server running at http://localhost:3000
echo   ==========================================
echo.
echo   * Browser should open automatically
echo   * If not, open http://localhost:3000
echo   * Close this window to stop the server
echo.
echo   Press any key to stop...
pause >nul

echo.
echo   Stopping server...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%P >nul 2>&1
)
echo   Done!
timeout /t 1 /nobreak >nul
