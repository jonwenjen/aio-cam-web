// 驗證輸出檔：S2（HDR）、S3（EXIF 一致）、S16（隱私開關）。用 exiftool 與 Apple ImageIO（tools/bin/*）。
// 用法：node tools/verify-output.mjs <original> <output> --privacy=keep|noLocation|minimal [--json]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../js/version.js';

const BIN = fileURLToPath(new URL('./bin/', import.meta.url));
const S3_FIELDS = ['ExifIFD:DateTimeOriginal', 'ExifIFD:OffsetTimeOriginal', 'GPS:GPSLatitude', 'GPS:GPSLongitude',
  'GPS:GPSAltitude', 'IFD0:Model', 'ExifIFD:LensModel', 'ExifIFD:FNumber', 'ExifIFD:FocalLength'];
const EXIF_GROUPS = new Set(['IFD0', 'ExifIFD', 'GPS', 'InteropIFD', 'IFD1', 'SubIFD']);
const MINIMAL_EXIF = new Set(['Orientation', 'ColorSpace', 'ExifImageWidth', 'ExifImageHeight']);
const APPLE_HDR = new Set(['HDRHeadroom', 'HDRGain']);

const exif = path => JSON.parse(execFileSync('exiftool', ['-j', '-n', '-G1', '-a', path], { maxBuffer: 64 << 20 }).toString())[0];

function gmcheck(path) {
  const s = execFileSync(BIN + 'gmcheck', [path]).toString();
  return { apple: /appleGainMap: true/.test(s), iso: /isoGainMap: true/.test(s), raw: s.trim() };
}

function hdrmeasure(path) {
  const s = execFileSync(BIN + 'hdrmeasure', [path]).toString();
  return { max: Number(/HDR max ([\d.]+)/.exec(s)?.[1]), over: Number(/pixels>1\.0: ([\d.]+)%/.exec(s)?.[1]), raw: s.trim() };
}

export function verify(original, output, privacy) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
  const a = exif(original), b = exif(output);
  const ga = gmcheck(original), gb = gmcheck(output);

  // S2：原圖有增益圖時，HDR 峰值與高光面積必須接近原圖
  if (ga.apple || ga.iso) {
    const ha = hdrmeasure(original), hb = hdrmeasure(output);
    add('S2 HDR max ±5%', Math.abs(hb.max - ha.max) / ha.max <= 0.05, `${ha.max} → ${hb.max}`);
    add('S2 pixels>1.0 ±3pt', Math.abs(hb.over - ha.over) <= 3, `${ha.over}% → ${hb.over}%`);
    add('S2 gain map kinds', ga.apple === gb.apple && ga.iso === gb.iso, `apple ${ga.apple}→${gb.apple}, iso ${ga.iso}→${gb.iso}`);
  }

  if (privacy === 'keep') {
    for (const k of S3_FIELDS) add(`S3 ${k}`, JSON.stringify(a[k]) === JSON.stringify(b[k]), `${a[k]} → ${b[k]}`);
  }
  if (privacy === 'noLocation') {
    const gps = Object.keys(b).filter(k => /GPS/i.test(k));
    add('S16 no GPS tags', gps.length === 0, gps.join(', ') || 'none');
  }
  if (privacy === 'minimal') {
    const extra = Object.keys(b).filter(k => {
      const [g, n] = k.split(':');
      return (EXIF_GROUPS.has(g) && !MINIMAL_EXIF.has(n)) || (g === 'Apple' && !APPLE_HDR.has(n));
    });
    add('S16 minimal EXIF only', extra.length === 0, extra.join(', ') || 'ok');
    const xmp = Object.keys(b).filter(k => k.startsWith('XMP'));
    add('S16 no XMP', xmp.length === 0, xmp.join(', ') || 'none');
    add('S16 ICC kept', !!b['ICC_Profile:ProfileDescription'], b['ICC_Profile:ProfileDescription']);
  }
  if (privacy !== 'minimal') {
    add('Software', b['IFD0:Software'] === `AIO Cam Web ${VERSION}`, b['IFD0:Software']);
  }
  // Chrome 的描述是 "Display P3 Gamut with sRGB Transfer"，Safari 是 "Display P3"
  add('ICC Display P3', /^Display P3/.test(b['ICC_Profile:ProfileDescription'] ?? ''), b['ICC_Profile:ProfileDescription']);
  return { original, output, privacy, ok: checks.every(c => c.ok), checks, gmcheck: { original: ga.raw, output: gb.raw } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [original, output] = args.filter(x => !x.startsWith('--'));
  const privacy = (args.find(x => x.startsWith('--privacy=')) ?? '--privacy=keep').split('=')[1];
  if (!original || !output || !['keep', 'noLocation', 'minimal'].includes(privacy)) {
    console.error('usage: node tools/verify-output.mjs <original> <output> --privacy=keep|noLocation|minimal [--json]');
    process.exit(2);
  }
  const r = verify(original, output, privacy);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else for (const c of r.checks) console.log(`${c.ok ? '✅' : '❌'} ${c.id}  ${c.detail ?? ''}`);
  process.exit(r.ok ? 0 : 1);
}
