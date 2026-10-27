// 配方模型（spec §9.1）：預設值、範圍夾值、差異、網址編碼。
// M1 引擎只用 wb、tone、color.saturation/vibrance、hsl、grade、grain、vignette、auto；其餘欄位解析並保存。

const hsl3 = () => [0, 0, 0];

export const DEFAULTS = Object.freeze(deepFreeze({
  v: 1, name: '', base: 'asshot', intensity: 1,
  wb: { temp: 0, tint: 0 },
  tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
  curve: { rgb: [], r: [], g: [], b: [] },
  color: { saturation: 0, vibrance: 0, pad: [0, 0], chrome: 0, chromeBlue: 0 },
  hsl: { red: hsl3(), orange: hsl3(), yellow: hsl3(), green: hsl3(), aqua: hsl3(), blue: hsl3(), purple: hsl3(), magenta: hsl3() },
  grade: { shadows: [0, 0], midtones: [0, 0], highlights: [0, 0], balance: 0 },
  paper: 'neutral',
  mono: { filter: 'none', tone: 'neutral' },
  tintBar: { hue: 0, amount: 0 },
  skinProtect: 0.5,
  detail: { sharpen: 0, clarity: 0, dehaze: 0, denoise: 0 },
  filter: { id: 'none', amount: 1 },
  effects: { halation: 0, diffusion: 0, glow: 0, flash: 0, leak: 0 },
  keepColor: null,
  grain: { amount: 0.2, size: 1, roughness: 0.5, format: '35mm', chroma: false },
  vignette: { amount: 0.15 },
  lensAware: true,
  auto: null,
}));

function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

const U = [0, 1], S = [-1, 1], HUE = [0, 360, 'wrap'];
const band = [S, S, S];

/** 每個數值欄位的 [min, max]（'wrap' = 取模）。形狀與 DEFAULTS 相同。 */
export const RANGES = deepFreeze({
  intensity: U,
  wb: { temp: [-2000, 3000], tint: [-100, 100] },
  tone: { exposure: [-3, 3], contrast: S, highlights: S, shadows: S, whites: S, blacks: S },
  color: { saturation: S, vibrance: S, pad: [S, S], chrome: U, chromeBlue: U },
  hsl: { red: band, orange: band, yellow: band, green: band, aqua: band, blue: band, purple: band, magenta: band },
  grade: { shadows: [HUE, U], midtones: [HUE, U], highlights: [HUE, U], balance: S },
  tintBar: { hue: HUE, amount: U },
  skinProtect: U,
  detail: { sharpen: U, clarity: S, dehaze: S, denoise: U },
  filter: { amount: U },
  effects: { halation: U, diffusion: U, glow: U, flash: U, leak: U },
  grain: { amount: U, size: [0.5, 3], roughness: U },
  vignette: { amount: U },
  auto: { exposure: [-2, 2], temp: [-2000, 3000], tint: [-100, 100], highlights: S, shadows: S, whites: S, blacks: S, vibrance: S },
});

const ENUMS = {
  paper: ['neutral', 'warm', 'cool', 'hard'],
  'mono.filter': ['none', 'yellow', 'orange', 'red', 'green'],
  'mono.tone': ['neutral', 'sepia', 'selenium', 'cyan', 'warm'],
  'grain.format': ['half', '35mm', '120'],
};
const ID_RE = /^[a-z0-9-]{1,32}$/; // base、filter.id
const CURVE_MAX = 8;

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = x => typeof x === 'number' && Number.isFinite(x);

function clampNum(x, range, dflt) {
  if (!isNum(x)) return dflt;
  if (!range) return x;
  const [lo, hi, wrap] = range;
  if (wrap) return ((x % hi) + hi) % hi;
  return Math.min(hi, Math.max(lo, x));
}

function normCurve(x) {
  if (!Array.isArray(x)) return [];
  const pts = x.filter(p => Array.isArray(p) && p.length === 2 && p.every(isNum))
    .slice(0, CURVE_MAX).map(([a, b]) => [Math.min(1, Math.max(0, a)), Math.min(1, Math.max(0, b))]);
  return pts;
}

