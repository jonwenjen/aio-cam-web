#version 300 es
// 單 pass 算圖：解碼 → 曝光與白平衡 → 33³ LUT → 暗角 → 編碼 → 顆粒。
// 數學與 js/engine/cpu-ref.js、render.wgsl 逐式一致（計畫「釘死的數學」）。改一邊就同時改另外兩邊。
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler2D src;
uniform highp sampler3D lut;   // RGBA32F，texelFetch（不濾波）
uniform float exposureMul;
uniform vec3 wb;
uniform float grainAmount;
uniform float grainCell;
uniform float grainRough;
uniform uint grainChroma;
uniform uint grainSeed;
uniform float vignette;
uniform uint srcW;
uniform uint srcH;
uniform uint dstW;
uniform uint dstH;
uniform uint orientation;
// WebGL 的 gl_FragCoord 原點在左下。讀回（readPixels）時第 0 列就是 y=0，
// 所以 flipY=0 時直接把 y 當存檔列號，讀回的位元組已是由上而下；畫到畫面上（renderToCanvas）時 flipY=1。
uniform uint flipY;

out vec4 outColor;

float decodeOETF(float e) { return e <= 0.04045 ? e / 12.92 : pow((e + 0.055) / 1.055, 2.4); }
float encodeOETF(float x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
vec3 enc(vec3 x) { return log2(1.0 + 255.0 * clamp(x, 0.0, 1.0)) / 8.0; }
vec3 dec(vec3 e) { return (exp2(8.0 * e) - 1.0) / 255.0; }

uvec2 storedToUpright(uvec2 s, uint Ws, uint Hs, uint o) {
  if (o == 2u) return uvec2(Ws - 1u - s.x, s.y);
  if (o == 3u) return uvec2(Ws - 1u - s.x, Hs - 1u - s.y);
  if (o == 4u) return uvec2(s.x, Hs - 1u - s.y);
  if (o == 5u) return uvec2(s.y, s.x);
  if (o == 6u) return uvec2(Hs - 1u - s.y, s.x);
  if (o == 7u) return uvec2(Hs - 1u - s.y, Ws - 1u - s.x);
  if (o == 8u) return uvec2(s.y, Ws - 1u - s.x);
  return s;
}

vec3 lutAt(ivec3 i) { return texelFetch(lut, i, 0).rgb; }
vec3 sampleLut(vec3 e) {
  vec3 t = clamp(e * 32.0, 0.0, 32.0);
  ivec3 i = min(ivec3(floor(t)), ivec3(31));
  vec3 f = t - vec3(i);
  vec3 c00 = mix(lutAt(i), lutAt(i + ivec3(1, 0, 0)), f.x);
  vec3 c10 = mix(lutAt(i + ivec3(0, 1, 0)), lutAt(i + ivec3(1, 1, 0)), f.x);
  vec3 c01 = mix(lutAt(i + ivec3(0, 0, 1)), lutAt(i + ivec3(1, 0, 1)), f.x);
  vec3 c11 = mix(lutAt(i + ivec3(0, 1, 1)), lutAt(i + ivec3(1, 1, 1)), f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

uint hash(uint x, uint y, uint s) {
  uint h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (s * 0xcb1ab31fu);
  h ^= h >> 16u; h *= 0x7feb352du;
  h ^= h >> 15u; h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

float h2f(uint h) { return float(h >> 8u) / 16777216.0 * 2.0 - 1.0; }

float vnoise(vec2 p, float cell, uint s) {
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 f = q - i;
  vec2 w = f * f * (3.0 - 2.0 * f);
  uint ix = uint(int(i.x));
  uint iy = uint(int(i.y));
  float a = h2f(hash(ix, iy, s));
  float b = h2f(hash(ix + 1u, iy, s));
  float c = h2f(hash(ix, iy + 1u, s));
  float d = h2f(hash(ix + 1u, iy + 1u, s));
  float top = a + (b - a) * w.x;
  float bot = c + (d - c) * w.x;
  return top + (bot - top) * w.y;
}

float grainNoise(vec2 p, uint s) {
  float r = grainRough;
  return (1.0 - r) * vnoise(p, grainCell, s) + r * vnoise(p, max(1.0, grainCell / 2.0), s + 1u);
}

void main() {
  uint fy = uint(gl_FragCoord.y);
  uvec2 sp = uvec2(uint(gl_FragCoord.x), flipY != 0u ? dstH - 1u - fy : fy);
  uvec2 up = storedToUpright(sp, dstW, dstH, orientation);
  vec3 px = texelFetch(src, ivec2(up), 0).rgb;

  vec3 lin = vec3(decodeOETF(px.r), decodeOETF(px.g), decodeOETF(px.b)) * (wb * exposureMul);
  lin = dec(sampleLut(enc(lin)));

  float W = float(srcW);
  float H = float(srcH);
  if (vignette > 0.0) {
    vec2 c = vec2(W, H) * 0.5;
    float r = length(vec2(up) + 0.5 - c) / length(c);
    lin = lin * (1.0 - vignette * smoothstep(0.35, 1.0, r));
  }

  vec3 e = vec3(encodeOETF(lin.r), encodeOETF(lin.g), encodeOETF(lin.b));
  if (grainAmount > 0.0) {
    float Y = 0.2290 * e.r + 0.6917 * e.g + 0.0793 * e.b;
    float k = grainAmount * 0.12 * 4.0 * Y * (1.0 - Y);
    vec2 p = vec2(up);
    if (grainChroma != 0u) {
      e = e + k * vec3(grainNoise(p, grainSeed), grainNoise(p, grainSeed + 2u), grainNoise(p, grainSeed + 4u));
    } else {
      e = e + k * grainNoise(p, grainSeed);
    }
  }
  vec3 q = floor(clamp(e, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
  outColor = vec4(q, 1.0);
}
