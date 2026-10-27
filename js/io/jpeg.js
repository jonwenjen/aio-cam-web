// JPEG 區段、MPF、增益圖偵測（由 reference/spike-jpeg.js 移植）。只處理位元組，不解碼像素。
import { u16be, u32be, u16le, u32le, ascii } from './bytes.js';

const isApp = m => m >= 0xE0 && m <= 0xEF;
const isSof = m => m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
export const XMP_ID = 'http://ns.adobe.com/xap/1.0/';
export const ISO21496_ID = 'urn:iso:std:iso:ts:21496';

function idOf(u, s) {
  if (!isApp(s.marker)) return '';
  let e = s.dataStart;
  while (e < s.end && e < s.dataStart + 64 && u[e] !== 0) e++;
  return ascii(u, s.dataStart, e);
}

/** 走訪從 start 開始的一張 JPEG，回傳區段與 EOI 之後的位移。 */
export function segments(u, start = 0) {
  if (u[start] !== 0xFF || u[start + 1] !== 0xD8) throw new Error('not a JPEG at ' + start);
  const segs = [];
  let p = start + 2;
  while (p < u.length - 1) {
    if (u[p] !== 0xFF) throw new Error('bad marker byte at ' + p);
    const m = u[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    if (m === 0xD9) return { segs, end: p + 2 };
    const len = u16be(u, p + 2);
    const s = { marker: m, start: p, end: p + 2 + len, dataStart: p + 4 };
    s.id = idOf(u, s);
    segs.push(s);
    p = s.end;
    if (m === 0xDA) {
      // 熵編碼資料：跳過填充位元組與 RST 標記，直到下一個真正的標記
      while (p < u.length - 1) {
        if (u[p] === 0xFF) {
          const n = u[p + 1];
          if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { p += 2; continue; }
          if (n === 0xFF) { p++; continue; }
          break;
        }
        p++;
      }
    }
  }
  return { segs, end: u.length, truncated: true };
}

export function parseMPF(u, seg) {
  const base = seg.dataStart + 4;
  const le = u[base] === 0x49;
  const r16 = o => le ? u16le(u, o) : u16be(u, o);
  const r32 = o => le ? u32le(u, o) : u32be(u, o);
  const ifd = base + r32(base + 4);
  const n = r16(ifd);
  let count = 0, entOff = -1;
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12, tag = r16(e), cnt = r32(e + 4);
    if (tag === 0xB001) count = r32(e + 8);
    if (tag === 0xB002) entOff = cnt > 4 ? base + r32(e + 8) : e + 8;
  }
  const entries = [];
  for (let i = 0; i < count && entOff > 0; i++) {
    const e = entOff + i * 16;
    const offset = r32(e + 8);
    entries.push({ attr: r32(e), size: r32(e + 4), offset, abs: i === 0 ? 0 : base + offset });
  }
  return { base, le, entries };
}

/** 產生整段 APP2 MPF（含 FFE2 與長度），大端序。 */
export function buildMPF(entries) {
  const n = entries.length, ifdLen = 2 + 3 * 12 + 4, dataLen = 16 * n;
  const len = buildMPF.len(n);
  const b = new Uint8Array(len);
  const v = new DataView(b.buffer);
  b[0] = 0xFF; b[1] = 0xE2; v.setUint16(2, len - 2); b.set([0x4D, 0x50, 0x46, 0], 4);
  const T = 8;
  b.set([0x4D, 0x4D, 0x00, 0x2A], T); v.setUint32(T + 4, 8);
  let e = T + 8;
  v.setUint16(e, 3); e += 2;
  v.setUint16(e, 0xB000); v.setUint16(e + 2, 7); v.setUint32(e + 4, 4); b.set([0x30, 0x31, 0x30, 0x30], e + 8); e += 12;
  v.setUint16(e, 0xB001); v.setUint16(e + 2, 4); v.setUint32(e + 4, 1); v.setUint32(e + 8, n); e += 12;
  v.setUint16(e, 0xB002); v.setUint16(e + 2, 7); v.setUint32(e + 4, dataLen); v.setUint32(e + 8, 8 + ifdLen); e += 12;
  v.setUint32(e, 0); e += 4;
  for (const en of entries) { v.setUint32(e, en.attr); v.setUint32(e + 4, en.size); v.setUint32(e + 8, en.offset); e += 16; }
  return b;
}
buildMPF.len = n => 2 + 2 + 4 + 8 + (2 + 3 * 12 + 4) + 16 * n;

