// 配方 → 33³ LUT。所有色彩科學在 CPU 產生，GPU 只查表。公式由計畫釘死（spec 未規定），M3 金樣本可改。
import { encodeOETF, decodeOETF, enc, dec, mul3, XYZ_TO_P3, linP3ToOklab, oklabToLinP3, lumaP3, LUMA } from '../color/p3.js';

const DEG = Math.PI / 180;
const clamp01 = x => Math.min(1, Math.max(0, x));

// ---- 白平衡 ----

function daylightXY(T) {
  const x = T <= 7000
    ? -4.6070e9 / T ** 3 + 2.9678e6 / T ** 2 + 99.11 / T + 0.244063
    : -2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 247.48 / T + 0.237040;
  return [x, -3 * x * x + 2.870 * x - 0.275];
}

function whiteP3(T) {
  const [x, y] = daylightXY(T);
  return mul3(XYZ_TO_P3, [x / y, 1, (1 - x - y) / y]);
}

const WHITE_REF = whiteP3(6504);

/** temp > 0 = 變暖（同常見色溫滑桿方向）。中性灰亮度不變。 */
export function wbGains(temp, tint) {
  const T = Math.min(25000, Math.max(4000, 6504 + temp));
  const w = whiteP3(T);
  const g = [WHITE_REF[0] / w[0], WHITE_REF[1] / w[1], WHITE_REF[2] / w[2]];
  g[1] *= 1 - 0.002 * tint;
  const l = LUMA[0] * g[0] + LUMA[1] * g[1] + LUMA[2] * g[2];
  return [g[0] / l, g[1] / l, g[2] / l];
}

// ---- 影調 ----

/** 作用在顯示空間亮度 y ∈ [0,1] */
export function toneCurve(y, tone) {
  const { contrast: c = 0, highlights: h = 0, shadows: s = 0, whites: w = 0, blacks: b = 0 } = tone;
  if (c) y = y + c * (3 * y * y - 2 * y * y * y - y);
  if (h) y = y + 0.6 * h * y * y * (1 - y);
  if (s) y = y + 0.6 * s * y * (1 - y) * (1 - y);
  if (w) y = y + 0.08 * w * y * y * y;
  if (b) y = y + 0.08 * b * (1 - y) ** 3;
  return clamp01(y);
}

// ---- 色彩（OKLab） ----

const BANDS = [['red', 20], ['orange', 55], ['yellow', 100], ['green', 140], ['aqua', 195], ['blue', 255], ['purple', 300], ['magenta', 340]];
const angDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
// 容許 OKLab 來回的浮點誤差，否則剛好在色域邊界的顏色（例如 P3 純青）會被誤判而縮小彩度
const GAMUT_EPS = 1e-6;
const inGamut = c => c.every(v => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);

/** 共用核心：影調 → 飽和／鮮豔 → HSL → 分離色調 → 色域對應。p 的欄位都可省略（= 0）。 */
function transform(x, p) {
  let e = x.map(encodeOETF);
  const Y = lumaP3(e);
  const k = toneCurve(Y, p.tone) / Math.max(Y, 1e-6);
  e = e.map(v => v * k);

  let [L, a, b] = linP3ToOklab(e.map(v => decodeOETF(Math.max(0, v))));
  let C = Math.hypot(a, b);
  let h = Math.atan2(b, a) / DEG;

  C *= 1 + (p.saturation ?? 0);
  C *= 1 + (p.vibrance ?? 0) * (1 - Math.min(1, C / 0.25));

  if (p.hsl) {
    const w = BANDS.map(([, c]) => Math.max(0, 1 - angDist(h, c) / 45));
    const W = w.reduce((s, v) => s + v, 0);
    if (W > 1) for (let i = 0; i < w.length; i++) w[i] /= W;
    let dh = 0, dc = 0, dl = 0;
    BANDS.forEach(([name], i) => {
      const [hs, cs, ls] = p.hsl[name];
      dh += w[i] * hs * 30; dc += w[i] * cs; dl += w[i] * ls;
    });
    const C0 = C;
    h += dh;
    C *= 1 + dc;
    L += dl * 0.15 * Math.min(1, C0 / 0.05);
  }

  a = C * Math.cos(h * DEG);
  b = C * Math.sin(h * DEG);

  if (p.grade) {
    const Lb = clamp01(L - 0.2 * p.grade.balance);
    const ws = (1 - Lb) ** 2, wh = Lb * Lb, wm = 2 * Lb * (1 - Lb);
    for (const [w, [hue, strength]] of [[ws, p.grade.shadows], [wm, p.grade.midtones], [wh, p.grade.highlights]]) {
      a += w * strength * 0.06 * Math.cos(hue * DEG);
      b += w * strength * 0.06 * Math.sin(hue * DEG);
    }
  }

  let out = oklabToLinP3([L, a, b]);
  if (!inGamut(out)) {
    // 保持 L、h，對 C 二分縮小 8 次
    let lo = 0, hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinP3([L, a * mid, b * mid]))) lo = mid; else hi = mid;
    }
    out = oklabToLinP3([L, a * lo, b * lo]);
  }
  return out.map(clamp01);
}

/** 單一顏色的完整發色轉換（不含曝光、白平衡、暗角、顆粒）。 */
export function lookPixel(lin, recipe) {
  return transform(lin, {
    tone: recipe.tone, saturation: recipe.color.saturation, vibrance: recipe.color.vibrance,
    hsl: recipe.hsl, grade: recipe.grade,
  });
}

/** 自動影調：contrast 固定 0；只有 vibrance（saturation、hsl、grade 為 0）。 */
export function autoPixel(lin, auto) {
  if (!auto) return lin;
  return transform(lin, {
    tone: { contrast: 0, highlights: auto.highlights, shadows: auto.shadows, whites: auto.whites, blacks: auto.blacks },
    vibrance: auto.vibrance,
  });
}

/** 格點 (i,j,k)，r 最快；存 enc(mix(auto, look(auto), intensity))，alpha = 1。 */
export function buildLut(recipe, size = 33) {
  const N = size;
  const data = new Float32Array(N * N * N * 4);
  const axis = Array.from({ length: N }, (_, i) => dec(i / (N - 1)));
  const t = recipe.intensity;
  let o = 0;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = autoPixel([axis[i], axis[j], axis[k]], recipe.auto);
    const l = t > 0 ? lookPixel(a, recipe) : a;
    for (let c = 0; c < 3; c++) data[o + c] = enc(a[c] + (l[c] - a[c]) * t);
    data[o + 3] = 1;
    o += 4;
  }
  return { size: N, data };
}
