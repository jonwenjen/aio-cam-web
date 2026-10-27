import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScene } from '../../js/looks/analyze.js';
import { makeSynthetic } from '../browser/synthetic.js';
import { decodeOETF } from '../../js/color/p3.js';
import { gray, linImage, W, H } from './scene-helpers.mjs';

test('uniform 18% gray', () => {
  const s = analyzeScene(gray(0.18), null);
  assert.ok(Math.abs(s.logMeanY - Math.log(0.18)) <= 0.02, `${s.logMeanY}`);
  assert.equal(s.cast.reliable, true);
  assert.ok(Math.abs(s.cast.a) < 0.002 && Math.abs(s.cast.b) < 0.002);
  assert.equal(s.skin, 0); assert.equal(s.sky, 0); assert.equal(s.green, 0);
  assert.equal(s.light.phase, 'unknown');
  for (const v of Object.values(s.scenes)) assert.ok(v >= 0 && v <= 1);
});

test('blue sky over gray', () => {
  const sky = [0.35, 0.6, 0.95].map(decodeOETF);
  const s = analyzeScene(linImage((x, y) => (y < H / 2 ? sky : [0.18, 0.18, 0.18])), null);
  assert.ok(s.scenes.sky > 0.8, `${s.scenes.sky}`);
});

test('skin patches → portrait', () => {
  const s = analyzeScene(makeSynthetic('skin', W, H), null);
  assert.ok(s.scenes.portrait > 0.8, `${s.scenes.portrait}`);
});

test('very dark → night', () => {
  assert.ok(analyzeScene(gray(0.01), null).scenes.night > 0.8);
});

test('GPS + time → light phase with full confidence; time only → 0.5', () => {
  const exif = { dateTimeOriginal: '2026:10:26 11:00:19', offsetTimeOriginal: '+08:00', gps: { lat: 22.6644, lon: 120.3014 } };
  const s = analyzeScene(gray(0.18), exif);
  assert.equal(s.light.phase, 'day');
  assert.ok(s.light.sunElevation > 50);
  assert.equal(s.light.confidence, 1);
  const t = analyzeScene(gray(0.18), { dateTimeOriginal: '2026:10:26 17:00:00' });
  assert.deepEqual([t.light.phase, t.light.confidence, t.light.sunElevation], ['golden', 0.5, null]);
});
