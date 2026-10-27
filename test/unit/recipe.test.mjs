import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, RANGES, normalize, diff, encodeForUrl, decodeFromUrl, withBase } from '../../js/looks/recipe.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 依 DEFAULTS 的形狀產生亂數配方，數值有時超出範圍 */
function randomRecipe(rnd) {
  const walk = (d, path) => {
    if (typeof d === 'number') return rnd() < 0.5 ? d : (rnd() * 4 - 2) * (Math.abs(d) > 2 ? 1000 : 1);
    if (Array.isArray(d)) return d.map((x, i) => walk(x, path + '.' + i));
    if (d && typeof d === 'object') return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, walk(v, path + '.' + k)]));
    return d;
  };
  const r = walk(DEFAULTS, '');
  r.wb.temp = rnd() * 6000 - 2500;
  if (rnd() < 0.5) r.auto = { exposure: rnd() * 6 - 3, temp: rnd() * 4000 - 1000, vibrance: rnd() - 0.5 };
  if (rnd() < 0.3) r.curve.rgb = [[0, 0.05], [0.5, 0.55], [1, 0.95]];
  if (rnd() < 0.3) r.paper = 'warm';
  return r;
}

const base = normalize({ base: 'hiyori', tone: { contrast: -0.15 }, grade: { shadows: [195, 0.35] } });
const getBase = () => base;

test('DEFAULTS shape', () => {
  assert.equal(DEFAULTS.v, 1);
  assert.equal(DEFAULTS.base, 'asshot');
  assert.equal(DEFAULTS.intensity, 1);
  assert.equal(DEFAULTS.tone.exposure, 0);
  assert.equal(DEFAULTS.auto, null);
  assert.deepEqual(RANGES.tone.exposure, [-3, 3]);
  assert.deepEqual(RANGES.wb.temp, [-2000, 3000]);
});

test('normalize clamps, drops unknown fields, defaults bad types', () => {
  const r = normalize({ tone: { contrast: 5 }, bogus: 1 });
  assert.equal(r.tone.contrast, 1);
  assert.equal('bogus' in r, false);
  assert.equal(normalize({ grain: { amount: 'x' } }).grain.amount, DEFAULTS.grain.amount);
  assert.equal(normalize({ v: 7 }).v, 1);
  assert.equal(normalize({ grade: { shadows: [400, 2] } }).grade.shadows[0], 40);
  assert.equal(normalize({ grade: { shadows: [-30, 2] } }).grade.shadows[1], 1);
  assert.equal(normalize({ grade: { shadows: [-30, 0] } }).grade.shadows[0], 330);
  assert.equal(normalize({ paper: 'purple' }).paper, 'neutral');
  assert.deepEqual(normalize({ hsl: { red: [1, 2] } }).hsl.red, [0, 0, 0]);
  assert.deepEqual(normalize({}), DEFAULTS);
});

test('auto field', () => {
  assert.equal(normalize({ auto: { exposure: 9 } }).auto.exposure, 2);
  assert.equal(normalize({ auto: { exposure: 9 } }).auto.tint, 0);
  assert.equal(normalize({}).auto, null);
  assert.equal(normalize({ auto: 'x' }).auto, null);
});

test('diff keeps only changed fields', () => {
  const r = normalize({ ...base, tone: { ...base.tone, exposure: 0.5 } });
  assert.deepEqual(diff(r, base), { tone: { exposure: 0.5 } });
  assert.deepEqual(diff(base, base), {});
});

test('URL codec round-trips 100 random recipes', async () => {
  const rnd = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const r = { ...randomRecipe(rnd), base: 'hiyori' };
    const s = await encodeForUrl(normalize(r), base);
    assert.match(s, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeFromUrl(s, getBase), normalize(r));
  }
});

test('5 changed fields encode to ≤ 200 chars', async () => {
  const r = normalize({ ...base, intensity: 0.8, tone: { ...base.tone, exposure: 0.35, shadows: 0.2 },
    wb: { temp: 600, tint: -5 } });
  assert.equal(Object.keys(diff(r, base)).length, 3);
  const s = await encodeForUrl(r, base);
  assert.ok(s.length <= 200, `${s.length}`);
});

test('decodeFromUrl returns null on garbage', async () => {
  assert.equal(await decodeFromUrl('###', getBase), null);
  assert.equal(await decodeFromUrl('AAAA', getBase), null);
  assert.equal(await decodeFromUrl('', getBase), null);
});

test('withBase keeps intensity, exposure and auto', () => {
  const r = normalize({ base: 'asshot', intensity: 0.6, tone: { exposure: 0.4, contrast: 0.5 },
    auto: { exposure: 0.3, temp: -200 } });
  const w = withBase(r, base);
  assert.equal(w.base, 'hiyori');
  assert.equal(w.intensity, 0.6);
  assert.equal(w.tone.exposure, 0.4);
  assert.equal(w.tone.contrast, -0.15);
  assert.deepEqual(w.auto, r.auto);
  assert.deepEqual(w.grade.shadows, [195, 0.35]);
});
