// 位元組讀寫小工具（所有 io/ 模組共用）

export const u16be = (u, o) => (u[o] << 8) | u[o + 1];
export const u32be = (u, o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
export const u16le = (u, o) => u[o] | (u[o + 1] << 8);
export const u32le = (u, o) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16)) + ((u[o + 3] << 24) >>> 0);

export function ascii(u, a, b) {
  let s = '';
  for (let i = a; i < b && i < u.length; i++) s += String.fromCharCode(u[i]);
  return s;
}

export function concat(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function startsWithAscii(u, offset, str) {
  if (offset + str.length > u.length) return false;
  for (let i = 0; i < str.length; i++) if (u[offset + i] !== str.charCodeAt(i)) return false;
  return true;
}
