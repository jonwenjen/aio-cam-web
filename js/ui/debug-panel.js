// ?debug=1：裝置能力、上次存檔各段耗時、上次匯入的場景分析摘要與自動計算時間（spec §14）。
import { t } from '../i18n/index.js';

export function mountDebugPanel(toolbar, root, getInfo) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'debug-btn';
  btn.className = 'tool';
  const panel = document.createElement('section');
  panel.id = 'debug-panel';
  panel.hidden = true;
  panel.innerHTML = '<h2></h2><pre></pre><button type="button" class="tool"></button>';
  const [h2, pre, copy] = [panel.querySelector('h2'), panel.querySelector('pre'), panel.querySelector('button')];
  const refresh = async () => { pre.textContent = JSON.stringify(await getInfo(), null, 1); };
  btn.addEventListener('click', async () => { panel.hidden = !panel.hidden; if (!panel.hidden) await refresh(); });
  copy.addEventListener('click', async () => {
    await refresh();
    try { await navigator.clipboard.writeText(pre.textContent); } catch { /* 沒有剪貼簿權限 */ }
  });
  toolbar.append(btn);
  root.append(panel);
  const label = () => { btn.textContent = t('debug.button'); h2.textContent = t('debug.title'); copy.textContent = t('debug.copy'); };
  label();
  return { label, refresh: () => (panel.hidden ? null : refresh()), destroy: () => { btn.remove(); panel.remove(); } };
}
