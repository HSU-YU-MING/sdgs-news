# SDGs 新聞分析器

貼上一篇(大學/學校)新聞的內容或網址,自動判斷它對應到哪些聯合國永續發展目標(SDGs,共 17 項)。專為校園新聞調校,會從「教學 / 研究 / 校務營運 / 社區參與」四個面向判讀。

**[線上使用](https://sdgs-news.pages.dev) · [作品介紹與開發故事](https://cornhsu.com/sdgs-news.html)**

## 架構(前端為主)

- **前端(靜態網站)**:介面 + 關鍵字快篩 + 直接呼叫 Gemini。
  使用者的 API 金鑰只存在他自己的瀏覽器(localStorage),分析時瀏覽器**直接**打給 Google,金鑰不經過任何伺服器。30 天未使用會自動清除。
- **`functions/api/fetch.js`**:唯一的後端,是一個 Cloudflare Pages Function,只負責「代抓新聞網頁內文」(解決瀏覽器跨域限制),完全不碰金鑰。

判斷邏輯:先用關鍵字快篩,再用 Gemini 做語意精修;若使用者沒填金鑰,自動退回只用關鍵字。

## 本機開發

```bash
npm install
npm run dev        # 只測「貼文字」分析(http://localhost:3000)
npm run preview    # 完整預覽,含「貼網址」代抓功能(用 Cloudflare 模擬器)
```

> 「貼文字」模式在 `npm run dev` 就能測;「貼網址」需要 Cloudflare Function,請用 `npm run preview`。

## 部署 / 更新上線

改完程式後,一行指令重新部署:

```bash
npm run deploy
```

(等同 `next build` + `wrangler pages deploy out`,上傳到 Cloudflare Pages 專案 `sdgs-news`。)

第一次在新電腦操作前需先登入:`npx wrangler login`。

## 重要:不要在伺服器設定金鑰

這是「使用者自帶金鑰」的網站。**請勿**在 Cloudflare 設定 `GEMINI_API_KEY` 環境變數,否則所有人會共用你的金鑰並由你付費。

## 調整建議

- 判斷更準:在 `lib/sdgs.js` 增補各目標關鍵字。
- 改 AI 規則 / 門檻:`lib/geminiClient.js`(提示語、`score >= 40`、模型 fallback 清單)。
- 金鑰清除天數:`lib/keyStore.js` 的 `INACTIVITY_DAYS`。

## 檔案結構

| 檔案 | 用途 |
| --- | --- |
| `app/page.js` | 前端頁面 + 分析流程(關鍵字、Gemini、組合結果) |
| `app/globals.css` | 樣式 |
| `lib/sdgs.js` | 17 項 SDGs 資料 + 關鍵字比對 |
| `lib/geminiClient.js` | 瀏覽器端呼叫 Gemini |
| `lib/keyStore.js` | 金鑰本機儲存 + 30 天清除 |
| `functions/api/fetch.js` | Cloudflare Function:代抓新聞網頁 |
