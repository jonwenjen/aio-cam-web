// 引擎選擇與復原：預設 WebGPU → WebGL2 → CPU；網址 ?engine=webgpu|webgl2|cpu 可指定優先。
import { createWebGPUEngine } from './webgpu.js';
import { createWebGL2Engine } from './webgl2.js';
import { CpuEngine } from './cpu-ref.js';

const FACTORIES = {
  webgpu: () => createWebGPUEngine().catch(() => null),
  webgl2: () => createWebGL2Engine().catch(() => null),
  cpu: async () => new CpuEngine(),
};
const DEFAULT_ORDER = ['webgpu', 'webgl2', 'cpu'];

let current = null;
let currentPrefer;

async function create(prefer) {
  const order = prefer && FACTORIES[prefer] ? [prefer, ...DEFAULT_ORDER.filter(k => k !== prefer)] : DEFAULT_ORDER;
  for (const kind of order) {
    const e = await FACTORIES[kind]();
    if (e) return e;
  }
  return new CpuEngine();
}

/** @returns {Promise<Engine>} 同一個 prefer 會重用已建立的引擎 */
export async function getEngine({ prefer } = {}) {
  if (!current || prefer !== currentPrefer) {
    current?.dispose();
    currentPrefer = prefer;
    current = create(prefer);
  }
  return current;
}

/**
 * gpu-lost → 重建引擎重試一次；gpu-oom → 丟 needs-downscale，讓呼叫端以 24MP 重試（spec §13）。
 * @template T @param {(engine: Engine) => Promise<T>} fn
 */
export async function renderWithRecovery(fn) {
  try {
    return await fn(await getEngine({ prefer: currentPrefer }));
  } catch (e) {
    if (e?.message === 'gpu-oom') throw new Error('needs-downscale');
    if (e?.message !== 'gpu-lost') throw e;
    (await current)?.dispose?.();
    current = create(currentPrefer);
    try {
      return await fn(await current);
    } catch (e2) {
      if (e2?.message === 'gpu-oom') throw new Error('needs-downscale');
      throw e2;
    }
  }
}
