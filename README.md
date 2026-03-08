# GetThreads

## ??????

???? [`CONTRIBUTING.md`](./CONTRIBUTING.md)?

- Claude Code / Codex / ????????????
- ???????`npm run lint`?`npm run test`?`npm run build`

**把社群內容變成你的第二大腦。**

丟一個連結給 Telegram Bot，它會自動抓取文章、評論、圖片與影片，智慧分類後存成 Markdown 筆記到你的 Obsidian Vault。

---

<details>
<summary><strong>為什麼需要 GetThreads？</strong></summary>

你在 Twitter 看到一篇好文、Reddit 上有精彩討論、Threads 上有值得收藏的串文——
但你知道這些內容遲早會消失在時間線裡。

GetThreads 讓你在 Telegram 裡丟一個連結，**3 秒後它就躺在你的 Obsidian 裡了**。
不只文章本體，連底下的評論討論也一起收。

</details>

<details open>
<summary><strong>亮點功能</strong></summary>

- **丟連結就存檔** — 支援 10+ 平台，評論自動一起抓
- **智慧分類** — 自動歸檔到對的 Obsidian 資料夾，支援 20+ 分類
- **跨平台搜尋** — 在 Telegram 裡搜 DuckDuckGo + Reddit
- **時間軸抓取** — 一次撈回某人最近的所有貼文
- **知識系統** — 深度分析 Vault 筆記，萃取實體、洞察與關係圖譜
- **互動式指令** — 缺參數時自動引導輸入，知識類指令提供快捷按鈕
- **AI 增強**（選配）— Claude 自動產生摘要與關鍵詞
- **批次翻譯** — 英文/簡中筆記自動翻譯為繁體中文

</details>

<details>
<summary><strong>支援平台</strong></summary>

### 完整支援

| 平台 | 內容 | 評論 | 時間軸 |
|------|:----:|:----:|:------:|
| X / Twitter | ✅ | ✅ | — |
| Threads | ✅ | ✅ | ✅ |
| Reddit | ✅ | ✅ | — |
| Bilibili | ✅ | ✅ | — |

### 內容擷取

| 平台 | 內容 | 備註 |
|------|:----:|------|
| YouTube | ✅ | yt-dlp，影片下載 + 播放清單 |
| GitHub | ✅ | Repo / Issue / PR |
| 通用網頁 | ✅ | Jina Reader fallback |

### 需登入平台

| 平台 | 內容 | 備註 |
|------|:----:|------|
| 微博 | ✅ | Camoufox + API |
| 小紅書 | ✅ | Camoufox |
| 抖音 / 今日頭條 | ✅ | Camoufox |

