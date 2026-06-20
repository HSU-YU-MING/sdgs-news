// Cloudflare Pages Function:/api/embed
// 用 Workers AI 的多語向量模型(bge-m3)把「文章」轉成向量。
// 內建「每日呼叫硬上限」:達標就回 429,前端自動改用瀏覽器本機模型。
// → 即使未來綁定付款方式,也不會超過免費額度、不會被扣費。

// 每日最多呼叫次數。壓在免費額度(每天 10,000 Neurons)與 KV 免費寫入上限(每天 1,000 次)之內。
// 想放寬/收緊改這個數字即可。
const DAILY_CAP = 900;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return json({ error: 'no-ai-binding' }, 503); // 無 AI 綁定 → 前端改本機
  }

  // ---- 每日上限檢查(若有 KV 綁定才啟用)----
  const dayKey = 'embed:' + new Date().toISOString().slice(0, 10); // 以 UTC 日期計
  let count = 0;
  if (env.USAGE_KV) {
    try {
      count = parseInt((await env.USAGE_KV.get(dayKey)) || '0', 10) || 0;
    } catch {
      count = 0; // 讀取失敗就當 0(避免整個雲端功能掛掉)
    }
    if (count >= DAILY_CAP) {
      // 達每日上限 → 不再呼叫 AI,改讓前端用本機(不會產生任何費用)
      return json({ error: 'daily-cap', cap: DAILY_CAP }, 429);
    }
  }

  let texts;
  try {
    texts = (await request.json()).texts;
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    return json({ error: 'no-texts' }, 400);
  }

  try {
    const resp = await env.AI.run('@cf/baai/bge-m3', { text: texts });
    const embeddings = resp?.data || resp?.embeddings || resp?.response;
    if (!Array.isArray(embeddings)) {
      return json({ error: 'unexpected-shape' }, 502);
    }

    // 成功才把今日計數 +1(寫入,2 天後自動過期)
    if (env.USAGE_KV) {
      try {
        await env.USAGE_KV.put(dayKey, String(count + 1), { expirationTtl: 172800 });
      } catch {
        /* 寫入失敗不影響本次結果 */
      }
    }

    return json({ embeddings });
  } catch (e) {
    // 額度用完 / 限流 / 其他錯誤 → 429,前端自動切本機
    return json({ error: 'ai-failed', message: String(e?.message || e).slice(0, 200) }, 429);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
