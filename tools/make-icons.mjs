// 把 icons/icon.svg 畫成 180／192／512 的 PNG（用無頭 Chrome 的畫布）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withPage } from './cdp-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(ROOT + 'icons/icon.svg', 'utf8');

await withPage(async ({ evaluate }) => {
  for (const size of [180, 192, 512]) {
    const b64 = await evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    writeFileSync(`${ROOT}icons/icon-${size}.png`, Buffer.from(b64, 'base64'));
    console.log(`icons/icon-${size}.png`);
  }
});
