// 引擎測試套件（Task 10 WebGPU、Task 11 WebGL2 共用）：與 CpuEngine 逐項對照。
import { toImageData } from './harness.js';
import { makeSynthetic, SYNTHETIC_NAMES } from './synthetic.js';
import { deltaEStats } from './deltae.js';
import { CpuEngine } from '../../js/engine/cpu-ref.js';
import { toRenderParams } from '../../js/engine/params.js';
import { BUILTIN, ORDER } from '../../js/looks/builtin.js';
import { normalize } from '../../js/looks/recipe.js';

const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const upright = img => ({ width: img.width, height: img.height, orientation: 1 });
const noopParams = (extra = {}) => toRenderParams(normalize({ ...BUILTIN.asshot.recipe, grain: { amount: 0 }, vignette: { amount: 0 }, ...extra }), { shortSide: 512 });

export async function engineSuite(engine) {
  const cpu = new CpuEngine();
  const details = { kind: engine.kind, failures: [] };
  // 失敗不中斷，全部跑完再回報，明細才看得到
  const check = (cond, msg) => { if (!cond) details.failures.push(msg); };

  // 1. 空操作
  details.noop = {};
  for (const name of ['ramp', 'noise']) {
    const src = toImageData(makeSynthetic(name));
    const out = await engine.render(src, noopParams(), upright(src));
    const d = maxDiff(out.data, src.data);
    details.noop[name] = d;
    check(d <= 1, `no-op ${name} maxDiff ${d}`);
  }

  // 2. 方向 1–8 與 CPU 位元相同
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  const six = toImageData({ width: 3, height: 2, data: Uint8ClampedArray.from(colors.flatMap(c => [...c, 255])) });
  for (let o = 1; o <= 8; o++) {
    const target = o >= 5 ? { width: 2, height: 3, orientation: o } : { width: 3, height: 2, orientation: o };
    const g = await engine.render(six, noopParams(), target);
    const c = await cpu.render(six, noopParams(), target);
    check(g.width === target.width && g.height === target.height, `orientation ${o} size`);
    check(maxDiff(g.data, c.data) === 0, `orientation ${o} differs from CPU`);
  }
  details.orientation = 'ok';

  // 3. 7 組發色 × 4 張合成圖：ΔE2000 mean ≤ 0.5、max ≤ 2.0
  details.looks = {};
  let worst = { mean: 0, max: 0 };
  for (const name of SYNTHETIC_NAMES) {
    const src = toImageData(makeSynthetic(name));
    for (const id of ORDER) {
      const params = toRenderParams(BUILTIN[id].recipe, { shortSide: Math.min(src.width, src.height) });
      const s = deltaEStats(await engine.render(src, params, upright(src)), await cpu.render(src, params, upright(src)));
      details.looks[`${name}/${id}`] = { mean: +s.mean.toFixed(4), max: +s.max.toFixed(3), p99: +s.p99.toFixed(3) };
      worst = { mean: Math.max(worst.mean, s.mean), max: Math.max(worst.max, s.max) };
    }
  }
  details.worst = worst;
  check(worst.mean <= 0.5 && worst.max <= 2.0, `ΔE worst mean ${worst.mean} max ${worst.max}`);

  // 4. 顆粒：與 CPU 每像素差 ≤ 1
  {
    const src = toImageData(makeSynthetic('noise'));
    for (const chroma of [false, true]) {
      const p = noopParams({ grain: { amount: 1, chroma } });
      const d = maxDiff((await engine.render(src, p, upright(src))).data, (await cpu.render(src, p, upright(src))).data);
      details[`grain${chroma ? 'Chroma' : ''}MaxDiff`] = d;
      check(d <= 1, `grain chroma=${chroma} maxDiff ${d}`);
    }
  }

  // 5. renderToCanvas 不是全黑
  {
    const src = toImageData(makeSynthetic('hueWheel', 256, 128));
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    await engine.renderToCanvas(src, toRenderParams(BUILTIN.hiyori.recipe, { shortSide: 128 }), canvas);
    const c2 = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = c2.getContext('2d', { colorSpace: 'display-p3' });
    ctx.drawImage(canvas, 0, 0);
    const px = ctx.getImageData(0, 0, c2.width, c2.height).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    details.canvas = { size: [canvas.width, canvas.height], litFraction: +(lit / (px.length / 4)).toFixed(3) };
    check(canvas.width === 256 && canvas.height === 128 && lit / (px.length / 4) > 0.5, 'renderToCanvas output is black');
  }
  details.pass = details.failures.length === 0;
  return details;
}
