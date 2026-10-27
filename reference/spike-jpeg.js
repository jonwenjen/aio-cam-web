// Throwaway spike helpers: JPEG segment parsing, MPF, gain-map detection and remux.
// Works in the browser (window.JPEGX) and in node (module.exports) for offline tests.
(function (root) {
  'use strict';
  const ascii = (u, a, b) => { let s = ''; for (let i = a; i < b && i < u.length; i++) s += String.fromCharCode(u[i]); return s; };
  const u16be = (u, o) => (u[o] << 8) | u[o + 1];
  const u32be = (u, o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];

  function idOf(u, s) {
    if (!(s.marker >= 0xE0 && s.marker <= 0xEF)) return '';
    let e = s.dataStart; while (e < s.end && e < s.dataStart + 64 && u[e] !== 0) e++;
    return ascii(u, s.dataStart, e);
  }

  // Walk one JPEG starting at `start`; returns its segments and the offset just past EOI.
  function segments(u, start = 0) {
    if (u[start] !== 0xFF || u[start + 1] !== 0xD8) throw new Error('not a JPEG at ' + start);
    const segs = []; let p = start + 2;
    while (p < u.length - 1) {
      if (u[p] !== 0xFF) throw new Error('bad marker byte at ' + p);
      const m = u[p + 1];
      if (m === 0xFF) { p++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      if (m === 0xD9) return { segs, end: p + 2 };
      const len = u16be(u, p + 2);
      const s = { marker: m, start: p, end: p + 2 + len, dataStart: p + 4 };
      s.id = idOf(u, s); segs.push(s); p = s.end;
      if (m === 0xDA) {
        while (p < u.length - 1) {
          if (u[p] === 0xFF) { const n = u[p + 1]; if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { p += 2; continue; } if (n === 0xFF) { p++; continue; } break; }
          p++;
        }
      }
    }
    return { segs, end: u.length, truncated: true };
  }

  function parseMPF(u, s) {
    const base = s.dataStart + 4; const le = u[base] === 0x49;
    const r16 = o => le ? u[o] | (u[o + 1] << 8) : u16be(u, o);
    const r32 = o => le ? (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16)) + (u[o + 3] << 24 >>> 0) : u32be(u, o);
    const ifd = base + r32(base + 4); const n = r16(ifd); let count = 0, entOff = -1;
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12, tag = r16(e), cnt = r32(e + 4);
      if (tag === 0xB001) count = r32(e + 8);
      if (tag === 0xB002) entOff = cnt > 4 ? base + r32(e + 8) : e + 8;
    }
    const entries = [];
    for (let i = 0; i < count && entOff > 0; i++) {
      const e = entOff + i * 16;
      entries.push({ attr: r32(e), size: r32(e + 4), offset: r32(e + 8), abs: i === 0 ? 0 : base + r32(e + 8) });
    }
    return { base, le, entries };
  }

  function xmpOf(u, segs) {
    return segs.filter(s => s.marker === 0xE1 && s.id.startsWith('http://ns.adobe.com/xa'))
      .map(s => ascii(u, s.dataStart + s.id.length + 1, s.end)).join('\n');
  }

  function iccOf(u, segs) {
    const parts = segs.filter(s => s.marker === 0xE2 && s.id === 'ICC_PROFILE')
      .sort((a, b) => u[a.dataStart + 12] - u[b.dataStart + 12]).map(s => u.subarray(s.dataStart + 14, s.end));
    if (!parts.length) return null;
    const len = parts.reduce((a, b) => a + b.length, 0); const icc = new Uint8Array(len); let o = 0;
    for (const p of parts) { icc.set(p, o); o += p.length; }
    return { bytes: len, desc: iccDesc(icc), space: ascii(icc, 16, 20), version: icc[8] + '.' + (icc[9] >> 4) };
  }

  function iccDesc(icc) {
    try {
      const n = u32be(icc, 128);
      for (let i = 0; i < n; i++) {
        const t = 132 + i * 12;
        if (ascii(icc, t, t + 4) !== 'desc') continue;
        const off = u32be(icc, t + 4), type = ascii(icc, off, off + 4);
        if (type === 'desc') { const c = u32be(icc, off + 8); return ascii(icc, off + 12, off + 12 + c - 1); }
        if (type === 'mluc') {
          const len = u32be(icc, off + 20), so = off + u32be(icc, off + 24); let s = '';
          for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16be(icc, so + k));
          return s;
        }
      }
    } catch (e) { return 'err ' + e.message; }
    return null;
  }

  function gainMapKind(u, segs) {
    const x = xmpOf(u, segs); const kinds = [];
    if (/hdrgainmap/i.test(x)) kinds.push('apple');
    if (/hdrgm:/i.test(x)) kinds.push('adobe-hdrgm');
    if (segs.some(s => s.marker === 0xE2 && s.id.startsWith('urn:iso:std:iso:ts:21496'))) kinds.push('iso21496');
    return kinds;
  }

  // Full structural analysis of a JPEG file (Uint8Array).
  function analyze(u) {
    const p = segments(u, 0);
    const out = {
      primaryEnd: p.end, fileLen: u.length,
      app: p.segs.filter(s => s.marker >= 0xE0 && s.marker <= 0xEF).map(s => 'APP' + (s.marker - 0xE0) + ':' + s.id + ':' + (s.end - s.start)),
      primaryGainKinds: gainMapKind(u, p.segs), icc: iccOf(u, p.segs), images: [], gainMap: null,
      primarySegs: p.segs, primarySOF: null,
    };
    const sof = p.segs.find(s => s.marker >= 0xC0 && s.marker <= 0xCF && s.marker !== 0xC4 && s.marker !== 0xC8 && s.marker !== 0xCC);
    if (sof) out.primarySOF = { w: u16be(u, sof.dataStart + 3), h: u16be(u, sof.dataStart + 1), comps: u[sof.dataStart + 5] };
    const mpfSeg = p.segs.find(s => s.marker === 0xE2 && s.id === 'MPF');
    let starts = [];
    if (mpfSeg) { const m = parseMPF(u, mpfSeg); out.mpf = m.entries.map(e => ({ attr: '0x' + e.attr.toString(16), size: e.size, offset: e.offset })); starts = m.entries.slice(1).map(e => e.abs); }
    else { for (let i = p.end; i < u.length - 3; i++) if (u[i] === 0xFF && u[i + 1] === 0xD8 && u[i + 2] === 0xFF) { starts.push(i); try { i = segments(u, i).end - 1; } catch (e) {} } }
    for (const st of starts) {
      try {
        const q = segments(u, st); const sof2 = q.segs.find(s => s.marker === 0xC0 || s.marker === 0xC1 || s.marker === 0xC2);
        const img = { start: st, end: q.end, size: q.end - st, gainKinds: gainMapKind(u, q.segs),
          dims: sof2 ? [u16be(u, sof2.dataStart + 3), u16be(u, sof2.dataStart + 1), u[sof2.dataStart + 5]] : null };
        out.images.push(img);
        if (!out.gainMap && img.gainKinds.length) out.gainMap = img;
      } catch (e) { out.images.push({ start: st, err: e.message }); }
    }
    return out;
  }

  // Rewrite the EXIF Orientation tag in a copy of an APP1 Exif segment.
  function patchOrientation(seg, val) {
    const t = 10; const le = seg[t] === 0x49;
    const r16 = o => le ? seg[o] | (seg[o + 1] << 8) : u16be(seg, o);
    const r32 = o => le ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16)) + (seg[o + 3] << 24 >>> 0) : u32be(seg, o);
    const ifd = t + r32(t + 4); const n = r16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (r16(e) === 0x0112) { if (le) { seg[e + 8] = val; seg[e + 9] = 0; } else { seg[e + 8] = 0; seg[e + 9] = val; } return true; }
    }
    return false;
  }

  function buildMPF(entries) {
    const n = entries.length, ifdLen = 2 + 3 * 12 + 4, dataLen = 16 * n;
    const len = 2 + 2 + 4 + 8 + ifdLen + dataLen; const b = new Uint8Array(len); const v = new DataView(b.buffer);
    b[0] = 0xFF; b[1] = 0xE2; v.setUint16(2, len - 2); b.set([0x4D, 0x50, 0x46, 0], 4);
    const T = 8; b.set([0x4D, 0x4D, 0x00, 0x2A], T); v.setUint32(T + 4, 8);
    let e = T + 8; v.setUint16(e, 3); e += 2;
    v.setUint16(e, 0xB000); v.setUint16(e + 2, 7); v.setUint32(e + 4, 4); b.set([0x30, 0x31, 0x30, 0x30], e + 8); e += 12;
    v.setUint16(e, 0xB001); v.setUint16(e + 2, 4); v.setUint32(e + 4, 1); v.setUint32(e + 8, n); e += 12;
    v.setUint16(e, 0xB002); v.setUint16(e + 2, 7); v.setUint32(e + 4, dataLen); v.setUint32(e + 8, 8 + ifdLen); e += 12;
    v.setUint32(e, 0); e += 4;
    for (const en of entries) { v.setUint32(e, en.attr); v.setUint32(e + 4, en.size); v.setUint32(e + 8, en.offset); e += 16; }
    return b;
  }
  buildMPF.len = n => 2 + 2 + 4 + 8 + (2 + 3 * 12 + 4) + 16 * n;

  // Combine a re-encoded primary (`processed`, e.g. canvas.toBlob output) with the original's
  // metadata and gain map. `orientation`: null keeps original EXIF value, a number overwrites it.
  // `gainMapJpeg`: optional replacement gain-map JPEG (e.g. rotated); the original gain map's APP
  // segments (its XMP aux-type declaration) are kept and only the coded image body is swapped.
  function remux(original, processed, { orientation = null, keepICCFrom = 'processed', gainMapJpeg = null } = {}) {
    const o = analyze(original); if (!o.gainMap) throw new Error('original has no gain map');
    const pp = segments(processed, 0);
    const take = (segs, u, pred) => segs.filter(pred).map(s => u.slice(s.start, s.end));
    const bodyOf = (u, segs, end) => { const f = segs.find(s => !(s.marker >= 0xE0 && s.marker <= 0xEF) && s.marker !== 0xFE); return u.subarray(f.start, end); };
    let gmBytes = original.subarray(o.gainMap.start, o.gainMap.end);
    if (gainMapJpeg) {
      const og = segments(original, o.gainMap.start), ng = segments(gainMapJpeg, 0);
      const apps = take(og.segs, original, s => s.marker >= 0xE0 && s.marker <= 0xEF && s.id !== 'MPF' && s.id !== 'JFIF');
      const nb = bodyOf(gainMapJpeg, ng.segs, ng.end);
      gmBytes = new Uint8Array(2 + apps.reduce((a, b) => a + b.length, 0) + nb.length);
      let k = 0; gmBytes.set([0xFF, 0xD8], 0); k = 2; for (const a of apps) { gmBytes.set(a, k); k += a.length; } gmBytes.set(nb, k);
    }
    let exif = take(o.primarySegs, original, s => s.marker === 0xE1 && s.id === 'Exif')[0];
    if (exif && orientation != null) patchOrientation(exif, orientation);
    const xmp = take(o.primarySegs, original, s => s.marker === 0xE1 && s.id.startsWith('http://ns.adobe.com/xa'));
    const iso = take(o.primarySegs, original, s => s.marker === 0xE2 && s.id.startsWith('urn:iso:std:iso:ts:21496'));
    // keepICCFrom: 'processed' (only the re-encoded primary's own profile), 'original', or 'none'.
    const icc = keepICCFrom === 'processed' ? take(pp.segs, processed, s => s.marker === 0xE2 && s.id === 'ICC_PROFILE')
      : keepICCFrom === 'original' ? take(o.primarySegs, original, s => s.marker === 0xE2 && s.id === 'ICC_PROFILE') : [];
    const body = bodyOf(processed, pp.segs, pp.end);
    const gm = gmBytes;
    const before = [exif, ...xmp, ...icc].filter(Boolean), after = iso;
    const lenOf = a => a.reduce((x, y) => x + y.length, 0);
    const mpfStart = 2 + lenOf(before), mpfLen = buildMPF.len(2), mpfBase = mpfStart + 8;
    const primaryLen = mpfStart + mpfLen + lenOf(after) + body.length;
    const mpf = buildMPF([{ attr: 0x030000, size: primaryLen, offset: 0 }, { attr: 0, size: gm.length, offset: primaryLen - mpfBase }]);
    const outLen = primaryLen + gm.length; const out = new Uint8Array(outLen); let w = 0;
    const put = a => { out.set(a, w); w += a.length; };
    put([0xFF, 0xD8]); before.forEach(put); put(mpf); after.forEach(put); put(body); put(gm);
    return out;
  }

  // Cheap container sniffing for non-JPEG inputs (HEIC / DNG): look for gain-map identifiers.
  function sniffGainMapBytes(u, limit = 4 << 20) {
    const s = ascii(u, 0, Math.min(u.length, limit));
    return { appleAux: s.includes('urn:com:apple:photo:2020:aux:hdrgainmap'), iso: s.includes('urn:iso:std:iso:ts:21496'),
      tmapBox: s.includes('tmap'), hdrgm: s.includes('hdrgm:') };
  }

  const api = { segments, analyze, remux, buildMPF, patchOrientation, iccOf, iccDesc, sniffGainMapBytes, xmpOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.JPEGX = api;
})(typeof window !== 'undefined' ? window : globalThis);
