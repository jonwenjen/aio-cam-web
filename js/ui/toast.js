// 短訊息（role=status，螢幕閱讀器會念出）。有 action 時是一顆可按的按鈕。
import { t } from '../i18n/index.js';

let host = null;

export function mountToasts(parent) {
  host = document.createElement('div');
  host.id = 'toasts';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  parent.append(host);
}

export function showToast(text, { ms = 4000, onAction } = {}) {
  if (!host) return;
  const el = document.createElement(onAction ? 'button' : 'div');
  el.className = 'toast';
  el.textContent = text;
  if (onAction) {
    el.type = 'button';
    el.addEventListener('click', () => { el.remove(); onAction(); });
  } else {
    el.title = t('toast.dismiss');
    el.addEventListener('click', () => el.remove());
  }
  host.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}
