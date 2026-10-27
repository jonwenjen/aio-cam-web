// Task 14 單元測試共用：產生縮圖大小的 P3 8-bit 影像
import { encodeOETF, decode8 } from '../../js/color/p3.js';
import { wbGains } from '../../js/looks/lut.js';

export const W = 256, H = 171;
const to8 = v => Math.round(encodeOETF(Math.min(1, Math.max(0, v))) * 255);

/** 每個像素由 f(x,y) 回傳線性 P3 [r,g,b] */
export function linImage(f, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y), i = (y * w + x) * 4;
    data[i] = to8(r); data[i + 1] = to8(g); data[i + 2] = to8(b); data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

export const gray = (v, w, h) => linImage(() => [v, v, v], w, h);

/** 在線性 P3 乘上增益（曝光、色偏劣化） */
export function degrade(img, mul, gains = [1, 1, 1]) {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = to8(decode8(img.data[i + c]) * mul * gains[c]);
    data[i + 3] = 255;
  }
  return { ...img, data };
}

export const warm = img => degrade(img, 1, wbGains(1000, 0));
