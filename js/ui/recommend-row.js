// 推薦列：3 張即時縮圖＋理由「藍天 → 清透」，點一下套用（spec §7.5.4）。
import { t } from '../i18n/index.js';

/** @returns {HTMLCanvasElement[]} 依序對應 recs 的縮圖畫布 */
export function renderRecommendRow(container, recs, { selected, onPick }) {
  container.replaceChildren();
  const title = document.createElement('h2');
  title.className = 'row-title';
  title.textContent = t('recommend.title');
  container.append(title);
  const list = document.createElement('div');
  list.className = 'rec-list';
  const canvases = [];
  for (const r of recs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rec-card';
    b.dataset.look = r.lookId;
    b.setAttribute('aria-pressed', String(r.lookId === selected));
    const c = document.createElement('canvas');
    c.className = 'rec-thumb';
    c.setAttribute('aria-hidden', 'true');
    const reason = document.createElement('span');
    reason.className = 'rec-reason';
    reason.textContent = t('reason.format', { scene: t(`reason.${r.reasonScene}`), look: t(`look.${r.lookId}.name`) });
    b.append(c, reason);
    b.addEventListener('click', () => onPick(r.lookId));
    list.append(b);
    canvases.push(c);
  }
  container.append(list);
  return canvases;
}

export function markSelectedRec(container, selected) {
  for (const b of container.querySelectorAll('.rec-card')) b.setAttribute('aria-pressed', String(b.dataset.look === selected));
}
