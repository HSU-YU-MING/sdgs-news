#!/usr/bin/env node
/**
 * 重新產生 lib/sdgEmbeddingsCloud.json——17 項 SDG 的「雲端路徑」預算向量。
 *
 * 為什麼需要這支:
 *   雲端語意路徑(lib/localSemantic.js)用的是這份**烘焙好的** JSON,
 *   本機 MiniLM 路徑卻是每次即時重算 sdgTexts()。
 *   所以改了 lib/sdgs.js 的 SDG_DESCRIPTIONS 或 name,本機立刻跟上、雲端不會,
 *   兩條路的判斷結果會悄悄不一致,而且**不會有任何錯誤訊息**,只是分數變得有點怪。
 *   → 改完 lib/sdgs.js 就回來跑這支。
 *
 * ─────────────────────────────────────────────────────────────
 * 怎麼跑(兩條路,擇一)
 * ─────────────────────────────────────────────────────────────
 *
 * A) 用 Cloudflare REST API(需要一把 API Token,推薦)
 *
 *      # Token 在 https://dash.cloudflare.com/profile/api-tokens 建立,
 *      # 權限只需要 Account → Workers AI → Read。Account ID 用 `npx wrangler whoami` 查。
 *      export CLOUDFLARE_ACCOUNT_ID=xxxxxxxx
 *      export CLOUDFLARE_API_TOKEN=xxxxxxxx
 *      node scripts/build-sdg-embeddings.mjs
 *
 * B) 沒有 API Token,改打一個跑起來的 /api/embed(用現成的 wrangler 登入即可)
 *
 *      # 另開一個終端機:
 *      npm run preview                 # next build && wrangler pages dev(:8788)
 *      # 然後:
 *      node scripts/build-sdg-embeddings.mjs --endpoint=http://localhost:8788/api/embed
 *
 *    ⚠ 這條路會真的消耗 Workers AI 額度(17 段),也會被 embed.js 的 DAILY_CAP 計數。
 *      指到正式站(https://sdgs.cornhsu.com/api/embed)也可以,但那會吃掉當天給使用者的額度,
 *      非必要不要這樣做。
 *
 * 其他旗標:
 *   --out=<path>   寫到別的檔案(預設 lib/sdgEmbeddingsCloud.json)
 *   --check        只重算並跟現有 JSON 比對,印出最大誤差,**不寫檔**
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 這裡的 process.env 跟本站的「金鑰紅線」不衝突,別誤會
 * ─────────────────────────────────────────────────────────────
 *   這支是**只在你自己電腦上跑的離線工具**。scripts/ 不會被 next build 打包、
 *   不會上線、線上也沒有 Node runtime 可以執行它(next.config.mjs 是 output:'export')。
 *   CLOUDFLARE_API_TOKEN 是讀你**本機 shell** 的環境變數。
 *   ⚠ 絕對不要因為看到這段就跑去 Cloudflare Pages 設環境變數——
 *     尤其**絕對不要設 GEMINI_API_KEY**(見 CLAUDE.md「金鑰紅線」那節)。
 *
 * 需求:Node >= 22.7(要靠 ESM 語法自動偵測才能 import 沒有 "type":"module" 的 lib/*.js)。
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 跟 lib/localSemantic.js 共用同一支 sdgTexts(),確保烘焙用的文字與本機路徑逐字相同。
// (刻意 import 而不是複製一份——複製就是這個 bug 的來源。)
import { sdgTexts } from '../lib/localSemantic.js';
import { SDGS } from '../lib/sdgs.js';

// 必須與 functions/api/embed.js 用的模型一致,否則兩邊向量不在同一個空間。
const MODEL = '@cf/baai/bge-m3';
const DIM = 1024;

// functions/api/embed.js 的 MAX_TEXTS,走 --endpoint 時要照著分批。
const ENDPOINT_BATCH = 4;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(ROOT, 'lib/sdgEmbeddingsCloud.json');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const texts = sdgTexts();

  if (texts.length !== SDGS.length) {
    fail(`sdgTexts() 回傳 ${texts.length} 段,但 SDGS 有 ${SDGS.length} 項——對不起來。`);
  }

  console.log(`要編碼 ${texts.length} 段 SDG 描述,模型 ${MODEL}`);
  console.log(`  第 1 段預覽:${texts[0].slice(0, 40)}…`);

  return embedAll(texts, args).then((raw) => {
    const vectors = {};
    raw.forEach((vec, i) => {
      if (!Array.isArray(vec) || vec.length !== DIM) {
        fail(`第 ${i + 1} 段的向量維度是 ${vec?.length},預期 ${DIM}。模型換掉了嗎?`);
      }
      // 執行時是 dot(正規化過的文章向量, 這裡的向量),所以這裡必須是單位向量。
      // 小數點後 6 位:檔案大小與精度的取捨,沿用原始烘焙檔的做法。
      vectors[SDGS[i].id] = normalize(vec).map((x) => Number(x.toFixed(6)));
    });

    const payload = { model: MODEL, dim: DIM, vectors };

    if (args.check) {
      report(payload, DEFAULT_OUT);
      return;
    }

    const out = args.out ? resolve(process.cwd(), args.out) : DEFAULT_OUT;
    try {
      report(payload, out);
    } catch {
      /* 舊檔不存在或壞掉就跳過比對 */
    }
    // 單行 minified、結尾不加換行——與原始檔一致,避免無意義的全檔 diff。
    writeFileSync(out, JSON.stringify(payload), 'utf8');
    console.log(`\n已寫入 ${out}`);
    console.log('提醒:雲端路徑要 `npm run preview` 才驗得到(`npm run dev` 會靜默落到本機模型)。');
  });
}

