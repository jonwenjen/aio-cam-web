// 單 pass 算圖：解碼 → 曝光與白平衡 → 33³ LUT → 暗角 → 編碼 → 顆粒。
// 數學與 js/engine/cpu-ref.js、render.frag.glsl 逐式一致（計畫「釘死的數學」）。改一邊就同時改另外兩邊。

struct U {
  exposureMul: f32,
  wb: vec3f,
  grainAmount: f32,
  grainCell: f32,
  grainRough: f32,
  grainChroma: u32,
  grainSeed: u32,
  vignette: f32,
  srcW: u32,
  srcH: u32,
  dstW: u32,
  dstH: u32,
  orientation: u32,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var lut: texture_3d<f32>;  // rgba32float，textureLoad（不濾波）

// LUT 三線性內插（手動，與 CPU 同樣的權重；硬體濾波的小數權重只有 8 位元精度）
fn lutAt(i: vec3i) -> vec3f { return textureLoad(lut, i, 0).rgb; }
fn sampleLut(e: vec3f) -> vec3f {
  let t = clamp(e * 32.0, vec3f(0.0), vec3f(32.0));
  let i = min(vec3i(floor(t)), vec3i(31));
  let f = t - vec3f(i);
  let c00 = mix(lutAt(i), lutAt(i + vec3i(1, 0, 0)), f.x);
  let c10 = mix(lutAt(i + vec3i(0, 1, 0)), lutAt(i + vec3i(1, 1, 0)), f.x);
  let c01 = mix(lutAt(i + vec3i(0, 0, 1)), lutAt(i + vec3i(1, 0, 1)), f.x);
  let c11 = mix(lutAt(i + vec3i(0, 1, 1)), lutAt(i + vec3i(1, 1, 1)), f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn decodeOETF(e: f32) -> f32 {
  if (e <= 0.04045) { return e / 12.92; }
  return pow((e + 0.055) / 1.055, 2.4);
}

fn encodeOETF(x: f32) -> f32 {
  if (x <= 0.0031308) { return 12.92 * x; }
  return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

fn enc(x: vec3f) -> vec3f { return log2(1.0 + 255.0 * clamp(x, vec3f(0.0), vec3f(1.0))) / 8.0; }
fn dec(e: vec3f) -> vec3f { return (exp2(8.0 * e) - 1.0) / 255.0; }

// 存檔座標 → 轉正座標（Ws×Hs = 存檔尺寸）
fn storedToUpright(s: vec2u, Ws: u32, Hs: u32, o: u32) -> vec2u {
  switch (o) {
    case 2u: { return vec2u(Ws - 1u - s.x, s.y); }
    case 3u: { return vec2u(Ws - 1u - s.x, Hs - 1u - s.y); }
    case 4u: { return vec2u(s.x, Hs - 1u - s.y); }
    case 5u: { return vec2u(s.y, s.x); }
    case 6u: { return vec2u(Hs - 1u - s.y, s.x); }
    case 7u: { return vec2u(Hs - 1u - s.y, Ws - 1u - s.x); }
    case 8u: { return vec2u(s.y, Ws - 1u - s.x); }
    default: { return s; }
  }
}

fn hash(x: u32, y: u32, s: u32) -> u32 {
  var h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (s * 0xcb1ab31fu);
  h ^= h >> 16u; h *= 0x7feb352du;
  h ^= h >> 15u; h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

fn h2f(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0 * 2.0 - 1.0; }

fn vnoise(p: vec2f, cell: f32, s: u32) -> f32 {
  let q = p / cell;
  let i = floor(q);
  let f = q - i;
  let w = f * f * (3.0 - 2.0 * f);
  let ix = u32(i32(i.x));
  let iy = u32(i32(i.y));
  let a = h2f(hash(ix, iy, s));
  let b = h2f(hash(ix + 1u, iy, s));
  let c = h2f(hash(ix, iy + 1u, s));
  let d = h2f(hash(ix + 1u, iy + 1u, s));
  let top = a + (b - a) * w.x;
  let bot = c + (d - c) * w.x;
  return top + (bot - top) * w.y;
}

fn grainNoise(p: vec2f, s: u32) -> f32 {
  let r = u.grainRough;
  return (1.0 - r) * vnoise(p, u.grainCell, s) + r * vnoise(p, max(1.0, u.grainCell / 2.0), s + 1u);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let sp = vec2u(u32(pos.x), u32(pos.y));
  let up = storedToUpright(sp, u.dstW, u.dstH, u.orientation);
  let px = textureLoad(src, vec2i(up), 0).rgb;

  var lin = vec3f(decodeOETF(px.r), decodeOETF(px.g), decodeOETF(px.b)) * (u.wb * u.exposureMul);
  // LUT：texel 座標 = enc·(N−1)，三線性
  lin = dec(sampleLut(enc(lin)));

  let W = f32(u.srcW);
  let H = f32(u.srcH);
  if (u.vignette > 0.0) {
    let c = vec2f(W, H) * 0.5;
    let r = length(vec2f(up) + 0.5 - c) / length(c);
    lin = lin * (1.0 - u.vignette * smoothstep(0.35, 1.0, r));
  }

  var e = vec3f(encodeOETF(lin.r), encodeOETF(lin.g), encodeOETF(lin.b));
  if (u.grainAmount > 0.0) {
    let Y = 0.2290 * e.r + 0.6917 * e.g + 0.0793 * e.b;
    let k = u.grainAmount * 0.12 * 4.0 * Y * (1.0 - Y);
    let p = vec2f(up);
    if (u.grainChroma != 0u) {
      e = e + k * vec3f(grainNoise(p, u.grainSeed), grainNoise(p, u.grainSeed + 2u), grainNoise(p, u.grainSeed + 4u));
    } else {
      e = e + k * grainNoise(p, u.grainSeed);
    }
  }
  // 與 CPU 的 Math.round 相同（四捨五入），再交給 unorm8 精確轉換
  let q = floor(clamp(e, vec3f(0.0), vec3f(1.0)) * 255.0 + 0.5) / 255.0;
  return vec4f(q, 1.0);
}
