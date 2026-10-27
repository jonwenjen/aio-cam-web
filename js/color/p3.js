// Display P3 色彩數學：傳遞函數、LUT 編碼、矩陣、OKLab。CPU、WebGPU、WebGL2 必須逐式一致（計畫「釘死的數學」）。

/** 8-bit P3 編碼值 → 線性（sRGB 傳遞函數） */
export function decode8(v) {
  return decodeOETF(v / 255);
}

export function decodeOETF(e) {
  return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
}

export function encodeOETF(x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** LUT 取樣座標：log2(1 + 255·clamp(x,0,1)) / 8 */
export function enc(x) {
  return Math.log2(1 + 255 * Math.min(1, Math.max(0, x))) / 8;
}

export function dec(e) {
  return (2 ** (8 * e) - 1) / 255;
}

export function mul3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function matMul(a, b) {
  return a.map(row => [0, 1, 2].map(c => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
}

function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// CSS Color 4（D65）
export const P3_TO_XYZ = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0, 0.0451134, 1.0439444],
];
export const XYZ_TO_P3 = inv3(P3_TO_XYZ);
const SRGB_TO_XYZ = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
export const SRGB_TO_P3 = matMul(XYZ_TO_P3, SRGB_TO_XYZ);

// OKLab：XYZ → LMS（M1）→ 立方根 → Lab（M2）
const XYZ_TO_LMS = [
  [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_LAB = [
  [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
  [0.0259040424655478, 0.7827717124575296, -0.8086757660377118],
];
const P3_TO_LMS = matMul(XYZ_TO_LMS, P3_TO_XYZ);
const LMS_TO_P3 = inv3(P3_TO_LMS);
const LAB_TO_LMS = inv3(LMS_TO_LAB);

export function linP3ToOklab(rgb) {
  const lms = mul3(P3_TO_LMS, rgb).map(Math.cbrt);
  return mul3(LMS_TO_LAB, lms);
}

export function oklabToLinP3(lab) {
  const lms = mul3(LAB_TO_LMS, lab).map(v => v * v * v);
  return mul3(LMS_TO_P3, lms);
}

/** P3 亮度係數（作用在編碼值或線性值皆可） */
export const LUMA = [0.2290, 0.6917, 0.0793];
export function lumaP3(e) {
  return LUMA[0] * e[0] + LUMA[1] * e[1] + LUMA[2] * e[2];
}
