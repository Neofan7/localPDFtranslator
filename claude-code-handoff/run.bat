@echo off
cd /d "%~dp0"
title PDF Translator

echo.
echo   Killing old processes on port 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo   Killing PID %%P
    taskkill /F /PID %%P >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo.
echo   Checking files...
if not exist "%~dp0_server.ps1" (
    echo   ERROR: _server.ps1 not found in %~dp0
    echo   Please put _server.ps1 and run.bat in the same folder.
    echo.
    pause
    exit /b 1
)

echo   Unblocking...
powershell.exe -NoProfile -Command "Unblock-File -Path '%~dp0_server.ps1'" 2>nul

echo   Starting PowerShell server...
echo   (If you see red errors below, screenshot them for debugging)
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0_server.ps1"

echo.
echo   === Server exited ===
echo.
pause
