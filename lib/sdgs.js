// 17 項 SDGs 的資料:編號、中文名稱、官方代表色、以及用於快速比對的關鍵字。
// 關鍵字用於「快篩」(不需 API 也能跑),Gemini 則負責語意上的精修判斷。

export const SDGS = [
  {
    id: 1,
    name: '消除貧窮',
    en: 'No Poverty',
    color: '#E5243B',
    keywords: ['貧窮', '貧困', '弱勢', '低收入', '社會救助', '脫貧', '經濟弱勢', '街友', '遊民', '貧富差距', '急難救助'],
  },
  {
    id: 2,
    name: '消除飢餓',
    en: 'Zero Hunger',
    color: '#DDA63A',
    keywords: ['飢餓', '糧食', '農業', '營養', '糧荒', '食物銀行', '剩食', '永續農業', '小農', '溫飽', '飢荒'],
  },
  {
    id: 3,
    name: '良好健康與福祉',
    en: 'Good Health and Well-being',
    color: '#4C9F38',
    keywords: ['健康', '醫療', '疾病', '疫苗', '疫情', '心理健康', '長照', '醫院', '死亡率', '公共衛生', '保健', '藥物'],
  },
  {
    id: 4,
    name: '優質教育',
    en: 'Quality Education',
    // 註:刻意「不」放入「學校 / 學生 / 校園 / 教學 / 課程」等場域字,
    // 因為大學新聞篇篇都有,會造成 SDG 4 過度命中、蓋掉其他訊號。
    // 只保留代表「教育本身就是主題」的字:就學機會、平權、弱勢、學習成效等。
    color: '#C5192D',
    keywords: ['識字', '獎學金', '助學金', '技職', '終身學習', '推廣教育', '數位學習', '課輔', '補救教學', '就學機會', '教育平權', '失學', '偏鄉教育', '弱勢學生', '學習落差', '城鄉差距', '教學創新', '素養教育'],
  },
  {
    id: 5,
    name: '性別平等',
    en: 'Gender Equality',
    color: '#FF3A21',
    keywords: ['性別', '婦女', '女性', '性別平等', '性騷擾', '性暴力', '同工同酬', '女權', '兩性', '歧視女性', '母職'],
  },
  {
    id: 6,
    name: '潔淨水與衛生',
    en: 'Clean Water and Sanitation',
    color: '#26BDE2',
    keywords: ['用水', '水資源', '淨水', '污水', '飲用水', '環境衛生', '缺水', '水質', '河川污染', '節水', '下水道', '汙水處理'],
  },
  {
    id: 7,
    name: '可負擔的潔淨能源',
    en: 'Affordable and Clean Energy',
    color: '#FCC30B',
    keywords: ['能源', '電力', '再生能源', '太陽能', '風力', '綠能', '發電', '電價', '節能', '光電', '儲能', '核能'],
  },
  {
    id: 8,
    name: '尊嚴就業與經濟成長',
    en: 'Decent Work and Economic Growth',
    color: '#A21942',
    // 移除「工作 / 產業」等過於通用的字,避免任何新聞都命中。
    keywords: ['就業', '失業', '勞工', '薪資', '經濟成長', 'GDP', '勞動', '創業', '加班', '職場', '裁員', '勞權', '最低工資', '勞動權益'],
  },
  {
    id: 9,
    name: '產業創新與基礎建設',
    en: 'Industry, Innovation and Infrastructure',
    color: '#FD6925',
    // 移除「網路 / 數位」等通用字(常與數位學習等混淆)。
    keywords: ['創新', '基礎建設', '製造業', '研發', '工業', '半導體', '智慧製造', '專利', '研究計畫', '論文', '科技部', '國科會', '技術移轉', '新創', '研究中心', '實驗室', '產學合作', '發明', '研究成果', '期刊'],
  },
  {
    id: 10,
    name: '減少不平等',
    en: 'Reduced Inequalities',
    color: '#DD1367',
    keywords: ['不平等', '歧視', '移工', '移民', '身心障礙', '原住民', '社會包容', '弱勢族群', '城鄉差距', '平權', '族群'],
  },
  {
    id: 11,
    name: '永續城市與社區',
    en: 'Sustainable Cities and Communities',
    color: '#FD9D24',
    keywords: ['城市', '都市', '社區', '住宅', '交通', '公共運輸', '都更', '空污', '居住', '城鄉', '韌性城市', '古蹟'],
  },
  {
    id: 12,
    name: '負責任的消費與生產',
    en: 'Responsible Consumption and Production',
    color: '#BF8B2E',
    keywords: ['回收', '減廢', '循環經濟', '永續消費', '塑膠', '一次性', '資源回收', '浪費', '碳足跡', '綠色生產', '廢棄物'],
  },
  {
    id: 13,
    name: '氣候行動',
    en: 'Climate Action',
    color: '#3F7E44',
    keywords: ['氣候', '暖化', '碳排', '減碳', '溫室氣體', '淨零', '碳中和', '極端氣候', '氣候變遷', '碳費', '減排'],
  },
  {
    id: 14,
    name: '水下生命',
    en: 'Life Below Water',
    color: '#0A97D9',
    keywords: ['海洋', '海洋生態', '漁業', '珊瑚', '海洋污染', '過度捕撈', '海廢', '魚類', '海岸', '紅樹林', '海龜'],
  },
  {
    id: 15,
    name: '陸域生命',
    en: 'Life on Land',
    color: '#56C02B',
    keywords: ['森林', '生物多樣性', '棲地', '物種', '濫伐', '保育', '野生動物', '荒漠化', '瀕危', '生態系', '植樹', '土地復育'],
  },
  {
    id: 16,
    name: '和平正義與健全制度',
    en: 'Peace, Justice and Strong Institutions',
    color: '#00689D',
    // 移除「政府 / 治理 / 透明」等通用字(任何校務、計畫新聞都可能命中)。
    keywords: ['司法', '貪腐', '人權', '法治', '犯罪', '暴力', '衝突', '法院', '反貪', '轉型正義', '社會正義', '廉政', '人權保障', '言論自由'],
  },
  {
    id: 17,
    name: '夥伴關係',
    en: 'Partnerships for the Goals',
    color: '#19486A',
    // 移除「合作 / 交流 / 簽署 / MOU / 姊妹校 / 結盟」等通用字,
    // 否則學校每則合作新聞都會被掛上 SDG 17。只保留「為了推動永續而跨部門/跨國協力」的字。
    keywords: ['國際合作', '公私協力', '產官學', '跨國合作', '國際援助', 'ODA', '永續發展夥伴', '跨部門合作', '國際組織', '聯合國', '南向政策'],
  },
];

// 用關鍵字快速比對文章,回傳每個 SDG 的命中關鍵字與分數。
export function keywordMatch(text) {
  const lower = text.toLowerCase();
  return SDGS.map((sdg) => {
    const matched = sdg.keywords.filter((kw) => lower.includes(kw.toLowerCase()));
    return {
      id: sdg.id,
      name: sdg.name,
      en: sdg.en,
      color: sdg.color,
      matched,
      // 簡單評分:每命中一個關鍵字 +1,最後正規化到 0-100 給前端參考。
      hits: matched.length,
    };
  });
}

export function getSdg(id) {
  return SDGS.find((s) => s.id === id);
}
