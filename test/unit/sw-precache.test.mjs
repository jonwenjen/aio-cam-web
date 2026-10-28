import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './helpers.mjs';
import { VERSION } from '../../js/version.js';
import { precacheList, buildHash } from '../../tools/stamp-sw.mjs';

const sw = readFileSync(ROOT + 'sw.js', 'utf8');
const PRECACHE = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)[1]);
const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('every app file is precached', () => {
  const files = ['index.html', 'manifest.webmanifest', ...['css', 'icons', 'js'].flatMap(d => walk(ROOT + d))]
    .map(p => './' + relative(ROOT, p.startsWith(ROOT) ? p : ROOT + p).split('\\').join('/'))
    .filter(p => !p.endsWith('.DS_Store'));
  const missing = files.filter(f => !PRECACHE.includes(f));
  assert.deepEqual(missing, []);
});

test('every precached path exists', () => {
  const gone = PRECACHE.filter(p => !existsSync(ROOT + p.slice(2)));
  assert.deepEqual(gone, []);
});

test('service worker cache version matches VERSION', () => {
  assert.equal(/const VERSION = '([^']+)'/.exec(sw)[1], VERSION);
});

test('manifest uses relative paths and has 192/512 maskable icons', () => {
  const m = JSON.parse(readFileSync(ROOT + 'manifest.webmanifest', 'utf8'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.icons.map(i => i.sizes).sort(), ['192x192', '512x512']);
  for (const i of m.icons) { assert.ok(!i.src.startsWith('/')); assert.match(i.purpose, /maskable/); assert.ok(existsSync(ROOT + i.src)); }
});

test('sw.js BUILD hash matches the precached files (any app change updates installed copies)', () => {
  const want = buildHash(precacheList());
  const got = /const BUILD = '([0-9a-f]+)'/.exec(sw)?.[1];
  assert.equal(got, want, 'run: node tools/stamp-sw.mjs');
});

test('precache bypasses the HTTP cache', () => {
  assert.match(sw, /cache: 'reload'/);
});