// ---------- 取向量 ----------

async function embedAll(texts, args) {
  if (args.endpoint) return embedViaEndpoint(texts, args.endpoint);
  return embedViaRest(texts);
}

// A) Cloudflare REST API
async function embedViaRest(texts) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    fail(
      '缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN。\n' +
        '  設好這兩個環境變數再跑一次,或改用 --endpoint=<跑起來的 /api/embed 網址>。\n' +
        '  詳見本檔開頭的說明。'
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;
  console.log('  來源:Cloudflare REST API');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    fail(`Workers AI 回 ${res.status}:${JSON.stringify(body?.errors ?? body)?.slice(0, 400)}`);
  }
  return pickEmbeddings(body?.result) ?? fail('看不懂 REST 回應的形狀。');
}

// B) 打一個跑起來的 /api/embed(照 MAX_TEXTS 分批)
async function embedViaEndpoint(texts, endpoint) {
  console.log(`  來源:${endpoint}(每批 ${ENDPOINT_BATCH} 段)`);
  const all = [];
  for (let i = 0; i < texts.length; i += ENDPOINT_BATCH) {
    const batch = texts.slice(i, i + ENDPOINT_BATCH);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: batch }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // embed.js 只回固定錯誤碼:daily-cap / ai-failed / no-ai-binding …
      fail(
        `/api/embed 回 ${res.status} ${JSON.stringify(body)}(第 ${i + 1}-${i + batch.length} 段)。\n` +
          '  no-ai-binding 通常代表你跑的是 `npm run dev` 而不是 `npm run preview`。'
      );
    }
    const vecs = pickEmbeddings(body);
    if (!vecs || vecs.length !== batch.length) fail(`第 ${i + 1} 批拿回 ${vecs?.length} 個向量,預期 ${batch.length}。`);
    all.push(...vecs);
    console.log(`  ✓ ${Math.min(i + ENDPOINT_BATCH, texts.length)}/${texts.length}`);
  }
  return all;
}

// Workers AI 的回應形狀在版本之間變過,三種都接(跟 functions/api/embed.js 一致)。
function pickEmbeddings(obj) {
  const v = obj?.data ?? obj?.embeddings ?? obj?.response;
  return Array.isArray(v) ? v : null;
}

// ---------- 工具 ----------

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// 跟現有檔案比一比,讓人一眼看出「這次重算到底改了什麼」。
function report(payload, path) {
  let old;
  try {
    old = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.log(`\n(${path} 不存在或無法解析,跳過比對)`);
    return;
  }
  let maxDelta = 0;
  let worst = null;
  for (const sdg of SDGS) {
    const a = payload.vectors[sdg.id];
    const b = old.vectors?.[sdg.id];
    if (!Array.isArray(b) || b.length !== a.length) {
      console.log(`\nSDG ${sdg.id}:舊檔沒有對應向量或長度不同`);
      maxDelta = Infinity;
      continue;
    }
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    if (d > maxDelta) {
      maxDelta = d;
      worst = sdg.id;
    }
  }
  console.log(`\n與現有 ${path} 比對:`);
  console.log(`  逐項最大絕對誤差 = ${maxDelta}${worst ? `(SDG ${worst})` : ''}`);
  if (maxDelta === 0) console.log('  → 完全相同,描述文字沒變。');
  else if (maxDelta < 1e-5) console.log('  → 只有浮點/四捨五入層級的差異,判斷結果不會變。');
  else console.log('  → 有實質差異(描述文字或模型換過了)。');
}

function parseArgs(argv) {
  const args = { endpoint: null, out: null, check: false };
  for (const a of argv) {
    if (a === '--check') args.check = true;
    else if (a.startsWith('--endpoint=')) args.endpoint = a.slice('--endpoint='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else fail(`不認得的參數:${a}`);
  }
  return args;
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

main().catch((e) => fail(e?.stack || String(e)));
