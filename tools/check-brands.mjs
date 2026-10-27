// 品牌名稱與底片型號只能出現在 docs/（spec §1.1）。掃描 App 會載入的檔案，找到就失敗。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['index.html', 'css', 'js', 'sw.js', 'manifest.webmanifest'];
const WORDS = ['fuji', 'fujifilm', 'ricoh', 'leica', 'olympus', 'nikon', 'canon', 'contax', 'zeiss',
  'kodak', 'portra', 'ektar', 'ektachrome', 'ultramax', 'cinestill', 'eterna', 'velvia', 'provia',
  'superia', 'acros', 'tri-x', 'hp5', 'polaroid'];
// gold 以單字邊界比對，避免誤判 golden
const PATTERN = new RegExp(`(${WORDS.map(w => w.replace(/[-]/g, '\\$&')).join('|')})|\\bgold\\b`, 'i');
// 子字串比對才抓得到藏在識別字裡的品牌（fujiLook）；含有品牌字串的一般英文單字先拿掉
const ALLOWED = /portrait|canonical/gi;

/** 回傳 ['行號: 命中字串', ...] */
export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const m = line.replace(ALLOWED, ' ').match(PATTERN);
    if (m) hits.push(`${i + 1}: ${m[0]}`);
  });
  return hits;
}

async function* walk(path) {
  let s;
  try { s = await stat(path); } catch { return; }
  if (s.isDirectory()) {
    for (const name of await readdir(path)) yield* walk(join(path, name));
  } else {
    yield path;
  }
}

export async function findBrands(root = ROOT) {
  const hits = [];
  for (const target of TARGETS) {
    for await (const file of walk(join(root, target))) {
      for (const h of scanText(await readFile(file, 'utf8'))) hits.push(`${relative(root, file)}:${h}`);
    }
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = await findBrands();
  if (hits.length) {
    console.error('brand names found outside docs/:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('check-brands: ok');
}
