# SDGs 新聞分析器 開發指南

貼上校園新聞的內容或網址，判斷它對應哪幾項 SDG（Next.js 15 + React 19，部署在 Cloudflare Pages，
對外網址 `sdgs.cornhsu.com`）。功能說明、三層判斷是什麼、檔案對照表見
[README.md](README.md) 與 [TECH.md](TECH.md)——那兩份是給使用者與接手者的，這份是開發慣例。

產品的核心承諾是「**不綁卡就零費用**」。下面每一條紅線與上限都是為了守住這句話，
不是效能調校，動之前先讀完理由。

## 指令

- `npm run dev`——**只夠測「貼文字」**。`next dev` 起不了 `functions/`，也沒有 AI／KV 綁定。
- `npm run preview`（`next build && wrangler pages dev`）——**動到 `functions/` 或綁定就必須走這條**。
  這是唯一能在本機跑到真實 Function 行為的方式。
- `npm run deploy`（`next build && wrangler pages deploy --commit-dirty=true`）。
  沒有目錄參數是正常的：產物路徑由 `wrangler.toml` 的 `pages_build_output_dir = "out"` 指定。
- 部署的共通流程（登入、部署前檢查、部署後驗證、Cloudflare 一鍵回滾）在全域 skill
  **`deploy-web`**（`~/.claude/skills/deploy-web/SKILL.md`），不在這裡重複。

**沒有測試、沒有 CI。** 編譯過只代表打包沒壞，不代表判斷邏輯對。
動了 `lib/` 的分數邏輯或 `functions/`，唯一的驗證方式是 `npm run preview` 然後真的分析一篇新聞。

## 線上沒有 Node runtime

`next.config.mjs` 是 `output: 'export'` + `images.unoptimized`——**這是純靜態匯出，
線上不存在任何 Next 程序**。SSR、Route Handlers（`app/api/`）、`next/image` 最佳化、
middleware（Next 的那個）通通不能用，寫了也不會執行。

所有動態邏輯一律走 **Cloudflare Pages Functions**（`functions/`，Workers 執行環境）。
兩個綁定定義在 `wrangler.toml`：

- `AI` → Workers AI，用 `@cf/baai/bge-m3` 算語意向量
- `USAGE_KV` → KV，只存「當日呼叫計數」

`functions/_middleware.js` 跑在**所有請求之前**（含 `/api/*`），把平台原生的
`sdgs-news.pages.dev` 301 轉到 `sdgs.cornhsu.com`。
⚠ 它**比對完整主機名，不是 `.pages.dev` 結尾**——這是刻意的：預覽部署的網址長得像
`<hash>.sdgs-news.pages.dev`，要留著能開，否則上線前沒辦法先看預覽版。
別「順手」把它改成後綴比對。

## 🔴 金鑰紅線：絕對不要在伺服器設 AI 金鑰

Gemini 走「**使用者自帶金鑰、存自己瀏覽器的 localStorage**」，
分析時由瀏覽器**直接**打給 Google，金鑰完全不經過我們的伺服器（`lib/geminiClient.js`、`lib/keyStore.js`）。

**絕對不要在 Cloudflare 設 `GEMINI_API_KEY` 之類的伺服器端 AI 金鑰環境變數。**
一設下去，全世界的訪客就變成共用你的金鑰、由你付錢——而且不會有任何錯誤訊息告訴你。
README 與 TECH.md 都寫了這條警告，**部署時看到「好像少設了一個變數」不要順手補上，那是刻意留空的**。

（`JINA_API_KEY` 是例外，那是給 `/api/fetch` 閱讀模式備援用的，設在 Cloudflare Pages Secret，
不是 AI 判斷金鑰，額度用完只會讓「貼網址」降級成「請改貼文字」。）

## 兩個端點的每日上限（2026-08-25／26 補上）

這兩支是**沒有驗證、對全世界開放**的端點，不設上限就是一個開放代理 + 免費 AI 服務。

| 端點 | `DAILY_CAP` | 計數單位 | 其他限制 |
|---|---|---|---|
| `functions/api/embed.js` | **900** | **段數**（`texts.length`） | `MAX_TEXTS = 4`、`MAX_TEXT_LEN = 8000` |
| `functions/api/fetch.js` | **100** | 請求數 | `MAX_URL_LEN = 2048`、擋內部位址 |

