// CPU 參考實作：逐像素照計畫「釘死的數學」。WebGPU、WebGL2 必須與這裡一致（S6）。
// 只依賴 {width, height, data} 形狀，Node 測試可直接使用。
import { decode8, encodeOETF, enc, dec } from '../color/p3.js';
import { storedToUpright, uprightSize, grainNoise } from './params.js';

const DECODE8 = Float64Array.from({ length: 256 }, (_, v) => decode8(v));
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** LUT 三線性內插：texel 座標 = enc·(N−1) */
function sampleLut(lut, e, out) {
  const N = lut.size, d = lut.data, M = N - 1;
  const t = [0, 1, 2].map(c => Math.min(M, Math.max(0, e[c] * M)));
  const i = t.map(v => Math.min(M - 1, Math.floor(v)));
  const f = t.map((v, c) => v - i[c]);
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      if (w) acc += w * d[((i[0] + dx) + (i[1] + dy) * N + (i[2] + dz) * N * N) * 4 + c];
    }
    out[c] = acc;
  }
  return out;
}

function makeImage(w, h, data) {
  if (typeof ImageData !== 'undefined') return new ImageData(data, w, h, { colorSpace: 'display-p3' });
  return { width: w, height: h, data, colorSpace: 'display-p3' };
}

/**
 * @param src    轉正、P3 8-bit 的 {width,height,data}
 * @param target 存檔方向尺寸 {width,height,orientation}；換算回轉正後必須等於 src 尺寸
 */
export function renderCPU(src, params, target) {
  const { width: Ws, height: Hs, orientation: o } = target;
  const [W, H] = uprightSize(Ws, Hs, o);
  if (W !== src.width || H !== src.height) throw new RangeError(`target ${Ws}x${Hs}@${o} does not match source ${src.width}x${src.height}`);

  const mul = 2 ** params.exposureEV;
  const g = params.wbGains.map(v => v * mul);
  const { grain, lut } = params;
  const vig = params.vignette.amount;
  const cx = W / 2, cy = H / 2, rmax = Math.hypot(cx, cy);
  const out = new Uint8ClampedArray(Ws * Hs * 4);
  const lin = [0, 0, 0], e = [0, 0, 0], s = [0, 0, 0];

  for (let sy = 0; sy < Hs; sy++) for (let sx = 0; sx < Ws; sx++) {
    const [ux, uy] = storedToUpright(sx, sy, Ws, Hs, o);
    const si = (uy * W + ux) * 4;
    for (let c = 0; c < 3; c++) e[c] = enc(DECODE8[src.data[si + c]] * g[c]);
    sampleLut(lut, e, s);
    for (let c = 0; c < 3; c++) lin[c] = dec(s[c]);

    if (vig) {
      const r = Math.hypot(ux + 0.5 - cx, uy + 0.5 - cy) / rmax;
      const k = 1 - vig * smoothstep(0.35, 1.0, r);
      for (let c = 0; c < 3; c++) lin[c] *= k;
    }

    for (let c = 0; c < 3; c++) e[c] = encodeOETF(lin[c]);
    if (grain.amount) {
      const Y = 0.2290 * e[0] + 0.6917 * e[1] + 0.0793 * e[2];
      const k = grain.amount * 0.12 * 4 * Y * (1 - Y);
      if (grain.chroma) for (let c = 0; c < 3; c++) e[c] += k * grainNoise(ux, uy, grain, c);
      else { const n = grainNoise(ux, uy, grain, 0); for (let c = 0; c < 3; c++) e[c] += k * n; }
    }

    const di = (sy * Ws + sx) * 4;
    for (let c = 0; c < 3; c++) out[di + c] = Math.round(Math.min(1, Math.max(0, e[c])) * 255);
    out[di + 3] = 255;
  }
  return makeImage(Ws, Hs, out);
}

export class CpuEngine {
  kind = 'cpu';

  async render(src, params, target) {
    return renderCPU(await toImageData(src), params, target);
  }

  /** 沒有 GPU 時的最後退路：轉正方向、與 src 同尺寸 */
  async renderToCanvas(src, params, canvas) {
    const img = renderCPU(await toImageData(src), params, { width: src.width, height: src.height, orientation: 1 });
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d', { colorSpace: 'display-p3' }).putImageData(img, 0, 0);
  }

  dispose() {}
}

/** ImageBitmap → P3 ImageData（瀏覽器）；已是 {data} 形狀就原樣回傳 */
export async function toImageData(src) {
  if (src.data) return src;
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height, { colorSpace: 'display-p3' });
}
