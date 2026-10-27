// 場景分析（spec §7.5.1）：輸入轉正、P3 8-bit、長邊 256 的縮圖，輸出 SceneStats。
// 11 個場景分數的公式由計畫釘死，M3 以 S21 校準。
import { decode8, linP3ToOklab, LUMA } from '../color/p3.js';
import { sunElevation, lightPhase, localTimeOnly, exifToUtc, exifLocalHour } from './sun.js';
import { decodeUpright } from '../io/import.js';
import { parseTiff, getTag, TAG } from '../io/tiff.js';

const DECODE8 = Float64Array.from({ length: 256 }, (_, v) => decode8(v));
const RAD = Math.PI / 180;
const NEUTRAL_CHROMA = 0.06; // 色偏參考的近中性門檻（spec §7.5.1）
const BAND_CENTERS = [20, 55, 100, 140, 195, 255, 300, 340]; // red orange yellow green aqua blue purple magenta
const angDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mean = arr => arr.reduce((x, y) => x + y, 0) / arr.length;
const median = arr => { const s = Float64Array.from(arr).sort(); return s.length ? s[s.length >> 1] : 0; };

function lightOf(exif) {
  const unknown = { phase: 'unknown', sunElevation: null, confidence: 0 };
  if (!exif?.dateTimeOriginal) return unknown;
  const utc = exifToUtc(exif.dateTimeOriginal, exif.offsetTimeOriginal);
  if (utc && exif.gps && Number.isFinite(exif.gps.lat) && Number.isFinite(exif.gps.lon)) {
    const el = sunElevation(utc, exif.gps.lat, exif.gps.lon);
    return { phase: lightPhase(el), sunElevation: el, confidence: 1 };
  }
  const hour = exifLocalHour(exif.dateTimeOriginal);
  return hour == null ? unknown : { ...localTimeOnly(hour), sunElevation: null };
}

