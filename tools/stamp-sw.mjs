// 重新產生 sw.js 的 PRECACHE 清單與 BUILD（所有預先快取檔案的內容雜湊）。
// App 任何檔案改了，sw.js 的位元組就跟著變，已安裝的使用者才會收到更新。
// test/unit/sw-precache.test.mjs 會檢查兩者是否最新；不是就執行：node tools/stamp-sw.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function precacheList() {
  return ['index.html', 'manifest.webmanifest', ...['css', 'icons', 'js'].flatMap(d => walk(ROOT + d).map(p => relative(ROOT, p)))]
    .filter(p => !p.endsWith('.DS_Store'))
    .map(p => './' + p.split('\\').join('/'))
    .sort();
}

export function buildHash(list) {
  const h = createHash('sha256');
  for (const p of list) { h.update(p); h.update(readFileSync(ROOT + p.slice(2))); }
  return h.digest('hex').slice(0, 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = precacheList();
  const build = buildHash(list);
  let sw = readFileSync(ROOT + 'sw.js', 'utf8');
  sw = sw.replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = [\n${list.map(p => '  ' + JSON.stringify(p)).join(',\n')}\n];`);
  sw = sw.replace(/const BUILD = '[0-9a-f]*';/, `const BUILD = '${build}';`);
  writeFileSync(ROOT + 'sw.js', sw);
  console.log(`sw.js: ${list.length} files, BUILD ${build}`);
}
