@echo off
cd /d "%~dp0"

:: Kill any existing bot instances to avoid Telegram 409 conflict
for /f "tokens=2" %%p in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr "PID:"') do (
    wmic process where "ProcessId=%%p" get CommandLine 2>nul | findstr /i "GetThreads" >nul && taskkill /pid %%p /f >nul 2>&1
)
timeout /t 3 /nobreak >nul

npm run dev
pause
