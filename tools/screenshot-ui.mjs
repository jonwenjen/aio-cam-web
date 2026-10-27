// 以 iPhone 18 Pro Max 尺寸（440×956 @3x）截三張介面圖到 test/out/：空狀態、匯入後、按下「自動」後。
// 用法：node tools/screenshot-ui.mjs [照片路徑（相對 repo 根目錄）]
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { withPage } from './cdp-harness.mjs';
import { startServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const photo = process.argv[2] ?? (existsSync(ROOT + 'test/external/s20/s20_02.jpg') ? 'test/external/s20/s20_02.jpg' : 'test/fixtures/gm_gps_rot6.jpg');
const server = await startServer();
mkdirSync(ROOT + 'test/out', { recursive: true });

try {
  await withPage(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 3, mobile: true });
    await send('Page.navigate', { url: server.url + '?test=1' });
    for (let i = 0; i < 100 && !(await evaluate('!!window.__aio?.ready').catch(() => false)); i++) await sleep(100);
    const shot = async name => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(ROOT + 'test/out/' + name, Buffer.from(data, 'base64'));
      console.log('test/out/' + name);
    };
    await shot('ui-empty.png');
    await evaluate(`(async () => {
      const s = window.__aio.state, sleep = ms => new Promise(r => setTimeout(r, ms));
      const bytes = await (await fetch(${JSON.stringify('/' + photo)})).arrayBuffer();
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'photo.jpg', { type: 'image/jpeg' }));
      const input = document.querySelector('#file-input'); input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      while (!(s.previewReady && !s.rendering)) await sleep(50);
    })()`);
    await sleep(300);
    await shot('ui-loaded.png');
    await evaluate(`(async () => {
      const s = window.__aio.state, sleep = ms => new Promise(r => setTimeout(r, ms));
      const n = s.renderCount; document.querySelector('#auto-btn').click();
      while (!(s.renderCount > n && !s.rendering)) await sleep(50);
    })()`);
    await sleep(300);
    await shot('ui-auto.png');
  }, { gpu: true, chromeArgs: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
} finally {
  await server.close();
}