> 需登入的平台使用 [Camoufox](https://camoufox.com/)（反偵測瀏覽器），首次使用需執行 `npx camoufox-js fetch`。

</details>

<details>
<summary><strong>快速開始</strong></summary>

### 1. 申請 Telegram Bot Token

在 Telegram 找 **@BotFather** → 傳送 `/newbot` → 取得 Token（格式：`1234567890:AAFdFMgb...`）

### 2. 安裝

**一般使用者** — 雙擊 `setup.bat`，按畫面指示操作

**開發者** — 手動設定：

```bash
npm install
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
# Camoufox 初始化（首次，Threads/小紅書/抖音需要）
npx camoufox-js fetch
```

### 3. 啟動

雙擊 `啟動.bat`（或 `start-dev.bat`），保持視窗開啟即可。

</details>

<details>
<summary><strong>指令速查</strong></summary>

| 指令 | 用途 |
|------|------|
| 傳送 URL | 自動擷取內容與評論，分類後存到 Vault |
| `/search <查詢>` | 網頁搜尋（DuckDuckGo，`/google` 為別名） |
| `/monitor <關鍵字>` | 跨平台搜尋提及（Reddit + DuckDuckGo） |
| `/timeline @用戶 [數量]` | 抓取用戶最近貼文（支援 Threads） |
| `/analyze` | 深度分析 Vault 知識 |
| `/knowledge` | 查看知識庫摘要 |
| `/recommend <主題>` | 推薦相關筆記 |
| `/brief <主題>` | 主題知識簡報 |
| `/compare <A> vs <B>` | 實體對比分析 |
| `/gaps` | 知識缺口分析 |
| `/skills` | 高密度主題 Skill 建議 |
| `/recent` | 本次啟動已儲存的內容 |
| `/status` | Bot 運行狀態與統計 |
| `/learn` | 重新掃描 Vault 更新分類規則 |
| `/reclassify` | 重新分類所有 Vault 筆記 |
| `/translate` | 批次翻譯英文/簡中筆記為繁體中文 |
| `/help` | 顯示說明 |

> 需要參數的指令（如 `/search`、`/recommend`）從選單點選後會自動引導輸入。知識類指令還會顯示熱門主題按鈕供快速選擇。

</details>

<details>
<summary><strong>常見問題</strong></summary>

**Bot 沒有回應？**
關掉 `啟動.bat` 視窗，重新雙擊啟動。

**顯示「409 Conflict」？**
上次 Bot 未正確關閉。關閉所有命令列視窗，等 10 秒再重新啟動。程式內建 ProcessGuardian 會自動重試。

**抓取超時或失敗？**
所有外部請求皆有超時保護（HTTP 30s / 影片 120s / 存檔 10s）。如果 DuckDuckGo 被限流，搜尋會自動降級到 Camoufox。

**想修改設定？**
編輯 `.env` 檔案，或重新執行 `setup.bat`。

</details>

<details>
<summary><strong>開發資訊</strong></summary>

### 開發指令

```bash
npm run dev      # 開發模式（tsx 即時執行）
npm run build    # 編譯 TypeScript
npm start        # 生產模式（需先 build）
npx tsc --noEmit # 型別檢查
```

### 技術架構

- **TypeScript** + ESM（`tsx` 執行）
- **Telegraf** — Telegram Bot API（ForceReply + InlineKeyboard 互動式指令）
- **Camoufox** — 反偵測瀏覽器（Firefox 基底），處理需 JS 渲染的平台
- **ProcessGuardian** — 防止 409 polling 衝突，指數退避自動重試
- **Anthropic Claude API**（選配）— AI 摘要與關鍵字增強
- **知識系統** — 實體萃取、知識圖譜、缺口分析、Skill 自動生成
- 所有長任務（timeline / monitor / learn / reclassify）採 fire-and-forget：先回覆「處理中」→ 背景執行 → 完成通知
- 評論自動篩選：過濾純 emoji 和過短反應，只保留有意義的討論
- URL 去重快取：避免重複儲存相同內容
- 批次翻譯：opencc-js（簡轉繁）+ Google Translate（英翻中），無需 API key

### 專案結構

```
src/
├── index.ts                    # 入口（ProcessGuardian 自動重試）
├── bot.ts                      # Telegram Bot（ForceReply 攔截 + URL 處理）
├── classifier.ts               # 內容智慧分類（20+ 分類）
├── saver.ts                    # Obsidian 存檔 + 去重快取
├── process-guardian.ts         # 409 衝突自動重試 + PID lockfile
├── commands/
│   ├── register-commands.ts    # 統一指令註冊 + InlineKeyboard callback
│   ├── timeline-command.ts     # /timeline
│   ├── monitor-command.ts      # /monitor + /search
│   ├── knowledge-command.ts    # /analyze + /knowledge + /gaps + /skills
│   └── knowledge-query-command.ts # /recommend + /brief + /compare
├── extractors/                 # 各平台內容擷取器
│   ├── x-extractor.ts          # Twitter/X（fxTweet API）
│   ├── threads-extractor.ts    # Threads（Camoufox）
│   ├── reddit-extractor.ts     # Reddit（公開 API）
│   ├── youtube-extractor.ts    # YouTube（yt-dlp + 播放清單）
│   ├── github-extractor.ts     # GitHub（REST API）
│   ├── bilibili-extractor.ts   # B站（公開 API）
│   ├── weibo-extractor.ts      # 微博（API + Camoufox）
│   ├── xiaohongshu-extractor.ts # 小紅書（Camoufox）
│   ├── douyin-extractor.ts     # 抖音（Camoufox）
│   └── web-extractor.ts        # 通用網頁（Jina Reader）
├── formatters/                 # 按平台分離的 Markdown 格式化
│   ├── index.ts                # Registry：platform → formatter
│   ├── base.ts                 # 組裝器（frontmatter + body + stats）
│   ├── shared.ts               # 共用工具（escape, linkify）
│   ├── x.ts / youtube.ts / ... # 各平台 formatter
│   └── default.ts              # 預設 formatter
├── knowledge/                  # 知識系統
│   ├── knowledge-store.ts      # 知識庫讀寫（vault-knowledge.json）
│   ├── knowledge-aggregator.ts # 統計聚合（Top 實體、洞察排序）
│   ├── knowledge-graph.ts      # 知識圖譜（缺口分析、實體關聯）
│   ├── skill-generator.ts      # 高密度主題 → Skill 自動生成
│   └── types.ts                # 知識系統型別
├── enrichment/                 # 內容後處理
│   └── post-processor.ts       # 連結展開、翻譯
├── learning/                   # 分類學習
│   ├── dynamic-classifier.ts   # 動態分類規則快取
│   ├── vault-learner.ts        # Vault 掃描學習
│   ├── learn-command.ts        # /learn 指令
│   ├── ai-enricher.ts          # Claude API 摘要/關鍵詞
│   ├── reclassify-command.ts   # /reclassify 指令
│   └── batch-translator.ts     # /translate 批次翻譯
└── utils/
    ├── config.ts               # 環境設定
    ├── url-parser.ts           # URL 解析與路由
    ├── force-reply.ts          # ForceReply 標記/解析工具
    ├── fetch-with-timeout.ts   # 帶超時的 HTTP 請求
    ├── search-service.ts       # 搜尋服務（DDG + Camoufox）
    └── camoufox-pool.ts        # 反偵測瀏覽器池（max 2, idle 10min）
```

</details>

---

## 授權

[ISC License](https://opensource.org/licenses/ISC) — 可自由使用、複製、修改與散布，僅需保留版權聲明。
