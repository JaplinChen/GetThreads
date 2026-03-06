@echo off
cd /d "%~dp0"
title GetThreads 安裝精靈
color 0A

echo.
echo  ==========================================
echo     GetThreads Bot -- 安裝精靈      
echo  ==========================================
echo.

:: 步驟 1：檢查 Node.js
echo  [1/3] 檢查 Node.js 是否已安裝...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [!] 找不到 Node.js！
    echo.
    echo  請先安裝 Node.js（免費），步驟如下：
    echo    1. 開啟以下網址：https://nodejs.org
    echo    2. 點選「LTS」版本下載
    echo    3. 執行安裝程式，一路按「Next」
    echo    4. 安裝完成後，重新雙擊此 setup.bat
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% 已就緒
echo.

:: 步驟 2：安裝套件
echo  [2/3] 安裝必要套件（首次執行需要幾分鐘）...
echo.
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [!] 套件安裝失敗！
    echo  請確認網路連線正常後，再次執行此程式。
    echo.
    pause
    exit /b 1
)
echo.
echo  [OK] 套件安裝完成
echo.

:: 步驟 3：開啟設定頁面
echo  [3/3] 開啟設定頁面...
echo.
echo  瀏覽器將自動開啟設定頁面。
echo  請在頁面中填入你的 Telegram Bot Token 與 Obsidian 資料夾位置。
echo.
echo  ------------------------------------------
echo  完成設定後，請關閉瀏覽器視窗。
echo  此視窗會自動結束。
echo  ------------------------------------------
echo.

call npx tsx src/admin/server.ts

echo.
echo  [OK] 設定完成！
echo.
echo  以後要使用 Bot，請雙擊「啟動.bat」即可。
echo.
pause
