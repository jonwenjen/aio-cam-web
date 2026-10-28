// 啟動：讀網址參數（?engine=、?debug=1、?test=1、#r=配方），掛上暗房。
import { initI18n, t } from './i18n/index.js';
import { getEngine } from './engine/engine.js';
import { mountDarkroom } from './ui/darkroom-view.js';
import { showToast } from './ui/toast.js';
import { decodeFromUrl } from './looks/recipe.js';
import { BUILTIN } from './looks/builtin.js';

const params = new URLSearchParams(location.search);

async function start() {
  await initI18n();
  const prefer = params.get('engine') ?? undefined;
  await getEngine({ prefer });
  const view = mountDarkroom(document.getElementById('app'), { debug: params.has('debug') });

  // #r= 配方連結：M1 只解析並套用
  const m = /^#r=(.+)$/.exec(location.hash);
  if (m) {
    const recipe = await decodeFromUrl(m[1], id => BUILTIN[id]?.recipe);
    if (recipe && BUILTIN[recipe.base]) view.setRecipe(recipe);
    else showToast(t('error.recipeLink'));
  }

  if (params.has('test')) {
    window.__aio = { outputs: window.__aio?.outputs ?? [], state: view.state, ready: true };
  }
}

/**
 * Service Worker（離線）。本機開發時不註冊（快取優先會讓改過的檔案看不到），要測試就加 ?sw=1。
 * 有新版本在等待時顯示「有新版本，點此更新」。
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (local && !params.has('sw')) return;
  const reg = await navigator.serviceWorker.register('./sw.js');
  // 只有使用者按下「更新」才重新載入；第一次安裝時 clients.claim() 也會觸發 controllerchange，
  // 那時重新載入會把使用者已選的照片清掉
  let userAskedUpdate = false;
  const offer = worker => showToast(t('update.available'), {
    ms: 0, onAction: () => { userAskedUpdate = true; worker.postMessage('skipWaiting'); },
  });
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAskedUpdate) { userAskedUpdate = false; location.reload(); }
  });
}

start().then(() => registerServiceWorker().catch(e => console.warn('service worker', e)));
