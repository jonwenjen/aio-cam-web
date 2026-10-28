import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputName } from '../../js/io/export.js';

const src = { meta: { dateTimeOriginal: '2026:10:26 11:00:19' } };
const now = new Date(2026, 9, 28, 7, 5, 9);

test('file name uses the capture time when metadata is kept', () => {
  assert.equal(outputName(src, 'hiyori', now, 'keep'), 'AIO_20261026_110019_hiyori.jpg');
  assert.equal(outputName(src, 'hiyori', now, 'noLocation'), 'AIO_20261026_110019_hiyori.jpg');
});

test('去除全部：file name must not reveal the capture time', () => {
  assert.equal(outputName(src, 'hiyori', now, 'minimal'), 'AIO_20261028_070509_hiyori.jpg');
});
