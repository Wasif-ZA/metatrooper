import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, screen } from 'electron';
import { awaitArrived, LATE_MS, place, planGlide, usableRect, type Arrival, type Display, type Mode, type Rect } from './cursor-glide.ts';
import { sessionColour } from './colour.ts';
import type { LiveGrant } from './desktop-frames.ts';

/** The desktop cursor host (contracts/agent-cursor.md): one click-through window per display, shown only while agents act. */

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.join(here, '..', 'renderer', 'overlay.html');
const PRELOAD = path.join(here, 'browser', 'overlay-preload.cjs');
const HIDE_AFTER_MS = 1500;
const TOP_EVERY_MS = 100;

export interface DesktopLook { mode: Mode; reducedMotion: boolean; colour: string; label: string; showCaption: boolean; idleFadeMs: number; protect: boolean }
export interface GlideReply { arrived: true; ms: number; shown: boolean; late: boolean }

const wins = new Map<number, { win: BrowserWindow; ready: Promise<void> }>();
/** Each session's cursor: the display it is on, its point in that window, the physical rect it went to, and when. */
const marks = new Map<string, { display: number; x: number; y: number; rect: number[]; at: number }>();
/** Each session's idle timer: `cursor.hide` once its cursor has been still for `idle_fade_ms`. */
const fades = new Map<string, NodeJS.Timeout>();
let grants: LiveGrant[] = [];
let lastAction = 0;
let topTimer: NodeJS.Timeout | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let glides = 0;
/** M6-18e's timing row, written with METATROOPER_WORKBENCH_PROBE; never the caption. */
let probe: (row: Record<string, unknown>) => void = () => {};
let lookOf:(sessionId: string) => DesktopLook = () => ({ mode: 'snappy', reducedMotion: false, colour: '#888', label: '', showCaption: true, idleFadeMs: 5000, protect: true });

const toDip = (r: Rect): Rect => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r);

function windowFor(d: Display, protect: boolean): { win: BrowserWindow; ready: Promise<void> } {
  let w = wins.get(d.id);
  if (!w || w.win.isDestroyed()) {
    const win = new BrowserWindow({
      transparent: true, frame: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, resizable: false, movable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: PRELOAD },
    });
    win.setIgnoreMouseEvents(true);
    w = { win, ready: win.loadFile(OVERLAY).catch(() => {}) };
    wins.set(d.id, w);
  }
  w.win.setContentProtection(protect);
  const b = w.win.getBounds();
  if (b.x !== d.bounds.x || b.y !== d.bounds.y || b.width !== d.bounds.width || b.height !== d.bounds.height) w.win.setBounds(d.bounds);
  return w;
}

function raise(): void {
  for (const { win } of wins.values()) {
    if (win.isDestroyed() || !win.isVisible()) continue;
    win.setAlwaysOnTop(true, 'floating');
    win.moveTop();
  }
}

/** Every overlay window leaves the always-on-top band and hides; cursors keep their place for the next action. */
function hideAll(): void {
  if (topTimer) clearInterval(topTimer);
  topTimer = null;
  for (const { win } of wins.values()) {
    if (win.isDestroyed()) continue;
    win.setAlwaysOnTop(false);
    win.hide();
  }
}

function acted(win: BrowserWindow): void {
  lastAction = Date.now();
  if (!win.isVisible()) win.showInactive();
  raise();
  topTimer ??= setInterval(raise, TOP_EVERY_MS);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideAll, HIDE_AFTER_MS);
}

function hide(session: string): void {
  const m = marks.get(session);
  if (!m) return;
  marks.delete(session);
  const w = wins.get(m.display);
  if (w && !w.win.isDestroyed()) w.win.webContents.send('cursor.hide', { session });
}

