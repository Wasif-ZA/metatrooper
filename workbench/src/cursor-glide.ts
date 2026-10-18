/** The agent cursor's timing and placement, shared by the pane overlay and the desktop overlay (contracts/agent-cursor.md). No Electron imports. */

export type Mode = 'off' | 'instant' | 'snappy' | 'human';
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Display { id: number; bounds: Rect }
export interface Arrival { id: string; at: number; x: number; y: number }

const MODES = new Set<Mode>(['off', 'instant', 'snappy', 'human']);
/** A move longer than this share of the host's diagonal snaps (D54: 1,101 px on a 1920x1080 host). */
export const SNAP_SHARE = 0.5;
export const NEAR_PX = 4;
export const LABEL_MAX = 28;
/** The input goes this long after `ms` when no `cursor.arrived` came. */
export const LATE_MS = 16;
export const HUMAN_FACTOR = 2.5;

let warned = false;

/** `agent_cursor.mode`, read as snappy (and logged once) when it is not one of the four. */
export function modeOf(v: unknown): Mode {
  if (MODES.has(v as Mode)) return v as Mode;
  if (!warned) {
    warned = true;
    console.error(`agent_cursor.mode ${JSON.stringify(v)} is not off, instant, snappy or human; using snappy`);
  }
  return 'snappy';
}

/** clamp(70 + 55 * log2(D / W + 1), 90, 220) ms, rounded. */
export function glideMs(d: number, w: number): number {
  const v = 70 + 55 * Math.log2(Math.max(0, d) / Math.max(1, w) + 1);
  return Math.round(Math.min(220, Math.max(90, v)));
}

export interface PlanIn {
  mode: Mode;
  reducedMotion: boolean;
  /** Where the session's cursor is now; null for its first action or the first after it faded. */
  prev: Point | null;
  target: Rect;
  /** Key and scroll: stay put when the cursor is already inside the target (D56). */
  keep?: boolean;
  host: { width: number; height: number };
}

/** Where the cursor goes and how long it takes; `ms` 0 means it snaps (or appears, when `prev` is null). */
export function planGlide(p: PlanIn): { from: Point; to: Point; ms: number } {
  const t = p.target;
  const prev = p.prev;
  const inside = !!prev && prev.x >= t.x && prev.x <= t.x + t.width && prev.y >= t.y && prev.y <= t.y + t.height;
  const to = p.keep && inside ? { x: prev!.x, y: prev!.y } : { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  if (!prev) return { from: to, to, ms: 0 };
  const from = { x: prev.x, y: prev.y };
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (p.mode === 'off' || p.mode === 'instant' || p.reducedMotion || d <= NEAR_PX || d > SNAP_SHARE * Math.hypot(p.host.width, p.host.height)) return { from, to, ms: 0 };
  const ms = glideMs(d, t.width);
  return { from, to, ms: p.mode === 'human' ? Math.round(ms * HUMAN_FACTOR) : ms };
}

/** The chip: engine, " · ", task, the whole label at most 28 characters (D50). */
export function chipLabel(engine: string, task: string): string {
  const t = task.replace(/\s+/g, ' ').trim();
  const s = Array.from(t ? `${engine} · ${t}` : engine);
  return s.length <= LABEL_MAX ? s.join('') : `${s.slice(0, LABEL_MAX - 1).join('')}…`;
}

/** A physical-pixel `[x, y, w, h]` as a rectangle in the overlay window of the display it lands on. */
export function place(rectPx: number[], toDip: (r: Rect) => Rect, matching: (r: Rect) => Display): { display: Display; rect: Rect } {
  const dip = toDip({ x: rectPx[0], y: rectPx[1], width: rectPx[2], height: rectPx[3] });
  const display = matching(dip);
  return { display, rect: { x: dip.x - display.bounds.x, y: dip.y - display.bounds.y, width: dip.width, height: dip.height } };
}

/** A physical rectangle with a size, as `[x, y, w, h]` of finite numbers. */
export function usableRect(r: unknown): r is number[] {
  return Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n)) && r[2] > 0 && r[3] > 0;
}

type IpcContents = { isDestroyed(): boolean; ipc?: { on(ch: string, fn: (...a: any[]) => void): unknown; removeListener(ch: string, fn: (...a: any[]) => void): unknown } };

/** Resolves with the overlay's `cursor.arrived` for `id`, or null at `ms + 16`; a missing or destroyed overlay waits the same (D57). Call before sending the glide. */
export function awaitArrived(wc: IpcContents | null, id: string, ms: number): Promise<Arrival | null> {
  return new Promise((resolve) => {
    const ipc = wc && !wc.isDestroyed() ? wc.ipc : undefined;
    const on = (_e: unknown, m: any) => {
      if (m && m.id === id && typeof m.at === 'number') done({ id, at: m.at, x: Number(m.x), y: Number(m.y) });
    };
    const done = (v: Arrival | null) => {
      clearTimeout(timer);
      ipc?.removeListener('cursor.arrived', on);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), ms + LATE_MS);
    ipc?.on('cursor.arrived', on);
  });
}
