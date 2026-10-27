// TIFF/EXIF 解析與重新排版寫出。值以原始位元組保存（依原檔位元組序），寫出時沿用原序並重算所有偏移。
// MakerNote（0x927C）原樣搬移：iPhone 的 Apple MakerNote 用自己的相對偏移，搬移不會破壞。
import { u16be, u32be, u16le, u32le, concat } from './bytes.js';

export const TAG = {
  Orientation: 0x0112, Software: 0x0131, Model: 0x0110, Make: 0x010F,
  ExifIFD: 0x8769, GPSIFD: 0x8825, InteropIFD: 0xA005, MakerNote: 0x927C,
  DateTimeOriginal: 0x9003, OffsetTimeOriginal: 0x9011, LensModel: 0xA434,
  FNumber: 0x829D, FocalLength: 0x920A, ColorSpace: 0xA001,
  PixelXDimension: 0xA002, PixelYDimension: 0xA003,
};
const THUMB_OFFSET = 0x0201, THUMB_LENGTH = 0x0202;
// 型別 → 單一值的位元組數（0 = 未知型別，視為 1）
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
const typeSize = t => TYPE_SIZE[t] || 1;
// 指標類 tag 不放進 Ifd Map，寫出時依子 IFD 是否存在重新產生
const POINTERS = new Set([TAG.ExifIFD, TAG.GPSIFD, TAG.InteropIFD]);

function reader(u, le) {
  return { r16: o => le ? u16le(u, o) : u16be(u, o), r32: o => le ? u32le(u, o) : u32be(u, o) };
}

function readIfd(u, off, le) {
  const { r16, r32 } = reader(u, le);
  const n = r16(off);
  const map = new Map(), ptr = {};
  for (let k = 0; k < n; k++) {
    const e = off + 2 + k * 12;
    const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
    const size = typeSize(type) * count;
    if (POINTERS.has(tag) || tag === THUMB_OFFSET) { ptr[tag] = r32(e + 8); continue; }
    const at = size <= 4 ? e + 8 : r32(e + 8);
    if (at + size > u.length) continue; // 指到檔案外的值：略過這個 tag
    map.set(tag, { type, count, raw: u.subarray(at, at + size) });
  }
  return { map, ptr, next: r32(off + 2 + n * 12) };
}

/** @returns {{le:boolean, ifd0:Map, exif:Map|null, gps:Map|null, interop:Map|null, ifd1:Map|null, thumbnail:Uint8Array|null}} */
export function parseTiff(tiff) {
  const le = tiff[0] === 0x49;
  if (!(le || tiff[0] === 0x4D) || tiff[0] !== tiff[1]) throw new Error('not a TIFF');
  const { r32 } = reader(tiff, le);
  const valid = o => o > 0 && o + 2 <= tiff.length;
  const t = { le, ifd0: null, exif: null, gps: null, interop: null, ifd1: null, thumbnail: null };
  const i0 = readIfd(tiff, r32(4), le);
  t.ifd0 = i0.map;
  if (valid(i0.ptr[TAG.ExifIFD])) {
    const ex = readIfd(tiff, i0.ptr[TAG.ExifIFD], le);
    t.exif = ex.map;
    if (valid(ex.ptr[TAG.InteropIFD])) t.interop = readIfd(tiff, ex.ptr[TAG.InteropIFD], le).map;
  }
  if (valid(i0.ptr[TAG.GPSIFD])) t.gps = readIfd(tiff, i0.ptr[TAG.GPSIFD], le).map;
  if (valid(i0.next)) {
    const i1 = readIfd(tiff, i0.next, le);
    t.ifd1 = i1.map;
    const off = i1.ptr[THUMB_OFFSET], len = i1.map.get(THUMB_LENGTH);
    if (off && len) {
      const n = len.type === 3 ? reader(len.raw, le).r16(0) : reader(len.raw, le).r32(0);
      if (off + n <= tiff.length) t.thumbnail = tiff.subarray(off, off + n);
    }
  }
  return t;
}

const pad2 = n => n + (n & 1);
const ifdSize = map => 2 + 12 * map.size + 4 +
  [...map.values()].reduce((a, e) => a + (e.raw.length > 4 ? pad2(e.raw.length) : 0), 0);

