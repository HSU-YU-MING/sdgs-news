# 技術說明（SDGs 新聞分析器）

一份給開發者 / 接手者看的技術總覽：用了哪些語言、框架、AI 模型,以及為什麼這樣設計。

## 程式語言

| 語言 | 用在哪 |
| --- | --- |
| **JavaScript**（ES Modules） | 主要語言——前端、後端 function、工具邏輯全是 JS（刻意不用 TypeScript,降低維護門檻） |
| **JSX** | React 寫畫面的語法（`app/page.js`） |
| **CSS** | 純手寫樣式（`app/globals.css`）,無 UI 框架 |
| **HTML** | 由 React / Next.js 產生 |
| **TOML** | Cloudflare 設定檔（`wrangler.toml`） |

## 核心框架與平台

| 技術 | 角色 |
| --- | --- |
| **Next.js 15**（App Router） | 主框架,以「靜態匯出」（`output: 'export'`）打包成純靜態網站 |
| **React 19** | 前端介面（輸入框、模式切換、結果卡片、金鑰設定面板） |
| **Cloudflare Pages** | 部署平台。對外網址是 `sdgs.cornhsu.com`,平台原生網址 `sdgs-news.pages.dev` 仍可用 |
| **Cloudflare Pages Functions** | 後端（Workers 執行環境）,即 `functions/` 資料夾 |
| **Cloudflare Workers AI** | 後端免費 AI（語意向量模型 bge-m3） |
| **Cloudflare KV** | 鍵值儲存,做「每日呼叫上限」計數器（防扣費） |
| **Wrangler** | Cloudflare CLI,負責部署（`npm run deploy`） |

## 用到的 AI / 模型

| 模型 / 服務 | 用途 | 跑在哪 |
| --- | --- | --- |
| **Google Gemini**（`gemini-*-flash`） | 最準的 SDG 判斷（會推理、給理由） | Google 雲端,瀏覽器直接呼叫 |
| **bge-m3**（`@cf/baai/bge-m3`） | 免金鑰的「雲端語意」判斷 | Cloudflare Workers AI |
| **MiniLM**（`@huggingface/transformers`） | 雲端額度用完時的「瀏覽器本機語意」備援 | 使用者瀏覽器（WASM/CPU） |
| **Jina Reader**（`r.jina.ai`） | 「貼網址」抓不到時的閱讀模式備援（會執行 JS） | Jina 第三方服務 |

## 架構（前端為主）

```
瀏覽器（前端,靜態）
 ├─ 關鍵字比對、Gemini 呼叫、本機語意 → 都在瀏覽器跑（金鑰不外洩）
 └─ 呼叫後端只為了兩件事：
      ├─ /api/fetch  → 代抓網頁（解決跨域）+ Jina 閱讀模式備援
      └─ /api/embed  → Workers AI 算語意向量 + 每日上限防扣費
```

- **前端為主**：能在瀏覽器做的都在瀏覽器做 → 使用者的 Gemini 金鑰**完全不經過伺服器**。
- **後端極簡**：只有兩支 function,純抓網頁與算向量,**不碰金鑰**。
- **全免費 + 防扣費**：每個用到額度的地方（Workers AI、Jina）都有「用完自動降級、不綁卡就零費用」的保護。

## 三層判斷邏輯

1. **關鍵字快篩**（最終保底,免任何服務）。
2. **語意模式（免金鑰）**：先用 Cloudflare Workers AI（bge-m3,免下載）；額度用完自動改用瀏覽器本機 MiniLM。只給相關度、無理由。
3. **Gemini（自帶金鑰）**：最準,會套用防偏差規則並給判斷理由。

預設「⚡自動」：有金鑰用 Gemini,否則用語意模式。

## 檔案對照

