import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { read, fixture, writeOut, ROOT } from './helpers.mjs';
import { analyze, parseMPF, iccBytes } from '../../js/io/jpeg.js';
import { assembleJpeg, selfCheck, iccApp2 } from '../../js/io/assemble.js';

const GMCHECK = ROOT + 'tools/bin/gmcheck', HDRMEASURE = ROOT + 'tools/bin/hdrmeasure';
const haveTools = existsSync(GMCHECK) && existsSync(HDRMEASURE);

function partsOf(name) {
  const u = read(name);
  const j = analyze(u);
  const seg = s => u.slice(s.start, s.end);
  return {
    u, j,
    encodedPrimary: u.subarray(0, j.primaryEnd),
    app1Exif: seg(j.exif),
    app1Xmp: j.xmp.map(seg),
    iso21496: j.iso21496.map(seg),
    gainMap: j.gainMap ? u.subarray(j.gainMap.start, j.gainMap.end) : null,
  };
}

test('reassembled fixture passes self-check and keeps the gain map byte-for-byte', () => {
  const p = partsOf('apple_gainmap_new.jpg');
  const out = assembleJpeg(p);
  writeOut('assembled.jpg', out);
  const chk = selfCheck(out, { expectGainMapBytes: p.gainMap, expectSize: { w: 384, h: 512 } });
  assert.deepEqual(chk, { ok: true });
  const j = analyze(out);
  // 版面：SOI → Exif → XMP → ICC → MPF → ISO → 掃描資料
  const order = j.primarySegs.filter(s => s.marker >= 0xE0 && s.marker <= 0xEF).map(s => s.id.slice(0, 11));
  assert.equal(order[0], 'Exif');
  assert.ok(order.indexOf('ICC_PROFILE') < order.indexOf('MPF'));
  assert.ok(!order.includes('JFIF') && !order.includes('AROT'));
  assert.deepEqual(j.icc, p.j.icc);
  const m = parseMPF(out, j.mpf);
  assert.equal(m.entries[0].size, j.primaryEnd);
  assert.equal(m.entries[1].abs, j.primaryEnd);
  assert.equal(m.entries[1].size, p.gainMap.length);
});

test('Apple ImageIO still sees the gain map and HDR headroom', t => {
  if (!haveTools) return t.skip('run tools/build-tools.sh');
  const path = writeOut('assembled.jpg', assembleJpeg(partsOf('apple_gainmap_new.jpg')));
  const gm = execFileSync(GMCHECK, [path]).toString();
  assert.match(gm, /appleGainMap: true 192x256/);
  assert.match(gm, /makerApple keys 33\/48: 1\.518932/);
  const hdrMax = s => Number(/HDR max ([\d.]+)/.exec(s)[1]);
  const a = hdrMax(execFileSync(HDRMEASURE, [fixture('apple_gainmap_new.jpg')]).toString());
  const b = hdrMax(execFileSync(HDRMEASURE, [path]).toString());
  assert.ok(Math.abs(a - b) / a <= 0.01, `${a} vs ${b}`);
});

test('without gain map: no MPF, self-check ok', () => {
  const p = partsOf('apple_gainmap_new.jpg');
  const out = assembleJpeg({ ...p, iso21496: [], gainMap: null });
  assert.equal(analyze(out).mpf, null);
  assert.deepEqual(selfCheck(out, { expectGainMapBytes: null, expectSize: { w: 384, h: 512 } }), { ok: true });
});

test('tampered gain map fails self-check', () => {
  const p = partsOf('apple_gainmap_new.jpg');
  const out = assembleJpeg(p);
  out[analyze(out).primaryEnd + 100] ^= 0xFF;
  const chk = selfCheck(out, { expectGainMapBytes: p.gainMap, expectSize: { w: 384, h: 512 } });
  assert.equal(chk.ok, false);
  assert.match(chk.reason, /gain map/);
});

test('wrong size fails self-check', () => {
  const p = partsOf('apple_gainmap_new.jpg');
  const chk = selfCheck(assembleJpeg(p), { expectGainMapBytes: p.gainMap, expectSize: { w: 512, h: 384 } });
  assert.equal(chk.ok, false);
  assert.match(chk.reason, /size/);
});

test('iccApp2 splits large profiles and reassembles', () => {
  const icc = new Uint8Array(150000).map((_, i) => i & 0xFF);
  const segs = iccApp2(icc);
  assert.equal(segs.length, 3);
  for (const s of segs) assert.ok(s.length - 2 <= 65535);
  const u = new Uint8Array([0xFF, 0xD8, ...segs.flatMap(s => [...s]), 0xFF, 0xD9]);
  const j = analyze(u);
  assert.deepEqual(iccBytes(u, j.primarySegs), icc);
});
