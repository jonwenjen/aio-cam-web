// 裝置能力（spec §10、§14 除錯面板）。
import { getEngine } from './engine/engine.js';

// 依序嘗試 48.8 / 24 / 16 / 12 MP，畫 1 像素再讀得回才算成功
const CANVAS_SIZES = [[48, 8064, 6048], [24, 5712, 4284], [16, 4896, 3264], [12, 4032, 3024]];

function canvasWorks(w, h) {
  try {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const ok = ctx.getImageData(w - 1, h - 1, 1, 1).data[0] === 255;
    c.width = c.height = 0; // 立刻釋放記憶體
    return ok;
  } catch {
    return false;
  }
}

function p3CanvasSupported() {
  try {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d', { colorSpace: 'display-p3' });
    return ctx?.getContextAttributes?.().colorSpace === 'display-p3';
  } catch {
    return false;
  }
}

let cached = null;

/** @returns {Promise<DeviceProfile>} */
export async function getDeviceProfile({ prefer } = {}) {
  if (cached) return cached;
  const engine = await getEngine({ prefer });
  let shaderF16 = false, maxTexture2D = 0;
  if (navigator.gpu) {
    const adapter = await navigator.gpu.requestAdapter().catch(() => null);
    if (adapter) { shaderF16 = adapter.features.has('shader-f16'); maxTexture2D = adapter.limits.maxTextureDimension2D; }
  }
  if (!maxTexture2D) {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    maxTexture2D = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  let shareFiles = false;
  try { shareFiles = !!navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'a.jpg', { type: 'image/jpeg' })] }); } catch { /* 不支援 */ }
  const sw = screen.width, sh = screen.height;
  cached = {
    engine: engine.kind,
    webgpu: !!navigator.gpu,
    shaderF16,
    maxTexture2D,
    p3Canvas: p3CanvasSupported(),
    shareFiles,
    maxCanvasMP: (CANVAS_SIZES.find(([, w, h]) => canvasWorks(w, h)) ?? [12])[0],
    wakeLock: 'wakeLock' in navigator,
    opfs: typeof navigator.storage?.getDirectory === 'function',
    videoEncoder: typeof VideoEncoder !== 'undefined',
    rtc: typeof RTCPeerConnection !== 'undefined',
    orientationPermission: typeof globalThis.DeviceOrientationEvent?.requestPermission === 'function',
    model: Math.min(sw, sh) === 440 && Math.max(sw, sh) === 956 && devicePixelRatio === 3 ? 'iphone-pro-max-6.9' : 'other',
    ua: navigator.userAgent,
  };
  return cached;
}
