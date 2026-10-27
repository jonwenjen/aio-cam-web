import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../../tools/check-brands.mjs';

test('flags brand names, even inside identifiers', () => {
  assert.deepEqual(scanText('const fujiLook = 1;\nKodak gold\nTri-X'), ['1: fuji', '2: Kodak', '3: Tri-X']);
  assert.deepEqual(scanText('portra400'), ['1: portra']);
});

test('ordinary words that contain a brand string are allowed', () => {
  assert.deepEqual(scanText('portrait Portraits canonical golden hour'), []);
});
