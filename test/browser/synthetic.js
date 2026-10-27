// 確定性的合成測試圖（P3 8-bit 位元組）。純 JS，Node 與瀏覽器都能 import。
// 瀏覽器端用 new ImageData(data, w, h, {colorSpace:'display-p3'}) 包裝。
import { oklabToLinP3, encodeOETF } from '../../js/color/p3.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG = Math.PI / 180;
const inGamut = c => c.every(v => v >= 0 && v <= 1);
const oklch = (L, C, h) => oklabToLinP3([L, C * Math.cos(h * DEG), C * Math.sin(h * DEG)]);
const to8 = lin => lin.map(v => Math.round(encodeOETF(Math.min(1, Math.max(0, v))) * 255));

/** 該色相在 L 下、P3 色域內的最大彩度 */
function maxChroma(L, h) {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inGamut(oklch(L, m, h))) lo = m; else hi = m; }
  return lo;
}

const GENERATORS = {
  // 上半水平灰階 0..255，下半 R、G、B 各一條
  ramp(w, h) {
    return (x, y) => {
      const v = Math.round((x / (w - 1)) * 255);
      if (y < h / 2) return [v, v, v];
      const band = Math.min(2, Math.floor(((y - h / 2) / (h / 2)) * 3));
      return [band === 0 ? v : 0, band === 1 ? v : 0, band === 2 ? v : 0];
    };
  },
  // OKLCh L=0.7；x = 色相 0–360°，y = 彩度 0 → 色域邊界
  hueWheel(w, h) {
    const cmax = Array.from({ length: w }, (_, x) => maxChroma(0.7, (x / w) * 360));
    return (x, y) => to8(oklch(0.7, (cmax[x] * y) / (h - 1), (x / w) * 360));
  },
  // 24 格膚色到橙紅：6 欄 L 0.45–0.85，4 列 C 0.04–0.14、h 30–70°
  skin(w, h) {
    return (x, y) => {
      const col = Math.min(5, Math.floor((x / w) * 6)), row = Math.min(3, Math.floor((y / h) * 4));
      return to8(oklch(0.45 + col * 0.08, 0.04 + row * (0.10 / 3), 30 + row * (40 / 3)));
    };
  },
  noise() {
    const rnd = mulberry32(20261027);
    return () => [rnd() * 256 | 0, rnd() * 256 | 0, rnd() * 256 | 0];
  },
};

export const SYNTHETIC_NAMES = Object.keys(GENERATORS);

export function makeSynthetic(name, w = 768, h = 512) {
  const gen = GENERATORS[name];
  if (!gen) throw new Error('unknown synthetic image ' + name);
  const px = gen(w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = px(x, y);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