/** @returns {SceneStats} */
export function analyzeScene(thumb, exif) {
  const { width: w, height: h, data } = thumb;
  const n = w * h;
  const Y = new Float64Array(n), C = new Float64Array(n);
  let logSum = 0, clipHi = 0, clipLo = 0, chromaSum = 0;
  const neutral = { a: [], b: [], r: [], g: [], bl: [] };
  let skin = 0, sky = 0, green = 0, chromatic = 0;
  const hueHist = new Array(8).fill(0);
  const skyRows = Math.floor(h * 0.4);
  const cx0 = Math.floor(w / 3), cx1 = Math.floor((2 * w) / 3), cy0 = Math.floor(h / 3), cy1 = Math.floor((2 * h) / 3);
  const centerY = [], surroundY = [];

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const rgb = [DECODE8[data[i]], DECODE8[data[i + 1]], DECODE8[data[i + 2]]];
    const y = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
    const [L, a, b] = linP3ToOklab(rgb);
    const c = Math.hypot(a, b);
    const hue = ((Math.atan2(b, a) / RAD) + 360) % 360;
    Y[p] = y; C[p] = c;
    logSum += Math.log(Math.max(y, 1e-4));
    if (y > 0.95) clipHi++;
    if (y < 0.005) clipLo++;
    chromaSum += c;
    if (y >= 0.05 && y <= 0.9 && c < NEUTRAL_CHROMA) {
      neutral.a.push(a); neutral.b.push(b); neutral.r.push(rgb[0]); neutral.g.push(rgb[1]); neutral.bl.push(rgb[2]);
    }
    if (c > 0.02) {
      chromatic++;
      let best = 0;
      for (let k = 1; k < 8; k++) if (angDist(hue, BAND_CENTERS[k]) < angDist(hue, BAND_CENTERS[best])) best = k;
      hueHist[best]++;
    }
    if (L >= 0.45 && L <= 0.9 && c >= 0.03 && c <= 0.16 && hue >= 25 && hue <= 75) skin++;
    const x = p % w, row = (p / w) | 0;
    if (row < skyRows && L > 0.5 && c > 0.03 && hue >= 180 && hue <= 275) sky++;
    if (hue >= 110 && hue <= 160 && c > 0.04) green++;
    if (x >= cx0 && x < cx1 && row >= cy0 && row < cy1) centerY.push(y); else surroundY.push(y);
  }

  const sortedY = Float64Array.from(Y).sort();
  const pct = q => sortedY[Math.min(n - 1, Math.floor(q * (n - 1)))];
  const sortedC = Float64Array.from(C).sort();
  const pY = { p0_5: pct(0.005), p5: pct(0.05), p50: pct(0.5), p95: pct(0.95), p99_5: pct(0.995) };
  // 近中性像素的 a、b 平均（spec §7.5.1）；近中性少於 5% 時視為無可靠參考
  const reliable = neutral.a.length >= 0.05 * n;
  const cast = reliable
    ? { a: mean(neutral.a), b: mean(neutral.b), reliable, rgb: [mean(neutral.r), mean(neutral.g), mean(neutral.bl)] }
    : { a: 0, b: 0, reliable, rgb: null };
  const dynRange = Math.log2(Math.max(pY.p99_5, 1e-4) / Math.max(pY.p5, 1e-4));
  const backlit = centerY.length > 0 && median(centerY) < 0.4 * median(surroundY);
  const light = lightOf(exif);
  const logMeanY = logSum / n;
  const meanChroma = chromaSum / n;
  const p95Chroma = sortedC[Math.floor(0.95 * (n - 1))];
  const hist = hueHist.map(v => (chromatic ? v / chromatic : 0));

  const s = {
    logMeanY, pY, clipHi: clipHi / n, clipLo: clipLo / n, cast, meanChroma, p95Chroma, hueHist: hist,
    skin: skin / n, sky: sky / n, green: green / n, dynRange, backlit, light,
  };
  const conf = phase => (light.phase === phase ? light.confidence : 0);
  const night = Math.max(conf('night'), 1 - smoothstep(0.02, 0.08, Math.exp(logMeanY)));
  s.scenes = {
    portrait: smoothstep(0.02, 0.12, s.skin),
    sky: smoothstep(0.08, 0.30, s.sky),
    green: smoothstep(0.10, 0.35, s.green),
    golden: light.phase === 'golden' ? light.confidence : 0.5 * smoothstep(0.55, 0.75, hist[1] + hist[2]),
    blueHour: conf('blue'),
    night,
    neon: night * smoothstep(0.10, 0.20, p95Chroma),
    indoorWarm: (1 - night) * smoothstep(0.01, 0.04, cast.b) * (light.phase === 'day' ? 0.3 : 1),
    overcast: (1 - smoothstep(4, 6, dynRange)) * (1 - smoothstep(0.04, 0.08, meanChroma)) * (1 - night),
    highContrast: smoothstep(7, 9, dynRange),
    backlit: backlit ? 1 : 0,
  };
  return s;
}

/** decodeUpright(長邊 256) → P3 像素 */
export async function thumbnailOf(src) {
  const bmp = await decodeUpright(src, { maxLongSide: 256 });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height, { colorSpace: 'display-p3' });
}

/** SourceImage 的 EXIF → 分析用欄位（缺值為 null） */
export function exifForAnalysis(src) {
  const out = { iso: null, exposureTime: null, fNumber: null, focalLength35: null, flash: null,
    dateTimeOriginal: src.meta?.dateTimeOriginal ?? null, offsetTimeOriginal: src.meta?.offsetTimeOriginal ?? null, gps: null };
  if (!src.exifTiff) return out;
  let t;
  try { t = parseTiff(src.exifTiff); } catch { return out; }
  const num = (ifd, tag) => { const v = getTag(t, ifd, tag); const x = Array.isArray(v) ? v[0] : v; return Number.isFinite(x) ? x : null; };
  out.iso = num('exif', 0x8827);
  out.exposureTime = num('exif', 0x829A);
  out.fNumber = num('exif', TAG.FNumber);
  out.focalLength35 = num('exif', 0xA405);
  out.flash = num('exif', 0x9209);
  if (t.gps) {
    const dms = tag => { const v = getTag(t, 'gps', tag); return Array.isArray(v) && v.length === 3 ? v[0] + v[1] / 60 + v[2] / 3600 : null; };
    const lat = dms(2), lon = dms(4);
    if (lat != null && lon != null) {
      out.gps = { lat: getTag(t, 'gps', 1) === 'S' ? -lat : lat, lon: getTag(t, 'gps', 3) === 'W' ? -lon : lon };
    }
  }
  return out;
}
