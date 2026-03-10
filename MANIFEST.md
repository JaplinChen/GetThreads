# GetThreads — MANIFEST

> AI 讀取此檔案即可快速理解專案結構，避免不必要的探索。
> 詳細架構設計見 `docs/architecture.md`。

## 專案用途

Telegram Bot，將使用者傳送的 URL 內容抓取、分類、AI 摘要後存入 Obsidian Vault。

## 技術棧

- **語言**：TypeScript（`ts-node` 執行，`vitest` 測試）
- **框架**：Telegraf（Telegram Bot API）
- **執行環境**：Windows 10，Node.js
- **LLM**：`claude -p` CLI（主力） → DDG AI Chat（fallback）

## 目錄結構

```
GetThreads/
├── src/                    ← 所有原始碼（81 檔，~8,200 行）
│   ├── index.ts            ← 主入口：啟動 config、extractor、guardian
│   ├── bot.ts              ← Telegraf Bot 組裝
│   ├── classifier.ts       ← 內容分類器（規則式）
│   ├── saver.ts            ← Obsidian Vault 存檔
│   ├── process-guardian.ts ← 進程管理（409 衝突自動重試）
│   ├── formatter.ts        ← 格式化入口
│   │
│   ├── commands/           ← Telegram 指令（/monitor, /timeline, /knowledge 等）
│   ├── messages/           ← 訊息處理管線（URL 偵測 → 抓取 → 豐富 → 存檔）
│   │   └── services/       ← 管線各階段純函式
│   ├── extractors/         ← 平台提取器（12 個）
│   │   ├── threads-extractor.ts
│   │   ├── youtube-extractor.ts
│   │   ├── reddit-extractor.ts
│   │   ├── x-extractor.ts
│   │   ├── bilibili-extractor.ts
│   │   ├── tiktok-extractor.ts
│   │   ├── github-extractor.ts
│   │   ├── weibo-extractor.ts
│   │   ├── xiaohongshu-extractor.ts
│   │   ├── douyin-extractor.ts
│   │   ├── web-extractor.ts      ← 通用網頁 fallback
│   │   ├── web-cleaner.ts        ← HTML 清理
│   │   ├── types.ts              ← ExtractedContent 資料契約
│   │   └── index.ts              ← 提取器註冊
│   ├── formatters/         ← Markdown 格式化（base + 各平台）
│   ├── enrichment/         ← LLM 摘要、連結豐富、翻譯
│   ├── knowledge/          ← 知識圖譜（聚合、查詢、技能生成）
│   ├── learning/           ← 學習系統（AI enricher、重分類、Vault 掃描）
│   ├── utils/              ← 工具函式（DDG、Camoufox、URL、搜尋）
│   ├── vault/              ← Vault 重處理輔助
│   ├── core/               ← 共用基礎（logger、errors）
│   └── admin/              ← 管理用 HTTP 服務
│
├── docs/                   ← 架構文件
│   └── architecture.md
├── scripts/                ← 本地輔助腳本（不進 git）
│   ├── reprocess-vault.ts  ← Vault 批次重處理
│   ├── migrate-*.ts        ← 遷移腳本
│   └── test-*.ts           ← 手動測試腳本
│
├── data/                   ← 執行時資料（知識庫 JSON，不進 git）
├── models/                 ← 本地模型（不進 git）
├── tools/                  ← 外部工具如 Camoufox（不進 git）
│
├── .env                    ← 環境變數（BOT_TOKEN 等）
├── .env.example            ← 環境變數範例
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── start.bat               ← 標準啟動（Windows）
├── start-dev.bat            ← 開發模式啟動
├── setup.bat               ← 初始設置
└── 啟動.bat                 ← 繁體中文版啟動
```

## 資料流

```
Telegram 訊息 → URL 偵測 → Extractor 抓取 → Classifier 分類
    → LLM Enrichment（摘要/關鍵字） → Formatter → Saver → Obsidian Vault
```

## 開發規範

| 規範 | 說明 |
|------|------|
| 行數限制 | 所有 `.ts` 檔案 ≤ 300 行 |
| 型別檢查 | `npx tsc --noEmit` 零錯誤 |
| 超時標準 | HTTP 30s / yt-dlp 120s / Obsidian 10s |
| 進程管理 | `taskkill /F /IM node.exe`（Windows） |
| Bot 啟動 | 先 taskkill → 等 3 秒 → 再啟動 |

## 不進 git 的大型目錄

| 目錄 | 大小 | 用途 |
|------|------|------|
| `node_modules/` | ~144 MB | npm 依賴 |
| `models/` | ~466 MB | 本地模型資料 |
| `data/` | ~210 MB | 知識庫 JSON |
| `tools/` | ~10 MB | Camoufox 等 |
| `dist/` | ~1.2 MB | 編譯輸出 |
