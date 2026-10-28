import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, writeOut, exiftoolJson } from './helpers.mjs';
import { analyze, XMP_ID } from '../../js/io/jpeg.js';
import { concat } from '../../js/io/bytes.js';
import { parseTiff, writeTiff, TAG } from '../../js/io/tiff.js';
import { xmpPacketsOf, withRecipe, stripLocation, xmpApp1 } from '../../js/io/xmp.js';
import { buildPrimaryMetadata } from '../../js/io/metadata.js';

const SOFTWARE = 'AIO Cam Web 0.1.0';
const RECIPE = 'eyJiIjoiaGl5b3JpIn0';

function sourceOf(u) {
  const jpeg = analyze(u);
  return { kind: 'jpeg', bytes: u, jpeg, exifTiff: jpeg.exif ? u.subarray(jpeg.exif.dataStart + 6, jpeg.exif.end) : null };
}
/** 拿掉原本的 APP1（Exif、XMP），把新的放在 SOI 後面 */
function withMetadata(u, { app1Exif, app1Xmp }) {
  const j = analyze(u);
  const drop = j.primarySegs.filter(s => s.marker === 0xE1);
  const parts = [u.subarray(0, 2), app1Exif, ...app1Xmp];
  let p = 2;
  for (const s of drop) { parts.push(u.subarray(p, s.start)); p = s.end; }
  parts.push(u.subarray(p));
  return concat(...parts);
}
function build(name, privacy, extra = {}) {
  const u = read(name);
  const src = sourceOf(u);
  const meta = buildPrimaryMetadata(src, { privacy, encodedRecipe: RECIPE, software: SOFTWARE,
    outWidth: 384, outHeight: 512, outOrientation: 6, ...extra });
  return { meta, path: writeOut(`meta-${privacy}-${name}`, withMetadata(u, meta)) };
}

test('xmp: withRecipe adds aiocam namespace and attribute; null gives minimal packet', () => {
  const x = withRecipe(null, RECIPE);
  assert.match(x, /xmlns:aiocam="https:\/\/jonwenjen\.github\.io\/aio-cam-web\/ns\/1\.0\/"/);
  assert.match(x, /aiocam:recipe="eyJiIjoiaGl5b3JpIn0"/);
  const app1 = xmpApp1(x);
  assert.deepEqual([...app1.subarray(0, 2)], [0xFF, 0xE1]);
  const text = new TextDecoder().decode(app1.subarray(4));
  assert.ok(text.startsWith(XMP_ID + '\0'));
});

test('xmp: stripLocation removes GPS attributes and elements', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" exif:GPSAltitude="12/1" photoshop:City="Kaohsiung" xmp:Rating="3">
    <exif:GPSLatitude>22,39.864N</exif:GPSLatitude><exif:GPSLongitude>120,18.084E</exif:GPSLongitude>
    <Iptc4xmpCore:Location>Pier 2</Iptc4xmpCore:Location>
    <Iptc4xmpExt:LocationShown><rdf:Bag><rdf:li>x</rdf:li></rdf:Bag></Iptc4xmpExt:LocationShown>
    <photoshop:State/></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const out = stripLocation(xml);
  assert.doesNotMatch(out, /GPS|City|State|Location/);
  assert.match(out, /xmp:Rating="3"/);
});

test('xmpPacketsOf reads the fixture XMP', () => {
  const u = read('gm_gps_rot6.jpg');
  const packets = xmpPacketsOf(u, analyze(u));
  assert.equal(packets.length, 1);
  assert.match(packets[0], /exif:GPSLatitude/);
});

test('keep: Software, recipe XMP, GPS and dates kept, output dimensions', () => {
  const { meta, path } = build('gm_gps_rot6.jpg', 'keep');
  assert.equal(meta.notice, null);
  const j = exiftoolJson(path, ['-n']);
  assert.equal(j['IFD0:Software'], SOFTWARE);
  assert.equal(j['XMP-aiocam:Recipe'], RECIPE);
  assert.equal(j['IFD0:Orientation'], 6);
  assert.equal(j['ExifIFD:ExifImageWidth'], 384);
  assert.equal(j['ExifIFD:ExifImageHeight'], 512);
  assert.ok(j['GPS:GPSLatitude']);
  assert.ok(j['XMP-exif:GPSLatitude']);
});

test('noLocation: no GPS anywhere, dates/model/lens kept', () => {
  const { path } = build('gm_gps_rot6.jpg', 'noLocation');
  const j = exiftoolJson(path, ['-n', '-s']);
  assert.deepEqual(Object.keys(j).filter(k => /GPS/i.test(k)), []);
  assert.ok(j['ExifIFD:DateTimeOriginal']);
  assert.ok(j['IFD0:Model']);
  assert.ok(j['ExifIFD:LensModel']);
  assert.equal(j['XMP-aiocam:Recipe'], RECIPE);
});

