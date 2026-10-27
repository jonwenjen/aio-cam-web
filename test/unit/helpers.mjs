import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = name => ROOT + 'test/fixtures/' + name;
export const privatePath = name => ROOT + 'test/private/' + name;
export const read = name => new Uint8Array(readFileSync(fixture(name)));
export const hasPrivate = name => existsSync(privatePath(name));