export function writeTiff(t) {
  const le = t.le;
  const long = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, le); return b; };
  const ptrEntry = v => ({ type: 4, count: 1, raw: long(v) });

  // 先把指標 tag 放進各 IFD 的副本（值稍後填），讓大小計算包含它們
  const ifd0 = new Map(t.ifd0);
  const exif = t.exif ? new Map(t.exif) : null;
  const ifd1 = t.ifd1 ? new Map(t.ifd1) : null;
  const thumb = ifd1 && t.thumbnail ? t.thumbnail : null;
  if (exif) ifd0.set(TAG.ExifIFD, ptrEntry(0));
  if (t.gps) ifd0.set(TAG.GPSIFD, ptrEntry(0));
  if (exif && t.interop) exif.set(TAG.InteropIFD, ptrEntry(0));
  if (thumb) {
    ifd1.set(THUMB_OFFSET, ptrEntry(0));
    ifd1.set(THUMB_LENGTH, ptrEntry(thumb.length));
  }

  // 版面：IFD0 → ExifIFD → GPS → Interop → IFD1 → 縮圖
  const order = [['ifd0', ifd0], ['exif', exif], ['gps', t.gps], ['interop', exif && t.interop], ['ifd1', ifd1]]
    .filter(([, m]) => m);
  const at = {};
  let pos = 8;
  for (const [name, m] of order) { at[name] = pos; pos += ifdSize(m); }
  const thumbAt = pos;
  const total = pos + (thumb ? thumb.length : 0);

  if (exif) ifd0.set(TAG.ExifIFD, ptrEntry(at.exif));
  if (t.gps) ifd0.set(TAG.GPSIFD, ptrEntry(at.gps));
  if (exif && t.interop) exif.set(TAG.InteropIFD, ptrEntry(at.interop));
  if (thumb) ifd1.set(THUMB_OFFSET, ptrEntry(thumbAt));

  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49, 0x2A, 0x00] : [0x4D, 0x4D, 0x00, 0x2A], 0);
  v.setUint32(4, 8, le);
  for (const [name, m] of order) {
    let p = at[name];
    const tags = [...m.keys()].sort((a, b) => a - b);
    v.setUint16(p, tags.length, le);
    let data = p + 2 + 12 * tags.length + 4;
    p += 2;
    for (const tag of tags) {
      const e = m.get(tag);
      v.setUint16(p, tag, le); v.setUint16(p + 2, e.type, le); v.setUint32(p + 4, e.count, le);
      if (e.raw.length <= 4) {
        out.set(e.raw, p + 8);
      } else {
        v.setUint32(p + 8, data, le);
        out.set(e.raw, data);
        data += pad2(e.raw.length);
      }
      p += 12;
    }
    v.setUint32(p, name === 'ifd0' && ifd1 ? at.ifd1 : 0, le);
  }
  if (thumb) out.set(thumb, thumbAt);
  return out;
}

/** 解出 tag 值：ASCII → 字串；數字型別 → 數字（count 1）或陣列；UNDEFINED/BYTE → Uint8Array。 */
export function getTag(t, ifdName, tag) {
  const e = t[ifdName]?.get(tag);
  if (!e) return undefined;
  const { raw, type, count } = e;
  if (type === 2) return String.fromCharCode(...raw).replace(/\0+$/, '');
  if (type === 1 || type === 6 || type === 7) return raw;
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const le = t.le;
  const vals = [];
  for (let i = 0; i < count; i++) {
    switch (type) {
      case 3: vals.push(v.getUint16(i * 2, le)); break;
      case 8: vals.push(v.getInt16(i * 2, le)); break;
      case 4: case 13: vals.push(v.getUint32(i * 4, le)); break;
      case 9: vals.push(v.getInt32(i * 4, le)); break;
      case 5: vals.push(v.getUint32(i * 8, le) / v.getUint32(i * 8 + 4, le)); break;
      case 10: vals.push(v.getInt32(i * 8, le) / v.getInt32(i * 8 + 4, le)); break;
      case 11: vals.push(v.getFloat32(i * 4, le)); break;
      case 12: vals.push(v.getFloat64(i * 8, le)); break;
      default: return raw;
    }
  }
  return count === 1 ? vals[0] : vals;
}

function ifdFor(t, ifdName) {
  if (!t[ifdName]) t[ifdName] = new Map();
  return t[ifdName];
}

export function setAscii(t, ifdName, tag, str) {
  const raw = new Uint8Array(str.length + 1);
  for (let i = 0; i < str.length; i++) raw[i] = str.charCodeAt(i) & 0x7F;
  ifdFor(t, ifdName).set(tag, { type: 2, count: raw.length, raw });
}

export function setShort(t, ifdName, tag, n) {
  const raw = new Uint8Array(2);
  new DataView(raw.buffer).setUint16(0, n, t.le);
  ifdFor(t, ifdName).set(tag, { type: 3, count: 1, raw });
}

export function setLong(t, ifdName, tag, n) {
  const raw = new Uint8Array(4);
  new DataView(raw.buffer).setUint32(0, n, t.le);
  ifdFor(t, ifdName).set(tag, { type: 4, count: 1, raw });
}

export function deleteTag(t, ifdName, tag) {
  t[ifdName]?.delete(tag);
}

/** 拿掉整個子 IFD；寫出時它的指標也會消失。 */
export function dropIfd(t, name) {
  t[name] = null;
  if (name === 'ifd1') t.thumbnail = null;
  if (name === 'exif') t.interop = null;
}

export const APP1_MAX = 65533;

/** 包成 FFE1 len "Exif\0\0" tiff。 */
export function exifApp1(tiff) {
  const len = 2 + 6 + tiff.length;
  if (len > APP1_MAX) throw new RangeError('APP1 too large');
  const head = new Uint8Array([0xFF, 0xE1, len >> 8, len & 0xFF, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  return concat(head, tiff);
}
