// 瀏覽器端直接呼叫 Gemini(使用者自己的金鑰),金鑰完全不經過任何伺服器。
// 用原生 fetch,不依賴 Node SDK,方便打包成純靜態網站。
import { SDGS } from './sdgs.js';
import { buildSdgPrompt } from './prompt.js';

// 靜態後備清單:當「自動偵測」失敗(例如連不到 ListModels)時才使用。
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest',
];

// 偵測到的可用模型清單(同一個分頁的 session 內快取,避免每次都重抓)
let cachedCandidates = null;

// 動態詢問 Google:這把金鑰「現在」能用哪些支援 generateContent 的模型,
// 自動挑最新的 flash 來用。未來 Google 換代也不必改程式。
async function getCandidateModels(key) {
  if (cachedCandidates) return cachedCandidates;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`
    );
    if (!res.ok) throw new Error('ListModels HTTP ' + res.status);
    const data = await res.json();

    const usable = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((n) => n.startsWith('gemini'));

    // 依「適合度」排序:優先 flash、版本越新越好、穩定版優先於 exp/preview
    const ranked = usable
      .map((n) => ({ n, s: scoreModel(n) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.n);

    // 動態結果排前面,再接靜態後備(去重)
    const merged = [...ranked, ...FALLBACK_MODELS].filter(
      (v, i, arr) => arr.indexOf(v) === i
    );
    cachedCandidates = merged.slice(0, 8); // 最多嘗試 8 個,避免失敗時試太久
    return cachedCandidates;
  } catch {
    // 偵測失敗就用靜態清單
    return FALLBACK_MODELS;
  }
}

function scoreModel(name) {
  let s = 0;
  const isFlash = name.includes('flash');
  const isPro = name.includes('pro');
  if (isFlash) s += 1000;
  else if (isPro) s += 500; // 沒有 flash 時退而用 pro
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/); // 版本號
  if (m) s += parseFloat(m[1]) * 100;
  if (name.includes('lite')) s -= 40; // 一般 flash 優先於 flash-lite
  if (/(exp|preview|thinking|image|tts|audio|vision)/.test(name)) s -= 300; // 偏好穩定的文字模型
  return s;
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'INTEGER' },
      score: { type: 'INTEGER' },
      reason: { type: 'STRING' },
    },
    required: ['id', 'score', 'reason'],
  },
};

export async function classifyWithGemini(text, apiKey) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('NO_API_KEY');

  const prompt = buildSdgPrompt(text);
  let lastError = null;

  const candidates = await getCandidateModels(key);
  for (const model of candidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        lastError = new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        continue; // 換下一個模型
      }

      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) {
        lastError = new Error('模型沒有回傳內容');
        continue;
      }

      const parsed = JSON.parse(raw);
      return { results: normalize(parsed), model };
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(
    `所有模型都呼叫失敗,請確認 API 金鑰是否正確且已啟用。最後錯誤:${lastError?.message || '未知'}`
  );
}

function normalize(parsed) {
  return (Array.isArray(parsed) ? parsed : [])
    .filter((r) => r && typeof r.id === 'number' && r.score >= 40)
    .map((r) => {
      const sdg = SDGS.find((s) => s.id === r.id);
      return sdg
        ? { id: r.id, name: sdg.name, en: sdg.en, color: sdg.color, score: r.score, reason: r.reason }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4); // 安全網:最多 4 項,避免一次掛太多
}
