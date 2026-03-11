# GetThreads 專案規則

## Post-Fix Checklist（修復後檢查清單）

* 修改 extractor 或 formatter 後，**必須同時檢查並修復**已存在的 Obsidian vault 筆記。
* 不要只修 code——也要修 output。用修正後的邏輯重新處理受影響的筆記。
* 修復完成後確認：無空白摘要、無壞連結、無 HTML 殘留。

## Build & Verification（建置驗證）

* 修改任何 TypeScript 檔案後，**必須執行 `npx tsc --noEmit`** 確認零錯誤才算完成。
* Hook 已自動檢查，但手動確認仍為最終標準——不要忽略 hook 輸出的錯誤。
* 報告完成前，確保編譯通過。

## Windows-Specific Gotchas（Windows 地雷）

* BAT 檔的 `echo` 中**不可使用 `||`**——cmd.exe 會解讀為 OR 運算子，導致腳本閃退。改用 `^|^|` 或重構輸出。
* BAT 檔必須 **CP950 編碼 + CRLF + 無 BOM**。
* 進程管理用 `tasklist` / `taskkill`，不用 `ps` / `kill`。
* 路徑分隔符：TypeScript 中用 `path.join()`，Bash 中用正斜線。

## Architecture Principles（架構原則）

* 新功能**整合進現有 URL 處理 pipeline**，不另建獨立 command（除非用戶明確要求）。
* 遵循現有模式：extractor → formatter → saver 管線。
* 新 extractor 用 `/extractor-scaffold` 腳手架生成，不要從零手寫。

## Custom Skills（自訂技能規範）

* 建立 `.claude/skills/` 下的 SKILL.md 時，**必須包含 YAML frontmatter**（title、description 等）。
* 新技能建立後提醒用戶：**需要重啟 Claude Code** 才會出現在 `/` 選單。
* 技能的 prompt 必須具體、可執行，避免模糊指令。

## Classifier / Vault 組織（分類器規範）

* 修改分類器關鍵字後，**必須跑回歸測試**（`/test classify`）檢查 false positives。
* 特別注意 **substring 匹配陷阱**（如 `ads` 會匹配 `attachments`）——用 word boundary 或完整比對。
* 搬移檔案前先做 **dry-run**：列出所有檔案的新分類，人工確認後再執行。

## Git Workflow（版控流程）

* 功能完成後，將 commit + push 視為標準流程的一部分（除非用戶另有指示）。
* 功能有顯著變更時，同步更新 README。
* 使用 `/done` 完成標準提交流程。

## Debug 策略（除錯原則）

* 遇到 runtime 問題時，**先診斷、再修復**——不要直接猜測修改。
* 第一步：列出所有可能的 root cause，檢查進程狀態、log 輸出。
* 確認根因後才開始修改程式碼。
* 避免在同一個問題上連續嘗試 3 次以上不同的猜測修復。
