// SourceImage + 配方 → 輸出 JPEG File（spec §8.3.2 B 法、§8.4）。
import { decodeUpright } from './import.js';
import { buildPrimaryMetadata } from './metadata.js';
import { assembleJpeg, selfCheck } from './assemble.js';
import { toRenderParams } from '../engine/params.js';
import { renderWithRecovery } from '../engine/engine.js';
import { encodeForUrl } from '../looks/recipe.js';
import { BUILTIN } from '../looks/builtin.js';
import { VERSION } from '../version.js';

const QUALITY = 0.92;
const DOWNSCALE_PIXELS = 24e6;

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** AIO_YYYYMMDD_HHMMSS_<lookId>.jpg；時間取 EXIF 拍攝時間，沒有就用 now 的本地時間 */
export function outputName(src, lookId, now = new Date()) {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(src.meta?.dateTimeOriginal ?? '');
  const stamp = m ? `${m[1]}${m[2]}${m[3]}_${m[4]}${m[5]}${m[6]}`
    : `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `AIO_${stamp}_${lookId}.jpg`;
}

async function encodeJpeg(imageData) {
  const c = new OffscreenCanvas(imageData.width, imageData.height);
  c.getContext('2d', { colorSpace: 'display-p3' }).putImageData(imageData, 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: QUALITY })).arrayBuffer());
}

/**
 * @returns {Promise<{ file: File, hdr: boolean, notice: null|'hdrSelfCheckFailed'|'exifTooLarge'|'heicNoHdr'|'downscaled', timings: Record<string, number> }>}
 */
export async function exportImage(src, recipe, { privacy = 'keep', lookId = recipe.base, engine, now = new Date() } = {}) {
  const t0 = performance.now();
  const timings = {};
  const lap = (k, from) => { timings[k] = Math.round(performance.now() - from); return performance.now(); };
  const withEngine = engine ? fn => fn(engine).catch(e => { throw e?.message === 'gpu-oom' ? new Error('needs-downscale') : e; }) : renderWithRecovery;

  let hdrPath = src.kind === 'jpeg' && src.hasGainMap;
  let target = hdrPath
    ? { width: src.storedWidth, height: src.storedHeight, orientation: src.orientation }
    : { width: src.width, height: src.height, orientation: 1 };
  let notices = [];

  let t = performance.now();
  let bitmap = await decodeUpright(src);
  t = lap('decode', t);
  let imageData;
  try {
    const params = toRenderParams(recipe, { shortSide: Math.min(src.width, src.height) });
    imageData = await withEngine(e => e.render(bitmap, params, target));
  } catch (e) {
    if (e?.message !== 'needs-downscale') throw e;
    // 記憶體不足：以約 24MP 重新解碼並改走 SDR（尺寸改變，不能保留增益圖）
    bitmap.close();
    const long = Math.max(src.width, src.height), short = Math.min(src.width, src.height);
    const maxLongSide = Math.floor(Math.sqrt(DOWNSCALE_PIXELS * long / short));
    bitmap = await decodeUpright(src, { maxLongSide });
    hdrPath = false;
    target = { width: bitmap.width, height: bitmap.height, orientation: 1 };
    notices.push('downscaled');
    const params = toRenderParams(recipe, { shortSide: Math.min(bitmap.width, bitmap.height) });
    imageData = await withEngine(e => e.render(bitmap, params, target));
  } finally {
    bitmap.close();
  }
  t = lap('render', t);

  const encodedPrimary = await encodeJpeg(imageData);
  t = lap('encode', t);

  const baseRecipe = BUILTIN[lookId]?.recipe ?? BUILTIN.asshot.recipe;
  const meta = buildPrimaryMetadata(src, {
    privacy, encodedRecipe: await encodeForUrl(recipe, baseRecipe), software: 'AIO Cam Web ' + VERSION,
    outWidth: target.width, outHeight: target.height, outOrientation: target.orientation,
  });
  if (meta.notice) notices.push(meta.notice);

  const expectSize = { w: target.width, h: target.height };
  let out;
  if (hdrPath) {
    const u = src.bytes, j = src.jpeg;
    const gainMap = u.subarray(j.gainMap.start, j.gainMap.end);
    out = assembleJpeg({ encodedPrimary, ...meta, iso21496: j.iso21496.map(s => u.subarray(s.start, s.end)), gainMap });
    if (!selfCheck(out, { expectGainMapBytes: gainMap, expectSize }).ok) {
      // 改存 SDR：方向仍是存檔方向、EXIF 方向不變，畫面仍正確
      out = assembleJpeg({ encodedPrimary, ...meta, iso21496: [], gainMap: null });
      hdrPath = false;
      notices.unshift('hdrSelfCheckFailed');
    }
  } else {
    out = assembleJpeg({ encodedPrimary, ...meta, iso21496: [], gainMap: null });
  }
  const sdrCheck = hdrPath ? { ok: true } : selfCheck(out, { expectGainMapBytes: null, expectSize });
  if (!sdrCheck.ok) throw new Error('assemble-failed: ' + sdrCheck.reason);
  if (src.kind === 'heic') notices.push('heicNoHdr');
  lap('assemble', t);
  timings.total = Math.round(performance.now() - t0);

  const file = new File([out], outputName(src, lookId, now), { type: 'image/jpeg', lastModified: now.getTime() });
  return { file, hdr: hdrPath, notice: notices[0] ?? null, timings };
}
