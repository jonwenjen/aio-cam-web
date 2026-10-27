// WebGL2 引擎（沒有 WebGPU 時的退路，S7）。數學與 render.wgsl、cpu-ref.js 一致。
import { uprightSize } from './params.js';

const VERT_URL = new URL('./shaders/render.vert.glsl', import.meta.url);
const FRAG_URL = new URL('./shaders/render.frag.glsl', import.meta.url);

function compile(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

/**
 * shader 是獨立檔案（沒有建置工具），要先 fetch，所以是 async。
 * @param {HTMLCanvasElement|OffscreenCanvas} [canvas] 引擎自己的繪圖畫布
 * @returns {Promise<Engine|null>}
 */
export async function createWebGL2Engine(canvas) {
  const c = canvas ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
  const gl = c.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const [vs, fs] = await Promise.all([VERT_URL, FRAG_URL].map(async u => (await fetch(u)).text()));
  return new WebGL2Engine(c, gl, vs, fs);
}

class WebGL2Engine {
  kind = 'webgl2';

  constructor(canvas, gl, vsSource, fsSource) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    canvas.addEventListener?.('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'display-p3';
    if ('unpackColorSpace' in gl) gl.unpackColorSpace = 'display-p3';

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vsSource));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.loc = {};
    for (const n of ['src', 'lut', 'exposureMul', 'wb', 'grainAmount', 'grainCell', 'grainRough', 'grainChroma', 'grainSeed',
      'vignette', 'srcW', 'srcH', 'dstW', 'dstH', 'orientation', 'flipY']) this.loc[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray();
    this.srcCache = { key: null, tex: null };
    this.lutCache = { key: null, tex: null };
  }

  checkAlive() {
    if (this.lost || this.gl.isContextLost()) throw new Error('gpu-lost');
  }

  sourceTexture(src) {
    const { gl } = this;
    if (this.srcCache.key === src) return this.srcCache.tex;
    if (this.srcCache.tex) gl.deleteTexture(this.srcCache.tex);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (src.data) {
      // ImageData：原始位元組，不做色彩轉換
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array(src.data.buffer, src.data.byteOffset, src.data.byteLength));
    } else {
      // ImageBitmap：由瀏覽器轉到 unpackColorSpace（display-p3）
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.srcCache = { key: src, tex };
    return tex;
  }

  lutTexture(lut) {
    const { gl } = this;
    if (this.lutCache.key === lut) return this.lutCache.tex;
    if (this.lutCache.tex) gl.deleteTexture(this.lutCache.tex);
    const N = lut.size;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // RGBA32F：與 CPU 的 Float32 LUT 完全相同；texelFetch 手動內插，不需要浮點濾波擴充
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, N, N, N, 0, gl.RGBA, gl.FLOAT, lut.data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    this.lutCache = { key: lut, tex };
    return tex;
  }

  draw(src, params, target, flipY) {
    const { gl, loc } = this;
    const [W, H] = uprightSize(target.width, target.height, target.orientation);
    if (W !== src.width || H !== src.height) throw new RangeError('target does not match source');
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture(src));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture(params.lut));
    gl.uniform1i(loc.src, 0);
    gl.uniform1i(loc.lut, 1);
    gl.uniform1f(loc.exposureMul, 2 ** params.exposureEV);
    gl.uniform3fv(loc.wb, params.wbGains);
    gl.uniform1f(loc.grainAmount, params.grain.amount);
    gl.uniform1f(loc.grainCell, params.grain.cellPx);
    gl.uniform1f(loc.grainRough, params.grain.roughness);
    gl.uniform1ui(loc.grainChroma, params.grain.chroma ? 1 : 0);
    gl.uniform1ui(loc.grainSeed, params.grain.seed);
    gl.uniform1f(loc.vignette, params.vignette.amount);
    gl.uniform1ui(loc.srcW, src.width);
    gl.uniform1ui(loc.srcH, src.height);
    gl.uniform1ui(loc.dstW, target.width);
    gl.uniform1ui(loc.dstH, target.height);
    gl.uniform1ui(loc.orientation, target.orientation);
    gl.uniform1ui(loc.flipY, flipY ? 1 : 0);
    gl.viewport(0, 0, target.width, target.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  async render(src, params, target) {
    this.checkAlive();
    const { gl } = this;
    const { width: w, height: h } = target;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    try {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gpu-oom');
      this.draw(src, params, target, false);
      const data = new Uint8ClampedArray(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer));
      const err = gl.getError();
      if (err === gl.OUT_OF_MEMORY) throw new Error('gpu-oom');
      this.checkAlive();
      return new ImageData(data, w, h, { colorSpace: 'display-p3' });
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
    }
  }

  /** 預覽：畫在引擎自己的畫布，再以 P3 2D 畫布複製到目標畫布（轉正方向、與 src 同尺寸） */
  async renderToCanvas(src, params, canvas) {
    this.checkAlive();
    const own = canvas === this.canvas;
    if (this.canvas.width !== src.width) this.canvas.width = src.width;
    if (this.canvas.height !== src.height) this.canvas.height = src.height;
    this.draw(src, params, { width: src.width, height: src.height, orientation: 1 }, true);
    if (own) return;
    if (canvas.width !== src.width) canvas.width = src.width;
    if (canvas.height !== src.height) canvas.height = src.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    ctx.drawImage(this.canvas, 0, 0);
  }

  dispose() {
    const { gl } = this;
    if (this.srcCache.tex) gl.deleteTexture(this.srcCache.tex);
    if (this.lutCache.tex) gl.deleteTexture(this.lutCache.tex);
    gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
