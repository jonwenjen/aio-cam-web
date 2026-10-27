// 多語系（spec §11）。M1 完整提供 zh-Hant 與 en；ja、zh-Hans、ko 先與 en 相同（M9 翻譯）。
export const LANGS = ['zh-Hant', 'ja', 'zh-Hans', 'en', 'ko'];
// 選單裡的語言名稱用各語言自己的寫法（慣例，不翻譯）
export const LANG_NAMES = { 'zh-Hant': '繁體中文', ja: '日本語', 'zh-Hans': '简体中文', en: 'English', ko: '한국어' };
const STORAGE_KEY = 'aio.lang';

let dict = {};
let current = 'zh-Hant';
const listeners = new Set();

function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 私密瀏覽 */ } }

/** navigator.languages 第一個符合者，否則 zh-Hant；localStorage['aio.lang'] 優先 */
export function pickLang(saved = storageGet(STORAGE_KEY), prefs = navigator.languages ?? [navigator.language]) {
  if (LANGS.includes(saved)) return saved;
  for (const p of prefs) {
    const l = String(p).toLowerCase();
    if (l.startsWith('zh')) return /hans|cn|sg/.test(l) ? 'zh-Hans' : 'zh-Hant';
    const hit = LANGS.find(x => x.toLowerCase() === l.split('-')[0]);
    if (hit) return hit;
  }
  return 'zh-Hant';
}

async function load(lang) {
  const res = await fetch(new URL(`./${lang}.json`, import.meta.url));
  return res.json();
}

export async function initI18n(lang) {
  current = LANGS.includes(lang) ? lang : pickLang();
  dict = await load(current);
  document.documentElement.lang = current;
}

export async function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  dict = await load(lang);
  current = lang;
  storageSet(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

export const getLang = () => current;
export const onLangChange = fn => listeners.add(fn);

/** t('auto.applied', { items: '…' }) */
export function t(key, vars) {
  const s = dict[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