幾個一定要知道的理由：

- **embed 的計數單位是「段數」不是「請求數」**。改回請求數就等於沒有上限——
  一個請求夾帶一萬段也只計 1 次。正常前端只送 1 段、且截到 4000 字
  （`lib/localSemantic.js` 的 `text.slice(0, 4000)`），`MAX_TEXTS = 4` 是留餘裕，超出一律當壞客戶端擋掉。
- **900 + 100 = 1000，這兩個數字要一起算**：KV 免費方案是每天 1,000 次寫入。
  要調高其中一個，必須同時看另一個，否則會撞到 KV 額度、連計數器都寫不進去（等於上限失效）。
- **`fetch.js` 擋 IP 字面量／localhost／`.local`／`.internal` 是防禦縱深，不是主要防線**
  （Workers 平台本身連不到私有網段）。IP 一律擋是刻意從簡：正常新聞網址都是網域名，
  擋掉整類就不必維護私有網段清單。
- **計數時機兩邊刻意不同**：`embed.js` 只在 AI 呼叫**成功後**才 +N；
  `fetch.js` **不論成敗都 +1**，因為代抓失敗時很可能已經燒掉一次 Jina 呼叫。
- KV 的鍵是 `embed:YYYY-MM-DD` / `fetch:YYYY-MM-DD`，**以 UTC 日期切**（不是台灣時間），
  `expirationTtl` 172800 自動清。使用者反映「上限提早／延後重置」時先想到這件事。

### 已知取捨：計數沒有原子性

先讀後寫，並發下會少算。**這是刻意接受的**——用「上限遠低於實際額度」的安全邊際吸收誤差
（900 段遠低於每天 10,000 Neurons）。要嚴格擋得換成 Durable Object，對這個站不划算。
不要為了「修掉這個 race」引入 DO 而讓架構變重。

`embed.js` 失敗時**只回固定錯誤碼、不轉傳原始訊息**（2026-08-27）：
Workers AI 的錯誤字串可能帶模型名與額度狀態，而前端只看狀態碼就切本機模型，message 本來就沒人讀。

## 地雷

### `lib/sdgEmbeddingsCloud.json` 是手工產物，repo 裡沒有產生器

17 項 SDG 的雲端向量已預先算好（`{"model":"@cf/baai/bge-m3","dim":1024}`），
執行時只算「這篇新聞」一個向量再做 cosine similarity——這是省額度的關鍵。

⚠ **但雲端路徑用的是這份烘焙好的 JSON，本機路徑（MiniLM）卻是每次即時重算 `sdgTexts()`。**
所以改了 `lib/sdgs.js` 的 `SDG_DESCRIPTIONS` 或 `name`：本機路徑立刻跟上，**雲端路徑不會**，
兩條路的判斷結果會悄悄不一致，而且**不會有任何錯誤**，只是分數變得有點怪。
repo 裡**沒有重算腳本**（當初是用 `node -e` 一次性跑出來的），要改描述文字就得自己重跑一次
Workers AI 產生新的 JSON。換掉 bge-m3 也一樣——`model` 欄位只是註記，程式不會驗。

### `npm run dev` 下的語意模式會靜默下載 120MB 模型

`next dev` 沒有 `/api/embed`，`classifySemantic` 的 `res.ok` 為假就直接落到瀏覽器本機 MiniLM
（`lib/localSemantic.js`）。畫面上只會出現「已自動改用本機模型」的提示，看起來像正常降級，
其實是你根本沒測到雲端路徑。**要驗雲端語意一定要 `npm run preview`。**

### Gemini 的 `score >= 40` 寫在兩個地方

`lib/prompt.js` 的提示語叫模型「只回傳 score >= 40」，`lib/geminiClient.js` 又 `.filter(r => r.score >= 40)` 一次。
提示語只是請求、過濾才是保證，所以兩個都要留；**要改門檻必須兩處一起改**，只改一邊會得到不一致的行為。

語意層的門檻是另一組：`lib/localSemantic.js` 的 `ABS_FLOOR = 0.4`（絕對下限）、
`REL_DELTA = 0.08`（與最高分的容許差距）、`MAX_RESULTS = 4`，雲端與本機共用 `finalize()`。
跟 Gemini 的 40 分沒有關係，別互相「統一」。

