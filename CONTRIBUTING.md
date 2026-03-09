# 貢獻指南

本專案可使用 Codex、Claude Code 或其他 AI 輔助工具進行開發。
本文件為工程規範的唯一來源，確保工具生成的變更互相相容。

## 提交前必須通過的檢查

```bash
npm run lint
npm run test
npm run build
```

任一項失敗，請先修復再提交或開 PR。

## 專案慣例

- 語言：TypeScript（ESM）
- 不手動修改 `dist/` 目錄
- 所有修改在 `src/`，產出透過 build 生成
- 型別專用的 import 使用 `import type`
- 除非無法避免，否則禁用 `any`

## 架構指引

- 修改模組邊界前，請先閱讀 `docs/architecture.md`
- `src/core/errors.ts`：共用錯誤分類與使用者可見的錯誤訊息
- `src/core/logger.ts`：共用結構化日誌入口
- `src/commands/command-runner.ts`：共用非同步指令包裝器
- `src/messages/services/*`：訊息處理的商業邏輯
- `src/commands/register-commands.ts`：僅做指令/動作的編排註冊

新增指令時：

1. 在 `src/commands/*` 實作 handler 邏輯
2. 透過 `register-commands.ts` 的 `registerAsyncCommand` / `registerAsyncAction` 註冊
3. 錯誤處理統一走 `runCommandTask` + `formatErrorMessage`
4. 使用 `logger` 取代散落的 `console.*`

## URL 與去重策略

- 統一使用 `src/utils/url-canonicalizer.ts` 的 `canonicalizeUrl`
- 不在功能模組內重新實作 URL 正規化
- 若需平台特有的 URL 處理，請擴充 `canonicalizeUrl` 並附上測試

## Callback Data 策略（Telegram）

- Telegram callback data 有嚴格長度限制
- 使用 `knowledge-query-command.ts` 的 `buildCallbackData(...)` 與 `resolveCallbackPayload(...)`
- 不直接將長文字放入 `callback_data`

## 修改核心行為時需更新的測試

- URL 正規化：
  - `src/utils/url-canonicalizer.test.ts`
- Callback token/payload 對應：
  - `src/commands/knowledge-query-command.test.ts`
- 訊息管線/格式化：
  - `src/messages/*.test.ts`
  - `src/messages/services/*.test.ts`

## AI 輔助工具的建議工作流

1. 編輯前先閱讀本文件與相關模組
2. 做最小範圍的修改
3. 執行 lint / test / build
4. 摘要說明修改的檔案與行為影響

## 日常修改的禁止事項

- 不在同一 commit 中重構不相關的模組
- 除非依賴或建構產出有變動，否則不修改 lock / build 檔案
