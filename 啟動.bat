@echo off
title GetThreads Bot -- 執行中
color 0A

echo.
echo  ==========================================
echo     GetThreads Bot
echo  ==========================================
echo.

:: 檢查是否已完成設定
if not exist ".env" (
    echo  [!] 尚未完成設定！
    echo.
    echo  請先雙擊「setup.bat」進行安裝與設定。
    echo.
    pause
    exit /b 1
)

:: 清除舊進程，避免衝突
echo  正在啟動...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 3 /nobreak >nul

:: 啟動 Bot
echo  [OK] Bot 已啟動！可以開始在 Telegram 使用了。
echo.
echo  ------------------------------------------
echo  保持此視窗開啟，Bot 才會持續運作。
echo  關閉此視窗 = 停止 Bot。
echo  ------------------------------------------
echo.

:: 切換 UTF-8（Node.js 輸出用），然後啟動
chcp 65001 >nul 2>&1
call npm run dev

:: Bot 停止後切回 CP950 顯示中文
chcp 950 >nul 2>&1
echo.
echo  ------------------------------------------
echo  Bot 已停止。
echo  若有錯誤訊息，請截圖後回傳給技術支援。
echo  ------------------------------------------
echo.
pause