/** The pipe's `cursor.glide`: draws the session's cursor gliding to a physical-pixel rectangle, then replies. */
export async function desktopGlide(session: string, rectPx: unknown, caption: string, look = lookOf(session), quiet = false): Promise<GlideReply> {
  if (look.mode === 'off') {
    if (!quiet) probe({ kind: 'cursor', host: 'desktop', session, ms: 0, late: false, shown: false, requested_at: Date.now(), arrived_at: null });
    return { arrived: true, ms: 0, shown: false, late: false };
  }
  if (!usableRect(rectPx)) {
    hide(session);
    return { arrived: true, ms: 0, shown: false, late: false };
  }
  const { display, rect } = place(rectPx, toDip, (r) => screen.getDisplayMatching(r));
  const m = marks.get(session);
  const moved = !!m && m.display !== display.id;
  if (moved) hide(session);
  const now = Date.now();
  const prev = m && !moved && now - m.at < look.idleFadeMs ? m : null;
  const { from, to, ms } = planGlide({ mode: look.mode, reducedMotion: look.reducedMotion, prev, target: rect, keep: /^(press|scroll)\b/.test(caption), host: display.bounds });
  const id = `desk:${++glides}`;
  const requested_at = Date.now();
  const due = requested_at + ms + LATE_MS;
  let got: Arrival | null = null;
  try {
    // window creation, page load, send and arrival all sit inside the one ms + 16 deadline (D57)
    const w = windowFor(display, look.protect);
    const arrival = awaitArrived(w.win.isDestroyed() ? null : w.win.webContents, id, ms);
    void w.ready.then(() => {
      if (w.win.isDestroyed() || Date.now() >= due) return;
      if (!quiet) acted(w.win);
      else if (moved && cursorsShowing()) {
        // a cursor following its window onto another display shows there, without moving the 1,500 ms hide
        if (!w.win.isVisible()) w.win.showInactive();
        raise();
      }
      w.win.webContents.send('cursor.glide', { id, session, colour: look.colour, label: look.label, from, to, targetRect: rect, ms, caption: look.showCaption ? caption : '', mode: look.mode, reducedMotion: look.reducedMotion });
    }).catch(() => {});
    got = await arrival;
  } catch {
    await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())));
  }
  const at = quiet && m ? m.at : Date.now();
  marks.set(session, { display: display.id, x: to.x, y: to.y, rect: rectPx, at });
  clearTimeout(fades.get(session));
  fades.set(session, setTimeout(() => {
    fades.delete(session);
    if (marks.get(session)?.at === at) hide(session);
  }, Math.max(0, at + look.idleFadeMs - Date.now())).unref());
  if (!quiet) probe({ kind: 'cursor', host: 'desktop', session, ms, late: !got, shown: true, requested_at, arrived_at: got ? got.at : null });
  return { arrived: true, ms, shown: true, late: !got };
}

/** True while an overlay window shows, so the grant poll runs every 250 ms. */
export function cursorsShowing(): boolean {
  return Date.now() - lastAction < HIDE_AFTER_MS;
}

const inside = (r: number[] | null, x: number, y: number) => !!r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

/** The grant whose window held the session's target when it was drawn. */
function grantOf(session: string, rect: number[], list: LiveGrant[]): LiveGrant | undefined {
  return list.find((g) => g.session_id === session && inside(g.rect, rect[0] + rect[2] / 2, rect[1] + rect[3] / 2));
}

/** Follows each showing cursor's window from `grant.live`: a moved window moves the cursor, a minimised or gone one hides it. */
export function refitCursors(next: LiveGrant[]): void {
  const before = grants;
  grants = next;
  if (!cursorsShowing()) return;
  for (const [session, m] of [...marks]) {
    const was = grantOf(session, m.rect, before);
    if (!was?.rect) continue;
    const now = next.find((g) => g.id === was.id);
    if (!now || !now.rect || now.minimized || now.rect[2] <= 0) { hide(session); continue; }
    const dx = now.rect[0] - was.rect[0], dy = now.rect[1] - was.rect[1];
    if (dx || dy) void desktopGlide(session, [m.rect[0] + dx, m.rect[1] + dy, m.rect[2], m.rect[3]], '', { ...lookOf(session), mode: 'instant', showCaption: false }, true).catch(() => {});
  }
}

/** Each live grant's cursor dot for the watch layout: where the session's cursor is, as a share of the window. */
export function cursorDots(): Record<string, { fx: number; fy: number; colour: string }> {
  const out: Record<string, { fx: number; fy: number; colour: string }> = {};
  if (!cursorsShowing()) return out;
  for (const [session, m] of marks) {
    const g = grantOf(session, m.rect, grants);
    if (!g?.rect) continue;
    out[g.id] = { fx: (m.rect[0] + m.rect[2] / 2 - g.rect[0]) / g.rect[2], fy: (m.rect[1] + m.rect[3] / 2 - g.rect[1]) / g.rect[3], colour: sessionColour(session) };
  }
  return out;
}

function displaysChanged(): void {
  const all = new Map(screen.getAllDisplays().map((d) => [d.id, d]));
  for (const [id, w] of wins) {
    const d = all.get(id);
    if (d && !w.win.isDestroyed()) {
      w.win.setBounds(d.bounds);
      continue;
    }
    if (!w.win.isDestroyed()) w.win.destroy();
    wins.delete(id);
    for (const [session, m] of marks) if (m.display === id) marks.delete(session);
  }
  for (const [session, m] of [...marks]) if (cursorsShowing()) void desktopGlide(session, m.rect, '', { ...lookOf(session), mode: 'instant', showCaption: false }, true).catch(() => {});
}

/** Wires display changes and the per-session look; call once after app ready. */
export function initDesktopOverlay(look: (sessionId: string) => DesktopLook, probeRow?: (row: Record<string, unknown>) => void): void {
  lookOf = look;
  if (probeRow) probe = probeRow;
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed'] as const) screen.on(ev as 'display-added', displaysChanged);
}

export function closeDesktopOverlay(): void {
  hideAll();
  for (const { win } of wins.values()) if (!win.isDestroyed()) win.destroy();
  wins.clear();
  marks.clear();
  for (const t of fades.values()) clearTimeout(t);
  fades.clear();
}
