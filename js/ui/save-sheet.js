// 輸出隱私開關：存檔鈕正上方的三段切換，永遠看得到目前選項，選擇記在 localStorage（spec §8.4、N03）。
import { t } from '../i18n/index.js';

export const PRIVACY = ['keep', 'noLocation', 'minimal'];
const KEY = 'aio.privacy';

export function loadPrivacy() {
  try { const v = localStorage.getItem(KEY); return PRIVACY.includes(v) ? v : 'keep'; } catch { return 'keep'; }
}

export function savePrivacy(v) {
  try { localStorage.setItem(KEY, v); } catch { /* 私密瀏覽 */ }
}

export function renderPrivacy(container, value, onChange) {
  container.replaceChildren();
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', t('privacy.label'));
  for (const p of PRIVACY) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg';
    b.dataset.privacy = p;
    b.textContent = t(`privacy.${p}`);
    b.setAttribute('aria-pressed', String(p === value));
    b.addEventListener('click', () => onChange(p));
    container.append(b);
  }
}
