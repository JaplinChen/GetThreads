# GetThreads

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
- **PDF 文件收集** — 直接傳 PDF 到 Telegram，自動擷取文字、分類、存入 Vault
- **智慧分類** — 自動歸檔到對的 Obsidian 資料夾，支援 20+ 分類
- **跨平台搜尋** — 在 Telegram 裡搜 DuckDuckGo + Reddit
- **GitHub 探索** — `/discover` 搜尋專案或瀏覽每日熱門
- **知識問答** — `/ask` 用 Vault 知識回答問題，AI 結合筆記上下文
- **時間軸抓取** — 一次撈回某人最近的所有貼文
- **知識系統** — 深度分析 Vault 筆記，萃取實體、洞察與關係圖譜，自動生成用戶偏好模型與知識蒸餾報告
- **記憶整合** — 自動發現跨筆記知識關聯，LLM 語義合成洞察，每週自動生成整合報告
- **相關筆記推薦** — 兩層演算法（實體圖譜 → 關鍵字比對）自動在筆記底部附加 `[[wikilink]]` 連結 + 生成索引
- **內容雷達** — 根據 Vault 高頻關鍵字自動搜尋新內容，定期存入 Vault 並推送 Telegram 通知
- **互動式指令** — 缺參數時自動引導輸入，知識類指令提供快捷按鈕
- **多模型智慧路由** — 依內容複雜度自動選擇 flash / standard / deep 免費模型，兼顧速度與品質
- **批次翻譯** — 英文/簡中筆記自動翻譯為繁體中文
- **跨裝置同步** — 搭配 [Remotely Save](https://github.com/remotely-save/remotely-save) + [InfiniCLOUD](https://infini-cloud.net/) 免費 WebDAV，Windows / Mac / iPhone 三端同步

</details>

<details>
<summary><strong>支援平台</strong></summary>

### 完整支援

| 平台 | 內容 | 評論 | 時間軸 | 備註 |
|------|:----:|:----:|:------:|------|
| X / Twitter | ✅ | ✅ | — | fxTweet API |
| Threads | ✅ | ✅ | ✅ | topic tag 自動偵測，智慧標題 |
| Reddit | ✅ | ✅ | — | 公開 API |
| Bilibili | ✅ | ✅ | — | 公開 API |

### 內容擷取

| 平台 | 內容 | 備註 |
|------|:----:|------|
| YouTube | ✅ | yt-dlp，字幕擷取 + 播放清單（影片預設不存，連結回原始 URL） |
| TikTok | ✅ | yt-dlp + whisper.cpp STT 逐字稿（影片預設不存） |
| GitHub | ✅ | Repo / Issue / PR |
| 通用網頁 | ✅ | Jina Reader fallback |
| PDF 文件 | ✅ | 直接傳檔到 Telegram，自動擷取文字 |

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
ALLOWED_USER_IDS=123456,789012      # 限制使用者（逗號分隔 Telegram user ID）
ENABLE_TRANSLATION=true             # 啟用簡轉繁翻譯
MAX_LINKED_URLS=5                   # 單則貼文最多抓取的外部連結數
SAVE_VIDEOS=false                   # 影片存入 Vault（預設 false，僅保留原始連結）
LLM_PROVIDER=opencode                # LLM CLI（預設 OpenCode + MiniMax M2.5 Free，DDG Chat 為備援）
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
| 傳送 PDF | 自動擷取文字、AI 摘要、分類存入 Vault |
| `/search <查詢>` | 網頁搜尋（DuckDuckGo） |
| `/monitor <關鍵字>` | 跨平台搜尋提及（Reddit + DuckDuckGo） |
| `/timeline @用戶 [數量]` | 抓取用戶最近貼文（支援 Threads） |
| `/ask <問題>` | 用 Vault 知識回答問題（AI 結合筆記上下文） |
| `/knowledge` | 知識庫總覽（含缺口/技能/偏好/分析子按鈕） |
| `/explore <主題>` | 知識探索（推薦筆記/簡報/對比，InlineKeyboard 選模式） |
| `/digest` | 知識報告（精華摘要/蒸餾/跨筆記洞察，InlineKeyboard 選模式） |
| `/discover <關鍵字>` | GitHub 專案探索（無參數=每日熱門掃描） |
| `/learn` | Vault 學習（更新分類規則/重新分類/批次翻譯，InlineKeyboard 選操作） |
| `/reprocess <路徑>` | 重新 AI 豐富現有筆記 |
| `/retry` | 重試失敗的連結 |
| `/subscribe @用戶` | 訂閱自動追蹤新內容 |
| `/quality` | Vault 品質報告 |
| `/suggest` | 相關筆記推薦（自動連結，寫入筆記底部 + 索引） |
| `/radar` | 內容雷達（自動搜尋+存入，on/off/auto/run/add/remove） |
| `/status` | Bot 運行狀態與本次儲存統計 |
| `/help` | 顯示說明 |

> 需要參數的指令（如 `/search`、`/explore`）從選單點選後會自動引導輸入。合併指令使用 InlineKeyboard 按鈕選擇子功能。

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
<summary><strong>跨裝置同步（選配）</strong></summary>

Vault 預設不儲存影片（`SAVE_VIDEOS=false`），實際大小約數十 MB，非常適合雲端同步。

**推薦方案：[InfiniCLOUD](https://infini-cloud.net/)（免費 20GB WebDAV）+ [Remotely Save](https://github.com/remotely-save/remotely-save) 外掛**

1. 註冊 InfiniCLOUD → My Page → 開啟 **Apps Connection** → 取得 WebDAV 位址與專用密碼
2. Obsidian 安裝 **Remotely Save** 外掛 → Remote Service 選 **WebDAV** → 填入位址、帳號、WebDAV 密碼
3. 建議啟用 **Password-Based Encryption**（E2E 加密）
4. 三台裝置（Windows / Mac / iPhone）使用相同設定，首次同步後即可自動排程

> 其他相容後端：OneDrive、Dropbox、S3、Synology NAS WebDAV。

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
- **OpenCode CLI** + 多模型路由 — 依複雜度自動選 flash（MIMO v2）/ standard（MiniMax M2.5）/ deep（Nemotron 3 Super），全免費
- **知識系統** — 實體萃取、知識圖譜、缺口分析、Skill 自動生成、用戶偏好萃取、知識蒸餾、記憶整合
- 所有長任務（timeline / monitor / learn / reclassify）採 fire-and-forget：先回覆「處理中」→ 背景執行 → 完成通知
- 評論自動篩選：過濾純 emoji 和過短反應，只保留有意義的討論
- URL 去重快取：避免重複儲存相同內容
- 批次翻譯：opencc-js（簡轉繁）+ Google Translate（英翻中），無需 API key

### Claude Code Skills（開發輔助）

13 個自訂技能，涵蓋開發全流程：

| 類別 | 技能 | 用途 |
|------|------|------|
| 開發流程 | `/design` `/dev` `/ship` | 架構確認 → 開發 → 驗證提交推送 |
| Session | `/resume` `/handoff` | 自動啟動 / 交接記錄 |
| 測試 | `/test` | classify / extractor / smoke / status |
| 重構 | `/refactor` | 影響分析 → 遷移 → 模組化拆分 |
| Vault | `/vault` | 維護 / 修復 / 知識萃取 |
| Bot 管理 | `/launch` | 啟動 / 停止 / 診斷 409 |
| 維護 | `/health` `/weekly` | 即時快照 / 週維護（含依賴檢查） |
| 新平台 | `/new-platform` | 腳手架 → 實作 → 測試 → 提交 |

### 設計原則

- 所有 TypeScript 檔案 **≤ 300 行**
- **不使用任何 API SDK**（無 Anthropic SDK、無 OpenAI SDK）
- LLM enrichment 來源：OpenCode CLI 多模型路由（flash / standard / deep，全免費）→ DDG AI Chat（免費備援）
- Enrichment 輸出過濾廢話與廣告語，保持中性專業語氣
- 外部呼叫必須有 timeout（HTTP 30s / yt-dlp 120s / Obsidian 10s）
- **輕量 Vault** — 影片預設不存入 Vault（`SAVE_VIDEOS=false`），僅保留原始 URL 連結

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
│   ├── knowledge-command.ts    # /knowledge（含 gaps/skills/preferences/analyze 子按鈕）
│   ├── knowledge-query-command.ts # /explore（推薦/簡報/對比）
│   ├── digest-command.ts       # /digest（精華/蒸餾/整合）
│   ├── ask-command.ts          # /ask Vault 知識問答
│   ├── discover-command.ts     # /discover GitHub 探索（含熱門掃描）
│   ├── suggest-command.ts     # /suggest 相關筆記推薦
│   └── radar-command.ts       # /radar 內容雷達管理
├── extractors/                 # 各平台內容擷取器
│   ├── x-extractor.ts          # Twitter/X（fxTweet API）
│   ├── threads-extractor.ts    # Threads（Camoufox，topic tag 偵測）
│   ├── reddit-extractor.ts     # Reddit（公開 API）
│   ├── youtube-extractor.ts    # YouTube（yt-dlp + 播放清單）
│   ├── tiktok-extractor.ts     # TikTok（yt-dlp + whisper.cpp STT）
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
│   ├── preference-extractor.ts # 用戶偏好模型（零 LLM 純統計）
│   ├── distiller.ts            # 知識蒸餾（核心原則 + 歸檔候選）
│   ├── consolidator.ts         # 記憶整合（跨筆記實體叢集 + LLM 洞察）
│   ├── consolidation-report.ts # 整合報告格式化與 Vault 存檔
│   └── types.ts                # 知識系統型別
├── enrichment/                 # 內容後處理
│   └── post-processor.ts       # 連結展開、翻譯
├── learning/                   # 分類學習與 AI 增強
│   ├── dynamic-classifier.ts   # 動態分類規則快取
│   ├── vault-learner.ts        # Vault 掃描學習
│   ├── learn-command.ts        # /learn 指令
│   ├── ai-enricher.ts          # OpenCode + MiniMax AI 摘要
│   ├── reclassify-command.ts   # 重新分類（由 /learn 按鈕觸發）
│   └── batch-translator.ts     # 批次翻譯（由 /learn 按鈕觸發）
├── radar/                      # 內容雷達（自動搜尋+存入）
│   ├── radar-types.ts          # 型別定義
│   ├── radar-store.ts          # 設定持久化 + 自動查詢生成
│   └── radar-service.ts        # 背景排程引擎（DDG 搜尋 → Vault）
├── vault/                      # Vault 維護工具
│   ├── frontmatter-utils.ts    # 共用 frontmatter 解析
│   ├── link-suggester.ts       # 相關筆記推薦（兩層 fallback）
│   ├── link-writer.ts          # 筆記寫入 + 索引生成
│   └── reprocess-helpers.ts    # 重處理輔助（備份、進度追蹤、fallback 重分類）
└── utils/
    ├── config.ts               # 環境設定
    ├── url-parser.ts           # URL 解析與路由
    ├── force-reply.ts          # ForceReply 標記/解析工具
    ├── fetch-with-timeout.ts   # 帶超時的 HTTP 請求
    ├── search-service.ts       # 搜尋服務（DDG + Camoufox）
    ├── ddg-chat.ts             # DuckDuckGo AI Chat 介面
    ├── local-llm.ts            # LLM 統一入口（多模型路由 → DDG Chat 備援）
    ├── vision-llm.ts           # 圖片辨識（OpenCode gpt-5-nano）
    ├── url-canonicalizer.ts    # URL 正規化（去重用）
    └── camoufox-pool.ts        # 反偵測瀏覽器池（max 2, idle 10min）
```

</details>

---

## 貢獻指南

詳見 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。歡迎使用 Claude Code / Codex 等 AI 輔助工具。

## 授權

[ISC License](https://opensource.org/licenses/ISC) — 可自由使用、複製、修改與散布，僅需保留版權聲明。
