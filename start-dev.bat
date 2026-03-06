@echo off
echo.
echo ==============================
echo   GetThreads Bot Launcher
echo ==============================
echo.

:: Step 1: Kill existing node processes
echo [1/4] Killing stale node processes...
taskkill /F /IM node.exe 2>nul
if %ERRORLEVEL% EQU 0 (
    echo       Done.
) else (
    echo       None found.
)

:: Step 2: Wait for cleanup
echo.
echo [2/4] Waiting 3s for cleanup...
timeout /t 3 /nobreak >nul

:: Step 3: TypeScript check
echo.
echo [3/4] TypeScript check...
call npx tsc --noEmit
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] TypeScript errors found. Fix before starting.
    pause
    exit /b 1
)
echo       OK - zero errors.

:: Step 4: Start bot
echo.
echo [4/4] Starting bot...
echo ==============================
echo.
call npm run dev

echo.
echo Bot stopped.
pause
