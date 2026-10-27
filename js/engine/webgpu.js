// WebGPU 引擎：一個 render pipeline（全螢幕三角形），fragment 逐像素做「釘死的數學」。
import { uprightSize } from './params.js';

const SHADER_URL = new URL('./shaders/render.wgsl', import.meta.url);
const UNIFORM_SIZE = 80; // 見 render.wgsl 的 struct U（vec3f 對齊 16）

/** @returns {Promise<Engine|null>} */
export async function createWebGPUEngine() {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const features = adapter.features.has('shader-f16') ? ['shader-f16'] : [];
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: {
      maxTextureDimension2D: Math.min(16384, adapter.limits.maxTextureDimension2D),
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    },
  });
  const code = await (await fetch(SHADER_URL)).text();
  return new WebGPUEngine(device, code, features.includes('shader-f16'));
}

class WebGPUEngine {
  kind = 'webgpu';

  constructor(device, code, shaderF16) {
    this.device = device;
    this.shaderF16 = shaderF16;
    this.lost = false;
    device.lost.then(() => { this.lost = true; });
    const module = device.createShaderModule({ code });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniform = device.createBuffer({ size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.srcCache = { key: null, texture: null };
    this.lutCache = { key: null, texture: null };
    this.contexts = new WeakMap();
  }

  checkAlive() {
    if (this.lost) throw new Error('gpu-lost');
  }

  sourceTexture(src) {
    if (this.srcCache.key === src) return this.srcCache.texture;
    this.srcCache.texture?.destroy();
    const { device } = this;
    const texture = device.createTexture({
      size: [src.width, src.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (src.data) {
      // ImageData：原始位元組，不做色彩轉換
      device.queue.writeTexture({ texture }, src.data, { bytesPerRow: src.width * 4 }, [src.width, src.height]);
    } else {
      device.queue.copyExternalImageToTexture({ source: src }, { texture, colorSpace: 'display-p3' }, [src.width, src.height]);
    }
    this.srcCache = { key: src, texture };
    return texture;
  }

  lutTexture(lut) {
    if (this.lutCache.key === lut) return this.lutCache.texture;
    this.lutCache.texture?.destroy();
    const N = lut.size;
    const texture = this.device.createTexture({
      // rgba32float：與 CPU 的 Float32 LUT 完全相同。f16 的誤差會讓接近中性的顏色 ΔE 超過 S6 門檻；
      // 取樣用 textureLoad 手動內插，不需要 float32-filterable
      size: [N, N, N], dimension: '3d', format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture }, lut.data, { bytesPerRow: N * 16, rowsPerImage: N }, [N, N, N]);
    this.lutCache = { key: lut, texture };
    return texture;
  }

  writeUniform(params, src, target) {
    const b = new ArrayBuffer(UNIFORM_SIZE);
    const f = new Float32Array(b), u = new Uint32Array(b);
    f[0] = 2 ** params.exposureEV;
    f.set(params.wbGains, 4);
    f[7] = params.grain.amount;
    f[8] = params.grain.cellPx;
    f[9] = params.grain.roughness;
    u[10] = params.grain.chroma ? 1 : 0;
    u[11] = params.grain.seed;
    f[12] = params.vignette.amount;
    u[13] = src.width; u[14] = src.height;
    u[15] = target.width; u[16] = target.height; u[17] = target.orientation;
    this.device.queue.writeBuffer(this.uniform, 0, b);
  }

  encodePass(encoder, src, params, target, view) {
    const [W, H] = uprightSize(target.width, target.height, target.orientation);
    if (W !== src.width || H !== src.height) throw new RangeError('target does not match source');
    this.writeUniform(params, src, target);
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: this.sourceTexture(src).createView() },
        { binding: 2, resource: this.lutTexture(params.lut).createView() },
      ],
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }

  async render(src, params, target) {
    this.checkAlive();
    const { device } = this;
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    const { width: w, height: h } = target;
    const out = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder();
      this.encodePass(encoder, src, params, target, out.createView());
      encoder.copyTextureToBuffer({ texture: out }, { buffer, bytesPerRow }, [w, h]);
      device.queue.submit([encoder.finish()]);
      const validation = await device.popErrorScope();
      const oom = await device.popErrorScope();
      if (oom) throw new Error('gpu-oom');
      if (validation) throw new Error('gpu-validation: ' + validation.message);
      await buffer.mapAsync(GPUMapMode.READ);
      this.checkAlive();
      const mapped = new Uint8Array(buffer.getMappedRange());
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
      buffer.unmap();
      return new ImageData(data, w, h, { colorSpace: 'display-p3' });
    } finally {
      out.destroy();
      buffer.destroy();
    }
  }

  /** 預覽：轉正方向、與 src 同尺寸 */
  async renderToCanvas(src, params, canvas) {
    this.checkAlive();
    if (canvas.width !== src.width) canvas.width = src.width;
    if (canvas.height !== src.height) canvas.height = src.height;
    // 預覽與推薦縮圖各有自己的畫布：每個畫布只 configure 一次
    let ctx = this.contexts.get(canvas);
    if (!ctx) {
      ctx = canvas.getContext('webgpu');
      ctx.configure({ device: this.device, format: 'rgba8unorm', colorSpace: 'display-p3', alphaMode: 'opaque' });
      this.contexts.set(canvas, ctx);
    }
    const encoder = this.device.createCommandEncoder();
    this.encodePass(encoder, src, params, { width: src.width, height: src.height, orientation: 1 }, ctx.getCurrentTexture().createView());
    // 不等 onSubmittedWorkDone：等待會跨過 frame 呈現，同一個 task 內的 drawImage 才讀得到這一幀
    this.device.queue.submit([encoder.finish()]);
  }

  dispose() {
    this.srcCache.texture?.destroy();
    this.lutCache.texture?.destroy();
    this.uniform.destroy();
    this.device.destroy();
  }
}
