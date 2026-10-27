// 從 HEIC（ISOBMFF 的 Exif item）與 TIFF/DNG 取出 EXIF。只讀結構，遇到不支援的版面回傳 null。
import { u16be, u32be, ascii } from './bytes.js';
import { parseTiff } from './tiff.js';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'mif1', 'msf1']);
const DNG_VERSION = 0xC612;

/** @returns {'jpeg'|'heic'|'dng'|'other'} */
export function sniffKind(u) {
  if (u.length >= 3 && u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF) return 'jpeg';
  if (u.length >= 16 && ascii(u, 4, 8) === 'ftyp') {
    const size = Math.min(u32be(u, 0), u.length);
    const brands = [ascii(u, 8, 12)];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(u, o, o + 4));
    if (brands.some(b => HEIC_BRANDS.has(b))) return 'heic';
  }
  const tiffLE = u[0] === 0x49 && u[1] === 0x49 && u[2] === 0x2A && u[3] === 0;
  const tiffBE = u[0] === 0x4D && u[1] === 0x4D && u[2] === 0 && u[3] === 0x2A;
  if (tiffLE || tiffBE) {
    try { if (parseTiff(u).ifd0.has(DNG_VERSION)) return 'dng'; } catch { /* 壞掉的 TIFF */ }
  }
  return 'other';
}

/** TIFF/DNG 檔本身就是 TIFF。 */
export function tiffFileExif(u) {
  return u;
}

// ---- ISOBMFF ----

/** 走訪 [start, end) 內的子 box。 */
function* boxes(u, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32be(u, p);
    const type = ascii(u, p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = u32be(u, p + 8) * 2 ** 32 + u32be(u, p + 12);
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) return;
    yield { type, start: p, body: p + header, end: p + size };
    p += size;
  }
}

const child = (u, box, type, skip = 0) => {
  for (const b of boxes(u, box.body + skip, box.end)) if (b.type === type) return b;
  return null;
};

function readN(u, o, n) {
  if (n === 0) return 0;
  if (n === 2) return u16be(u, o);
  if (n === 4) return u32be(u, o);
  if (n === 8) return u32be(u, o) * 2 ** 32 + u32be(u, o + 4);
  throw new Error('bad size');
}

function metaBox(u) {
  for (const b of boxes(u, 0, u.length)) if (b.type === 'meta') return b;
  return null;
}

/** item_ID → item_type */
function itemTypes(u, meta) {
  const iinf = child(u, meta, 'iinf', 4);
  if (!iinf) return new Map();
  const v = u[iinf.body];
  const first = iinf.body + 4 + (v === 0 ? 2 : 4);
  const map = new Map();
  for (const infe of boxes(u, first, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const iv = u[infe.body];
    if (iv < 2) continue;
    const idLen = iv === 2 ? 2 : 4;
    const id = readN(u, infe.body + 4, idLen);
    map.set(id, ascii(u, infe.body + 4 + idLen + 2, infe.body + 4 + idLen + 6));
  }
  return map;
}

/** item_ID → { offset, length }（只支援 construction_method 0、單一 extent） */
function itemLocation(u, meta, wantId) {
  const iloc = child(u, meta, 'iloc', 4);
  if (!iloc) return null;
  const v = u[iloc.body];
  if (v > 1) return null;
  let p = iloc.body + 4;
  const offSize = u[p] >> 4, lenSize = u[p] & 15, baseSize = u[p + 1] >> 4, idxSize = v === 1 ? u[p + 1] & 15 : 0;
  p += 2;
  const count = u16be(u, p); p += 2;
  for (let i = 0; i < count; i++) {
    const id = u16be(u, p); p += 2;
    let method = 0;
    if (v === 1) { method = u16be(u, p) & 15; p += 2; }
    p += 2; // data_reference_index
    const base = readN(u, p, baseSize); p += baseSize;
    const extents = u16be(u, p); p += 2;
    const list = [];
    for (let k = 0; k < extents; k++) {
      p += idxSize;
      const off = readN(u, p, offSize); p += offSize;
      const len = readN(u, p, lenSize); p += lenSize;
      list.push({ offset: base + off, length: len });
    }
    if (id === wantId) return method === 0 && list.length === 1 ? list[0] : null;
  }
  return null;
}

export function heicExifTiff(u) {
  try {
    const meta = metaBox(u);
    if (!meta) return null;
    const exifId = [...itemTypes(u, meta)].find(([, t]) => t === 'Exif')?.[0];
    if (exifId == null) return null;
    const loc = itemLocation(u, meta, exifId);
    if (!loc || loc.offset + loc.length > u.length || loc.length < 4) return null;
    const start = loc.offset + 4 + u32be(u, loc.offset);
    const end = loc.offset + loc.length;
    return start < end ? u.subarray(start, end) : null;
  } catch {
    return null;
  }
}

export function heicStoredSize(u) {
  try {
    const meta = metaBox(u);
    if (!meta) return null;
    const pitm = child(u, meta, 'pitm', 4);
    const iprp = child(u, meta, 'iprp', 4);
    if (!pitm || !iprp) return null;
    const primary = u[pitm.body] === 0 ? u16be(u, pitm.body + 4) : u32be(u, pitm.body + 4);
    const ipco = child(u, iprp, 'ipco');
    const ipma = child(u, iprp, 'ipma');
    if (!ipco || !ipma) return null;
    const props = [...boxes(u, ipco.body, ipco.end)];
    const v = u[ipma.body], flags = u[ipma.body + 3];
    let p = ipma.body + 4;
    const count = u32be(u, p); p += 4;
    for (let i = 0; i < count; i++) {
      const id = v < 1 ? u16be(u, p) : u32be(u, p); p += v < 1 ? 2 : 4;
      const n = u[p++];
      for (let k = 0; k < n; k++) {
        const idx = flags & 1 ? u16be(u, p) & 0x7FFF : u[p] & 0x7F;
        p += flags & 1 ? 2 : 1;
        const prop = props[idx - 1];
        if (id === primary && prop?.type === 'ispe') return { w: u32be(u, prop.body + 4), h: u32be(u, prop.body + 8) };
      }
    }
    return null;
  } catch {
    return null;
  }
}
