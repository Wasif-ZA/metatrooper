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

const CRON_FIELDS: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

export type Cron = { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean };

/** Parses a 5-field cron (minute hour day-of-month month day-of-week) with *, lists, ranges and steps; weekday 7 is Sunday. Throws on anything else. */
export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron must have 5 fields: minute hour day month weekday');
  const sets = parts.map((part, i) => {
    const [lo, hi] = CRON_FIELDS[i]!;
    const out = new Set<number>();
    for (const item of part.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error(`cron field "${part}" is not valid`);
      const a = m[1] === '*' ? lo : Number(m[2]);
      const b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? hi : a;
      const step = m[4] !== undefined ? Number(m[4]) : 1;
      if (a < lo || b > hi || a > b || step < 1) throw new Error(`cron field "${part}" is out of range ${lo}-${hi}`);
      for (let v = a; v <= b; v += step) out.add(i === 4 && v === 7 ? 0 : v);
    }
    return out;
  });
  return { min: sets[0]!, hour: sets[1]!, dom: sets[2]!, mon: sets[3]!, dow: sets[4]!, domAny: parts[2]!.startsWith('*'), dowAny: parts[4]!.startsWith('*') };
}

/** First local time strictly after `from` that matches, or null within 5 years. A wall time skipped by DST runs at the shifted time; a repeated one runs once. */
export function cronNext(expr: string | Cron, from: Date): Date | null {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const hours = [...c.hour].sort((x, y) => x - y);
  const mins = [...c.min].sort((x, y) => x - y);
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 366 * 5; i++, day.setDate(day.getDate() + 1)) {
    const y = day.getFullYear(), mo = day.getMonth(), d = day.getDate();
    if (!c.mon.has(mo + 1)) continue;
    const domOk = c.dom.has(d), dowOk = c.dow.has(day.getDay());
    if (!(c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk)) continue;
    for (const h of hours) for (const m of mins) {
      const t = new Date(y, mo, d, h, m);
      if (t.getTime() > from.getTime()) return t;
    }
  }
  return null;
}

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** The schedule in words ("Weekdays at 10:00"); falls back to the expression itself. */
export function cronWords(expr: string): string {
  const [mi, h, dom, mon, dow] = expr.trim().split(/\s+/);
  const at = `${pad(Number(h))}:${pad(Number(mi))}`;
  const fixed = /^\d+$/.test(mi ?? '') && /^\d+$/.test(h ?? '');
  if (mon === '*' && dom === '*' && dow === '*') {
    if (fixed) return `Daily at ${at}`;
    if (/^\*\/\d+$/.test(mi!) && h === '*') return `Every ${mi!.slice(2)} minutes`;
    if (mi === '0' && /^\*\/\d+$/.test(h!)) return `Every ${h!.slice(2)} hours`;
    if (/^\d+$/.test(mi!) && h === '*') return `Hourly at :${pad(Number(mi))}`;
  }
  if (fixed && mon === '*' && dom === '*') {
    if (dow === '1-5') return `Weekdays at ${at}`;
    if (dow === '0,6' || dow === '6,0') return `Weekends at ${at}`;
    if (/^[0-7]$/.test(dow!)) return `${DAYS[Number(dow) % 7]} at ${at}`;
  }
  if (fixed && mon === '*' && dow === '*' && /^\d+$/.test(dom!)) return `Monthly on day ${dom} at ${at}`;
  return expr.trim();
}

const CROCKFORD ='0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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
