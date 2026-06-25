// Cloudflare Pages Function:/api/fetch
// 唯一的後端,只負責「代抓新聞網頁的內文」(解決瀏覽器跨域限制)。
// 完全不碰使用者的 API 金鑰。純 JavaScript,可在 Cloudflare Workers 環境執行。

export async function onRequestPost(context) {
  let url = '';
  try {
    const body = await context.request.json();
    url = (body.url || '').trim();
  } catch {
    return json({ error: '請求格式錯誤' }, 400);
  }

  if (!/^https?:\/\//i.test(url)) {
    return json({ error: '請輸入有效的網址(需以 http:// 或 https:// 開頭)' }, 400);
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
