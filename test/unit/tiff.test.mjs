import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { read, hasPrivate, privatePath, writeOut, exiftoolJson } from './helpers.mjs';
import { analyze } from '../../js/io/jpeg.js';
import { concat } from '../../js/io/bytes.js';
import { parseTiff, writeTiff, getTag, setAscii, setShort, deleteTag, dropIfd, exifApp1, TAG } from '../../js/io/tiff.js';

const IFDS = ['ifd0', 'exif', 'gps', 'interop', 'ifd1'];
const cases = [['gm_gps_rot6.jpg', () => read('gm_gps_rot6.jpg')], ['big_exif.jpg', () => read('big_exif.jpg')]];
if (hasPrivate('IMG_0040.jpg')) cases.push(['IMG_0040.jpg', () => new Uint8Array(readFileSync(privatePath('IMG_0040.jpg')))]);

const tiffOf = u => { const j = analyze(u); return u.subarray(j.exif.dataStart + 6, j.exif.end); };
/** 把 JPEG 的 APP1 Exif 換成 newApp1 */
function replaceExif(u, newApp1) {
  const j = analyze(u);
  return concat(u.subarray(0, j.exif.start), newApp1, u.subarray(j.exif.end));
}
// 只有檔案系統資訊、ExifTool 自己的訊息、縮圖位移（重新排版必然改變）、
// MPF 的位置欄位（這裡只換 APP1、不重算 MPF；MPF 重算是 assemble.js 的事）可以不同
const IGNORE_GROUPS = new Set(['ExifTool', 'File', 'System']);
const comparable = j => Object.fromEntries(Object.entries(j).filter(([k]) =>
  k !== 'SourceFile' && !IGNORE_GROUPS.has(k.split(':')[0]) && k !== 'IFD1:ThumbnailOffset' &&
  !/^MPImage\d+:MPImage(Start|Length)$/.test(k)));

for (const [name, load] of cases) {
  test(`${name}: parse → write → parse keeps every tag's raw bytes`, () => {
    const t1 = parseTiff(tiffOf(load()));
    const t2 = parseTiff(writeTiff(t1));
    assert.equal(t2.le, t1.le);
    for (const ifd of IFDS) {
      assert.equal(!!t2[ifd], !!t1[ifd], ifd);
      if (!t1[ifd]) continue;
      assert.deepEqual([...t2[ifd].keys()].sort(), [...t1[ifd].keys()].sort(), ifd);
      for (const [tag, e] of t1[ifd]) {
        const e2 = t2[ifd].get(tag);
        assert.equal(e2.type, e.type);
        assert.equal(e2.count, e.count);
        assert.deepEqual(e2.raw, e.raw, `${ifd} 0x${tag.toString(16)}`);
      }
    }
    assert.deepEqual(t2.thumbnail, t1.thumbnail);
  });

  test(`${name}: rewritten EXIF reads identically in exiftool (MakerNotes included)`, () => {
    const u = load();
    const tiff = writeTiff(parseTiff(tiffOf(u)));
    const path = writeOut('tiff-rt-' + name, replaceExif(u, exifApp1(tiff)));
    const a = comparable(exiftoolJson(path));
    const orig = comparable(exiftoolJson(writeOut('tiff-orig-' + name, u)));
    assert.deepEqual(a, orig);
    // Apple HDR 參數（MakerNote tag 33、48）必須原樣保留
    for (const k of Object.keys(orig).filter(k => k.startsWith('Apple:'))) assert.deepEqual(a[k], orig[k], k);
  });
}

test('gm_gps_rot6: getTag decodes values', () => {
  const t = parseTiff(tiffOf(read('gm_gps_rot6.jpg')));
  assert.equal(getTag(t, 'ifd0', TAG.Orientation), 6);
  assert.match(getTag(t, 'exif', TAG.DateTimeOriginal), /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/);
  assert.ok(t.gps);
  const lat = getTag(t, 'gps', 2);
  assert.ok(Math.abs(lat[0] + lat[1] / 60 + lat[2] / 3600 - 22.6644) < 1e-4);
  assert.equal(getTag(t, 'ifd0', 0x9999), undefined);
});

test('setAscii Software is read by exiftool; setShort/deleteTag work', () => {
  const u = read('gm_gps_rot6.jpg');
  const t = parseTiff(tiffOf(u));
  setAscii(t, 'ifd0', TAG.Software, 'AIO Cam Web 0.1.0');
  setShort(t, 'ifd0', TAG.Orientation, 1);
  deleteTag(t, 'exif', TAG.LensModel);
  const path = writeOut('tiff-software.jpg', replaceExif(u, exifApp1(writeTiff(t))));
  const j = exiftoolJson(path, ['-n']);
  assert.equal(j['IFD0:Software'], 'AIO Cam Web 0.1.0');
  assert.equal(j['IFD0:Orientation'], 1);
  assert.equal(j['ExifIFD:LensModel'], undefined);
});

test('dropIfd gps removes GPS entirely', () => {
  const u = read('gm_gps_rot6.jpg');
  const t = parseTiff(tiffOf(u));
  dropIfd(t, 'gps');
  const path = writeOut('tiff-nogps.jpg', replaceExif(u, exifApp1(writeTiff(t))));
  const j = exiftoolJson(path, ['-EXIF:all']);
  assert.deepEqual(Object.keys(j).filter(k => k.startsWith('GPS:')), []);
});

test('big_exif: APP1 overflows after adding Software, fits after dropping IFD1 (Review Focus 4)', () => {
  const t = parseTiff(tiffOf(read('big_exif.jpg')));
  assert.ok(t.ifd1 && t.thumbnail);
  setAscii(t, 'ifd0', TAG.Software, 'AIO Cam Web 0.1.0');
  assert.throws(() => exifApp1(writeTiff(t)), RangeError);
  dropIfd(t, 'ifd1');
  assert.equal(t.thumbnail, null);
  const app1 = exifApp1(writeTiff(t));
  assert.deepEqual([...app1.subarray(0, 2)], [0xFF, 0xE1]);
});
