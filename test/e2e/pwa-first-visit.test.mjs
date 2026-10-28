// 第一次開 App：Service Worker 安裝並以 clients.claim() 接管頁面時，App 不可以自己重新載入
// （使用者可能已經選了照片）。直接開 App 本身，比對 performance.timeOrigin 判斷是否重新載入過。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer } from '../../tools/serve.mjs';
import { withPage } from '../../tools/cdp-harness.mjs';

test('first visit: no reload when the service worker takes control', async () => {
  const server = await startServer();
  try {
    await withPage(async ({ send, evaluate, errors, logs }) => {
      let loads = 0;
      await send('Page.navigate', { url: server.url + '?sw=1&test=1' });
      // cdp-harness 沒有事件訂閱：以 performance.timeOrigin 判斷頁面是否換過一次
      let origin = null;
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        const o = await evaluate('window.__aio?.ready ? performance.timeOrigin : null').catch(() => null);
        if (o) { origin = o; break; }
      }
      assert.ok(origin, 'app not ready');
      let controlled = false;
      for (let i = 0; i < 100 && !controlled; i++) {
        await sleep(100);
        controlled = await evaluate('!!navigator.serviceWorker.controller').catch(() => false);
      }
      await sleep(2000);
      const now = await evaluate('performance.timeOrigin');
      if (now !== origin) loads++;
      assert.ok(controlled, 'service worker never took control; logs: ' + logs.join(' | '));
      assert.equal(loads, 0, 'the app reloaded itself after the service worker took control');
      assert.deepEqual(errors, []);
    }, { gpu: true, chromeArgs: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
  } finally {
    await server.close();
  }
});
