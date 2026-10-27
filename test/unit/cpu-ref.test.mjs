import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRenderParams, storedToUpright, uprightSize, hash, h2f, vnoise, grainNoise } from '../../js/engine/params.js';
import { renderCPU, CpuEngine } from '../../js/engine/cpu-ref.js';
import { BUILTIN } from '../../js/looks/builtin.js';
import { normalize } from '../../js/looks/recipe.js';
import { decode8, encodeOETF } from '../../js/color/p3.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function image(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const c = fill(i % w, Math.floor(i / w), i); data.set([...c, 255], i * 4); }
  return { width: w, height: h, data };
}
const noop = (extra = {}) => toRenderParams(normalize({ ...BUILTIN.asshot.recipe, grain: { amount: 0 }, vignette: { amount: 0 }, ...extra }), { shortSide: 512 });
const upright = src => ({ width: src.width, height: src.height, orientation: 1 });
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

const rnd = mulberry32(3);
const rand = Array.from({ length: 64 }, () => [rnd() * 256 | 0, rnd() * 256 | 0, rnd() * 256 | 0]);
const ramp = image(320, 1, x => x < 256 ? [x, x, x] : rand[x - 256]);

test('render params', () => {
  const p = toRenderParams(normalize({ tone: { exposure: 0.5 }, auto: { exposure: 0.25, temp: 100 }, wb: { temp: 500 },
    grain: { size: 2, format: 'half' } }), { shortSide: 3024 });
  assert.equal(p.exposureEV, 0.75);
  assert.equal(p.lut.size, 33);
  assert.equal(p.grain.cellPx, 1.5 * 2 * 1.4);
  assert.equal(p.grain.seed, 7);
  assert.equal(toRenderParams(normalize({}), { shortSide: 100 }).grain.cellPx, 0.75);
  assert.ok(p.wbGains[0] > 1);
});

test('orientation table and sizes', () => {
  assert.deepEqual(uprightSize(3, 2, 6), [2, 3]);
  assert.deepEqual(uprightSize(3, 2, 3), [3, 2]);
  assert.deepEqual(storedToUpright(0, 0, 3, 2, 6), [1, 0]);
  assert.deepEqual(storedToUpright(2, 1, 3, 2, 8), [1, 0]);
});

test('hash is u32 and deterministic; h2f in [-1,1)', () => {
  const h = hash(12, 34, 7);
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
  assert.equal(hash(12, 34, 7), h);
  assert.notEqual(hash(12, 34, 8), h);
  assert.ok(h2f(0) === -1 && h2f(0xFFFFFFFF) < 1);
  const v = vnoise(10, 10, 1.5, 7);
  assert.ok(v >= -1 && v <= 1);
  assert.equal(grainNoise(5, 5, { cellPx: 1.5, roughness: 0.5, chroma: false, seed: 7 }, 0),
    grainNoise(5, 5, { cellPx: 1.5, roughness: 0.5, chroma: false, seed: 7 }, 2));
});

test('no-op: output bytes equal input', () => {
  const out = renderCPU(ramp, noop(), upright(ramp));
  assert.equal(maxDiff(out.data, ramp.data), 0);
});

test('orientation 1..8: output(sx,sy) = input(storedToUpright(sx,sy))', () => {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  const src = image(3, 2, (x, y) => colors[y * 3 + x]);
  for (let o = 1; o <= 8; o++) {
    const [Ws, Hs] = o >= 5 ? [2, 3] : [3, 2];
    const out = renderCPU(src, noop(), { width: Ws, height: Hs, orientation: o });
    assert.deepEqual([out.width, out.height], [Ws, Hs]);
    for (let sy = 0; sy < Hs; sy++) for (let sx = 0; sx < Ws; sx++) {
      const [ux, uy] = storedToUpright(sx, sy, Ws, Hs, o);
      assert.deepEqual(px(out, sx, sy), px(src, ux, uy), `o=${o} (${sx},${sy})`);
    }
  }
});

test('grain: deterministic, seed-dependent, amount 0 = none', () => {
  const src = image(64, 64, (x, y) => [128, 100 + y, 90 + x]);
  const p = noop({ grain: { amount: 1 } });
  const a = renderCPU(src, p, upright(src)), b = renderCPU(src, p, upright(src));
  assert.equal(maxDiff(a.data, b.data), 0);
  assert.ok(maxDiff(a.data, src.data) > 0);
  const c = renderCPU(src, { ...p, grain: { ...p.grain, seed: 8 } }, upright(src));
  assert.ok(maxDiff(a.data, c.data) > 0);
  const z = renderCPU(src, { ...p, grain: { ...p.grain, amount: 0 } }, upright(src));
  assert.equal(maxDiff(z.data, src.data), 0);
});

test('grain does not touch pure black and pure white', () => {
  const src = image(32, 32, x => x < 16 ? [0, 0, 0] : [255, 255, 255]);
  const out = renderCPU(src, noop({ grain: { amount: 1, chroma: true } }), upright(src));
  assert.equal(maxDiff(out.data, src.data), 0);
});

test('vignette: center unchanged, corners darker, amount 0 unchanged', () => {
  const src = image(65, 33, () => [180, 180, 180]);
  const out = renderCPU(src, noop({ vignette: { amount: 0.5 } }), upright(src));
  assert.deepEqual(px(out, 32, 16), [180, 180, 180]);
  assert.ok(px(out, 0, 0)[0] < 180 && px(out, 64, 32)[0] < 180);
});

test('exposure +1 EV doubles linear mid gray (±1/255)', () => {
  const src = image(4, 4, () => [118, 118, 118]);
  const out = renderCPU(src, noop({ tone: { exposure: 1 } }), upright(src));
  const want = Math.round(encodeOETF(2 * decode8(118)) * 255);
  assert.ok(Math.abs(px(out, 1, 1)[0] - want) <= 1, `${px(out, 1, 1)[0]} vs ${want}`);
});

test('target size mismatch throws RangeError', () => {
  assert.throws(() => renderCPU(ramp, noop(), { width: 10, height: 1, orientation: 1 }), RangeError);
  assert.throws(() => renderCPU(ramp, noop(), { width: 320, height: 1, orientation: 6 }), RangeError);
});

test('CpuEngine.render matches renderCPU', async () => {
  const e = new CpuEngine();
  assert.equal(e.kind, 'cpu');
  const p = noop({ grain: { amount: 0.5 } });
  const a = await e.render(ramp, p, upright(ramp));
  assert.equal(maxDiff(a.data, renderCPU(ramp, p, upright(ramp)).data), 0);
  e.dispose();
});
