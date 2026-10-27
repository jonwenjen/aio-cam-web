// 太陽高度與光線階段（spec §7.5.1、N43）。NOAA 簡化公式，不含大氣折射。
const RAD = Math.PI / 180;

/** @returns {number} 太陽高度角（度） */
export function sunElevation(dateUtc, lat, lon) {
  const jd = dateUtc.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD)); // 分鐘
  const minutes = dateUtc.getUTCHours() * 60 + dateUtc.getUTCMinutes() + dateUtc.getUTCSeconds() / 60;
  const tst = minutes + eot + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const cosZ = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZ))) / RAD;
}

/** > 12° 白天、0–12° 黃金時刻、−6–0° 藍調、< −6° 夜晚 */
export function lightPhase(elevation) {
  if (elevation > 12) return 'day';
  if (elevation >= 0) return 'golden';
  if (elevation >= -6) return 'blue';
  return 'night';
}

/** 沒有 GPS 時用當地時刻粗估，信心 0.5 */
export function localTimeOnly(hour) {
  let phase = 'day';
  if ((hour >= 6 && hour < 8) || (hour >= 16 && hour < 18)) phase = 'golden';
  else if ((hour >= 5 && hour < 6) || (hour >= 18 && hour < 19)) phase = 'blue';
  else if (hour >= 19 || hour < 5) phase = 'night';
  return { phase, confidence: 0.5 };
}

const DT = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/;

/** EXIF 時間＋時區 → UTC Date；格式不對回傳 null */
export function exifToUtc(dateTime, offset) {
  const m = DT.exec(dateTime ?? '');
  const o = /^([+-])(\d\d):(\d\d)$/.exec(offset ?? '');
  if (!m || !o) return null;
  const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const sign = o[1] === '-' ? -1 : 1;
  return new Date(local - sign * (+o[2] * 60 + +o[3]) * 60000);
}

/** EXIF 時間的當地小時（含小數）；格式不對回傳 null */
export function exifLocalHour(dateTime) {
  const m = DT.exec(dateTime ?? '');
  return m ? +m[4] + +m[5] / 60 + +m[6] / 3600 : null;
}
