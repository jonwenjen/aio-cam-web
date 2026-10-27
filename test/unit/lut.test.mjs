import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode8, encodeOETF, decodeOETF, enc, dec, linP3ToOklab, oklabToLinP3, lumaP3, P3_TO_XYZ, XYZ_TO_P3, SRGB_TO_P3 } from '../../js/color/p3.js';
import { BUILTIN, ORDER } from '../../js/looks/builtin.js';
import { wbGains, toneCurve, lookPixel, autoPixel, buildLut } from '../../js/looks/lut.js';
import { normalize } from '../../js/looks/recipe.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const maxAbs = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const N = 33;
const identityEnc = (i, j, k) => [i, j, k].map(v => v / (N - 1));
function lutDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
  return m;
}
function identityError(lut) {
  let m = 0;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const o = (i + j * N + k * N * N) * 4;
    const e = identityEnc(i, j, k);
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(lut.data[o + c] - e[c]));
  }
  return m;
}

test('8-bit decode → encode round-trips every value', () => {
  for (let v = 0; v <= 255; v++) assert.equal(Math.round(encodeOETF(decode8(v)) * 255), v);
  for (let i = 0; i <= 1000; i++) { const e = i / 1000; assert.ok(Math.abs(encodeOETF(decodeOETF(e)) - e) < 1e-9); }
});

test('enc/dec inverse', () => {
  for (let i = 0; i <= 1000; i++) { const x = i / 1000; assert.ok(Math.abs(dec(enc(x)) - x) < 1e-6); }
  assert.equal(enc(0), 0); assert.ok(Math.abs(enc(1) - 1) < 1e-12);
});

test('OKLab round-trip and matrices', () => {
  const rnd = mulberry32(1);
  for (let n = 0; n < 1000; n++) {
    const c = [rnd(), rnd(), rnd()];
    assert.ok(maxAbs(oklabToLinP3(linP3ToOklab(c)), c) < 1e-6);
  }
  const white = linP3ToOklab([1, 1, 1]);
  assert.ok(Math.abs(white[0] - 1) < 1e-4 && Math.abs(white[1]) < 1e-4 && Math.abs(white[2]) < 1e-4);
  const I = P3_TO_XYZ.map((row, r) => [0, 1, 2].map(c => row.reduce((a, v, k) => a + v * XYZ_TO_P3[k][c], 0)));
  assert.ok(maxAbs(I.flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1]) < 1e-9);
  assert.ok(maxAbs(SRGB_TO_P3.map(r => r.reduce((a, b) => a + b, 0)), [1, 1, 1]) < 1e-4);
  assert.ok(Math.abs(lumaP3([1, 1, 1]) - 1) < 1e-9);
});

test('wbGains direction', () => {
  for (const g of wbGains(0, 0)) assert.ok(Math.abs(g - 1) < 1e-6);
  const w = wbGains(600, 0); assert.ok(w[0] > 1 && 1 > w[2]);
  const c = wbGains(-1200, 0); assert.ok(c[2] > 1 && 1 > c[0]);
  assert.ok(wbGains(0, 50)[1] < wbGains(0, 0)[1]);
});

test('toneCurve: zero params is identity, endpoints fixed', () => {
  const zero = { contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
  for (let i = 0; i <= 100; i++) assert.equal(toneCurve(i / 100, zero), i / 100);
  assert.ok(toneCurve(0.25, { ...zero, shadows: 0.5 }) > 0.25);
});

test('no-op: default recipe LUT is identity', () => {
  assert.ok(identityError(buildLut(normalize({}))) < 1e-6);
});

test('neutral input stays neutral under natural; saturation does not tint gray', () => {
  for (const g of [0.02, 0.18, 0.5, 0.9]) {
    const o = lookPixel([g, g, g], BUILTIN.natural.recipe);
    assert.ok(Math.max(...o) - Math.min(...o) < 1e-4, `${g}: ${o}`);
    const s = lookPixel([g, g, g], normalize({ color: { saturation: 0.8, vibrance: 0.5 } }));
    assert.ok(Math.max(...s) - Math.min(...s) < 1e-4);
  }
});

test('intensity 0 → identity; auto is not scaled by intensity', () => {
  assert.ok(identityError(buildLut(normalize({ ...BUILTIN.hiyori.recipe, intensity: 0 }))) < 1e-6);
  assert.ok(identityError(buildLut(normalize({ ...BUILTIN.hiyori.recipe, intensity: 0, auto: { shadows: 0.3 } }))) > 1e-3);
  assert.deepEqual(autoPixel([0.2, 0.3, 0.4], null), [0.2, 0.3, 0.4]);
});

test('every look differs from identity (except asshot) and from each other', () => {
  const luts = Object.fromEntries(ORDER.map(id => [id, buildLut(BUILTIN[id].recipe)]));
  assert.ok(identityError(luts.asshot) < 1e-6);
  for (const id of ORDER.filter(x => x !== 'asshot')) assert.ok(identityError(luts[id]) > 1e-3, id);
  for (let a = 0; a < ORDER.length; a++) for (let b = a + 1; b < ORDER.length; b++) {
    assert.ok(lutDiff(luts[ORDER[a]], luts[ORDER[b]]) > 1e-3, `${ORDER[a]} vs ${ORDER[b]}`);
  }
  for (const lut of Object.values(luts)) {
    assert.equal(lut.size, 33);
    assert.equal(lut.data.length, 33 ** 3 * 4);
    for (const v of lut.data) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
  }
});

test('BUILTIN recipes are already normalized; ORDER and families', () => {
  assert.deepEqual(ORDER, ['asshot', 'natural', 'hiyori', 'streetscape', 'heritage', 'clearview', 'chiaroscuro']);
  for (const id of ORDER) {
    const b = BUILTIN[id];
    assert.equal(b.id, id);
    assert.equal(b.recipe.base, id);
    assert.ok(['neutral', 'negative', 'positive', 'cinema'].includes(b.family));
    assert.deepEqual(normalize(b.recipe), b.recipe);
  }
});
