# GetThreads

Telegram Bot，自動擷取社群平台內容並儲存至 Obsidian Vault。

傳送連結給 Bot，自動抓取文章、評論、圖片與影片，智慧分類後存成 Markdown 筆記。

---

## 支援平台

| 平台 | 內容擷取 | 評論擷取 | 時間軸 | 備註 |
|------|:--------:|:--------:|:------:|------|
| X / Twitter | ✅ | ✅ | — | 時間軸需登入，不支援 |
| Threads | ✅ | ✅ | ✅ | 透過 Camoufox |
| Reddit | ✅ | ✅ | — | Reddit API |
| YouTube | ✅ | — | — | 需安裝 yt-dlp |
| GitHub | ✅ | — | — | Repo / Issue / PR |
| Bilibili | ✅ | ✅ | — | 公開 API |
| 微博 | ⚠️ | — | — | 需登入 |
| 小紅書 | ⚠️ | — | — | 需登入 |
| 抖音 / 今日頭條 | ⚠️ | — | — | 需登入 |
| 通用網頁 | ✅ | — | — | 透過 Jina Reader |

---

## 安裝前準備：申請 Telegram Bot

1. 在 Telegram 搜尋 **@BotFather**（藍勾官方帳號）
2. 傳送 `/newbot`
3. 輸入 Bot 名稱（如 `我的收藏Bot`）
4. 輸入 Bot 帳號（必須以 `bot` 結尾，如 `mycollection_bot`）
5. BotFather 會給你一串 Token，格式如：`1234567890:AAFdFMgb...`
6. 複製這串 Token，安裝時會用到

---

## 第一次安裝

### 方法一：使用安裝精靈（適合一般使用者）

1. 雙擊 `setup.bat`
2. 若提示 Node.js 未安裝，程式會自動開啟下載頁，安裝 LTS 版後重新執行
3. 在自動開啟的設定頁面中填入 Bot Token 與 Obsidian Vault 路徑
4. 按「儲存設定」完成

### 方法二：手動設定（適合開發者）

```bash
# 1. 安裝依賴
npm install

# 2. 建立環境設定
cp .env.example .env
```

編輯 `.env`：

```env
# 必填
BOT_TOKEN=your_telegram_bot_token
VAULT_PATH=C:/Users/yourname/ObsidianVault

# 選填
ANTHROPIC_API_KEY=sk-ant-...        # AI 摘要與關鍵字增強
ALLOWED_USER_IDS=123456,789012      # 限制使用者（逗號分隔 Telegram user ID）
```

```bash
# 3. Camoufox 初始化（首次，Threads/小紅書/抖音需要）
npx camoufox-js fetch

# 4. 啟動
npm run dev
```

---

## 每天使用

雙擊 `啟動.bat`（或 `start-dev.bat`）即可啟動 Bot。

- 保持視窗開啟 = Bot 持續運作
- 關閉視窗 = Bot 停止

---

## Telegram 指令

| 指令 | 說明 |
|------|------|
| 直接傳送 URL | 自動擷取內容並儲存到 Vault |
| `/timeline @用戶 [threads]` | 抓取用戶最近貼文（支援 Threads） |
| `/monitor <關鍵字>` | 跨平台搜尋提及（Reddit + DuckDuckGo） |
| `/google <查詢>` | 網頁搜尋（DuckDuckGo） |
| `/learn` | 重新掃描 Vault 更新分類規則 |
| `/reclassify` | 重新分類所有 Vault 筆記 |

---

## 專案結構

```
src/
├── index.ts                  # 入口（ProcessGuardian 自動重試）
├── bot.ts                    # Telegram Bot 主邏輯
├── classifier.ts             # 內容智慧分類
├── formatter.ts              # Markdown 格式化
├── saver.ts                  # Obsidian 存檔
├── process-guardian.ts       # 409 衝突自動重試 + PID lockfile
├── commands/
│   ├── timeline-command.ts   # /timeline
│   ├── monitor-command.ts    # /monitor + /google
│   └── comments-command.ts   # /comments
├── extractors/
│   ├── x-extractor.ts        # Twitter/X
│   ├── threads-extractor.ts  # Threads（Camoufox）
│   ├── reddit-extractor.ts   # Reddit
│   ├── youtube-extractor.ts  # YouTube
│   ├── github-extractor.ts   # GitHub
│   ├── bilibili-extractor.ts # B站
│   ├── weibo-extractor.ts    # 微博
│   ├── xiaohongshu-extractor.ts # 小紅書
│   ├── douyin-extractor.ts   # 抖音
│   └── web-extractor.ts      # 通用網頁 fallback
└── utils/
    ├── config.ts              # 環境設定
    ├── url-parser.ts          # URL 解析與路由
    ├── fetch-with-timeout.ts  # 帶超時的 HTTP 請求
    └── camoufox-pool.ts       # 反偵測瀏覽器池（max 2）
```

---

## 技術細節

- **TypeScript** + ESM modules（`tsx` 執行）
- **Telegraf** 處理 Telegram Bot API
- **Camoufox**（反偵測瀏覽器，基於 Firefox）處理需 JS 渲染的平台
- **ProcessGuardian** 防止 409 polling 衝突，指數退避自動重試
- 所有外部請求皆有超時保護（HTTP 30s / 影片 120s / 存檔 10s）
- 內建智慧分類器，自動將內容分類到 Obsidian 資料夾
- 可選 Anthropic API 進行 AI 摘要與關鍵字增強

---

## 開發指令

```bash
npm run dev      # 開發模式（tsx 即時執行）
npm run build    # 編譯 TypeScript
npm start        # 生產模式（需先 build）
npx tsc --noEmit # 型別檢查
```

---

## 常見問題

### Bot 沒有回應？
- 確認 `啟動.bat` 的視窗是否還開著
- 關掉視窗再重新雙擊 `啟動.bat`

### 顯示「409 Conflict」？
- 上次 Bot 未正確關閉。關閉所有命令列視窗，等 10 秒，重新啟動

### 找不到 Obsidian Vault？
- 確認 Obsidian 已建立 Vault
- 在 `.env` 手動輸入 Vault 完整路徑，或重新執行 `setup.bat`

### 修改設定？
- 編輯 `.env` 檔案，或重新雙擊 `setup.bat`

---

## 授權

ISC
