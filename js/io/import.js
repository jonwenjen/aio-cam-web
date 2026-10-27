// File → SourceImage。只讀位元組結構；像素解碼在 decodeUpright。
import { analyze, iccDesc } from './jpeg.js';
import { parseTiff, getTag, TAG } from './tiff.js';
import { sniffKind, heicExifTiff, heicStoredSize, tiffFileExif } from './container-exif.js';
import { uprightSize } from '../engine/params.js';

const decodeFailed = () => new Error('decode-failed');

function readExif(tiffBytes) {
  if (!tiffBytes) return { tiff: null, orientation: 1, meta: {} };
  try {
    const t = parseTiff(tiffBytes);
    const o = getTag(t, 'ifd0', TAG.Orientation);
    const str = (ifd, tag) => { const v = getTag(t, ifd, tag); return typeof v === 'string' && v ? v : undefined; };
    return {
      tiff: t,
      orientation: Number.isInteger(o) && o >= 1 && o <= 8 ? o : 1,
      meta: {
        dateTimeOriginal: str('exif', TAG.DateTimeOriginal),
        offsetTimeOriginal: str('exif', TAG.OffsetTimeOriginal),
        model: str('ifd0', TAG.Model),
      },
    };
  } catch {
    return { tiff: null, orientation: 1, meta: {} }; // EXIF 損壞：當作沒有（spec §13）
  }
}

async function probeSize(bytes) {
  try {
    const b = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
    const size = [b.width, b.height];
    b.close();
    return size;
  } catch {
    return null;
  }
}

/** @returns {Promise<SourceImage>} */
export async function importFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffKind(bytes);
  const base = { kind, bytes, name: file.name, jpeg: null, hasGainMap: false, colorSpace: 'srgb', exifTiff: null };

  if (kind === 'jpeg') {
    let jpeg;
    try { jpeg = analyze(bytes); } catch { throw decodeFailed(); }
    if (!jpeg.sof) throw decodeFailed();
    const exifTiff = jpeg.exif ? bytes.subarray(jpeg.exif.dataStart + 6, jpeg.exif.end) : null;
    const { orientation, meta } = readExif(exifTiff);
    const [width, height] = uprightSize(jpeg.sof.w, jpeg.sof.h, orientation);
    return {
      ...base, jpeg, exifTiff, orientation, meta,
      storedWidth: jpeg.sof.w, storedHeight: jpeg.sof.h, width, height,
      hasGainMap: !!jpeg.gainMap,
      colorSpace: /P3/i.test((jpeg.icc && iccDesc(jpeg.icc)) ?? '') ? 'display-p3' : 'srgb',
    };
  }

  // HEIC（M1 一律 SDR）、DNG/TIFF、其他（PNG 等）
  const exifTiff = kind === 'heic' ? heicExifTiff(bytes) : kind === 'dng' || isTiff(bytes) ? tiffFileExif(bytes) : null;
  const { orientation, meta } = readExif(exifTiff);
  const stored = kind === 'heic' ? heicStoredSize(bytes) : null;
  let width, height, storedWidth, storedHeight;
  if (stored) {
    [storedWidth, storedHeight] = [stored.w, stored.h];
    [width, height] = uprightSize(stored.w, stored.h, orientation);
  } else {
    const size = await probeSize(bytes);
    if (!size) throw decodeFailed();
    [width, height] = size;
    [storedWidth, storedHeight] = uprightSize(width, height, orientation);
  }
  return {
    ...base, exifTiff, orientation, meta, storedWidth, storedHeight, width, height,
    colorSpace: kind === 'heic' ? 'display-p3' : 'srgb',
  };
}

function isTiff(u) {
  return (u[0] === 0x49 && u[1] === 0x49 && u[2] === 0x2A) || (u[0] === 0x4D && u[1] === 0x4D && u[3] === 0x2A);
}

/**
 * 解碼成轉正的 ImageBitmap。JPEG 一律只解碼主圖：瀏覽器根本看不到增益圖（規格：禁止讓瀏覽器解碼增益圖）。
 * @returns {Promise<ImageBitmap>}
 */
export async function decodeUpright(src, { maxLongSide } = {}) {
  const bytes = src.kind === 'jpeg' ? src.bytes.subarray(0, src.jpeg.primaryEnd) : src.bytes;
  const opts = { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' };
  const long = Math.max(src.width, src.height);
  if (maxLongSide && long > maxLongSide) {
    const s = maxLongSide / long;
    Object.assign(opts, { resizeWidth: Math.max(1, Math.round(src.width * s)), resizeHeight: Math.max(1, Math.round(src.height * s)), resizeQuality: 'high' });
  }
  try {
    return await createImageBitmap(new Blob([bytes]), opts);
  } catch {
    throw decodeFailed();
  }
}
