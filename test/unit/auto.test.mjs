import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScene } from '../../js/looks/analyze.js';
import { autoAdjust } from '../../js/looks/auto.js';
import { gray, degrade, warm, linImage } from './scene-helpers.mjs';
import { wbGains } from '../../js/looks/lut.js';

const KEYS = ['exposure', 'temp', 'tint', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance'];

test('no-op: neutral 18% gray needs nothing', () => {
  const a = autoAdjust(analyzeScene(gray(0.18), null));
  assert.deepEqual(Object.keys(a).sort(), [...KEYS].sort());
  for (const k of KEYS) assert.equal(a[k], 0, k);
});

test('one stop under → about +0.8 EV', () => {
  const a = autoAdjust(analyzeScene(degrade(gray(0.18), 0.5), null));
  assert.ok(a.exposure >= 0.75 && a.exposure <= 0.85, `${a.exposure}`);
});

// 自動白平衡只輕推 ±200 K（spec v0.6）：+1000 K 暖色偏 → −200 K
test('warm cast → nudged −200 K (cap)', () => {
  const a = autoAdjust(analyzeScene(warm(gray(0.18)), null));
  assert.equal(a.temp, -200);
});

test('cool cast → nudged +200 K (cap)', () => {
  const a = autoAdjust(analyzeScene(degrade(gray(0.18), 1, wbGains(-1000, 0)), null));
  assert.equal(a.temp, 200);
});

test('bright but not clipped → not darkened; clipped highlights → darkened', () => {
  assert.equal(autoAdjust(analyzeScene(gray(0.4), null)).exposure, 0);
  const clipped = linImage((x, y) => (y < 40 ? [1, 1, 1] : [0.45, 0.45, 0.45]));
  assert.ok(autoAdjust(analyzeScene(clipped, null)).exposure < 0);
});

test('golden hour keeps most of the warmth', () => {
  const s = analyzeScene(warm(gray(0.18)), null);
  const a = autoAdjust({ ...s, scenes: { ...s.scenes, golden: 1 } });
  assert.ok(Math.abs(a.temp) <= 350, `${a.temp}`);
});

test('deterministic and rounded', () => {
  const s = analyzeScene(warm(degrade(gray(0.18), 0.5)), null);
  const a = autoAdjust(s), b = autoAdjust(s);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.round(a.exposure * 20) - a.exposure * 20) < 1e-9);
  assert.equal(Math.abs(a.temp % 50), 0);
});
