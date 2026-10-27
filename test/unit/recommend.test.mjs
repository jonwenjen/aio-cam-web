import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScene } from '../../js/looks/analyze.js';
import { recommend, RULES } from '../../js/looks/recommend.js';
import { BUILTIN, ORDER } from '../../js/looks/builtin.js';
import { makeSynthetic } from '../browser/synthetic.js';
import { decodeOETF } from '../../js/color/p3.js';
import { linImage, W, H } from './scene-helpers.mjs';

const sky = [0.35, 0.6, 0.95].map(decodeOETF);
const skyImage = linImage((x, y) => (y < H / 2 ? sky : [0.18, 0.18, 0.18]));
const ids = r => r.map(x => x.lookId);

test('RULES cover every built-in look', () => {
  assert.deepEqual(Object.keys(RULES).sort(), [...ORDER].sort());
});

test('blue sky → clearview first, reason sky', () => {
  const r = recommend(analyzeScene(skyImage, null));
  assert.equal(r[0].lookId, 'clearview');
  assert.equal(r[0].reasonScene, 'sky');
});

test('skin → hiyori in top 3', () => {
  assert.ok(ids(recommend(analyzeScene(makeSynthetic('skin', W, H), null))).includes('hiyori'));
});

test('night with neon → chiaroscuro in top 3, reason neon or night', () => {
  const neon = [[1, 0, 0.6], [0, 0.9, 1], [0.9, 0, 1]];
  const img = linImage((x, y) => {
    const block = Math.floor(x / 32) + Math.floor(y / 32);
    return block % 5 === 0 ? neon[block % 3].map(v => v * 0.25) : [0.002, 0.002, 0.003];
  });
  const r = recommend(analyzeScene(img, null));
  const c = r.find(x => x.lookId === 'chiaroscuro');
  assert.ok(c, JSON.stringify(r));
  assert.ok(['neon', 'night'].includes(c.reasonScene));
});

test('diversity: a same-family runner-up gives way to another family within 80%', () => {
  const base = analyzeScene(skyImage, null);
  const zero = Object.fromEntries(Object.keys(base.scenes).map(k => [k, 0]));
  // 不套多樣性時：日和 1.0、街景 0.9（同為負片）、自然 0.85
  const stats = { ...base, scenes: { ...zero, portrait: 1, overcast: 1, highContrast: 1 } };
  const r = recommend(stats);
  assert.equal(r[0].lookId, 'hiyori');
  assert.notEqual(BUILTIN[r[1].lookId].family, 'negative');
  assert.ok(new Set(r.map(x => BUILTIN[x.lookId].family)).size >= 2);
});

test('length 3, unique, deterministic; general reason when no scene matters', () => {
  const s = analyzeScene(skyImage, null);
  const r = recommend(s);
  assert.equal(r.length, 3);
  assert.equal(new Set(ids(r)).size, 3);
  assert.deepEqual(recommend(s), r);
  const zero = Object.fromEntries(Object.keys(s.scenes).map(k => [k, 0]));
  const g = recommend({ ...s, scenes: zero });
  assert.deepEqual(ids(g), ['natural', 'asshot', 'hiyori']);
  assert.ok(g.every(x => x.reasonScene === 'general'));
});
