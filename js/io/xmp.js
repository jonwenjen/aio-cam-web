// XMP 封包：讀出、加配方、去除位置欄位、包成 APP1。
import { concat } from './bytes.js';
import { XMP_ID } from './jpeg.js';
import { APP1_MAX } from './tiff.js';

export const AIOCAM_NS = 'https://jonwenjen.github.io/aio-cam-web/ns/1.0/';

/** 主圖 APP1 XMP 封包的 XML 文字。 */
export function xmpPacketsOf(u, info) {
  const dec = new TextDecoder();
  return info.xmp.map(s => dec.decode(u.subarray(s.dataStart + XMP_ID.length + 1, s.end)));
}

const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function withRecipe(xml, encodedRecipe) {
  const attrs = ` xmlns:aiocam="${AIOCAM_NS}" aiocam:recipe="${escAttr(encodedRecipe)}"`;
  if (xml == null) {
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
      `<rdf:Description rdf:about=""${attrs}/></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
  }
  // 先拿掉舊的配方（重新存檔時），再加到第一個 rdf:Description
  const clean = xml.replace(/\s+xmlns:aiocam=(["'])[^"']*\1/g, '').replace(/\s+aiocam:recipe=(["'])[^"']*\1/g, '');
  if (!/<rdf:Description\b/.test(clean)) {
    return clean.replace(/<rdf:RDF\b([^>]*)>/, `<rdf:RDF$1><rdf:Description rdf:about=""${attrs}/>`);
  }
  return clean.replace(/<rdf:Description\b/, `<rdf:Description${attrs}`);
}

const LOCATION_NAMES = ['exif:GPS[A-Za-z]*', 'photoshop:City', 'photoshop:State', 'photoshop:Country',
  'Iptc4xmpCore:Location', 'Iptc4xmpExt:LocationShown', 'Iptc4xmpExt:LocationCreated'];

export function stripLocation(xml) {
  let out = xml;
  for (const name of LOCATION_NAMES) {
    out = out
      .replace(new RegExp(`\\s+${name}=(["'])[^"']*\\1`, 'g'), '')                     // 屬性
      .replace(new RegExp(`<(${name})\\b[^>]*/>`, 'g'), '')                               // 空元素
      .replace(new RegExp(`<(${name})\\b[^>]*>[\\s\\S]*?</\\1>`, 'g'), '');              // 元素（含巢狀 rdf:Bag/Seq）
  }
  return out;
}

export function xmpApp1(xml) {
  const body = concat(new TextEncoder().encode(XMP_ID + '\0'), new TextEncoder().encode(xml));
  const len = 2 + body.length;
  if (len > APP1_MAX) throw new RangeError('APP1 too large');
  return concat(new Uint8Array([0xFF, 0xE1, len >> 8, len & 0xFF]), body);
}
