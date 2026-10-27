import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunElevation, lightPhase, localTimeOnly, exifToUtc } from '../../js/looks/sun.js';

test('equinox noon on the equator is overhead', () => {
  assert.ok(sunElevation(new Date('2026-03-20T12:07:00Z'), 0, 0) > 88);
});

test('June solstice noon on the Tropic of Cancer is overhead', () => {
  assert.ok(sunElevation(new Date('2026-06-21T12:02:00Z'), 23.44, 0) > 88);
});

test('North Pole in December is always below the horizon', () => {
  for (let h = 0; h < 24; h++) assert.ok(sunElevation(new Date(Date.UTC(2026, 11, 21, h)), 89.9, 0) < 0, `hour ${h}`);
});

test('Kaohsiung on the IMG_0040 date', () => {
  const lat = 22.6644, lon = 120.3014;
  const morning = sunElevation(exifToUtc('2026:10:26 11:00:19', '+08:00'), lat, lon);
  assert.ok(morning >= 50 && morning <= 57, `${morning}`);
  assert.equal(lightPhase(morning), 'day');
  assert.ok(['golden', 'blue'].includes(lightPhase(sunElevation(exifToUtc('2026:10:26 17:20:00', '+08:00'), lat, lon))));
  assert.equal(lightPhase(sunElevation(exifToUtc('2026:10:26 22:00:00', '+08:00'), lat, lon)), 'night');
});

test('phase thresholds and local-time fallback', () => {
  assert.deepEqual([13, 12.1, 6, -3, -7].map(lightPhase), ['day', 'day', 'golden', 'blue', 'night']);
  assert.deepEqual(localTimeOnly(7), { phase: 'golden', confidence: 0.5 });
  assert.equal(localTimeOnly(17).phase, 'golden');
  assert.equal(localTimeOnly(5.5).phase, 'blue');
  assert.equal(localTimeOnly(18.5).phase, 'blue');
  assert.equal(localTimeOnly(23).phase, 'night');
  assert.equal(localTimeOnly(2).phase, 'night');
  assert.equal(localTimeOnly(12).phase, 'day');
  assert.equal(exifToUtc('bad', '+08:00'), null);
});
