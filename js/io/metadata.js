// 依隱私開關產生主圖的 EXIF／XMP 區段（spec §8.4、N03）。
import { u16be, u32be } from './bytes.js';
import { parseTiff, writeTiff, setAscii, setShort, setLong, dropIfd, exifApp1, TAG } from './tiff.js';
import { xmpPacketsOf, withRecipe, stripLocation, xmpApp1 } from './xmp.js';

const APPLE_HDR_TAGS = [33, 48]; // HDRHeadroom、HDRGain
const APPLE_HEADER = 'Apple iOS\0';

/** 從 Apple MakerNote 取出 tag 33、48，產生只含這兩個標籤的最小 MakerNote；沒有就回傳 null。 */
function minimalAppleMakerNote(mn) {
  if (!mn || mn.length < 16 || String.fromCharCode(...mn.subarray(0, 10)) !== APPLE_HEADER) return null;
  if (mn[12] !== 0x4D || mn[13] !== 0x4D) return null; // 只見過 MM
  const n = u16be(mn, 14);
  const found = [];
  for (let k = 0; k < n; k++) {
    const e = 16 + k * 12;
    if (e + 12 > mn.length) break;
    const tag = u16be(mn, e);
    if (!APPLE_HDR_TAGS.includes(tag)) continue;
    const type = u16be(mn, e + 2), count = u32be(mn, e + 4);
    const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }[type] ?? 1) * count;
    // Apple MakerNote 的偏移相對於 MakerNote 起點
    const at = size <= 4 ? e + 8 : u32be(mn, e + 8);
    if (at + size > mn.length) continue;
    found.push({ tag, type, count, raw: mn.slice(at, at + size) });
  }
  if (!found.length) return null;
  const ifdAt = 14, dataStart = ifdAt + 2 + found.length * 12 + 4;
  const dataLen = found.reduce((a, f) => a + (f.raw.length > 4 ? f.raw.length + (f.raw.length & 1) : 0), 0);
  const out = new Uint8Array(dataStart + dataLen);
  const v = new DataView(out.buffer);
  out.set(mn.subarray(0, 14), 0); // "Apple iOS\0" 00 01 "MM"
  v.setUint16(ifdAt, found.length);
  let data = dataStart;
  found.forEach((f, i) => {
    const e = ifdAt + 2 + i * 12;
    v.setUint16(e, f.tag); v.setUint16(e + 2, f.type); v.setUint32(e + 4, f.count);
    if (f.raw.length <= 4) out.set(f.raw, e + 8);
    else { v.setUint32(e + 8, data); out.set(f.raw, data); data += f.raw.length + (f.raw.length & 1); }
  });
  return out;
}

function emptyTiff() {
  return { le: false, ifd0: new Map(), exif: null, gps: null, interop: null, ifd1: null, thumbnail: null };
}

function setDims(t, w, h) {
  setLong(t, 'exif', TAG.PixelXDimension, w);
  setLong(t, 'exif', TAG.PixelYDimension, h);
}

function minimalTiff(src, { outWidth, outHeight, outOrientation }) {
  const t = emptyTiff();
  setShort(t, 'ifd0', TAG.Orientation, outOrientation);
  setShort(t, 'exif', TAG.ColorSpace, 0xFFFF);
  setDims(t, outWidth, outHeight);
  let orig = null;
  try { orig = src.exifTiff ? parseTiff(src.exifTiff) : null; } catch { /* 原 EXIF 損壞：當作沒有 */ }
  const mn = minimalAppleMakerNote(orig?.exif?.get(TAG.MakerNote)?.raw);
  if (mn) t.exif.set(TAG.MakerNote, { type: 7, count: mn.length, raw: mn });
  return t;
}

/**
 * @param {'keep'|'noLocation'|'minimal'} privacy
 * @returns {{ app1Exif: Uint8Array, app1Xmp: Uint8Array[], notice: null|'exifTooLarge' }}
 */
export function buildPrimaryMetadata(src, { privacy, encodedRecipe, software, outWidth, outHeight, outOrientation }) {
  const out = { outWidth, outHeight, outOrientation };
  if (privacy === 'minimal') {
    return { app1Exif: exifApp1(writeTiff(minimalTiff(src, out))), app1Xmp: [], notice: null };
  }

  let t = null;
  try { t = src.exifTiff ? parseTiff(src.exifTiff) : null; } catch { /* 原 EXIF 損壞：重新產生 */ }
  if (!t) {
    t = emptyTiff();
    setShort(t, 'exif', TAG.ColorSpace, 0xFFFF);
  }
  setShort(t, 'ifd0', TAG.Orientation, outOrientation);
  setAscii(t, 'ifd0', TAG.Software, software);
  setDims(t, outWidth, outHeight);
  if (privacy === 'noLocation') dropIfd(t, 'gps');

  let packets = src.kind === 'jpeg' && src.jpeg ? xmpPacketsOf(src.bytes, src.jpeg) : [];
  if (privacy === 'noLocation') packets = packets.map(stripLocation);
  packets = packets.length ? [withRecipe(packets[0], encodedRecipe), ...packets.slice(1)] : [withRecipe(null, encodedRecipe)];
  const app1Xmp = packets.map(xmpApp1);

  // 超過 APP1 上限：先拿掉縮圖，仍超過就改用最小 EXIF
  let notice = null, app1Exif;
  try {
    app1Exif = exifApp1(writeTiff(t));
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    dropIfd(t, 'ifd1');
    try {
      app1Exif = exifApp1(writeTiff(t));
    } catch (e2) {
      if (!(e2 instanceof RangeError)) throw e2;
      app1Exif = exifApp1(writeTiff(minimalTiff(src, out)));
      notice = 'exifTooLarge';
    }
  }
  return { app1Exif, app1Xmp, notice };
}

