import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { PARENT_SESSION_ENV } from '../../core/src/terminal/parent-env.ts';
import { windowsBuild } from '../../core/src/terminal/windows-build.ts';
import { resolveLaunch } from '../../core/src/hook/resolve.ts';
import { termAck } from './terminals.ts';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, Notification, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { syncFrames } from './desktop-frames.ts';
import { DatabaseSync } from 'node:sqlite';
import { browserPipe, corePipe, dbFile, homeDir, logsDir, uiKeyFile } from '../../core/src/paths.ts';
import { captureProcessLog } from '../../core/src/log.ts';
import { ulid } from '../../core/src/time.ts';
import { PaneManager, ToolError, type PaneRow } from './browser/panes.ts';
import { startBrowserServer } from './browser/server.ts';
import { typedUrl } from '../../core/src/browser/policy.ts';
import { openReaderDb } from '../../core/src/store/db.ts';
import { call } from '../../core/src/pipe/client.ts';
import { browserAudit, dataVersion, snapshot, toastFor, withContext, withLiveText, type LiveText, type Snapshot } from './queries.ts';
import { fileDiff, gitIn, handback, sessionChanges } from './handback.ts';
import { gitAct, gitView, ownerGroups, runIn, type GitView } from './gitpane.ts';
import { ownersAsync, repoOfAsync } from '../../core/src/sessions/owners.ts';
import { copied, diffLineBody, elementBody, filesBody } from './comments.ts';
import { attachTerm, detachAll, detachTerm, termInput, termResize } from './terminals.ts';
import { activeTheme, settings, settingsError, settingsFile } from '../../core/src/settings.ts';
import { ownedIn, refreshRowGit, rowGit } from './rowgit.ts';
import { crashAction, freshNeeds, watchDb } from './queries.ts';

captureProcessLog('workbench', false);
process.on('uncaughtException', (e) => { try { dialog.showErrorBox('A JavaScript error occurred in the main process', String(e?.stack ?? e)); } catch {} });
app.on('render-process-gone', (_e, wc, d) => console.error(`render-process-gone ${d.reason} exit ${d.exitCode} ${wc.getURL().slice(0, 200)}`));
app.on('child-process-gone', (_e, d) => console.error(`child-process-gone ${d.type} ${d.reason} exit ${d.exitCode}`));
let lagAt = Date.now();
setInterval(() => {
  const lag = Date.now() - lagAt - 500;
  if (lag > 1000) console.error(`main thread stalled ${lag} ms`);
  lagAt = Date.now();
}, 500).unref();

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, '..', 'renderer', 'index.html');
const DEBOUNCE_MS = 50;
const POLL_MS = 1000;

export const UI_METHODS = new Set([
  'session.search', 'session.list',
  'project.open', 'session.launch', 'session.focus', 'session.seen', 'session.hide', 'session.limit-resume', 'project.clear', 'project.hide', 'engines.check',
  'needs.dismiss', 'session.paste-prompt', 'shell.list', 'shell.open', 'shell.close', 'session.clear-status', 'session.resume', 'needs_you.mark-read', 'needs_you.mark-unread', 'pane.open', 'pane.close', 'pane.assign', 'pane.capture', 'approval.resolve',
  'notify.sink.set', 'notify.sink.list', 'notify.sink.test', 'notify.sink.remove',
  'grant.candidates', 'grant.window', 'grant.revoke', 'takeover.resume',
]);

let win: BrowserWindow | null = null;
let reader: DatabaseSync | null = null;
let view: { projectId: string | null } = { projectId: null };
let lastVersion = -1;
let lastOnline: boolean | null = null;
let pushTimer: NodeJS.Timeout | null = null;
let panes: PaneManager | null = null;

function db(): DatabaseSync | null {
  if (reader) return reader;
  try {
    reader = openReaderDb();
    reader?.exec('PRAGMA busy_timeout = 200');
  } catch {
    reader = null;
  }
  return reader;
}

function emptySnapshot(): Snapshot {
  return { at: Date.now(), core: { online: false, pid: null, heartbeat_age_ms: null }, projects: [], engines: [], sessions: [], needs_you: [], approvals: [], panes: [], snapshots: [], limits: [], selected: null, git: {} };
}

let lastGood: Snapshot | null = null;
let liveText: LiveText = {};
let livePolling = false;