### Gemini 模型清單是動態偵測的

`getCandidateModels()` 會即時問 Google ListModels、用 `scoreModel()` 排序挑最新的 flash，
`FALLBACK_MODELS` 只是連不到時的靜態後備。所以**「模型換代了要改程式」通常是假需求**，
排序規則壞了才需要動 `scoreModel()`。快取只在同一個分頁的 session 內。

### `.env.local` 有真的金鑰，不可 commit

範本是 `.env.local.example`。`.gitignore` 已含 `.env*.local`。
（但見下面「現況與文件不符」——目前程式其實沒有讀它。）

### `.wrangler/` 是本機狀態

2026-08-23 已移出版控並加進 `.gitignore`。看到它出現在 `git status` 就是 ignore 沒生效，不要重新加回去。

## 套件：不要修，除非時機到了

### ⚠ 絕對不要在這個 repo 跑 `npm audit fix`

2026-08-11 踩過：它會把 `wrangler` 升版、`miniflare` 換成 **5.x alpha**。
那兩個是**唯一的部署工具與本機 Functions 引擎**——壞掉等於既不能部署、也不能在本機驗證，
而這個 repo 沒有測試可以接住你。目前鎖在 wrangler 4.102.0 / miniflare 4.x。

要修單一套件請用 `package.json` 的 **`overrides`**（`protobufjs: ^7.6.5` 就是這樣精準修掉的）。

### npm audit 的判讀留帳（避免下次重新緊張）

`npm audit --omit=dev` 目前約 **7 high**：`sharp`（libvips CVE ×4）、`next` 本身 8 個 advisory、
`postcss`、`nanoid`。**全部判讀為不修。**

理由：這些 advisory 攻擊的全是「**執行中的 Next server**」（Server Actions DoS／SSRF、
快取混淆、Image Optimization API、Server Function 端點外洩）或建置期路徑，
而本站是 `output: 'export'` 純靜態匯出，**線上沒有 Next 程序可以被攻擊**；
`sharp`／`postcss` 只在本機建置時跑，輸入來自自己的 repo。實際暴露面接近零。

**觸發點**：等 `miniflare` 5.x 脫離 alpha，再把 wrangler + miniflare + next 一起整批升級，
sharp 那一串會自然被帶掉。在那之前每次看到 audit 報紅，回來看這一段就好，不用重新調查。

## 現況與文件不符（已知，尚未處理）

- **`.env.local` / `.env.local.example` 是遺留物**：全 repo 沒有任何一處讀 `process.env`
  （已 grep 確認）。範本教人把 Gemini 金鑰填進 `.env.local`，但那把金鑰**不會被任何程式使用**——
  純粹是一把躺在硬碟上的金鑰。要嘛刪掉範本，要嘛在範本裡註明只是備忘。動之前先問。
- **UI 文案還留著已移除的第四種模式**：`app/page.js` 的 footer 寫「三種判斷模式：Gemini 雲端 /
  本地語意 / **本地 LLM**」，錯誤訊息也提到「本地 LLM」，但 `ENGINES` 只剩 `auto` / `gemini` / `semantic`。
  「本地 LLM」（需下載約 1GB）已經拿掉了，文案沒跟上。
- **TECH.md 說 `sdgs-news.pages.dev`「仍可用」**——自 2026-08-23 起它會 301 轉到正式網址，
  嚴格說是「仍可連、但會被轉走」。
- **TECH.md 的「套件安全決策（2026-08-11）」數字已過時**：當時是 8 個漏洞
  （protobufjs + sharp ×7），現在 advisory 清單長出了 next／postcss／nanoid。**結論不變、數字要重讀。**
- README 說 `npm run deploy` 等同 `wrangler pages deploy out`，實際是
  `wrangler pages deploy --commit-dirty=true`（目錄來自 `wrangler.toml`）。行為相同，寫法不同。

## 收尾慣例

- 動了功能面 → 同步 README 的三層判斷表與檔案結構表、TECH.md 的檔案對照表。
- 動了 `DAILY_CAP`、門檻值、模型名 → README／TECH.md 裡都有寫死的數字，一起改。
- 重大取捨（像上面的「不修 audit」「不上 Durable Object」）→ 寫進這份 CLAUDE.md 的留帳，
  不要只留在 commit message 裡。
