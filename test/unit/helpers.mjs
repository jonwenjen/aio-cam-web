import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = name => ROOT + 'test/fixtures/' + name;
export const privatePath = name => ROOT + 'test/private/' + name;
export const read = name => new Uint8Array(readFileSync(fixture(name)));
export const hasPrivate = name => existsSync(privatePath(name));

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const OUT = ROOT + 'test/out/';
export function writeOut(name, bytes) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + name, bytes);
  return OUT + name;
}
export const exiftoolJson = (path, args = []) =>
  JSON.parse(execFileSync('exiftool', ['-j', '-G1', '-a', ...args, path], { maxBuffer: 64 << 20 }).toString())[0];