/** Fetches the core's in-memory terminal lines and titles; pushes when they changed. */
async function pollLiveText(): Promise<void> {
  if (livePolling) return;
  livePolling = true;
  try {
    const out = await call('session.live-text', {}, { waitMs: POLL_MS });
    const next = out.kind === 'reply' && out.reply.result && typeof out.reply.result === 'object' ? out.reply.result as LiveText : {};
    if (JSON.stringify(next) !== JSON.stringify(liveText)) { liveText = next; schedulePush(); }
  } catch {} finally { livePolling = false; }
}

let readFromDb = false;

function read(): Snapshot {
  readFromDb = false;
  const d = db();
  if (!d) return emptySnapshot();
  try {
    lastGood = { ...withLiveText(withContext(snapshot(d, view.projectId), path.join(homeDir(), 'claude-context')), liveText), git: rowGit(), settings_error: settingsError(), core_mismatch: coreMismatch, core_log: coreLog };
    readFromDb = true;
    return lastGood;
  } catch {
    try { reader?.close(); } catch {}
    reader = null;
    return lastGood ? { ...lastGood, at: Date.now() } : emptySnapshot();
  }
}

function syncPanes(): void {
  const d = db();
  if (!d || !panes) return;
  try {
    panes.sync(d.prepare('SELECT * FROM browser_pane WHERE open = 1').all() as unknown as PaneRow[]);
  } catch {}
}

let toasted: Set<string> | null = null;
/** The tile the renderer shows big, reported on every change; ui_selection lags behind shell picks and project switches. */
let focused: string | null = null;

/** The session a needs-you row is about, from the snapshot or else the database, with its live terminal title. */
function sessionOf(s: Snapshot, n: Snapshot['needs_you'][number]) {
  if (n.kind !== 'done' && n.kind !== 'failed' && n.kind !== 'uncommitted') return null;
  const hit = [...s.sessions, ...(s.live ?? [])].find((x) => x.id === n.ref);
  if (hit) return hit;
  try {
    const row = db()?.prepare('SELECT engine_id, cwd, step_id, started_at FROM session WHERE id = ?').get(n.ref) as { engine_id: string; cwd: string | null; step_id: string | null; started_at: string } | undefined;
    return row ? { ...row, title: n.ref ? liveText[n.ref]?.title ?? null : null } : null;
  } catch {
    return null;
  }
}

/** One Windows toast per new needs-you row; clicking it shows the window and selects the session it is about. */
function toastNew(s: Snapshot, fromDb: boolean): void {
  const next = freshNeeds(toasted, s, fromDb);
  toasted = next.seen;
  for (const n of next.fresh) {
    if (!Notification.isSupported()) continue;
    const toast = toastFor(n, sessionOf(s, n), { window: !!win && !win.isDestroyed() && win.isFocused(), session: focused });
    if (!toast) continue;
    const note = new Notification({ ...toast, silent: false });
    note.on('click', () => {
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      const target = n.kind === 'done' || n.kind === 'failed' ? n.ref : null;
      if (target) void call('session.focus', { session_id: target }, { ui: true }).then(schedulePush);
    });
    note.show();
  }
}

function push(): void {
  if (!win || win.isDestroyed()) return;
  syncPanes();
  const s = read();
  lastOnline = s.core.online;
  toastNew(s, readFromDb);
  win.webContents.send('snapshot', s);
}

function schedulePush(): void {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    push();
  }, DEBOUNCE_MS);
}

let toldPid: number | null = null;
/** The take-over key as registered, and why it failed; the error is undefined until registration has been tried. */
let takeoverKey = '';
let takeoverError: string | null | undefined;
/** Tells each core that starts (a new `core.pid`) this process's pid, so it never lists or grants the workbench's windows (M6-15). */
async function tellCoreOurPid(corePid: number | null): Promise<void> {
  if (!corePid || corePid === toldPid || takeoverError === undefined) return;
  const out = await call('desktop.ui-window', { pid: process.pid, takeover_key: takeoverKey, takeover_error: takeoverError }, { ui: true });
  if (out.kind === 'reply' && !out.reply.error) toldPid = corePid;
}

/** Watches the data folder for troop.db* writes, and polls PRAGMA data_version and the heartbeat every second. */
function watch(): void {
  const dir = homeDir();
  fs.mkdirSync(dir, { recursive: true });
  watchDb(dir, path.basename(dbFile()), schedulePush);
  setInterval(() => {
    const d = db();
    let changed = false;
    if (d) {
      try {
        const v = dataVersion(d);
        if (v !== lastVersion) {
          lastVersion = v;
          changed = true;
        }
      } catch {
        try { reader?.close(); } catch {}
        reader = null;
      }
    }
    const s = read();
    void tellCoreOurPid(s.core.pid);
    if (lastOnline === true && !s.core.online && ownCore && !closing) void restartOwnCore();
    if (lastOnline === false && s.core.online) void checkCoreVersion().then(schedulePush);
    if (changed || s.core.online !== lastOnline) schedulePush();
    void pollLiveText();
  }, POLL_MS);
}

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file:') && fileURLToPath(url.split(/[?#]/)[0]) === INDEX;
}

