import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers.mjs';
import { BUILTIN } from '../../js/looks/builtin.js';
import { findBrands } from '../../tools/check-brands.mjs';

const LANGS = ['zh-Hant', 'ja', 'zh-Hans', 'en', 'ko'];
const load = lang => JSON.parse(readFileSync(`${ROOT}js/i18n/${lang}.json`, 'utf8'));

test('all locales have exactly the same keys', () => {
  const ref = Object.keys(load('zh-Hant')).sort();
  for (const lang of LANGS) assert.deepEqual(Object.keys(load(lang)).sort(), ref, lang);
});

test('zh-Hant and en have no empty strings', () => {
  for (const lang of ['zh-Hant', 'en']) {
    for (const [k, v] of Object.entries(load(lang))) assert.ok(typeof v === 'string' && v.trim(), `${lang}:${k}`);
  }
});

test('every look key refers to a built-in look, and every look has name and traits', () => {
  const dict = load('zh-Hant');
  for (const k of Object.keys(dict).filter(k => k.startsWith('look.'))) assert.ok(BUILTIN[k.split('.')[1]], k);
  for (const id of Object.keys(BUILTIN)) { assert.ok(dict[`look.${id}.name`]); assert.ok(dict[`look.${id}.traits`]); }
});

test('required keys exist (notices match exportImage, reasons match scenes)', () => {
  const dict = load('zh-Hant');
  const need = ['notice.hdrSelfCheckFailed', 'notice.exifTooLarge', 'notice.heicNoHdr', 'notice.downscaled',
    'error.decode', 'error.generic', 'error.recipeLink', 'auto.button', 'auto.undo', 'auto.applied', 'recommend.title',
    'settings.autoOnImport', 'import.button', 'save.button', 'save.tapToShare', 'privacy.keep', 'privacy.noLocation',
    'privacy.minimal', 'slider.intensity', 'slider.exposure', 'compare.hint', 'badge.hdr', 'reason.format',
    ...['portrait', 'sky', 'green', 'golden', 'blueHour', 'night', 'neon', 'indoorWarm', 'overcast', 'highContrast', 'backlit', 'general'].map(s => 'reason.' + s),
    ...['neutral', 'negative', 'positive', 'cinema'].map(f => 'family.' + f)];
  for (const k of need) assert.ok(k in dict, k);
  assert.equal(dict['look.hiyori.name'], '日和');
  assert.equal(dict['look.hiyori.traits'], '柔・青影');
});

test('no brand names in the app', async () => {
  assert.deepEqual(await findBrands(), []);
});
