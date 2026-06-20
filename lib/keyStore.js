// 使用者 Gemini 金鑰的本機儲存工具。
// 金鑰只存在使用者自己的瀏覽器 localStorage,不會上傳保存到伺服器。
// 規則:超過 INACTIVITY_DAYS 天未使用,下次開啟時自動清除。

const STORAGE_KEY = 'sdgs_gemini_key';
const INACTIVITY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isBrowser() {
  return typeof window !== 'undefined' && !!window.localStorage;
}

// 讀取金鑰;若已逾期未使用則清除並回傳空字串。
export function loadKey() {
  if (!isBrowser()) return '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    const data = JSON.parse(raw);
    const last = data.lastUsedAt || data.savedAt || 0;
    if (Date.now() - last > INACTIVITY_DAYS * MS_PER_DAY) {
      localStorage.removeItem(STORAGE_KEY);
      return '';
    }
    return data.key || '';
  } catch {
    return '';
  }
}

// 儲存金鑰(同時記錄存入時間)。
export function saveKey(key) {
  if (!isBrowser()) return;
  const now = Date.now();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ key: key.trim(), savedAt: now, lastUsedAt: now })
  );
}

// 更新「最後使用時間」,讓 30 天倒數重新計算。
export function touchKey() {
  if (!isBrowser()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    data.lastUsedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 忽略 */
  }
}

// 手動清除金鑰。
export function clearKey() {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_KEY);
}

// 取得到期相關資訊(給設定畫面顯示)。
export function getKeyInfo() {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const key = data.key || '';
    const last = data.lastUsedAt || data.savedAt || 0;
    const daysLeft = Math.max(0, Math.ceil(INACTIVITY_DAYS - (Date.now() - last) / MS_PER_DAY));
    return {
      masked: key ? '••••••••' + key.slice(-4) : '',
      daysLeft,
      inactivityDays: INACTIVITY_DAYS,
    };
  } catch {
    return null;
  }
}

export { INACTIVITY_DAYS };
