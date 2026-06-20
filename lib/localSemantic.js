// 本地語意模式:用 Transformers.js 的多語向量模型,在瀏覽器端比對
// 新聞與 17 個 SDG 描述的語意相似度。不需金鑰、不需 GPU。
import { SDGS, SDG_DESCRIPTIONS } from './sdgs.js';

// 多語向量模型(支援中文)。第一次使用會下載並快取。
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// 相似度門檻與最多回傳數(可調)
const SIM_THRESHOLD = 0.34;
const MAX_RESULTS = 5;

let extractorPromise = null;
let sdgEmbeddings = null; // 17 個 SDG 描述的向量(快取)

// 載入模型(單例)。onProgress 會收到 0-100 的下載進度。
async function getExtractor(onProgress) {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false; // 一律從網路下載(快取於瀏覽器)
    return pipeline('feature-extraction', MODEL_ID, {
      progress_callback: (p) => {
        if (onProgress && p?.status === 'progress' && typeof p.progress === 'number') {
          onProgress(Math.round(p.progress));
        }
      },
    });
  })();
  return extractorPromise;
}

async function embed(extractor, text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data); // 已正規化的向量
}

function cosine(a, b) {
  // 兩個向量都已正規化,內積即為餘弦相似度
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export async function classifyLocalSemantic(text, onProgress) {
  const extractor = await getExtractor(onProgress);

  // 第一次:先把 17 個 SDG 描述轉成向量並快取
  if (!sdgEmbeddings) {
    sdgEmbeddings = {};
    for (const sdg of SDGS) {
      const descText = `${sdg.name}。${SDG_DESCRIPTIONS[sdg.id] || ''}`;
      sdgEmbeddings[sdg.id] = await embed(extractor, descText);
    }
  }

  const docVec = await embed(extractor, text.slice(0, 4000));

  const scored = SDGS.map((sdg) => {
    const sim = cosine(docVec, sdgEmbeddings[sdg.id]);
    return {
      id: sdg.id,
      name: sdg.name,
      en: sdg.en,
      color: sdg.color,
      sim,
      score: Math.max(0, Math.min(100, Math.round(sim * 100))),
      reason: '',
    };
  }).sort((a, b) => b.sim - a.sim);

  let results = scored.filter((r) => r.sim >= SIM_THRESHOLD).slice(0, MAX_RESULTS);
  // 若沒有任何項目過門檻,至少回傳最相關的前 3 項
  if (results.length === 0) results = scored.slice(0, 3);

  return { results, model: MODEL_ID };
}
