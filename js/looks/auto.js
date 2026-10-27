// 一鍵自動調整（spec §7.5.2、N41）。所有輸出四捨五入：EV 到 0.05、色溫到 50、其他到 0.01（確定、滑桿顯示整齊）。
import { linP3ToOklab } from '../color/p3.js';
import { wbGains } from './lut.js';

const round = (v, step) => Number((Math.round(v / step) * step).toFixed(4)) || 0; // || 0：不要 −0
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const DARKEN_MIN_CLIP = 0.005; // 過曝（Y > 0.95）像素比例超過 0.5% 才准降曝光
const WB_LIMIT = 200;          // 自動白平衡只輕推 ±200 K，大幅修色溫交給手動滑桿（spec v0.6）

function exposureEV(s) {
  const snow = s.pY.p50 > 0.45 && s.meanChroma < 0.03; // 高調雪景
  const target = s.scenes.night > 0.5 ? 0.08 : snow ? 0.30 : 0.18;
  let ev = clamp(0.8 * Math.log2(target / Math.exp(s.logMeanY)), -2, 2);
  if (ev > 0) ev = Math.min(ev, Math.max(0, Math.log2(0.95 / Math.max(s.pY.p99_5, 1e-4)))); // p99.5 不超過 0.95
  // 只有高光真的過曝才降曝光：iPhone 刻意拍亮的照片（白牆、逆光人像）不要被壓暗（spec v0.6）
  if (ev < 0 && s.clipHi <= DARKEN_MIN_CLIP) ev = 0;
  return Math.abs(ev) < 0.15 ? 0 : ev;
}

const CAST_DEADZONE = 0.008; // spec §7.5.2

/** 讓近中性平均色經 wbGains(temp, tint) 後最接近中性（色溫 100K、色調 5 的格點） */
function whiteBalance(s) {
  const { cast } = s;
  if (!cast.reliable || Math.hypot(cast.a, cast.b) < CAST_DEADZONE) return { temp: 0, tint: 0 };
  let best = { d: Infinity, temp: 0, tint: 0 };
  for (let temp = -2000; temp <= 3000; temp += 100) {
    for (let tint = -100; tint <= 100; tint += 5) {
      const g = wbGains(temp, tint);
      const [, a, b] = linP3ToOklab([cast.rgb[0] * g[0], cast.rgb[1] * g[1], cast.rgb[2] * g[2]]);
      const d = a * a + b * b;
      if (d < best.d) best = { d, temp, tint };
    }
  }
  const k = s.scenes.golden > 0.5 || s.scenes.indoorWarm > 0.5 ? 0.3 : 0.7; // 保留現場氣氛
  return { temp: clamp(best.temp * k, -WB_LIMIT, WB_LIMIT), tint: best.tint * k };
}

/** @returns {Recipe['auto']} */
export function autoAdjust(s) {
  const ev = exposureEV(s);
  const { temp, tint } = whiteBalance(s);
  const gain = 2 ** ev;
  const p99 = s.pY.p99_5 * gain, p0 = s.pY.p0_5 * gain;
  const highlights = s.clipHi > 0.02 ? -Math.min(0.6, 10 * s.clipHi) : 0;
  const shadows = s.backlit || s.dynRange > 7 ? Math.max(0, Math.min(0.5, 0.1 * (s.dynRange - 6))) : 0;
  // 白位／黑位只在影像有實際影調範圍時調整（≥ 2 檔）；單一色調（灰卡）沒有白點黑點可言
  const hasRange = s.dynRange >= 2;
  const whites = hasRange && p99 < 0.7 ? Math.min(0.4, 0.8 * (0.7 - p99)) : 0;
  const blacks = hasRange && p0 > 0.03 ? -Math.min(0.4, 4 * (p0 - 0.03)) : 0;
  // 完全沒有彩度（< 0.01）的影像加自然飽和沒有意義
  const vibrance = s.meanChroma >= 0.01 && s.meanChroma < 0.04 && s.scenes.night < 0.5 ? 0.15 : 0;
  return {
    exposure: round(ev, 0.05),
    temp: round(clamp(temp, -2000, 3000), 50),
    tint: round(clamp(tint, -100, 100), 0.01),
    highlights: round(highlights, 0.01),
    shadows: round(shadows, 0.01),
    whites: round(whites, 0.01),
    blacks: round(blacks, 0.01),
    vibrance: round(vibrance, 0.01),
  };
}
