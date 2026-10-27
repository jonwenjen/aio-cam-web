// 發色推薦（spec §7.5.3、N42）。規則表起始值由計畫釘死，同步寫在 docs/looks.md；M3 以 S21 校準。
import { BUILTIN, ORDER } from './builtin.js';

export const RULES = Object.freeze({
  asshot: { base: 0.30, w: {} },
  natural: { base: 0.35, w: { portrait: 0.3, overcast: 0.2 } },
  hiyori: { base: 0.20, w: { portrait: 0.5, green: 0.4, backlit: 0.4, overcast: 0.3 } },
  streetscape: { base: 0.20, w: { highContrast: 0.4, overcast: 0.3, night: 0.2 } },
  heritage: { base: 0.20, w: { golden: 0.6, indoorWarm: 0.4, portrait: 0.2 } },
  clearview: { base: 0.20, w: { sky: 0.7, green: 0.2, blueHour: 0.3 } },
  chiaroscuro: { base: 0.15, w: { neon: 0.6, night: 0.4, highContrast: 0.3, blueHour: 0.2 } },
});

const DIVERSITY = 0.8;

/** @returns {{ lookId:string, score:number, reasonScene:string }[]} 同樣輸入結果固定 */
export function recommend(stats, { personal = null, k = 3 } = {}) {
  void personal; // N44（M5）
  const scored = ORDER.map((lookId, order) => {
    const rule = RULES[lookId];
    let score = rule.base, reasonScene = 'general', top = 0.1;
    for (const [scene, w] of Object.entries(rule.w)) {
      const c = (stats.scenes[scene] ?? 0) * w;
      score += c;
      if (c > top) { top = c; reasonScene = scene; }
    }
    return { lookId, score: Number(score.toFixed(6)), reasonScene, order };
  }).sort((a, b) => b.score - a.score || a.order - b.order);

  // 多樣性：第 2、3 名和第 1 名同家族，且有其他家族的分數在第 1 名的 80% 以內時，改放那組
  const family = id => BUILTIN[id].family;
  const first = scored[0];
  const picks = [first];
  while (picks.length < Math.min(k, scored.length)) {
    const rest = scored.filter(x => !picks.includes(x));
    let next = rest[0];
    if (family(next.lookId) === family(first.lookId)) {
      const alt = rest.find(x => family(x.lookId) !== family(first.lookId) && x.score >= DIVERSITY * first.score);
      if (alt) next = alt;
    }
    picks.push(next);
  }
  return picks.map(({ lookId, score, reasonScene }) => ({ lookId, score, reasonScene }));
}
