// 重組輸出 JPEG（spec §8.3.2 B 法）：新主圖＋原中繼資料＋逐位元組照抄的增益圖，並自我檢查。
import { concat } from './bytes.js';
import { segments, analyze, parseMPF, buildMPF, iccBytes, scanBody } from './jpeg.js';

const ICC_ID = 'ICC_PROFILE\0';
const ICC_CHUNK = 65519; // 65535 − 2（長度）− 12（ID）− 2（序號）

/** 依 ICC_PROFILE 規則切成多段 APP2。 */
export function iccApp2(icc) {
  const n = Math.ceil(icc.length / ICC_CHUNK);
  const out = [];
  for (let i = 0; i < n; i++) {
    const part = icc.subarray(i * ICC_CHUNK, (i + 1) * ICC_CHUNK);
    const len = 2 + 12 + 2 + part.length;
    const head = new Uint8Array(4 + 12 + 2);
    head.set([0xFF, 0xE2, len >> 8, len & 0xFF], 0);
    for (let k = 0; k < 12; k++) head[4 + k] = ICC_ID.charCodeAt(k);
    head[16] = i + 1; head[17] = n;
    out.push(concat(head, part));
  }
  return out;
}

/**
 * 版面：SOI → APP1 Exif → APP1 XMP… → APP2 ICC… → APP2 MPF（有增益圖時）→ APP2 ISO 21496… → 主圖掃描資料 → 增益圖。
 * encodedPrimary 的 APP0（JFIF）、APP1 不帶入；它的 ICC 重新切段寫入。APP10:AROT 不帶入。
 */
export function assembleJpeg({ encodedPrimary, app1Exif, app1Xmp = [], iso21496 = [], gainMap = null }) {
  const p = segments(encodedPrimary, 0);
  const icc = iccBytes(encodedPrimary, p.segs);
  const body = scanBody(encodedPrimary, p.segs, p.end);
  const before = [new Uint8Array([0xFF, 0xD8]), ...(app1Exif ? [app1Exif] : []), ...app1Xmp, ...(icc ? iccApp2(icc) : [])];
  const lenOf = a => a.reduce((x, y) => x + y.length, 0);
  if (!gainMap) return concat(...before, ...iso21496, body);

  const mpfStart = lenOf(before);
  const primaryLen = mpfStart + buildMPF.len(2) + lenOf(iso21496) + body.length;
  // MPF 的偏移以 MPF 內 TIFF 標頭（APP2 起點 + 8）為基準；第一筆（主圖）偏移固定 0
  const mpf = buildMPF([
    { attr: 0x030000, size: primaryLen, offset: 0 },
    { attr: 0, size: gainMap.length, offset: primaryLen - (mpfStart + 8) },
  ]);
  return concat(...before, mpf, ...iso21496, body, gainMap);
}

const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 重新解析輸出：尺寸一致；有增益圖時 MPF 第二筆指到的位元組與原增益圖完全相同。 */
export function selfCheck(out, { expectGainMapBytes, expectSize }) {
  let j;
  try { j = analyze(out); } catch (e) { return { ok: false, reason: 'unparsable: ' + e.message }; }
  if (!j.sof || j.sof.w !== expectSize.w || j.sof.h !== expectSize.h) {
    return { ok: false, reason: `size ${j.sof?.w}x${j.sof?.h} != ${expectSize.w}x${expectSize.h}` };
  }
  if (!expectGainMapBytes) return j.mpf ? { ok: false, reason: 'unexpected MPF' } : { ok: true };
  if (!j.mpf) return { ok: false, reason: 'gain map: no MPF' };
  const e = parseMPF(out, j.mpf).entries[1];
  if (!e) return { ok: false, reason: 'gain map: no MPF entry' };
  if (!equalBytes(out.subarray(e.abs, e.abs + e.size), expectGainMapBytes)) {
    return { ok: false, reason: 'gain map bytes differ' };
  }
  const kinds = j.gainMap?.start === e.abs ? j.gainMap.gainKinds : [];
  if (!kinds.includes('apple') && !kinds.includes('iso21496')) return { ok: false, reason: 'gain map not recognized' };
  return { ok: true };
}
