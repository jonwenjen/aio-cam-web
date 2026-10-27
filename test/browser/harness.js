// 瀏覽器測試頁共用工具。頁面完成時呼叫 report()，tools/run-browser.mjs 讀 window.__result。
import { analyze } from '../../js/io/jpeg.js';

export function report(pass, details) {
  window.__result = { pass: !!pass, details };
  const pre = document.createElement('pre');
  pre.textContent = (pass ? 'PASS\n' : 'FAIL\n') + JSON.stringify(details, null, 2);
  document.body.append(pre);
}

/** 執行測試函式；丟錯即 FAIL。fn 回傳 details（可含 pass:false）。 */
export async function run(fn) {
  try {
    const details = await fn();
    report(details?.pass !== false, details);
  } catch (e) {
    report(false, { error: String(e?.stack ?? e) });
  }
}

export function check(cond, msg) {
  if (!cond) throw new Error('check failed: ' + msg);
}

/** 讀圖、縮到長邊 maxLong、以 P3 讀出像素。JPEG 只餵主圖給解碼器（絕不讓瀏覽器解碼增益圖）。 */
export async function loadImageData(url, maxLong = 768) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) bytes = bytes.subarray(0, analyze(bytes).primaryEnd);
  const blob = new Blob([bytes]);
  const probe = await createImageBitmap(blob);
  const s = Math.min(1, maxLong / Math.max(probe.width, probe.height));
  const w = Math.round(probe.width * s), h = Math.round(probe.height * s);
  probe.close();
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: 'from-image' });
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, w, h, { colorSpace: 'display-p3' });
}

export function toImageData({ width, height, data }) {
  return new ImageData(new Uint8ClampedArray(data), width, height, { colorSpace: 'display-p3' });
}

/** 轉 90°（順時針），給缺私人照片時的替代圖 */
export function rotate90({ width, height, data }) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = height - 1 - y, ny = x;
    out.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (ny * height + nx) * 4);
  }
  return new ImageData(out, height, width, { colorSpace: 'display-p3' });
}
