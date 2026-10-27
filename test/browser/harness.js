// 瀏覽器測試頁共用工具。頁面完成時呼叫 report()，tools/run-browser.mjs 讀 window.__result。

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

/** 讀圖、縮到長邊 maxLong、以 P3 讀出像素 */
export async function loadImageData(url, maxLong = 768) {
  const blob = await (await fetch(url)).blob();
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