test('minimal: EXIF only orientation, color space, dimensions (+Apple HDR MakerNote); no XMP', () => {
  const { meta, path } = build('gm_gps_rot6.jpg', 'minimal');
  assert.equal(meta.app1Xmp.length, 0);
  const exif = exiftoolJson(path, ['-EXIF:all']);
  const keys = Object.keys(exif).filter(k => k !== 'SourceFile').map(k => k.split(':')[1]).sort();
  assert.deepEqual(keys, ['ColorSpace', 'ExifImageHeight', 'ExifImageWidth', 'Orientation']);
  assert.deepEqual(Object.keys(exiftoolJson(path, ['-XMP:all'])).filter(k => k !== 'SourceFile'), []);
  const all = exiftoolJson(path);
  const orig = exiftoolJson(writeOut('meta-orig.jpg', read('gm_gps_rot6.jpg')));
  assert.deepEqual(Object.keys(all).filter(k => k.startsWith('Apple:')).sort(), ['Apple:HDRGain', 'Apple:HDRHeadroom']);
  assert.equal(all['Apple:HDRHeadroom'], orig['Apple:HDRHeadroom']);
  assert.equal(all['Apple:HDRGain'], orig['Apple:HDRGain']);
  assert.equal(all['IFD0:Software'], undefined);
});

test('outOrientation=1 writes Orientation 1', () => {
  const { path } = build('gm_gps_rot6.jpg', 'keep', { outOrientation: 1 });
  assert.equal(exiftoolJson(path, ['-n'])['IFD0:Orientation'], 1);
});

test('source without EXIF: keep produces Orientation, Software, ColorSpace, dimensions', () => {
  const u = read('plain_srgb.jpg');
  const src = { ...sourceOf(u), exifTiff: null };
  const meta = buildPrimaryMetadata(src, { privacy: 'keep', encodedRecipe: RECIPE, software: SOFTWARE,
    outWidth: 768, outHeight: 512, outOrientation: 1 });
  const t = parseTiff(meta.app1Exif.subarray(10));
  assert.deepEqual([...t.ifd0.keys()].sort((a, b) => a - b), [TAG.Orientation, TAG.Software]);
  assert.deepEqual([...t.exif.keys()].sort((a, b) => a - b), [TAG.ColorSpace, TAG.PixelXDimension, TAG.PixelYDimension]);
  assert.equal(meta.app1Xmp.length, 1);
});

test('big_exif: Software fits after dropping the thumbnail → notice null (Review Focus 4)', () => {
  const { meta, path } = build('big_exif.jpg', 'keep', { outWidth: 768, outHeight: 512, outOrientation: 1 });
  assert.equal(meta.notice, null);
  const j = exiftoolJson(path);
  assert.equal(j['IFD0:Software'], SOFTWARE);
  assert.equal(j['IFD1:ThumbnailImage'], undefined);
  const orig = exiftoolJson(writeOut('meta-big-orig.jpg', read('big_exif.jpg')));
  assert.equal(j['ExifIFD:UserComment'], orig['ExifIFD:UserComment']);
});

test('70KB UserComment → falls back to minimal with notice exifTooLarge', () => {
  const u = read('big_exif.jpg');
  const t = parseTiff(sourceOf(u).exifTiff);
  t.exif.set(0x9286, { type: 7, count: 70000, raw: new Uint8Array(70000).fill(0x41) });
  const src = { ...sourceOf(u), exifTiff: writeTiff(t) };
  const meta = buildPrimaryMetadata(src, { privacy: 'keep', encodedRecipe: RECIPE, software: SOFTWARE,
    outWidth: 768, outHeight: 512, outOrientation: 1 });
  assert.equal(meta.notice, 'exifTooLarge');
  const t2 = parseTiff(meta.app1Exif.subarray(10));
  assert.equal(t2.exif.get(0x9286), undefined);
});

test('the embedded EXIF thumbnail (unedited, possibly wrongly rotated) is never kept', () => {
  // 有縮圖但不會超過 APP1 上限的 EXIF：拿掉 big_exif 那段很長的 UserComment
  const u = read('big_exif.jpg');
  const t0 = parseTiff(sourceOf(u).exifTiff);
  t0.exif.delete(0x9286);
  assert.ok(t0.thumbnail);
  const src = { ...sourceOf(u), exifTiff: writeTiff(t0) };
  for (const privacy of ['keep', 'noLocation']) {
    const meta = buildPrimaryMetadata(src, { privacy, encodedRecipe: RECIPE, software: 'x',
      outWidth: 768, outHeight: 512, outOrientation: 1 });
    const t = parseTiff(meta.app1Exif.subarray(10));
    assert.equal(t.ifd1, null, privacy);
    assert.equal(t.thumbnail, null, privacy);
  }
});
