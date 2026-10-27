// 本機靜態伺服器（repo 根目錄），只給開發與測試用。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.wgsl': 'text/plain; charset=utf-8', '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.heic': 'image/heic', '.tif': 'image/tiff', '.txt': 'text/plain; charset=utf-8',
};

async function handle(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (file !== ROOT.replace(/\/$/, '') && !file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}

export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => { handle(req, res).catch(() => res.writeHead(500).end()); });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      resolve({ url, close: () => new Promise(r => server.close(r)) });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(5173);
  console.log('serving ' + ROOT + ' at ' + url.replace('127.0.0.1', 'localhost'));
}

