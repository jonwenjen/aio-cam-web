// 7 組暫定發色（M1；起始值照 spec §9.2，M3 金樣本定版）。名稱與特徵詞在 i18n，這裡只有代號。
import { normalize } from './recipe.js';

const def = (id, family, fields) => ({ id, family, recipe: normalize({ ...fields, base: id }) });
const merge = (a, b) => ({ ...a, ...b });

const T = tone => ({ tone: merge({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }, tone) });

export const BUILTIN = Object.freeze({
  asshot: def('asshot', 'neutral', {}),
  natural: def('natural', 'neutral', { ...T({ contrast: -0.05, highlights: -0.15 }), skinProtect: 0.6 }),
  hiyori: def('hiyori', 'negative', {
    ...T({ contrast: -0.15, highlights: -0.2 }),
    color: { saturation: -0.05 },
    grade: { shadows: [195, 0.35], highlights: [60, 0.15] },
    hsl: { orange: [0.05, 0.05, 0] },
  }),
  streetscape: def('streetscape', 'negative', {
    ...T({ blacks: 0.3, shadows: -0.2 }),
    color: { saturation: -0.2 },
    grade: { midtones: [240, 0.2] },
    grain: { amount: 0.35, size: 1.3 },
  }),
  heritage: def('heritage', 'positive', {
    ...T({ contrast: 0.1, shadows: -0.2 }),
    hsl: { red: [0, 0.15, 0], orange: [0, 0.1, 0], yellow: [0, 0.15, 0] },
    vignette: { amount: 0.25 },
  }),
  clearview: def('clearview', 'positive', {
    ...T({ contrast: 0.05, highlights: -0.1, whites: 0.1 }),
    hsl: { blue: [0, 0.15, -0.05], aqua: [0.15, 0.1, 0] },
  }),
  chiaroscuro: def('chiaroscuro', 'cinema', {
    ...T({ contrast: 0.15, shadows: -0.4, highlights: -0.1 }),
    color: { saturation: -0.15 },
    grade: { highlights: [60, 0.2], shadows: [240, 0.2] },
  }),
});

export const ORDER = ['asshot', 'natural', 'hiyori', 'streetscape', 'heritage', 'clearview', 'chiaroscuro'];
