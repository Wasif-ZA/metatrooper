import crypto from 'node:crypto';

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** ISO 8601 with milliseconds and the local offset, e.g. 2026-09-29T14:05:00.123+10:00. */
export function nowIso(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(ms: number = Date.now()): string {
  let t = '';
  let time = ms;
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[time % 32] + t;
    time = Math.floor(time / 32);
  }
  const bytes = crypto.randomBytes(16);
  let r = '';
  for (let i = 0; i < 16; i++) r += CROCKFORD[bytes[i] % 32];
  return t + r;
}
