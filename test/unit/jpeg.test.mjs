import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { read, fixture } from './helpers.mjs';
import { analyze, segments, parseMPF, buildMPF, iccBytes, scanBody } from '../../js/io/jpeg.js';
import { concat } from '../../js/io/bytes.js';

test('analyze apple gain map fixture', () => {
  const j = analyze(read('apple_gainmap_new.jpg'));
  assert.deepEqual([j.sof.w, j.sof.h, j.sof.comps], [384, 512, 3]);
  assert.deepEqual(j.gainMap.dims, [192, 256, 1]);
  assert.ok(j.exif && j.icc && j.mpf);
  assert.ok(j.gainMap.gainKinds.includes('apple'));
  assert.equal(j.hasAROT, false);
});

test('MPF round-trips', () => {
  const mpf = buildMPF([{ attr: 0x030000, size: 1000, offset: 0 }, { attr: 0, size: 200, offset: 900 }]);
  assert.equal(mpf.length, buildMPF.len(2));
  const u = concat(new Uint8Array([0xFF, 0xD8]), mpf, new Uint8Array([0xFF, 0xD9]));
  const { segs } = segments(u);
  const seg = segs.find(s => s.id === 'MPF');
  const m = parseMPF(u, seg);
  assert.deepEqual(m.entries.map(e => [e.attr, e.size, e.offset]), [[0x030000, 1000, 0], [0, 200, 900]]);
  assert.equal(m.entries[1].abs, m.base + 900);
});

test('rejects non-JPEG', () => assert.throws(() => segments(new Uint8Array([0x89, 0x50])), /not a JPEG/));

test('icc reassembled', () => {
  const iccLenByExiftool = execFileSync('exiftool', ['-b', '-ICC_Profile', fixture('apple_gainmap_new.jpg')]).length;
  const u = read('apple_gainmap_new.jpg');
  const j = analyze(u);
  assert.equal(j.icc.length, iccLenByExiftool);
  assert.deepEqual(iccBytes(u, j.primarySegs), j.icc);
});

test('scanBody starts at first non-APP segment and ends at EOI', () => {
  const u = read('apple_gainmap_new.jpg');
  const j = analyze(u);
  const body = scanBody(u, j.primarySegs, j.primaryEnd);
  assert.equal(body[0], 0xFF);
  assert.ok(!(body[1] >= 0xE0 && body[1] <= 0xEF) && body[1] !== 0xFE);
  assert.deepEqual([...body.subarray(-2)], [0xFF, 0xD9]);
});

test('plain JPEG without gain map', () => {
  const j = analyze(read('plain_srgb.jpg'));
  assert.equal(j.gainMap, null);
  assert.equal(j.mpf, null);
  assert.equal(j.icc, null);
  assert.deepEqual([j.sof.w, j.sof.h], [768, 512]);
});