| 檔案 | 技術 | 做什麼 |
| --- | --- | --- |
| `app/page.js` | React / JSX | 整個前端介面 + 分析流程 |
| `app/layout.js` | React | 頁面外框與 metadata |
| `app/globals.css` | CSS | 樣式 |
| `lib/geminiClient.js` | JS | 呼叫 Gemini + 動態偵測可用模型 |
| `lib/localSemantic.js` | JS | 雲端語意（bge-m3）+ 本機備援（MiniLM） |
| `lib/prompt.js` | JS | SDG 判斷提示語（含防偏差規則） |
| `lib/sdgs.js` | JS | 17 項 SDG 資料 + 關鍵字 + 語意描述 |
| `lib/sdgEmbeddingsCloud.json` | JSON | 預先算好的 17 項 SDG 雲端向量（省額度） |
| `scripts/build-sdg-embeddings.mjs` | JS | 重新產生上面那份向量；改了 `SDG_DESCRIPTIONS` 就要跑 |
| `lib/keyStore.js` | JS | Gemini 金鑰本機儲存（30 天未用自動清除） |
| `functions/api/fetch.js` | JS | 代抓網頁 + Jina 閱讀模式備援 |
| `functions/api/embed.js` | JS | Workers AI 向量 + 每日上限 |
| `wrangler.toml` | TOML | Cloudflare 設定（AI、KV 綁定） |

## 環境變數 / 密鑰

| 名稱 | 設在哪 | 用途 |
| --- | --- | --- |
| `JINA_API_KEY` | Cloudflare（Pages Secret） | 啟用閱讀模式備援（免登入試用金鑰即可） |
| `GEMINI_API_KEY` | 各使用者瀏覽器（localStorage） | 使用者自帶,不在伺服器設定 |

> ⚠️ 切勿在 Cloudflare 伺服器設定 `GEMINI_API_KEY`,否則所有人會共用你的金鑰並由你付費。

本專案**不使用 `.env` 檔**：網站程式碼（`app/`、`lib/`、`functions/`）沒有任何一處讀 `process.env`，
所以也刻意不放 `.env.local.example` 範本，以免讓人誤以為架構是「伺服器端共用金鑰」。
`JINA_API_KEY` 是透過 Workers 的綁定（`env.JINA_API_KEY`）讀取，不是 `.env` 檔。

唯一讀環境變數的是 `scripts/build-sdg-embeddings.mjs`（`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`），
那是**只在自己電腦上跑的離線工具**，不會被打包也不會上線。

## 成本與額度（重點：不綁卡就零費用）

| 服務 | 免費額度 | 用完時 |
| --- | --- | --- |
| Cloudflare Workers AI | 每天 10,000 Neurons（每日重置）；另有程式端每日上限 `DAILY_CAP` | 自動切瀏覽器本機模型 |
| Jina Reader | 一次性免費 token（約 100 萬~1000 萬,不自動回充） | 閱讀模式失效,退回「請貼文字」 |
| Gemini | 由使用者自己的金鑰承擔 | 與本網站無關 |

只要 **Cloudflare 與 Jina 都不綁信用卡**,額度用完只會「功能降級」,不會產生任何費用。

## 套件安全決策（2026-08-11）

**背景**：`npm audit` 報 8 個漏洞（protobufjs moderate、sharp high ×7）。

**決策**：只用 `overrides` 把 protobufjs 升到 `^7.6.5`,sharp 暫不處理。

**理由**：`npm audit fix` 會連帶把 `miniflare` 從 4.x 換成 `5.x-alpha`、`wrangler` 升到 4.121
——那是本站唯一的部署工具與本機 Functions 預覽引擎,為修漏洞換成 alpha 版風險過高。
sharp 的修補版（0.35.2）必須靠那次升級才拉得到,所以一併延後。

**代價（接受的風險）**：sharp 的 4 個 libvips CVE 仍在。實際暴露面極低——本站是
`output: 'export'` 純靜態匯出,線上沒有 Node runtime,sharp 只在**本機建置時**執行,
且輸入圖片來自自己的 repo。

**何時重看**：miniflare 5.x 脫離 alpha 後,一起升 next + wrangler + miniflare,sharp 會自然被帶上來。

## 一句話總結

用 **JavaScript 一條龍**（Next.js + React 前端、Cloudflare Functions 後端）,部署在 **Cloudflare**,搭配 **Gemini、Cloudflare Workers AI、瀏覽器端 AI** 三層判斷,主打「**免金鑰也能用、自帶金鑰更準、全程不扣錢**」。