/** 多段 ICC_PROFILE 依序號接回。 */
export function iccBytes(u, segs) {
  const parts = segs.filter(s => s.marker === 0xE2 && s.id === 'ICC_PROFILE')
    .sort((a, b) => u[a.dataStart + 12] - u[b.dataStart + 12])
    .map(s => u.subarray(s.dataStart + 14, s.end));
  if (!parts.length) return null;
  const icc = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { icc.set(p, o); o += p.length; }
  return icc;
}

/** ICC 描述字串（desc 或 mluc），讀不到回傳 null。 */
export function iccDesc(icc) {
  try {
    const n = u32be(icc, 128);
    for (let i = 0; i < n; i++) {
      const t = 132 + i * 12;
      if (ascii(icc, t, t + 4) !== 'desc') continue;
      const off = u32be(icc, t + 4), type = ascii(icc, off, off + 4);
      if (type === 'desc') { const c = u32be(icc, off + 8); return ascii(icc, off + 12, off + 12 + c - 1); }
      if (type === 'mluc') {
        const len = u32be(icc, off + 20), so = off + u32be(icc, off + 24);
        let s = '';
        for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16be(icc, so + k));
        return s;
      }
    }
  } catch { /* 損壞的描述檔視同沒有描述 */ }
  return null;
}

/** 第一個非 APPn/COM 區段（DQT/SOF/DHT/SOS…）到 EOI。 */
export function scanBody(u, segs, end) {
  const first = segs.find(s => !isApp(s.marker) && s.marker !== 0xFE);
  return u.subarray(first.start, end);
}

function xmpText(u, segs) {
  return segs.filter(s => s.marker === 0xE1 && s.id === XMP_ID)
    .map(s => ascii(u, s.dataStart + XMP_ID.length + 1, s.end)).join('\n');
}

function gainKinds(u, segs) {
  const x = xmpText(u, segs);
  const kinds = [];
  if (/hdrgainmap/i.test(x)) kinds.push('apple');
  if (/hdrgm:/i.test(x)) kinds.push('adobe-hdrgm');
  if (segs.some(s => s.marker === 0xE2 && s.id.startsWith(ISO21496_ID))) kinds.push('iso21496');
  return kinds;
}

/** @returns {JpegInfo} */
export function analyze(u) {
  const p = segments(u, 0);
  const segs = p.segs;
  const sofSeg = segs.find(s => isSof(s.marker));
  const mpf = segs.find(s => s.marker === 0xE2 && s.id === 'MPF') ?? null;
  const info = {
    primaryEnd: p.end,
    primarySegs: segs,
    sof: sofSeg ? { w: u16be(u, sofSeg.dataStart + 3), h: u16be(u, sofSeg.dataStart + 1), comps: u[sofSeg.dataStart + 5] } : null,
    exif: segs.find(s => s.marker === 0xE1 && s.id === 'Exif') ?? null,
    xmp: segs.filter(s => s.marker === 0xE1 && s.id === XMP_ID),
    icc: iccBytes(u, segs),
    iso21496: segs.filter(s => s.marker === 0xE2 && s.id.startsWith(ISO21496_ID)),
    mpf,
    gainMap: null,
    hasAROT: segs.some(s => s.marker === 0xEA && s.id === 'AROT'),
  };

  // 其餘影像的起點：有 MPF 就照 MPF，沒有就掃描主圖之後的 SOI
  let starts = [];
  if (mpf) {
    starts = parseMPF(u, mpf).entries.slice(1).map(e => e.abs);
  } else {
    for (let i = p.end; i < u.length - 3; i++) {
      if (u[i] === 0xFF && u[i + 1] === 0xD8 && u[i + 2] === 0xFF) {
        starts.push(i);
        try { i = segments(u, i).end - 1; } catch { /* 繼續掃描 */ }
      }
    }
  }
  for (const st of starts) {
    try {
      const q = segments(u, st);
      const kinds = gainKinds(u, q.segs);
      if (!kinds.length) continue;
      const sof2 = q.segs.find(s => isSof(s.marker));
      info.gainMap = {
        start: st, end: q.end, gainKinds: kinds,
        dims: sof2 ? [u16be(u, sof2.dataStart + 3), u16be(u, sof2.dataStart + 1), u[sof2.dataStart + 5]] : null,
      };
      break;
    } catch { /* 損壞的次影像略過 */ }
  }
  return info;
}
