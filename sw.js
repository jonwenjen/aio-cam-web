// Service Worker：App 檔案離線可用（spec §12）。ES module 不能 importScripts，版本字串寫死，
// 由 test/unit/sw-precache.test.mjs 確認與 js/version.js 相同、且 PRECACHE 涵蓋所有 App 檔案。
const VERSION = '0.1.0';
const CACHE = 'aio-cam-' + VERSION;
const PRECACHE = [
  "./css/app.css",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./index.html",
  "./js/color/p3.js",
  "./js/device.js",
  "./js/engine/cpu-ref.js",
  "./js/engine/engine.js",
  "./js/engine/params.js",
  "./js/engine/shaders/render.frag.glsl",
  "./js/engine/shaders/render.vert.glsl",
  "./js/engine/shaders/render.wgsl",
  "./js/engine/webgl2.js",
  "./js/engine/webgpu.js",
  "./js/i18n/en.json",
  "./js/i18n/index.js",
  "./js/i18n/ja.json",
  "./js/i18n/ko.json",
  "./js/i18n/zh-Hans.json",
  "./js/i18n/zh-Hant.json",
  "./js/io/assemble.js",
  "./js/io/bytes.js",
  "./js/io/container-exif.js",
  "./js/io/deliver.js",
  "./js/io/export.js",
  "./js/io/import.js",
  "./js/io/jpeg.js",
  "./js/io/metadata.js",
  "./js/io/tiff.js",
  "./js/io/xmp.js",
  "./js/looks/analyze.js",
  "./js/looks/auto.js",
  "./js/looks/builtin.js",
  "./js/looks/lut.js",
  "./js/looks/recipe.js",
  "./js/looks/recommend.js",
  "./js/looks/sun.js",
  "./js/main.js",
  "./js/ui/darkroom-view.js",
  "./js/ui/debug-panel.js",
  "./js/ui/look-strip.js",
  "./js/ui/recommend-row.js",
  "./js/ui/save-sheet.js",
  "./js/ui/toast.js",
  "./js/version.js",
  "./manifest.webmanifest"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('aio-cam-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // 導覽：網路優先，離線時回快取的 index.html
    event.respondWith(fetch(req).catch(async () => (await caches.match(req)) ?? caches.match('./index.html')));
    return;
  }
  // 其他同源 GET：快取優先，未命中走網路
  event.respondWith(caches.match(req).then(hit => hit ?? fetch(req)));
});
