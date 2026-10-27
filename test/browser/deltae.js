// CIEDE2000（Sharma 2005）與影像色差統計。8-bit P3 → 線性 → XYZ D65 → Lab D65。
// 矩陣與白點和 culori 相同，讓 Node 單元測試能直接對照。瀏覽器與 Node 都能 import。

const P3_TO_XYZ = [
  [0.486570948648216, 0.265667693169093, 0.1982172852343625],
  [0.2289745640697487, 0.6917385218365062, 0.079286914093745],
  [0, 0.0451133818589026, 1.043944368900976],
];
const D65 = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const K = 29 ** 3 / 3 ** 3, E = 6 ** 3 / 29 ** 3;
const f = v => (v > E ? Math.cbrt(v) : (K * v + 16) / 116);
const lin = c => (Math.abs(c) <= 0.04045 ? c / 12.92 : (Math.sign(c) || 1) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);

export function linP3ToLab65(rgb) {
  const xyz = P3_TO_XYZ.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / D65[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** P3 編碼值（0–1）→ Lab D65 */
export function p3ToLab65(e) {
  return linP3ToLab65(e.map(lin));
}

const RAD = Math.PI / 180;

export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hue = (b, a) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) / RAD; return h < 0 ? h + 360 : h; };
  const hp1 = hue(b1, ap1), hp2 = hue(b2, ap2);

  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * RAD);

  const Lp = (L1 + L2) / 2, Cp = (Cp1 + Cp2) / 2;
  let hp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hp = (hp1 + hp2) / 2;
    else hp = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hp - 30) * RAD) + 0.24 * Math.cos(2 * hp * RAD)
    + 0.32 * Math.cos((3 * hp + 6) * RAD) - 0.20 * Math.cos((4 * hp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lp - 50) ** 2) / Math.sqrt(20 + (Lp - 50) ** 2);
  const Sc = 1 + 0.045 * Cp, Sh = 1 + 0.015 * Cp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** 兩張同尺寸 8-bit P3 影像的 ΔE2000 統計 */
export function deltaEStats(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('size mismatch');
  const n = a.width * a.height;
  const lab = new Map();
  const labOf = (d, i) => {
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let v = lab.get(key);
    if (!v) { v = p3ToLab65([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]); lab.set(key, v); }
    return v;
  };
  const de = new Float64Array(n);
  let sum = 0, max = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const same = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2];
    const v = same ? 0 : ciede2000(labOf(a.data, i), labOf(b.data, i));
    de[p] = v; sum += v; if (v > max) max = v;
  }
  de.sort();
  return { mean: sum / n, max, p99: de[Math.floor(0.99 * (n - 1))] };
}
