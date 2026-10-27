// 瀏覽器測試執行器：每頁跑兩次——有 GPU（WebGPU 可用）與「沒有 WebGPU」（S7）。
// 頁面完成時設定 window.__result = { pass, details }；有任何未捕捉錯誤就算失敗。
// 用法：node tools/run-browser.mjs [test/browser/page.html ...]
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { withPage } from './cdp-harness.mjs';
import { startServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'test/out/';
const TIMEOUT_MS = 120_000;
const GPU_ARGS = ['--enable-unsafe-webgpu', '--use-angle=metal'];
// module script（含它 import 的檔案）載入失敗不會丟 Runtime.exceptionThrown，在這裡直接判失敗
const SCRIPT_LOAD_GUARD = "addEventListener('error',e=>{const t=e.target;if(t&&t.tagName==='SCRIPT')window.__result={pass:false,details:{error:'script load failed: '+(t.src||'inline module graph')}}},true)";
const NO_WEBGPU = "Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined,configurable:true})";

export const RUNS = [
  { name: 'gpu', initScripts: [] },
  { name: 'nowebgpu', initScripts: [NO_WEBGPU] },
];

/** 開一頁、等 __result；回傳 { pass, details, errors, logs } */
export async function runPage(url, run, { timeoutMs = TIMEOUT_MS } = {}) {
  return withPage(async ({ evaluate, errors, logs }) => {
    const t0 = Date.now();
    let result = null;
    while (Date.now() - t0 < timeoutMs) {
      result = await evaluate('window.__result ?? null').catch(() => null);
      if (result || errors.length) break; // 未捕捉錯誤已經代表失敗，不必等到逾時
      await sleep(250);
    }
    if (!result) result = { pass: false, details: { error: errors.length ? 'uncaught error' : `timeout after ${timeoutMs / 1000}s` } };
    const pass = !!result.pass && errors.length === 0;
    return { pass, details: result.details, errors: [...errors], logs: [...logs], ms: Date.now() - t0 };
  }, { url, gpu: true, chromeArgs: GPU_ARGS, initScripts: [SCRIPT_LOAD_GUARD, ...run.initScripts], settleMs: 500 });
}

async function main() {
  let pages = process.argv.slice(2).filter(a => a !== '--');
  if (!pages.length) {
    pages = (await readdir(ROOT + 'test/browser')).filter(f => f.endsWith('.html')).sort().map(f => 'test/browser/' + f);
  }
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  const rows = [];
  try {
    for (const page of pages) {
      for (const run of RUNS) {
        const r = await runPage(server.url + page.replace(/^\.?\//, ''), run);
        const name = basename(page.split('?')[0], '.html');
        await writeFile(`${OUT}browser-${name}-${run.name}.json`, JSON.stringify(r, null, 2));
        rows.push({ page, run: run.name, pass: r.pass, ms: r.ms, note: r.errors[0] ?? r.details?.error ?? r.details?.skipped ?? '' });
      }
    }
  } finally {
    await server.close();
  }
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.page}  [${r.run}]  ${(r.ms / 1000).toFixed(1)}s  ${String(r.note).slice(0, 160)}`);
  }
  const failed = rows.filter(r => !r.pass).length;
  console.log(`${rows.length - failed}/${rows.length} passed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
