// 瀏覽器端直接呼叫 Gemini(使用者自己的金鑰),金鑰完全不經過任何伺服器。
// 用原生 fetch,不依賴 Node SDK,方便打包成純靜態網站。
import { SDGS } from './sdgs.js';

// 多模型 fallback:依序嘗試,某個失效自動換下一個。
const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest',
];

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

function buildPrompt(text) {
  const sdgList = SDGS.map((s) => `${s.id}. ${s.name}(${s.en})`).join('\n');
  return `你是高等教育永續發展報告(SDGs)分析專家。以下是一所大學/學院的新聞稿,請判斷它對應哪些聯合國永續發展目標(SDGs)。

請依照加拿大大學 SDG 報告指南的框架,從「大學如何貢獻 SDG」的四個面向來判讀新聞:
- 教學 (Teaching):開設課程、學程、學生培育、推廣教育
- 研究 (Research):論文、研究計畫、技術發明、學術成果
- 校務營運 (Campus operations):校園節能減碳、減廢回收、無障礙與性別友善設施、永續採購
- 社區參與與對外領導 (Outreach):與政府/企業/NGO/在地社區合作、公共倡議、國際交流

17 項 SDGs 清單:
${sdgList}

判斷規則:
- 從上述四個面向思考這則新聞「實際促成了哪個 SDG」,而不只是看字面關鍵字。
  例:教授獲補助研究太陽能電池 → SDG 7(潔淨能源)+ SDG 9(研究創新);
  辦理偏鄉學童課輔 → SDG 4(優質教育)+ SDG 10(減少不平等)。

- 【重要,避免 SDG 4 過度認列】這是大學新聞,幾乎每則都發生在校園、有學生或師長參與,
  但「發生在學校 / 有學生參與 / 用上課或活動形式」本身並不構成 SDG 4。
  校園與教學只是「背景與媒介」,不是目標。請把它當背景,聚焦在新聞「真正促成的成果」屬於哪個 SDG。
  * 只有當新聞的「核心主題就是提升教育本身」時,才認列 SDG 4,例如:擴大就學機會、
    教育平權、弱勢/偏鄉教育、識字與學習成效、課程與教學法創新、終身/推廣教育、獎助學金。
  * 若核心成果是研究發現、技術發明、健康、能源、環境、產業合作等,即使它由師生完成或在課堂進行,
    也「不要」加上 SDG 4,而應認列該成果真正對應的目標。
  * 判斷原則:把「教育」這個面向先扣掉後,這則新聞還剩下什麼貢獻?那才是它真正的 SDG。

- 【避免 SDG 17 過度認列】單純的學術交流、簽 MOU、姊妹校、一般合作、出席活動,
  不要只因為「有合作」就掛 SDG 17。只有當合作的「目的明確是為了推動永續發展目標」
  (例如跨國/跨部門共同解決貧窮、氣候、健康等議題,或對開發中國家的援助)時才認列 SDG 17。
  一般合作請改認列該合作「實際要達成的那個 SDG」。

- 同理,新聞中只是提到「政府」「機關」「補助」等字,不代表就是 SDG 16 或其他目標;
  請看實質內容,不要被單一字詞觸發。

- 只列出「真正相關」的目標,不要硬湊。一篇新聞通常對應 1~3 個目標。
- score 代表相關程度(0-100),數字越高越相關。請只回傳 score >= 40 的項目。
- reason 用一句繁體中文說明這則新聞透過哪個面向對應該目標(25 字以內),
  盡量點出是教學/研究/營運/社區參與哪一類。
- 依 score 由高到低排序。

新聞內容:
"""
${text}
"""`;
}

export async function classifyWithGemini(text, apiKey) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('NO_API_KEY');

  const prompt = buildPrompt(text);
  let lastError = null;

  for (const model of MODEL_CANDIDATES) {
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
    .sort((a, b) => b.score - a.score);
}
