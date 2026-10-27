/**
 * Dependency-free headless-Chrome CDP harness.
 *
 * Launches a SEPARATE Chrome with a throwaway profile, so the user's own
 * browser session is never locked, relaunched, or disturbed. Uses only Node
 * built-ins (global fetch + WebSocket, Node >= 22).
 *
 *   import { withPage, asFileLiteral } from './cdp-harness.mjs';
 *
 *   await withPage(async ({ evaluate, logs, errors }) => {
 *     console.log(await evaluate('document.title'));
 *     const caps = await evaluate(`(async () => ({
 *       VideoEncoder: typeof VideoEncoder !== 'undefined',
 *       avc: (await VideoEncoder.isConfigSupported({
 *         codec: 'avc1.42001f', width: 640, height: 360 })).supported,
 *     }))()`);
 *     if (!caps.VideoEncoder || !caps.avc) throw new Error('no WebCodecs');
 *     if (errors.length) throw new Error('page threw: ' + errors[0]);
 *   }, { url: 'http://localhost:4173/' });
 *
 * `evaluate` uses awaitPromise + returnByValue and rethrows page-side
 * exceptions as real JS errors, so a failing assertion inside the page fails
 * the harness instead of silently returning undefined.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { await access(p); return p; } catch {}
  }
  throw new Error(
    'no Chrome binary found; set CHROME_PATH to a Chromium-based browser',
  );
}

export async function withPage(fn, opts = {}) {
  const { url = 'about:blank', headless = true, port, settleMs = 3000 } = opts;
  const exe = await findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'cdp-harness-'));
  const devPort = port ?? 9200 + Math.floor(Math.random() * 700);

  const chrome = spawn(
    exe,
    [
      ...(headless ? ['--headless=new'] : []),
      `--remote-debugging-port=${devPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(opts.gpu ? [] : ['--disable-gpu']),
      ...(opts.chromeArgs ?? []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ws;
  const teardown = () => {
    try { ws?.close(); } catch {}
    try { chrome.kill('SIGKILL'); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  try {
    // Chrome needs a moment before the debug port answers.
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = await (
          await fetch(`http://127.0.0.1:${devPort}/json/list`)
        ).json();
        target = list.find((t) => t.type === 'page');
      } catch {}
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('chrome devtools endpoint never came up');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    let id = 0;
    const pending = new Map();
    const logs = [];
    const errors = [];

    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        logs.push(
          `${m.params.type}: ${
            m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
          }`,
        );
      }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push(
          m.params.exceptionDetails?.exception?.description ??
            m.params.exceptionDetails?.text,
        );
      }
    });

    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

    async function evaluate(expression) {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description ??
            r.exceptionDetails.text,
        );
      }
      return r.result.value;
    }

    await send('Runtime.enable');
    await send('Page.enable');
    if (url !== 'about:blank') {
      await send('Page.navigate', { url });
      await sleep(settleMs);
    }

    return await fn({ evaluate, send, logs, errors, url, devPort });
  } finally {
    teardown();
  }
}

/**
 * Read a file into a JS literal you can splice into an evaluate expression.
 *
 * A page cannot read the local filesystem, so embed the bytes rather than
 * fetching `file://` (blocked cross-origin from an http page). Build the File
 * in-page from the decoded base64 and hand it to a real <input type=file>.
 *
 *   const lit = asFileLiteral('/abs/clip.mp4', 'video/mp4');
 *   await evaluate(`(async () => {
 *     const bin = Uint8Array.from(atob(${lit.b64}), c => c.charCodeAt(0));
 *     const file = new File([bin], ${JSON.stringify(lit.name)},
 *                          { type: ${JSON.stringify(lit.mime)} });
 *     const dt = new DataTransfer(); dt.items.add(file);
 *     const input = document.querySelector('input[type=file]');
 *     input.files = dt.files;
 *     input.dispatchEvent(new Event('change', { bubbles: true }));
 *   })()`);
 */
export function asFileLiteral(absPath, mime = 'application/octet-stream') {
  const b64 = readFileSync(absPath).toString('base64');
  const name = absPath.split('/').pop();
  return { b64, name, mime, bytes: Math.round((b64.length * 3) / 4) };
}