async function saveComment(id: string, sessionId: string, kind: 'element' | 'diff-line' | 'file', body: string, crop: string | null): Promise<{ ok: boolean; error?: string; comment_id?: string; copied?: boolean }> {
  const rw = new DatabaseSync(dbFile());
  try {
    rw.exec('PRAGMA busy_timeout = 2000');
    rw.prepare('INSERT INTO comment (id, at, session_id, kind, body, crop_path) VALUES (?, ?, ?, ?, ?, ?)').run(id, new Date().toISOString(), sessionId, kind, body, crop);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    rw.close();
  }
  const out = await call('comment.deliver', { comment_id: id }, { ui: true });
  return { ok: true, comment_id: id, copied: copied(out) };
}

function inside(root: string, file: string): boolean {
  const r = path.relative(path.resolve(root), path.resolve(file));
  return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r);
}

function appendLine(envName: string, value: unknown): void {
  const file = process.env[envName];
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify(value) + '\n');
  } catch {}
}

/** Asks the core, the only writer of settings.json, to set one key; returns the core's error message, if any. */
async function writeSetting(key: string, value: unknown): Promise<string | null> {
  const out = await call('settings.set', { key, value }, { ui: true });
  if (out.kind !== 'reply') return 'the core is offline, so the setting was not saved';
  return out.reply.error ? out.reply.error.message : null;
}

