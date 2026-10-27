// 發色列：依家族分段（中性／負片／正片／電影），段間有家族名；選中者 aria-pressed（spec §11.1 第 1 層）。
import { BUILTIN, ORDER } from '../looks/builtin.js';
import { t } from '../i18n/index.js';

const FAMILIES = ['neutral', 'negative', 'positive', 'cinema'];

export function renderLookStrip(container, { selected, onPick }) {
  container.replaceChildren();
  for (const family of FAMILIES) {
    const ids = ORDER.filter(id => BUILTIN[id].family === family);
    if (!ids.length) continue;
    const group = document.createElement('div');
    group.className = 'look-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(`family.${family}`));
    const label = document.createElement('span');
    label.className = 'look-family';
    label.textContent = t(`family.${family}`);
    label.setAttribute('aria-hidden', 'true');
    group.append(label);
    for (const id of ids) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'look';
      b.dataset.look = id;
      b.setAttribute('aria-pressed', String(id === selected));
      b.innerHTML = '<span class="look-name"></span><span class="look-traits"></span>';
      b.querySelector('.look-name').textContent = t(`look.${id}.name`);
      b.querySelector('.look-traits').textContent = t(`look.${id}.traits`);
      b.addEventListener('click', () => onPick(id));
      group.append(b);
    }
    container.append(group);
  }
}

export function markSelectedLook(container, selected) {
  for (const b of container.querySelectorAll('[data-look]')) b.setAttribute('aria-pressed', String(b.dataset.look === selected));
}