function normValue(dflt, input, range, path) {
  if (path.startsWith('curve.')) return normCurve(input);
  if (typeof dflt === 'number') return clampNum(input, range, dflt);
  if (typeof dflt === 'boolean') return typeof input === 'boolean' ? input : dflt;
  if (typeof dflt === 'string') {
    if (typeof input !== 'string') return dflt;
    if (ENUMS[path]) return ENUMS[path].includes(input) ? input : dflt;
    if (path === 'base' || path === 'filter.id') return ID_RE.test(input) ? input : dflt;
    return input.slice(0, 64);
  }
  if (Array.isArray(dflt)) {
    if (!Array.isArray(input) || input.length !== dflt.length) return [...dflt];
    return dflt.map((d, i) => clampNum(input[i], range?.[i], d));
  }
  if (isObj(dflt)) {
    const src = isObj(input) ? input : {};
    return Object.fromEntries(Object.keys(dflt).map(k => [k, normValue(dflt[k], src[k], range?.[k], path ? `${path}.${k}` : k)]));
  }
  return dflt;
}

function normAuto(input) {
  if (!isObj(input)) return null;
  return Object.fromEntries(Object.entries(RANGES.auto).map(([k, r]) => [k, clampNum(input[k], r, 0)]));
}

function normKeepColor(input) {
  // M1 不使用；只保存可序列化的物件
  if (!isObj(input)) return null;
  try { return JSON.parse(JSON.stringify(input)); } catch { return null; }
}

/** 深層合併到 DEFAULTS、夾值、丟掉不認得的欄位。 */
export function normalize(input) {
  const src = isObj(input) ? input : {};
  const out = normValue(DEFAULTS, src, RANGES, '');
  out.v = 1;
  out.auto = normAuto(src.auto);
  out.keepColor = normKeepColor(src.keepColor);
  return out;
}

const EPS = 1e-9;
function same(a, b) {
  if (isNum(a) && isNum(b)) return Math.abs(a - b) <= EPS;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(k => same(a[k], b[k]));
  }
  return a === b;
}

/** 只留與 baseRecipe 不同的欄位（陣列、auto、keepColor 整個比較）。 */
export function diff(recipe, baseRecipe) {
  const walk = (a, b, top) => {
    const out = {};
    for (const k of Object.keys(a)) {
      if (same(a[k], b?.[k])) continue;
      const nested = isObj(a[k]) && isObj(b?.[k]) && !(top && (k === 'auto' || k === 'keepColor'));
      out[k] = nested ? walk(a[k], b[k], false) : a[k];
    }
    return out;
  };
  return walk(recipe, baseRecipe, true);
}

function mergeDiff(baseRecipe, d) {
  const walk = (b, x) => {
    if (!isObj(x) || !isObj(b)) return x;
    const out = { ...b };
    for (const k of Object.keys(x)) out[k] = isObj(b[k]) ? walk(b[k], x[k]) : x[k];
    return out;
  };
  return walk(baseRecipe, d);
}

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('bad base64url');
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** JSON(diff + {b: base}) → deflate-raw → base64url（無 =）。 */
export async function encodeForUrl(recipe, baseRecipe) {
  const json = JSON.stringify({ ...diff(recipe, baseRecipe), b: recipe.base });
  return toBase64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

/** 失敗回傳 null（不丟錯）。 */
export async function decodeFromUrl(s, getBase) {
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(s), new DecompressionStream('deflate-raw')));
    const { b, ...d } = JSON.parse(json);
    if (typeof b !== 'string') return null;
    const baseRecipe = getBase(b);
    if (!baseRecipe) return null;
    return normalize({ ...mergeDiff(baseRecipe, d), base: b });
  } catch {
    return null;
  }
}

/** 換發色：保留使用者的 intensity、tone.exposure、auto，其他欄位換成 baseRecipe 的值。 */
export function withBase(recipe, baseRecipe) {
  const b = normalize(baseRecipe);
  return normalize({ ...b, intensity: recipe.intensity, tone: { ...b.tone, exposure: recipe.tone.exposure }, auto: recipe.auto });
}