function handlers(): void {
  const on = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (e, ...args) => {
      if (!trusted(e)) throw new Error('untrusted sender');
      return fn(...args);
    });
  };

  on('view', (v: { projectId?: unknown }) => {
    view = { projectId: typeof v?.projectId === 'string' ? v.projectId : null };
    push();
    return true;
  });

  on('focus', (id: unknown) => {
    focused = typeof id === 'string' ? id : null;
    return true;
  });

  on('call', async (method: unknown, params: unknown) => {
    if (typeof method !== 'string' || !UI_METHODS.has(method)) return { kind: 'reply', reply: { id: null, error: { code: -32601, message: `the workbench does not call ${String(method)}` } } };
    const out = await call(method, (params && typeof params === 'object' ? params : {}) as Record<string, unknown>, { ui: true });
    schedulePush();
    return out;
  });

  on('pickFolder', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  on('paneShow', (paneId: unknown, bounds: unknown) => {
    const b = bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
    const rect = b && [b.x, b.y, b.width, b.height].every((v) => typeof v === 'number')
      ? { x: Math.round(b.x as number), y: Math.round(b.y as number), width: Math.round(b.width as number), height: Math.round(b.height as number) }
      : null;
    panes?.show(typeof paneId === 'string' ? paneId : null, rect);
    return true;
  });

  on('paneNavigate', async (paneId: unknown, url: unknown) => {
    if (typeof paneId !== 'string' || typeof url !== 'string' || !panes) return { ok: false, error: 'no pane' };
    try {
      await panes.userNavigate(paneId, typedUrl(url));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  on('paneAct', (paneId: unknown, action: unknown, arg: unknown) => {
    if (typeof paneId === 'string' && typeof action === 'string') panes?.act(paneId, action, arg);
    return true;
  });

  on('paneAudit', (paneId: unknown) => {
    const d = db();
    return typeof paneId === 'string' && d ? browserAudit(d, paneId) : [];
  });

  on('paneMenu', (items: unknown, x: unknown, y: unknown) => new Promise<string | null>((resolve) => {
    if (!win || !Array.isArray(items)) return resolve(null);
    const tpl = (list: unknown[]): MenuItemConstructorOptions[] => list.map((i: any) => i?.type === 'separator' ? { type: 'separator' as const }
      : Array.isArray(i?.submenu) ? { label: String(i.label ?? ''), submenu: tpl(i.submenu) }
      : { label: String(i?.label ?? ''), enabled: i?.enabled !== false, type: i?.checked === undefined ? 'normal' as const : 'radio' as const, checked: !!i?.checked, click: () => resolve(String(i?.id)) });
    // Windows fires the close callback before click, so let a click resolve first
    Menu.buildFromTemplate(tpl(items)).popup({ window: win, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0), callback: () => setTimeout(() => resolve(null), 0) });
  }));

  on('panePick', async (paneId: unknown) => {
    if (typeof paneId !== 'string' || !panes) return false;
    await panes.pick(paneId);
    return true;
  });

  on('panePickWalk', async (paneId: unknown, dir: unknown) => {
    if (typeof paneId !== 'string' || (dir !== 'up' && dir !== 'down') || !panes) return false;
    return panes.walkPick(paneId, dir);
  });

  on('panePickCancel', (paneId: unknown) => {
    if (typeof paneId === 'string') panes?.cancelPick(paneId);
    return true;
  });

  on('commentSave', async (c: { pane_id?: unknown; session_id?: unknown; note?: unknown; url?: unknown; selector?: unknown; html?: unknown; crop?: unknown }) => {
    if (typeof c?.session_id !== 'string' || typeof c.note !== 'string') return { ok: false, error: 'pick a session and write a note' };
    const id = ulid();
    const dir = path.join(homeDir(), 'comments', c.session_id.replace(/[^A-Za-z0-9]/g, ''));
    fs.mkdirSync(dir, { recursive: true });
    const crop = path.join(dir, `${id}.png`);
    if (typeof c.crop === 'string') fs.writeFileSync(crop, Buffer.from(c.crop, 'base64'));
    const body = elementBody(id, c.note, String(c.url ?? ''), String(c.selector ?? ''), String(c.html ?? ''), crop.split(String.fromCharCode(92)).join('/'));
    return saveComment(id, c.session_id, 'element', body, crop.split(String.fromCharCode(92)).join('/'));
  });

  on('commentDiffLine', async (c: { session_id?: unknown; note?: unknown; file?: unknown; line?: unknown; text?: unknown }) => {
    if (typeof c?.session_id !== 'string' || typeof c.note !== 'string' || !c.note.trim()) return { ok: false, error: 'pick a session and write a note' };
    if (typeof c.file !== 'string' || !Number.isInteger(c.line)) return { ok: false, error: 'pick a diff line' };
    const id = ulid();
    return saveComment(id, c.session_id, 'diff-line', diffLineBody(id, c.note, c.file, c.line as number, String(c.text ?? '')), null);
  });

  on('commentFiles', async (c: { session_id?: unknown; paths?: unknown }) => {
    const paths = Array.isArray(c?.paths) ? c.paths.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)) : [];
    if (typeof c?.session_id !== 'string' || !paths.length) return { ok: false, error: 'drop files on a session card' };
    const id = ulid();
    return saveComment(id, c.session_id, 'file', filesBody(id, paths), null);
  });

  on('snapshotImage', (file: unknown) => {
    if (typeof file !== 'string' || !inside(path.join(homeDir(), 'snapshots'), file)) return null;
    try {
      return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      return null;
    }
  });

  on('handback', async (projectId: unknown) => {
    const d = db();
    const project = d && typeof projectId === 'string' ? (d.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined) : undefined;
    if (!project) return { error: 'pick a project first' };
    try {
      return await handback(gitIn(project.path));
    } catch (e) {
      return { error: (e as Error).message.split(String.fromCharCode(10))[0] };
    }
  });

  on('handbackFile', async (projectId: unknown, file: unknown) => {
    const d = db();
    if (!d || typeof projectId !== 'string' || typeof file !== 'string') return null;
    const project = d.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) return null;
    try {
      return await gitIn(project.path)(['diff', '--cached', '--', file]);
    } catch {
      return null;
    }
  });

  const gitViews = new Map<string, { at: number; view: Promise<GitView> }>();
  const viewOf = (dir: string) => {
    const hit = gitViews.get(dir);
    if (hit && Date.now() - hit.at < 3000) return hit.view;
    const view = gitView(runIn(dir));
    gitViews.set(dir, { at: Date.now(), view });
    view.catch(() => gitViews.delete(dir));
    return view;
  };

  on('git', async (projectId: unknown, op: unknown, arg: unknown) => {
    const d = db();
    const project = d && typeof projectId === 'string' ? (d.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined) : undefined;
    if (!project) return { error: 'pick a project first' };
    const git = runIn(project.path);
    const why = (e: unknown) => { const err = e as Error & { stderr?: string }; return (err.stderr || err.message).trim().split(String.fromCharCode(10)).slice(-3).join(' '); };
    if ((op === 'diff' || op === 'diff-staged') && typeof arg === 'string') {
      try { return await git(['diff', ...(op === 'diff-staged' ? ['--cached'] : []), '--', arg]); } catch { return null; }
    }
    let error: string | undefined;
    try {
      if (typeof op === 'string' && op !== 'view') await gitAct(git, op, arg);
    } catch (e) {
      error = why(e);
    } finally {
      if (op !== 'view') gitViews.delete(project.path);
    }
    try {
      const view = await viewOf(project.path);
      const repo = await repoOfAsync(project.path);
      let groups: GitView['groups'];
      try { if (repo && d) groups = ownerGroups(view.changes, await ownersAsync(d, repo)); } catch {}
      return { ...view, groups, error };
    } catch (e) {
      return { error: why(e) };
    }
  });

  const cwdOf = (sessionId: unknown) => {
    const d = db();
    const row = d && typeof sessionId === 'string' ? (d.prepare('SELECT cwd FROM session WHERE id = ?').get(sessionId) as { cwd: string | null } | undefined) : undefined;
    return row?.cwd ?? null;
  };
  /** The commit the Diff tab compares against: the turn's start, HEAD, or where the branch left the default branch. */
  const diffBase = async (sessionId: unknown, scope: unknown, cwd: string): Promise<string> => {
    const g = gitIn(cwd);
    if (scope === 'turn') {
      const d = db();
      const row = d && typeof sessionId === 'string' ? (d.prepare('SELECT turn_base FROM session WHERE id = ?').get(sessionId) as { turn_base: string | null } | undefined) : undefined;
      if (row?.turn_base) return row.turn_base;
    }
    if (scope === 'branch') {
      for (const ref of ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master']) {
        try { return (await g(['merge-base', 'HEAD', ref])).trim(); } catch {}
      }
    }
    return 'HEAD';
  };
  on('sessionDiff', async (sessionId: unknown, scope: unknown) => {
    const cwd = cwdOf(sessionId);
    if (!cwd) return { error: 'this session has no folder recorded' };
    try {
      return await sessionChanges(gitIn(cwd), await diffBase(sessionId, scope, cwd));
    } catch (e) {
      return { error: (e as Error).message.split(String.fromCharCode(10))[0] };
    }
  });
  on('sessionDiffFile', async (sessionId: unknown, file: unknown, scope: unknown) => {
    const cwd = cwdOf(sessionId);
    if (!cwd || typeof file !== 'string') return null;
    try { return await fileDiff(gitIn(cwd), await diffBase(sessionId, scope, cwd), file); } catch { return null; }
  });

  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  on('termAttach', (sessionId: unknown, cols: unknown, rows: unknown) => {
    if (typeof sessionId !== 'string') return false;
    attachTerm(sessionId, num(cols, settings().terminal.cols), num(rows, settings().terminal.rows), (sid, msg) => { if (win && !win.isDestroyed()) win.webContents.send('term', sid, msg); });
    return { windows_build: windowsBuild() };
  });
  on('uiSettings', () => ({ terminal: settings().terminal, ui: { ...settings().ui, themes: undefined }, theme: activeTheme(), themes: Object.entries(settings().ui.themes).map(([id, t]) => ({ id, label: t.label || id })), firstRun: !fs.existsSync(settingsFile()), home: app.getPath('home') }));
  on('setTheme', async (name: unknown) => {
    if (typeof name !== 'string' || !Object.hasOwn(settings().ui.themes, name)) return { error: 'unknown theme' };
    const error = await writeSetting('ui.theme', name);
    return error ? { error } : activeTheme({ ...settings(), ui: { ...settings().ui, theme: name } });
  });
  on('setApproval', async (value: unknown) => {
    if (value !== 'ask' && value !== 'contained') return { error: 'approval must be ask or contained' };
    const error = await writeSetting('sessions.approval', value);
    return error ? { error } : { ok: true };
  });
  let layoutWrites = Promise.resolve<unknown>(null);
  on('saveLayout', (projectId: unknown, layout: unknown) => {
    if (typeof projectId !== 'string' || !layout || typeof layout !== 'object' || Array.isArray(layout) || JSON.stringify(layout).length > 64 * 1024) return { error: 'bad layout' };
    layoutWrites = layoutWrites.catch(() => null).then(() => writeSetting('ui.layout', { ...settings().ui.layout, [projectId]: layout }));
    return layoutWrites.then((error) => (error ? { error } : { ok: true }));
  });
  on('termInput', (sessionId: unknown, data: unknown) => { if (typeof sessionId === 'string' && typeof data === 'string') termInput(sessionId, data); });
  on('termResize', (sessionId: unknown, cols: unknown, rows: unknown) => { if (typeof sessionId === 'string') termResize(sessionId, num(cols, settings().terminal.cols), num(rows, settings().terminal.rows)); });
  on('termAck', (sessionId: unknown, bytes: unknown) => { if (typeof sessionId === 'string' && typeof bytes === 'number') termAck(sessionId, bytes); });
  on('termDetach', (sessionId: unknown) => { if (typeof sessionId === 'string') detachTerm(sessionId); });

  on('readText', () => clipboard.readText());
  on('pasteImage', async (sessionId: unknown) => {
    if (typeof sessionId !== 'string') return null;
    const item = (await clipboard.read()).find((i) => i.types.includes('image/png'));
    if (!item) return null;
    const png = Buffer.from(await ((await item.getType('image/png')) as Blob).arrayBuffer());
    const dir = path.join(homeDir(), 'paste', sessionId.replace(/[^A-Za-z0-9-]/g, ''));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${ulid()}.png`);
    fs.writeFileSync(file, png);
    return file;
  });
  on('linkCheck', (sessionId: unknown, candidates: unknown) => {
    if (!Array.isArray(candidates)) return [];
    const cwd = cwdOf(sessionId);
    return candidates.slice(0, 50).map((c) => {
      if (typeof c !== 'string' || c.length > 400) return null;
      const file = path.isAbsolute(c) ? c : cwd ? path.resolve(cwd, c) : null;
      try { return file && fs.statSync(file).isFile() ? file : null; } catch { return null; }
    });
  });
  on('openLink', (target: unknown, line: unknown, col: unknown) => {
    if (typeof target !== 'string') return false;
    if (/^https?:\/\//.test(target)) { void shell.openExternal(target); return true; }
    try { if (!fs.statSync(target).isFile()) return false; } catch { return false; }
    const code = resolveLaunch('code');
    if (!code) { shell.showItemInFolder(target); return true; }
    spawn(code.argv[0], [...code.argv.slice(1), '-g', `${target}:${num(line, 1)}:${num(col, 1)}`], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...code.env } }).on('error', (e) => console.error(`could not open ${target}: ${e.message}`)).unref();
    return true;
  });
  on('restartCore', async () => { await restartCore(); ownCore = true; return true; });
  on('stopCore', async () => { await stopCore(); return true; });
  on('openLogs', async () => { fs.mkdirSync(logsDir(), { recursive: true }); return (await shell.openPath(logsDir())) === ''; });
  on('copyText', (text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
    return true;
  });

  on('desktopThumbs', async () => {
    const grants = lastGood?.grants ?? [];
    if (!grants.length) return {};
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 480, height: 300 }, fetchWindowIcons: false });
    const out: Record<string, string> = {};
    for (const g of grants) {
      const s = sources.find((x) => x.id.startsWith(`window:${g.hwnd}:`));
      if (s && !s.thumbnail.isEmpty()) out[g.id] = s.thumbnail.toDataURL();
    }
    return out;
  });

  on('longtasks', (entries: unknown) => appendLine('METATROOPER_LONGTASK_LOG', { at: Date.now(), entries }));
  on('probe', (state: unknown) => appendLine('METATROOPER_WORKBENCH_PROBE', { at: Date.now(), state, app_menu: Menu.getApplicationMenu() !== null, loads }));
}

/** No network: only the app's own files load; http(s) links open in the system browser. */
function lockDown(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith('file:') || details.url.startsWith('devtools:') || details.url.startsWith('data:');
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  app.on('web-contents-created', (_e, contents) => {
    if (contents.session !== session.defaultSession) return;
    contents.on('will-navigate', (ev) => ev.preventDefault());
    contents.on('will-attach-webview', (ev) => ev.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

let loads = 0;

function createWindow(): void {
  win = new BrowserWindow({
    icon: path.join(APP_DIR, 'build', 'icon.png'),
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'MetaTrooper',
    backgroundColor: activeTheme().bg,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.on('did-finish-load', push);
  win.webContents.on('did-finish-load', () => { loads++; });
  let reloadedAt = -Infinity;
  win.webContents.on('render-process-gone', (_e, d) => {
    detachAll();
    panes?.show(null, null);
    const act = crashAction(d.reason, reloadedAt, Date.now());
    if (act === 'reload') { reloadedAt = Date.now(); win?.webContents.reload(); }
    else if (act === 'stop') dialog.showErrorBox('MetaTrooper', `The window crashed again (${d.reason}). Restart MetaTrooper; the logs folder has details.`);
  });
  win.webContents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) detachAll(); });
  win.on('unresponsive', () => console.error('window unresponsive'));
  win.on('responsive', () => console.error('window responsive again'));
  win.on('close', (e) => {
    if (closing || !ownCore) return;
    e.preventDefault();
    void onClose();
  });
  win.on('closed', () => {
    panes?.closeAll();
    syncFrames([]);
    win = null;
  });
  panes = new PaneManager(win, {
    db,
    probe: (entry) => appendLine('METATROOPER_WORKBENCH_PROBE', { at: Date.now(), state: entry }),
    urlChanged: (paneId, url) => { void call('pane.url', { pane_id: paneId, url }, { ui: true }); },
    commentPicked: (info) => win?.webContents.send('comment-picked', info),
    paneEvent: (ev) => { if (win && !win.isDestroyed()) win.webContents.send('pane-event', ev); },
    openPane: (projectId, url) => {
      void call('pane.open', { project_id: projectId, url }, { ui: true }).then((out) => {
        const paneId = out.kind === 'reply' ? (out.reply.result as { pane_id?: string } | undefined)?.pane_id : undefined;
        if (paneId && win && !win.isDestroyed()) win.webContents.send('pane-event', { kind: 'opened', pane_id: paneId });
        schedulePush();
      });
    },
  });
  const query = { ...(process.env.METATROOPER_WORKBENCH_PROBE ? { probe: '1' } : {}), ...(process.env.METATROOPER_DEMO ? { demo: '1' } : {}) };
  void win.loadFile(INDEX, { query });
}

const CORE_MAIN = path.join(here, '..', '..', 'core', 'src', 'main.ts');
const APP_DIR = path.resolve(here, '..');
const APP_VERSION = String((JSON.parse(fs.readFileSync(path.join(APP_DIR, '..', 'package.json'), 'utf8')) as { version?: unknown }).version ?? '');

let coreMismatch: string | null = null;
let coreLog: string[] | null = null;
const restarts: number[] = [];

/** Compares the running core's version with this window's; a different one makes the window offer Restart core. */
async function checkCoreVersion(): Promise<void> {
  const out = await call('core.ping', {}, { ui: true });
  if (out.kind !== 'reply' || out.reply.error) return;
  const v = (out.reply.result as { version?: unknown }).version;
  coreMismatch = v === APP_VERSION ? null : `core ${typeof v === 'string' ? v : '(older)'} is running; this window is ${APP_VERSION}`;
}

/** The last `n` lines of logs/core.log. */
function coreLogTail(n: number): string[] {
  try { return fs.readFileSync(path.join(logsDir(), 'core.log'), 'utf8').trimEnd().split(/\r?\n/).slice(-n); } catch { return ['logs/core.log could not be read']; }
}

/** Restarts a core this window started when it stops answering, at most 3 times in 60 s; after that it shows the core log instead. */
async function restartOwnCore(): Promise<void> {
  const now = Date.now();
  while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
  if (restarts.length >= 3) {
    coreLog = coreLogTail(20);
    schedulePush();
    return;
  }
  restarts.push(now);
  coreLog = null;
  await ensureCore();
  await checkCoreVersion();
  schedulePush();
}

function coreUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(corePipe());
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.setTimeout(500, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Starts the core detached when none answers, without the parent Claude Code session's identity; it outlives the window. */
let ownCore = false;
let closing = false;

async function ensureCore(): Promise<void> {
  if (await coreUp()) return;
  ownCore = true;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !PARENT_SESSION_ENV.has(k.toUpperCase()) && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  spawn('node', [CORE_MAIN], { cwd: path.dirname(path.dirname(CORE_MAIN)), detached: true, stdio: 'ignore', windowsHide: true, env }).on('error', (e) => console.error(`could not start the core: ${e.message}`)).unref();
  for (let i = 0; i < 40 && !(await coreUp()); i++) await new Promise((r) => setTimeout(r, 250));
}

function folderArg(argv: string[], cwd: string): string | null {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    const p = path.resolve(cwd, a);
    if (p === APP_DIR) continue;
    try { if (fs.statSync(p).isDirectory()) return p; } catch {}
  }
  return null;
}

export function needsYouLink(argv: string[]): string | null {
  for (const a of argv) {
    const m = /^metatrooper:\/\/needs-you\/([A-Za-z0-9_-]{1,64})\/?$/i.exec(a);
    if (m) return m[1];
  }
  return null;
}

/** Tests (METATROOPER_HOME set) and git worktrees (a .git file, not a folder) never take over the OS link handler. */
function registersProtocol(): boolean {
  if (process.env.METATROOPER_HOME) return false;
  if (!process.defaultApp) return true;
  try { return fs.statSync(path.join(APP_DIR, '..', '.git')).isDirectory(); } catch { return false; }
}

function openNeedsYou(id: string | null): void {
  if (!id || !win) return;
  const send = () => win?.webContents.send('open-needs-you', id);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

async function stopCore(): Promise<void> {
  ownCore = false;
  await call('core.stop', {}, { ui: true });
  for (let i = 0; i < 40 && (await coreUp()); i++) await new Promise((r) => setTimeout(r, 250));
}

async function restartCore(): Promise<void> {
  await stopCore();
  await ensureCore();
}

/** Any open agent session counts, so an agent waiting on the user is never stopped unasked. */
function busy(): boolean {
  const s = lastGood;
  return !!s && s.sessions.some((x) => x.state !== 'exited');
}

/** Closing asks only when the window started the core and work is open; an idle own core is stopped, a core started elsewhere is left alone. */
async function onClose(): Promise<void> {
  if (ownCore && busy()) {
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Keep running in the background', 'Stop everything', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Agents are still open.',
      detail: 'Keep them running and reattach next time, or stop the core and every agent now.',
    });
    if (response === 2) return;
    if (response === 1) await stopCore();
  } else if (ownCore) await stopCore();
  closing = true;
  win?.close();
}

async function openFolder(dir: string | null): Promise<void> {
  if (!dir) return;
  const out = await call('project.open', { path: dir });
  const id = out.kind === 'reply' ? (out.reply.result as { project_id?: string } | undefined)?.project_id : undefined;
  if (!id || !win) return;
  const send = () => win?.webContents.send('select-project', id);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

app.setPath('userData', path.join(homeDir(), 'workbench'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    void openFolder(folderArg(argv, cwd));
    openNeedsYou(needsYouLink(argv));
  });
  app.whenReady().then(() => {
    if (registersProtocol()) {
      if (process.defaultApp) app.setAsDefaultProtocolClient('metatrooper', process.execPath, [APP_DIR]);
      else app.setAsDefaultProtocolClient('metatrooper');
    }
    lockDown();
    handlers();
    Menu.setApplicationMenu(null);
    createWindow();
    void ensureCore().then(checkCoreVersion).then(() => openFolder(folderArg(process.argv, process.cwd())));
    openNeedsYou(needsYouLink(process.argv));
    watch();
    const gitTick = async () => {
      try {
        const all = lastGood?.sessions ?? [];
        const live = all.filter((x) => x.state !== 'exited').map((x) => ({ id: x.id, cwd: x.cwd }));
        const d = db();
        if (await refreshRowGit(live, d ? await ownedIn(d, all.map((x) => x.cwd)) : {})) push();
      } catch {}
      setTimeout(gitTick, settings().terminal.git_every_ms);
    };
    void gitTick();
    const takeover = takeoverKey = settings().desktop.takeover_key;
    try {
      takeoverError = globalShortcut.register(takeover, () => { void call('takeover.pause', {}, { ui: true }).then(schedulePush); }) ? null : 'held by another program';
    } catch (e) {
      takeoverError = `not a valid accelerator: ${(e as Error).message}`;
    }
    if (takeoverError) console.error(`take-over key ${takeover} ${takeoverError}`);
    app.on('will-quit', () => globalShortcut.unregisterAll());
    const frameTick = async () => {
      try {
        if (win && (lastGood?.grants?.length || syncFrames.count())) {
          const out = await call('grant.live', {}, { ui: true, waitMs: 1000 });
          syncFrames(out.kind === 'reply' && out.reply.result ? (out.reply.result as { grants: Parameters<typeof syncFrames>[0] }).grants : []);
        }
      } catch {}
      setTimeout(frameTick, 500);
    };
    void frameTick();
    void startBrowserServer(browserPipe(), {
      db,
      uiKey: () => {
        try {
          return fs.readFileSync(uiKeyFile(), 'utf8').trim();
        } catch {
          return null;
        }
      },
      panes: panes as PaneManager,
      refreshPanes: syncPanes,
      openPane: async (projectId, sessionId) => {
        const out = await call('pane.open', { project_id: projectId, session_id: sessionId, agent: true }, { ui: true });
        const paneId = out.kind === 'reply' ? (out.reply.result as { pane_id?: string } | undefined)?.pane_id : undefined;
        if (!paneId) throw new ToolError(-32099, out.kind === 'reply' && out.reply.error ? `could not open a browser pane: ${out.reply.error.message}` : 'could not open a browser pane: the core is offline');
        schedulePush();
        return paneId;
      },
    }).catch((e) => console.error(`browser pipe did not start: ${(e as Error).message}`));
  });
  app.on('window-all-closed', () => app.quit());
}
