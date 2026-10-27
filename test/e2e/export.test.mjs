// 端到端：真的瀏覽器匯出 → exiftool＋Apple ImageIO 驗證 S2／S3／S16（tools/verify-output.mjs）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';
import { withPage } from '../../tools/cdp-harness.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'test/out/e2e/';
const haveTools = existsSync(ROOT + 'tools/bin/gmcheck') && existsSync(ROOT + 'tools/bin/hdrmeasure');
const FILES = ['test/fixtures/gm_gps_rot6.jpg'];
if (existsSync(ROOT + 'test/private/IMG_0040.jpg')) FILES.push('test/private/IMG_0040.jpg');
const PRIVACY = ['keep', 'noLocation', 'minimal'];

let server;
before(async () => { server = await startServer(); mkdirSync(OUT, { recursive: true }); });
after(async () => { await server?.close(); });

/** 走真的介面（/?test=1）：選檔 → 點發色 → 點隱私 → 存檔；回傳 [{ file, privacy, look, name, notice, hdr, path }] */
async function exportAll(jobs) {
  return withPage(async ({ send, evaluate, errors }) => {
    const results = [];
    for (const job of jobs) {
      await send('Page.navigate', { url: `${server.url}?test=1` });
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) { await sleep(100); ready = await evaluate('!!window.__aio?.ready').catch(() => false); }
      assert.ok(ready, 'app not ready');
      const r = await evaluate(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (fn, ms = 120000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(50); } };
        const s = window.__aio.state;
        const bytes = await (await fetch(${JSON.stringify('/' + job.file)})).arrayBuffer();
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], ${JSON.stringify(job.file.split('/').pop())}, { type: 'image/jpeg' }));
        const input = document.querySelector('#file-input');
        const n0 = s.importCount;
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => s.importCount > n0 && s.previewReady && !s.rendering);
        document.querySelector('#looks [data-look=${JSON.stringify(job.look)}]').click();
        document.querySelector('#privacy [data-privacy=${JSON.stringify(job.privacy)}]').click();
        await until(() => !s.rendering);
        const n = window.__aio.outputs.length;
        document.querySelector('#save-btn').click();
        await until(() => window.__aio.outputs.length === n + 1 && !s.busy);
        const o = window.__aio.outputs.at(-1);
        let b64 = '';
        for (let i = 0; i < o.bytes.length; i += 32768) b64 += String.fromCharCode(...o.bytes.subarray(i, i + 32768));
        return { name: o.name, b64: btoa(b64), ...s.lastExport };
      })()`);
      const path = `${OUT}${job.file.split('/').pop().replace(/\.\w+$/, '')}-${job.look}-${job.privacy}.jpg`;
      writeFileSync(path, Buffer.from(r.b64, 'base64'));
      results.push({ ...job, hdr: r.hdr, notice: r.notice, name: r.name, path });
    }
    assert.deepEqual(errors, []);
    return results;
  }, { gpu: true, chromeArgs: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
}

test('S2/S3/S16: every privacy level verifies with exiftool and Apple ImageIO', async t => {
  if (!haveTools) return t.skip('run tools/build-tools.sh');
  const jobs = FILES.flatMap(file => PRIVACY.map(privacy => ({ file, privacy, look: 'asshot' })));
  for (const r of await exportAll(jobs)) {
    const v = spawnSync('node', [ROOT + 'tools/verify-output.mjs', ROOT + r.file, r.path, `--privacy=${r.privacy}`], { encoding: 'utf8' });
    assert.equal(v.status, 0, `${r.file} ${r.privacy}\n${v.stdout}\n${v.stderr}`);
    assert.equal(r.hdr, true, `${r.file} ${r.privacy} lost HDR`);
  }
});

test('big_exif: Software fits after dropping thumbnail, notice null (Review Focus 4)', async () => {
  const [r] = await exportAll([{ file: 'test/fixtures/big_exif.jpg', privacy: 'keep', look: 'natural' }]);
  assert.equal(r.notice, null);
  const j = JSON.parse(execFileSync('exiftool', ['-j', '-G1', '-Software', r.path]).toString())[0];
  assert.match(j['IFD0:Software'], /^AIO Cam Web \d+\.\d+\.\d+$/);
});
