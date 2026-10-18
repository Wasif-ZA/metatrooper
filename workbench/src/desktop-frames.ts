import { BrowserWindow, screen } from 'electron';

/** A live grant as `grant.live` reports it; `rect` is `[x, y, w, h]` in physical pixels. */
export interface LiveGrant { id: string; session_id: string; hwnd: number; title: string; rect: number[] | null; minimized: boolean }

const BORDER = 3;
const frames = new Map<string, BrowserWindow>();

/** A stable colour per session, so a frame and a session's cursor match. */
export function sessionColour(sessionId: string): string {
  let h = 0;
  for (const c of sessionId) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 85%, 60%)`;
}

/** The frame's bounds in DIPs: the window's rectangle grown by the border on every side. */
export function frameBounds(rect: number[], toDip: (r: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number }) {
  const r = toDip({ x: rect[0], y: rect[1], width: rect[2], height: rect[3] });
  return { x: Math.round(r.x) - BORDER, y: Math.round(r.y) - BORDER, width: Math.round(r.width) + 2 * BORDER, height: Math.round(r.height) + 2 * BORDER };
}

function makeFrame(colour: string): BrowserWindow {
  const w = new BrowserWindow({
    frame: false, transparent: true, focusable: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, show: false,
    alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  w.setIgnoreMouseEvents(true);
  w.setContentProtection(true);
  w.setAlwaysOnTop(true, 'floating');
  const html = `<!doctype html><html><body style="margin:0;height:100vh;box-sizing:border-box;border:${BORDER}px solid ${colour};background:transparent"></body></html>`;
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return w;
}

/** One click-through frame per live grant, in its session's colour, moved to the window; gone or minimised windows lose theirs. */
export function syncFrames(grants: LiveGrant[]): void {
  const keep = new Set<string>();
  for (const g of grants) {
    if (!g.rect || g.minimized || g.rect[2] <= 0 || g.rect[3] <= 0) continue;
    keep.add(g.id);
    let w = frames.get(g.id);
    if (!w || w.isDestroyed()) {
      w = makeFrame(sessionColour(g.session_id));
      frames.set(g.id, w);
    }
    const b = frameBounds(g.rect, (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r));
    const now = w.getBounds();
    if (now.x !== b.x || now.y !== b.y || now.width !== b.width || now.height !== b.height) w.setBounds(b);
    if (!w.isVisible()) w.showInactive();
  }
  for (const [id, w] of frames) {
    if (keep.has(id)) continue;
    if (!w.isDestroyed()) w.destroy();
    frames.delete(id);
  }
}
syncFrames.count = () => frames.size;
