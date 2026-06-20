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

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return json({ error: '無法連線到該網址:' + e.message }, 422);
  }

  if (!res.ok) {
    return json({ error: `抓取網頁失敗(HTTP ${res.status})` }, 422);
  }

  const html = await res.text();
  const { title, text } = extract(html);

  if (!text || text.length < 50) {
    return json(
      { error: '抓到網頁了,但找不到足夠的內文(該站可能需要登入或為動態載入)。請改用「貼文字」模式。' },
      422
    );
  }

  return json({ title, text: (title ? title + '\n\n' : '') + text.slice(0, 8000) });
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
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  // 優先抓 <article>
  const article = body.match(/<article[\s\S]*?<\/article>/i);
  if (article) body = article[0];

  // 抓所有夠長的 <p>
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const t = decodeEntities(stripTags(m[1])).trim();
    if (t.length > 30) paras.push(t);
  }

  let textOut = paras.join('\n');
  if (textOut.length < 200) {
    // 退而求其次:整段去標籤
    textOut = decodeEntities(stripTags(body)).replace(/\s{2,}/g, ' ').trim();
  }

  return { title: title.trim(), text: textOut.trim() };
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
