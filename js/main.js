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

start();
