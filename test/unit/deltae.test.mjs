import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differenceCiede2000 } from 'culori';
import { ciede2000, p3ToLab65, deltaEStats } from '../browser/deltae.js';
import { makeSynthetic } from '../browser/synthetic.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('matches culori CIEDE2000 on 1000 random P3 pairs', () => {
  const de = differenceCiede2000();
  const rnd = mulberry32(5);
  for (let i = 0; i < 1000; i++) {
    const a = [rnd(), rnd(), rnd()], b = i % 3 ? a.map(v => Math.min(1, Math.max(0, v + (rnd() - 0.5) * 0.1))) : [rnd(), rnd(), rnd()];
    const ref = de({ mode: 'p3', r: a[0], g: a[1], b: a[2] }, { mode: 'p3', r: b[0], g: b[1], b: b[2] });
    assert.ok(Math.abs(ciede2000(p3ToLab65(a), p3ToLab65(b)) - ref) < 1e-6, `${a} ${b}`);
  }
});

test('Sharma 2005 reference pairs', () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
  ];
  for (const [a, b, want] of pairs) {
    assert.ok(Math.abs(ciede2000(a, b) - want) < 1e-4, `${a} vs ${b}`);
    assert.ok(Math.abs(ciede2000(b, a) - want) < 1e-4);
  }
});

test('deltaEStats: identical images give 0; synthetic images are deterministic', () => {
  for (const name of ['ramp', 'hueWheel', 'skin', 'noise']) {
    const a = makeSynthetic(name, 96, 64), b = makeSynthetic(name, 96, 64);
    assert.equal(a.data.length, 96 * 64 * 4);
    assert.deepEqual(a.data, b.data);
    assert.deepEqual(deltaEStats(a, b), { mean: 0, max: 0, p99: 0 });
  }
  const a = makeSynthetic('ramp', 96, 64), c = { ...a, data: a.data.map((v, i) => (i % 4 === 0 ? Math.min(255, v + 10) : v)) };
  const s = deltaEStats(a, c);
  assert.ok(s.mean > 0 && s.max >= s.p99 && s.p99 >= 0);
});
