// 配方 → RenderParams；方向表；顆粒雜湊與值雜訊（JS 版，與 WGSL/GLSL 逐式一致，見計畫「釘死的數學」）。
import { wbGains, buildLut } from '../looks/lut.js';

const FORMAT_SCALE = { half: 1.4, '35mm': 1.0, '120': 0.6 };

/** @returns {RenderParams}（見計畫「共用介面」） */
export function toRenderParams(recipe, { shortSide }) {
  const a = recipe.auto;
  const g = recipe.grain;
  return {
    exposureEV: recipe.tone.exposure + (a?.exposure ?? 0),
    wbGains: wbGains(recipe.wb.temp + (a?.temp ?? 0), recipe.wb.tint + (a?.tint ?? 0)),
    lut: buildLut(recipe),
    grain: {
      amount: g.amount,
      cellPx: Math.max(0.75, 1.5 * g.size * FORMAT_SCALE[g.format] * shortSide / 3024),
      roughness: g.roughness,
      chroma: g.chroma,
      seed: 7,
    },
    vignette: { amount: recipe.vignette.amount },
  };
}

/** 存檔座標 (sx,sy) → 轉正座標 (ux,uy)。Ws×Hs 是存檔尺寸。 */
export function storedToUpright(sx, sy, Ws, Hs, o) {
  switch (o) {
    case 2: return [Ws - 1 - sx, sy];
    case 3: return [Ws - 1 - sx, Hs - 1 - sy];
    case 4: return [sx, Hs - 1 - sy];
    case 5: return [sy, sx];
    case 6: return [Hs - 1 - sy, sx];
    case 7: return [Hs - 1 - sy, Ws - 1 - sx];
    case 8: return [sy, Ws - 1 - sx];
    default: return [sx, sy];
  }
}

export function uprightSize(Ws, Hs, o) {
  return o >= 5 && o <= 8 ? [Hs, Ws] : [Ws, Hs];
}

/** u32 座標雜湊 */
export function hash(x, y, s) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(s, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function h2f(h) {
  return (h >>> 8) / 16777216 * 2 - 1;
}

export function vnoise(px, py, cell, seed) {
  const qx = px / cell, qy = py / cell;
  const ix = Math.floor(qx), iy = Math.floor(qy);
  const fx = qx - ix, fy = qy - iy;
  const wx = fx * fx * (3 - 2 * fx), wy = fy * fy * (3 - 2 * fy);
  const a = h2f(hash(ix, iy, seed)), b = h2f(hash(ix + 1, iy, seed));
  const c = h2f(hash(ix, iy + 1, seed)), d = h2f(hash(ix + 1, iy + 1, seed));
  const top = a + (b - a) * wx, bot = c + (d - c) * wx;
  return top + (bot - top) * wy;
}

/** channel 0/1/2；chroma=false 時三通道相同 */
export function grainNoise(px, py, grain, channel) {
  const s = grain.seed + (grain.chroma ? 2 * channel : 0);
  const r = grain.roughness;
  return (1 - r) * vnoise(px, py, grain.cellPx, s) + r * vnoise(px, py, Math.max(1, grain.cellPx / 2), s + 1);
}
