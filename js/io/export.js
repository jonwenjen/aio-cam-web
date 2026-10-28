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

/**
 * AIO_YYYYMMDD_HHMMSS_<lookId>.jpg；時間取 EXIF 拍攝時間，沒有就用 now 的本地時間。
 * 「去除全部」時一律用 now：檔名不可以洩漏拍攝時間。
 */
export function outputName(src, lookId, now = new Date(), privacy = 'keep') {
  const m = privacy === 'minimal' ? null : /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(src.meta?.dateTimeOriginal ?? '');
  const stamp = m ? `${m[1]}${m[2]}${m[3]}_${m[4]}${m[5]}${m[6]}`
    : `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `AIO_${stamp}_${lookId}.jpg`;
}

async function encodeJpeg(imageData) {
  const c = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
  if (!ctx) throw new Error('needs-downscale'); // 超過這台裝置的畫布上限
  ctx.putImageData(imageData, 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: QUALITY })).arrayBuffer());
}

/**
 * @returns {Promise<{ file: File, hdr: boolean, notice: null|'hdrSelfCheckFailed'|'exifTooLarge'|'heicNoHdr'|'downscaled', timings: Record<string, number> }>}
 */
export async function exportImage(src, recipe, { privacy = 'keep', lookId = recipe.base, engine, now = new Date(), maxPixels = Infinity } = {}) {
  const t0 = performance.now();
  const timings = {};
  const lap = (k, from) => { timings[k] = Math.round(performance.now() - from); return performance.now(); };
  const withEngine = engine ? fn => fn(engine).catch(e => { throw e?.message === 'gpu-oom' ? new Error('needs-downscale') : e; }) : renderWithRecovery;

  let hdrPath = src.kind === 'jpeg' && src.hasGainMap;
  let target;
  const notices = [];

  // 縮小重試：記憶體不足或超過裝置畫布上限（spec §10、§13）。尺寸改變就不能保留增益圖 → SDR
  const long = Math.max(src.width, src.height), short = Math.min(src.width, src.height);
  const downscale = async limit => {
    let maxLongSide = Math.floor(Math.sqrt(limit * long / short));
    while (maxLongSide * Math.round(maxLongSide * short / long) > limit) maxLongSide--; // 四捨五入後仍不可超過上限
    const bmp = await decodeUpright(src, { maxLongSide });
    hdrPath = false;
    if (!notices.includes('downscaled')) notices.push('downscaled');
    return bmp;
  };

  let t = performance.now();
  let bitmap = src.width * src.height > maxPixels ? await downscale(maxPixels) : await decodeUpright(src);
  // SDR 以實際解碼尺寸為準（HEIC 的 irot 等可能與中繼資料推算不同）；HDR 必須與存檔尺寸完全對應
  if (hdrPath && (bitmap.width !== src.width || bitmap.height !== src.height)) { hdrPath = false; notices.push('hdrSelfCheckFailed'); }
  const targetFor = bmp => hdrPath
    ? { width: src.storedWidth, height: src.storedHeight, orientation: src.orientation }
    : { width: bmp.width, height: bmp.height, orientation: 1 };
  target = targetFor(bitmap);
  t = lap('decode', t);
  let imageData, encodedPrimary;
  const renderAndEncode = async () => {
    const params = toRenderParams(recipe, { shortSide: Math.min(bitmap.width, bitmap.height) });
    imageData = await withEngine(e => e.render(bitmap, params, target));
    t = lap('render', t);
    encodedPrimary = await encodeJpeg(imageData);
    t = lap('encode', t);
  };
  try {
    await renderAndEncode();
  } catch (e) {
    if (e?.message !== 'needs-downscale') throw e;
    bitmap.close();
    bitmap = await downscale(Math.min(DOWNSCALE_PIXELS, maxPixels));
    target = targetFor(bitmap);
    await renderAndEncode();
  } finally {
    bitmap.close();
  }


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

  const file = new File([out], outputName(src, lookId, now, privacy), { type: 'image/jpeg', lastModified: now.getTime() });
  return { file, hdr: hdrPath, notice: notices[0] ?? null, timings };
}
