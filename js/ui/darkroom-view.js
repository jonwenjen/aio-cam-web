// 暗房：匯入 → 自動／推薦 → 發色、強度、曝光 → 存檔（spec §7、§7.5.4、§8、§11）。
// 所有可見文字與 aria-label 都經 t()；disabled 等狀態只在 render() 依 state 計算。
import { t, onLangChange, setLang, getLang, LANGS, LANG_NAMES } from '../i18n/index.js';
import { importFile, decodeUpright } from '../io/import.js';
import { exportImage } from '../io/export.js';
import { deliver, shareNow } from '../io/deliver.js';
import { renderWithRecovery } from '../engine/engine.js';
import { toRenderParams, lutKey } from '../engine/params.js';
import { buildLut } from '../looks/lut.js';
import { normalize, withBase } from '../looks/recipe.js';
import { BUILTIN } from '../looks/builtin.js';
import { thumbnailOf, analyzeScene, exifForAnalysis } from '../looks/analyze.js';
import { autoAdjust } from '../looks/auto.js';
import { recommend } from '../looks/recommend.js';
import { mountToasts, showToast } from './toast.js';
import { renderLookStrip, markSelectedLook } from './look-strip.js';
import { renderRecommendRow, markSelectedRec } from './recommend-row.js';
import { renderPrivacy, loadPrivacy, savePrivacy } from './save-sheet.js';
import { mountDebugPanel } from './debug-panel.js';
import { canvasFor } from './canvas-kind.js';
import { getDeviceProfile } from '../device.js';

const HOLD_MS = 150;
const AUTO_ON_IMPORT = 'aio.autoOnImport';
const HEIC_HINT = 'aio.heicHintShown';
const DEBUG = 'aio.debug'; // 從主畫面開啟時網址沒有 ?debug=1，所以設定裡的開關要記住

const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 私密瀏覽 */ } };
const clone = x => JSON.parse(JSON.stringify(x));

// 原圖比較用：恆等（不改色、無顆粒暗角）
const ORIGINAL = normalize({ grain: { amount: 0 }, vignette: { amount: 0 } });

const lutCache = new Map();
function paramsFor(recipe, img) {
  const key = lutKey(recipe);
  let lut = lutCache.get(key);
  if (!lut) {
    if (lutCache.size > 24) lutCache.delete(lutCache.keys().next().value);
    lut = buildLut(recipe);
    lutCache.set(key, lut);
  }
  return toRenderParams(recipe, { shortSide: Math.min(img.width, img.height), lut });
}

/** 32×32 縮圖的 FNV-1a 雜湊（測試用來判斷預覽是否改變） */
function previewHash(canvas) {
  const c = new OffscreenCanvas(32, 32);
  const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619);
  return (h >>> 0).toString(16);
}

const TEMPLATE = `
<header class="toolbar">
  <button type="button" id="auto-btn" class="primary auto"></button>
  <span class="spacer"></span>
  <select id="lang-select" class="tool"></select>
  <button type="button" id="settings-btn" class="tool" aria-expanded="false" aria-controls="settings-panel"></button>
</header>
<section id="settings-panel" hidden>
  <label class="switch"><input type="checkbox" id="auto-on-import"><span id="auto-on-import-label"></span></label>
  <label class="switch"><input type="checkbox" id="debug-toggle"><span id="debug-toggle-label"></span></label>
</section>
<main id="preview">
  <canvas id="preview-canvas"></canvas>
  <span id="hdr-badge" hidden></span>
  <p id="compare-hint" class="hint"></p>
  <div id="empty-state">
    <label for="file-input" id="empty-import" class="primary"></label>
    <p id="empty-text"></p>
  </div>
</main>
<section id="recommend" hidden></section>
<nav id="looks" class="look-strip"></nav>
<section class="sliders">
  <label class="slider"><span id="intensity-label"></span><input type="range" id="intensity" min="0" max="1" step="0.01"></label>
  <label class="slider"><span id="exposure-label"></span><input type="range" id="exposure" min="-3" max="3" step="0.05"></label>
</section>
<div id="privacy" class="segmented"></div>
<footer class="actions">
  <label id="import-btn" class="primary"><input type="file" id="file-input" accept="image/*" multiple hidden><span id="import-label"></span></label>
  <button type="button" id="save-btn" class="primary save"><span class="spinner" aria-hidden="true"></span><span id="save-label"></span></button>
</footer>`;

