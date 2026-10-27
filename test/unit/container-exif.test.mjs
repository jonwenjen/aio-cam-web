import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';
import { analyze } from '../../js/io/jpeg.js';
import { parseTiff, getTag, writeTiff, TAG } from '../../js/io/tiff.js';
import { sniffKind, heicExifTiff, tiffFileExif, heicStoredSize } from '../../js/io/container-exif.js';

const jpegTiff = u => { const j = analyze(u); return parseTiff(u.subarray(j.exif.dataStart + 6, j.exif.end)); };

test('sniffKind', () => {
  assert.equal(sniffKind(read('gm_gps_rot6.jpg')), 'jpeg');
  assert.equal(sniffKind(read('sample.heic')), 'heic');
  assert.equal(sniffKind(read('sample.tif')), 'other');
  assert.equal(sniffKind(read('kodak/kodim05.png')), 'other');
  assert.equal(sniffKind(new Uint8Array(3)), 'other');
});

test('sniffKind detects DNG by DNGVersion tag', () => {
  const t = parseTiff(read('sample.tif'));
  t.ifd0.set(0xC612, { type: 1, count: 4, raw: new Uint8Array([1, 4, 0, 0]) });
  assert.equal(sniffKind(writeTiff(t)), 'dng');
});

test('HEIC EXIF matches the JPEG it came from', () => {
  const t = parseTiff(heicExifTiff(read('sample.heic')));
  const ref = jpegTiff(read('gm_gps_rot6.jpg'));
  assert.equal(getTag(t, 'exif', TAG.DateTimeOriginal), getTag(ref, 'exif', TAG.DateTimeOriginal));
  assert.ok(t.gps);
  assert.equal(getTag(t, 'ifd0', TAG.Orientation), 6);
});

test('HEIC stored size from ispe', () => {
  assert.deepEqual(heicStoredSize(read('sample.heic')), { w: 384, h: 512 });
});

test('heicExifTiff returns null for garbage instead of throwing', () => {
  assert.equal(heicExifTiff(new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70])), null);
  assert.equal(heicStoredSize(new Uint8Array(4)), null);
});

test('TIFF file EXIF readable', () => {
  const t = parseTiff(tiffFileExif(read('sample.tif')));
  assert.match(getTag(t, 'ifd0', TAG.Model), /iPhone/);
});
