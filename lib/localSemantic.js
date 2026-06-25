// 語意模式:先用 Cloudflare Workers AI(雲端 bge-m3,免下載);
// 若雲端額度用完或失敗,自動改用瀏覽器本機向量模型(Transformers.js)。
import { SDGS, SDG_DESCRIPTIONS } from './sdgs.js';

// 瀏覽器本機備援模型(多語句向量,支援中文)。
const LOCAL_MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
// 收緊輸出:向量分數常擠在一起,只取「明顯突出」的前幾名,切掉後段雜訊。
const ABS_FLOOR = 0.4; // 絕對下限:低於此一律不算
const REL_DELTA = 0.08; // 相對門檻:與最高分差距超過此值就捨棄
const MAX_RESULTS = 4; // 最多顯示幾項

// 17 個 SDG 的描述文字(雲端與本機共用)
function sdgTexts() {
  return SDGS.map((s) => `${s.name}。${SDG_DESCRIPTIONS[s.id] || ''}`);
}

// 對外主入口:回傳 { results, model, source('cloud'|'local'), note }
export async function classifySemantic(text, onProgress) {
  const article = text.slice(0, 4000);

  // 1) 先試雲端 Workers AI(只送文章,SDG 向量用預先算好的,省額度)
  try {
    if (onProgress) onProgress({ percent: null, text: '雲端語意分析中…' });
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [article] }),
    });
    if (res.ok) {
      const { embeddings } = await res.json();
      if (Array.isArray(embeddings) && embeddings.length >= 1) {
        const { default: baked } = await import('./sdgEmbeddingsCloud.json');
        const docVec = normalizeVec(embeddings[0]);
        return finalize(
          SDGS.map((sdg) => ({ sdg, sim: dot(docVec, baked.vectors[sdg.id]) })),
          'cloud:bge-m3',
          'cloud'
        );
      }
    }
    // 非 ok(例如 429 達每日上限 / 額度用完)→ 落到本機
  } catch {
    // 網路或其他錯誤 → 落到本機
  }

  // 2) 改用瀏覽器本機模型
  const note = '雲端語意額度已滿或暫不可用,已自動改用本機模型(首次需下載約 120MB)。';
  const local = await classifyWithLocalModel(article, onProgress);
  return { ...local, note };
}

// ---------- 雲端結果整理 ----------
function finalize(scored, model, source) {
  const ranked = scored
    .map(({ sdg, sim }) => ({
      id: sdg.id,
      name: sdg.name,
      en: sdg.en,
      color: sdg.color,
      sim,
      score: Math.max(0, Math.min(100, Math.round(sim * 100))),
      reason: '',
    }))
    .sort((a, b) => b.sim - a.sim);

  const top = ranked[0]?.sim || 0;
  const cut = Math.max(ABS_FLOOR, top - REL_DELTA);
  let results = ranked.filter((r) => r.sim >= cut).slice(0, MAX_RESULTS);
  if (results.length === 0) results = ranked.slice(0, 1); // 至少給最相關的一項
  return { results, model, source };
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalizeVec(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// ---------- 瀏覽器本機模型(備援) ----------
let extractorPromise = null;
let localSdgEmbeddings = null;

async function getExtractor(onProgress) {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    return pipeline('feature-extraction', LOCAL_MODEL_ID, {
      progress_callback: (p) => {
        if (onProgress && p?.status === 'progress' && typeof p.progress === 'number') {
          onProgress({ percent: Math.round(p.progress), text: '載入本機語意模型中…' });
        }
      },
    });
  })();
  return extractorPromise;
}

async function embedLocal(extractor, text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

async function classifyWithLocalModel(article, onProgress) {
  const extractor = await getExtractor(onProgress);
  if (!localSdgEmbeddings) {
    localSdgEmbeddings = [];
    const texts = sdgTexts();
    for (let i = 0; i < SDGS.length; i++) {
      localSdgEmbeddings[i] = await embedLocal(extractor, texts[i]);
    }
  }
  const docVec = await embedLocal(extractor, article);
  return finalize(
    SDGS.map((sdg, i) => ({ sdg, sim: dot(docVec, localSdgEmbeddings[i]) })),
    LOCAL_MODEL_ID,
    'local'
  );
}
