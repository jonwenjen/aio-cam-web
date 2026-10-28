// 一張畫布只能有一種 context：'webgpu' 用過就拿不到 '2d'（反之亦然）。
// GPU 遺失後引擎可能改成 WebGL2／CPU（兩者在目標畫布上用 '2d'），這時換一張新畫布，保留位置、id、class 與屬性。
const CONTEXT_OF = { webgpu: 'webgpu', webgl2: '2d', cpu: '2d' };

/** @returns {HTMLCanvasElement} 可以給這種引擎 renderToCanvas 的畫布（可能是新的） */
export function canvasFor(canvas, engineKind) {
  const need = CONTEXT_OF[engineKind] ?? '2d';
  const used = canvas.dataset.ctx;
  if (!used || used === need) {
    canvas.dataset.ctx = need;
    return canvas;
  }
  const fresh = document.createElement('canvas');
  for (const { name, value } of canvas.attributes) fresh.setAttribute(name, value);
  fresh.dataset.ctx = need;
  canvas.replaceWith(fresh);
  return fresh;
}