export function mountDarkroom(root, { debug = false } = {}) {
  root.innerHTML = TEMPLATE;
  const $ = s => root.querySelector(s);
  mountToasts(root);

  const state = {
    src: null, bitmap: null, thumb: null, stats: null, recommendations: null,
    recipe: normalize({}), autoOn: false, recipeBeforeAuto: null,
    privacy: loadPrivacy(), busy: false, pendingShare: null, lastExport: null, autoMs: null, exportCount: 0, maxPixels: Infinity,
    previewReady: false, rendering: false, renderCount: 0, importCount: 0, lastPreviewHash: null, showOriginal: false,
  };
  const els = {
    auto: $('#auto-btn'), lang: $('#lang-select'), settings: $('#settings-btn'), settingsPanel: $('#settings-panel'),
    autoOnImport: $('#auto-on-import'), preview: $('#preview'), canvas: $('#preview-canvas'), hdr: $('#hdr-badge'),
    empty: $('#empty-state'), recommend: $('#recommend'), looks: $('#looks'), intensity: $('#intensity'),
    exposure: $('#exposure'), privacy: $('#privacy'), file: $('#file-input'), save: $('#save-btn'),
  };
  let recCanvases = [];

  // ---- 算圖佇列：預覽與推薦縮圖依序畫，預覽合併到同一幀 ----
  const queue = [];
  let running = false, previewQueued = false;
  function enqueue(job) {
    queue.push(job);
    state.rendering = true;
    if (!running) drain();
  }
  async function drain() {
    running = true;
    while (queue.length) {
      try { await queue.shift()(); } catch (e) { console.error(e); showToast(t('error.generic')); }
    }
    running = false;
    state.rendering = false;
  }
  function schedulePreview() {
    if (!state.bitmap || previewQueued) return;
    previewQueued = true;
    enqueue(() => new Promise((resolve, reject) => requestAnimationFrame(async () => {
      previewQueued = false;
      try {
        const bmp = state.bitmap;
        const params = paramsFor(state.showOriginal ? ORIGINAL : state.recipe, bmp);
        // 引擎可能在 GPU 遺失後換了種類：畫布 context 不合就換一張（canvas-kind.js）
        await renderWithRecovery(e => e.renderToCanvas(bmp, params, (els.canvas = canvasFor(els.canvas, e.kind))));
        state.lastPreviewHash = previewHash(els.canvas); // 同一個 task 內讀，WebGPU 畫布才還在
        state.previewReady = true;
        state.renderCount++;
        resolve();
      } catch (e) { reject(e); }
    })));
  }
  function scheduleRecs() {
    const recs = state.recommendations, thumb = state.thumb;
    if (!recs || !thumb) return;
    const canvases = recCanvases;
    recs.forEach((r, i) => enqueue(async () => {
      const recipe = withBase(state.recipe, BUILTIN[r.lookId].recipe);
      await renderWithRecovery(e => e.renderToCanvas(thumb, paramsFor(recipe, thumb), (canvases[i] = canvasFor(canvases[i], e.kind))));
    }));
  }

  // ---- 動作 ----
  function setRecipe(recipe) {
    state.recipe = normalize(recipe);
    state.pendingShare = null; // 待分享的檔案是舊的編輯結果，作廢
    render();
    schedulePreview();
  }
  function pickLook(id) {
    setRecipe(withBase(state.recipe, BUILTIN[id].recipe));
  }
  function toggleAuto() {
    if (!state.stats) return;
    if (state.autoOn) {
      state.autoOn = false;
      setRecipe(state.recipeBeforeAuto);
      state.recipeBeforeAuto = null;
    } else {
      state.recipeBeforeAuto = clone(state.recipe);
      const auto = autoAdjust(state.stats);
      const top = state.recommendations[0].lookId;
      state.autoOn = true;
      setRecipe(withBase({ ...state.recipe, auto }, BUILTIN[top].recipe));
      const items = [];
      if (auto.exposure) items.push(t('auto.item.exposure', { value: (auto.exposure > 0 ? '+' : '') + auto.exposure.toFixed(2) }));
      if (auto.temp) items.push(t('auto.item.temp', { value: (auto.temp > 0 ? '+' : '−') + Math.abs(auto.temp) }));
      items.push(t(`look.${top}.name`));
      showToast(t('auto.applied', { items: items.join('、') }));
    }
    scheduleRecs();
  }

  let importToken = 0;
  async function onFiles(files) {
    if (!files?.length) return;
    if (files.length > 1) showToast(t('notice.batchLater'));
    const token = ++importToken; // 連續選兩張時，較慢的前一張完成後直接丟棄
    state.previewReady = false;
    let bitmap = null;
    try {
      const src = await importFile(files[0]);
      if (token !== importToken) return;
      const longest = Math.min(2048, Math.round(devicePixelRatio * Math.max(els.preview.clientWidth, els.preview.clientHeight)) || 2048);
      bitmap = await decodeUpright(src, { maxLongSide: longest });
      if (token !== importToken) return;
      const thumb = await thumbnailOf(src);
      if (token !== importToken) return;
      const t0 = performance.now();
      const stats = analyzeScene(thumb, exifForAnalysis(src));
      const recs = recommend(stats);
      state.autoMs = +(performance.now() - t0).toFixed(1);
      state.bitmap?.close();
      Object.assign(state, { src, bitmap, thumb, stats, recommendations: recs, autoOn: false, recipeBeforeAuto: null, pendingShare: null });
      bitmap = null; // 已交給 state
      // 換照片：保留發色與強度，曝光與自動歸零
      state.recipe = withBase(normalize({ intensity: state.recipe.intensity }), BUILTIN[state.recipe.base].recipe);
      recCanvases = renderRecommendRow(els.recommend, recs, { selected: state.recipe.base, onPick: pickLook });
      if (lsGet(AUTO_ON_IMPORT) === '1') toggleAuto();
      else scheduleRecs();
      render();
      schedulePreview();
    } catch (e) {
      if (token === importToken) {
        showToast(t(e?.message === 'decode-failed' ? 'error.decode' : 'error.generic'));
        if (e?.message !== 'decode-failed') console.error(e);
      }
    } finally {
      bitmap?.close(); // 被丟棄的匯入
      state.importCount++;
      els.file.value = '';
    }
  }

  async function onSave() {
    if (state.pendingShare) {
      // 手勢過期或取消後再按：直接分享同一個檔案（此時有新的使用者手勢），不重做處理
      if (state.busy) return;
      const file = state.pendingShare;
      state.busy = true; // 分享面板開著：按鈕忙碌，避免重複觸發
      render();
      try {
        const how = await shareNow(file);
        if (how !== 'cancelled' && how !== 'needsTap' && state.pendingShare === file) state.pendingShare = null;
      } finally {
        state.busy = false;
        render();
      }
      return;
    }
    if (!state.src || state.busy) return;
    state.busy = true;
    render();
    try {
      const src = state.src;
      state.exportCount++;
      const r = await exportImage(src, state.recipe, { privacy: state.privacy, lookId: state.recipe.base, maxPixels: state.maxPixels });
      state.lastExport = { name: r.file.name, hdr: r.hdr, notice: r.notice, timings: r.timings };
      const how = await deliver(r.file);
      // 手勢過期（needsTap）或取消：留著檔案，改顯示「點這裡分享／儲存」；換了照片就不留
      if ((how === 'needsTap' || how === 'cancelled') && state.src === src) state.pendingShare = r.file;
      if (r.notice === 'heicNoHdr') {
        if (lsGet(HEIC_HINT) !== '1') { lsSet(HEIC_HINT, '1'); showToast(t('notice.heicNoHdr'), { ms: 8000 }); }
      } else if (r.notice) {
        showToast(t(`notice.${r.notice}`));
      }
    } catch (e) {
      console.error(e);
      showToast(t(e?.message === 'decode-failed' ? 'error.decode' : 'error.generic'));
    } finally {
      state.busy = false;
      render();
      debugPanel?.refresh();
    }
  }

  // ---- 事件 ----
  els.auto.addEventListener('click', toggleAuto);
  els.file.addEventListener('change', () => onFiles(els.file.files));
  els.save.addEventListener('click', onSave);
  els.intensity.addEventListener('input', () => setRecipe({ ...state.recipe, intensity: +els.intensity.value }));
  els.exposure.addEventListener('input', () => setRecipe({ ...state.recipe, tone: { ...state.recipe.tone, exposure: +els.exposure.value } }));
  els.settings.addEventListener('click', () => {
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
    els.settings.setAttribute('aria-expanded', String(!els.settingsPanel.hidden));
  });
  els.autoOnImport.checked = lsGet(AUTO_ON_IMPORT) === '1';
  els.autoOnImport.addEventListener('change', () => lsSet(AUTO_ON_IMPORT, els.autoOnImport.checked ? '1' : '0'));
  els.lang.addEventListener('change', () => setLang(els.lang.value));
  for (const l of LANGS) els.lang.add(new Option(LANG_NAMES[l], l));

  // 按住預覽看原圖（spec §7.1）。掛在容器上：畫布可能被換掉（canvas-kind.js）
  let holdTimer = null;
  els.preview.addEventListener('pointerdown', () => {
    if (!state.bitmap) return;
    holdTimer = setTimeout(() => { state.showOriginal = true; schedulePreview(); }, HOLD_MS);
  });
  const release = () => {
    clearTimeout(holdTimer);
    if (state.showOriginal) { state.showOriginal = false; schedulePreview(); }
  };
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) els.preview.addEventListener(ev, release);
  els.preview.addEventListener('contextmenu', e => e.preventDefault());
  // 裝置畫布上限（spec §10）：稍後在背景量一次，避免和第一次匯入搶記憶體
  setTimeout(() => getDeviceProfile().then(p => { state.maxPixels = p.maxCanvasPixels; }).catch(() => {}), 1500);

  const debugInfo = async () => ({
    device: await getDeviceProfile(),
    lastExport: state.lastExport,
    autoMs: state.autoMs,
    scene: state.stats && { light: state.stats.light, scenes: state.stats.scenes, cast: state.stats.cast, logMeanY: state.stats.logMeanY },
    recipe: state.recipe,
  });
  let debugPanel = null;
  function setDebug(on) {
    lsSet(DEBUG, on ? '1' : '0');
    els.debugToggle.checked = on;
    if (on && !debugPanel) debugPanel = mountDebugPanel(root.querySelector('.toolbar'), root, debugInfo);
    if (!on && debugPanel) { debugPanel.destroy(); debugPanel = null; }
  }
  els.debugToggle = $('#debug-toggle');
  els.debugToggle.addEventListener('change', () => setDebug(els.debugToggle.checked));
  setDebug(debug || lsGet(DEBUG) === '1');

  // ---- 畫面 ----
  function renderTexts() {
    $('#settings-btn').textContent = t('settings.button');
    $('#auto-on-import-label').textContent = t('settings.autoOnImport');
    $('#debug-toggle-label').textContent = t('settings.debug');
    els.lang.setAttribute('aria-label', t('lang.label'));
    els.lang.value = getLang();
    els.canvas.setAttribute('aria-label', t('preview.label') + '，' + t('compare.hint'));
    els.canvas.setAttribute('role', 'img');
    $('#compare-hint').textContent = t('compare.hint');
    els.hdr.textContent = t('badge.hdr');
    $('#empty-text').textContent = t('app.empty');
    $('#empty-import').textContent = t('import.button');
    $('#intensity-label').textContent = t('slider.intensity');
    $('#exposure-label').textContent = t('slider.exposure');
    els.intensity.setAttribute('aria-label', t('slider.intensity'));
    els.exposure.setAttribute('aria-label', t('slider.exposure'));
    $('#import-label').textContent = t('import.button');
    els.file.setAttribute('aria-label', t('import.button'));
    renderLookStrip(els.looks, { selected: state.recipe.base, onPick: pickLook });
    renderPrivacy(els.privacy, state.privacy, p => {
      state.privacy = p;
      state.pendingShare = null; // 待分享的檔案是用舊的隱私設定產生的，作廢（否則會送出剛選擇去除的 GPS）
      savePrivacy(p);
      render();
    });
    if (state.recommendations) {
      recCanvases = renderRecommendRow(els.recommend, state.recommendations, { selected: state.recipe.base, onPick: pickLook });
      scheduleRecs();
    }
    debugPanel?.label();
  }

  function render() {
    const has = !!state.src;
    els.auto.textContent = t(state.autoOn ? 'auto.undo' : 'auto.button');
    els.auto.setAttribute('aria-pressed', String(state.autoOn));
    els.auto.disabled = !state.stats;
    els.save.disabled = !has || state.busy;
    els.save.setAttribute('aria-busy', String(state.busy));
    $('#save-label').textContent = t(state.busy ? 'save.busy' : state.pendingShare ? 'save.tapToShare' : 'save.button');
    els.save.classList.toggle('share', !!state.pendingShare);
    els.empty.hidden = has;
    els.canvas.hidden = !has;
    els.hdr.hidden = !(has && state.src.hasGainMap);
    els.recommend.hidden = !state.recommendations;
    els.intensity.value = String(state.recipe.intensity);
    els.exposure.value = String(state.recipe.tone.exposure);
    els.intensity.disabled = els.exposure.disabled = !has;
    markSelectedLook(els.looks, state.recipe.base);
    markSelectedRec(els.recommend, state.recipe.base);
    for (const b of els.privacy.querySelectorAll('[data-privacy]')) b.setAttribute('aria-pressed', String(b.dataset.privacy === state.privacy));
  }

  onLangChange(() => { renderTexts(); render(); });
  renderTexts();
  render();

  return { state, setRecipe, render };
}
