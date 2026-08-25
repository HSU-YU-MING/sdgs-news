// Cloudflare Pages Function:/api/fetch
// 唯一的後端,只負責「代抓新聞網頁的內文」(解決瀏覽器跨域限制)。
// 完全不碰使用者的 API 金鑰。純 JavaScript,可在 Cloudflare Workers 環境執行。

// 每日代抓上限。這個端點沒有驗證,不加上限就是一個開放代理,
// 也能被灌請求燒光 Jina 閱讀模式的免費額度(見 fetchViaReader)。
// 數字要跟 KV 免費寫入額度(每天 1,000 次)一起算:embed.js 佔 900,這裡佔 100,剛好壓在預算內。
// 正常使用量遠低於此——每次「貼網址」分析最多觸發 1 次代抓。
const DAILY_CAP = 100;
const MAX_URL_LEN = 2048;

export async function onRequestPost(context) {
  let url = '';
  try {
    const body = await context.request.json();
    url = (body.url || '').trim();
  } catch {
    return json({ error: '請求格式錯誤' }, 400);
  }

  if (url.length > MAX_URL_LEN) {
    return json({ error: '網址過長' }, 400);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return json({ error: '請輸入有效的網址(需以 http:// 或 https:// 開頭)' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json({ error: '請輸入有效的網址(需以 http:// 或 https:// 開頭)' }, 400);
  }
  // 防禦縱深:擋內部/保留位址。Workers 平台本身連不到私有網段,
  // 這層是避免被拿來探測與當內容代理的順手硬化,不是主要防線。
  if (isInternalHost(parsed.hostname)) {
    return json({ error: '不支援 IP 或內部位址,請貼新聞網站的網址' }, 400);
  }

  // ---- 每日上限檢查(若有 KV 綁定才啟用;與 embed.js 同款)----
  // 已知取捨:先讀後寫、無原子性,並發下會少算。用「上限遠低於實際承受力」的安全邊際吸收。
  const dayKey = 'fetch:' + new Date().toISOString().slice(0, 10); // 以 UTC 日期計
  let count = 0;
  if (context.env.USAGE_KV) {
    try {
      count = parseInt((await context.env.USAGE_KV.get(dayKey)) || '0', 10) || 0;
    } catch {
      count = 0; // 讀取失敗就當 0(避免整個功能掛掉)
    }
    if (count >= DAILY_CAP) {
      return json(
        { error: '⏳ 「貼網址」功能今日額度已用完。請改用「貼文字」模式——複製新聞內文貼上即可,分析功能不受影響。' },
        429
      );
    }
  }

  // 1) 先嘗試直接抓取 + 萃取(快)
  let title = '';
  let text = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (res.ok) {
      const ext = extract(await res.text());
      title = ext.title;
      text = ext.text;
    }
  } catch {
    /* 連線失敗 → 交給下面的閱讀模式備援 */
  }

  // 2) 內文太少或抓取失敗 → 改用閱讀模式(Jina Reader,會執行 JS)再抓一次
  let readerStatus = null;
  if (text.length < 200) {
    const rr = await fetchViaReader(url, context.env);
    readerStatus = rr.status;
    if (rr.text.length > text.length) {
      text = rr.text;
    }
  }

  // 代抓已經做完(可能含一次 Jina 呼叫),不論結果好壞都把今日計數 +1(2 天後自動過期)
  if (context.env.USAGE_KV) {
    try {
      await context.env.USAGE_KV.put(dayKey, String(count + 1), { expirationTtl: 172800 });
    } catch {
      /* 寫入失敗不影響本次結果 */
    }
  }

  if (!text || text.length < 50) {
    let error = '抓不到足夠的內文(該站可能需要登入、有反爬蟲、或內容無法解析)。請改用「貼文字」模式。';
    if (readerStatus === 402 || readerStatus === 401) {
      error = '🔋 閱讀模式(Jina)的免費額度已用完。此站為動態載入、無法直接擷取,請改用「貼文字」模式。(若要繼續用閱讀模式,可在 Cloudflare 更換 JINA_API_KEY)';
    } else if (readerStatus === 429) {
      error = '⏳ 閱讀模式暫時達到流量上限,請稍後再試,或改用「貼文字」模式。';
    }
    return json({ error, readerStatus }, 422);
  }

  return json({ title, text: (title ? title + '\n\n' : '') + text.slice(0, 8000) });
}

// 內部/保留位址判斷:localhost 與其變體、.local/.internal 網域、以及所有 IP 字面量。
// IP 一律擋是刻意從簡——正常新聞網址都是網域名,擋掉整類就不用維護私有網段清單。
function isInternalHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (h.startsWith('[')) return true; // IPv6 字面量(URL API 的 hostname 保留中括號)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true; // IPv4 字面量
  return false;
}

// 閱讀模式備援:透過 Jina Reader 以「真瀏覽器執行 JS」的方式取得乾淨內文。
// 用於救回 JS 動態載入 / SPA / 部分被擋的網站。失敗就回空字串。
// 需設定環境變數 JINA_API_KEY(免費申請);沒設定時免金鑰呼叫會因伺服器共用 IP 被限流(429),通常無效。
async function fetchViaReader(url, env) {
  try {
    const headers = { 'X-Return-Format': 'text', Accept: 'text/plain' };
    if (env && env.JINA_API_KEY) {
      headers.Authorization = 'Bearer ' + env.JINA_API_KEY;
    }
    const r = await fetch('https://r.jina.ai/' + url, { headers });
    if (!r.ok) return { text: '', status: r.status };
    return { text: (await r.text()).trim(), status: 200 };
  } catch {
    return { text: '', status: 0 };
  }
}

// 用純字串處理萃取內文(不依賴 cheerio,Workers 環境可用)。
function extract(html) {
  // 取標題
  let title = '';
  const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogt) title = decodeEntities(ogt[1]);
  if (!title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) title = decodeEntities(stripTags(t[1]));
  }

  // 移除雜訊區塊
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ');

  // 候選區塊:每個 <article> 區塊 + 整頁;各自取 <p> 內文,挑「內文最多」的那個。
  // (避免被頁面上裝飾性的小 <article> 誤導,例如某些部落格的「閱讀文章」小區塊)
  const candidates = [];
  for (const m of cleaned.matchAll(/<article[\s\S]*?<\/article>/gi)) candidates.push(m[0]);
  candidates.push(cleaned);

  let textOut = '';
  for (const c of candidates) {
    const t = paragraphs(c);
    if (t.length > textOut.length) textOut = t;
  }

  // 仍太短 → 退而求其次:整頁去標籤
  if (textOut.length < 200) {
    textOut = decodeEntities(stripTags(cleaned)).replace(/\s{2,}/g, ' ').trim();
  }

  return { title: title.trim(), text: textOut.trim() };
}

// 從一段 HTML 取出夠長的 <p> 段落,合併成文字
function paragraphs(htmlChunk) {
  const out = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(htmlChunk)) !== null) {
    const t = decodeEntities(stripTags(m[1])).trim();
    if (t.length > 30) out.push(t);
  }
  return out.join('\n');
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
