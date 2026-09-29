import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { browserPipe, dbFile, homeDir, uiKeyFile } from '../../core/src/paths.ts';
import { ulid } from '../../core/src/time.ts';
import { PaneManager, type PaneRow } from './browser/panes.ts';
import { startBrowserServer } from './browser/server.ts';
import { openReaderDb } from '../../core/src/store/db.ts';
import { call } from '../../core/src/pipe/client.ts';
import { dataVersion, snapshot, type Snapshot } from './queries.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, '..', 'renderer', 'index.html');
const DEBOUNCE_MS = 50;
const POLL_MS = 1000;

export const UI_METHODS = new Set([
  'project.open', 'session.launch', 'session.focus', 'session.seen', 'session.hide', 'engines.check',
  'run.start', 'run.cancel', 'run.resume', 'gate.resolve', 'pipeline.validate', 'variant.pick', 'variant.discard', 'needs.dismiss',
  'pane.open', 'pane.close', 'pane.assign', 'pane.capture',
]);

let win: BrowserWindow | null = null;
let reader: DatabaseSync | null = null;
let view: { projectId: string | null; runId: string | null } = { projectId: null, runId: null };
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
  return { at: Date.now(), core: { online: false, pid: null, heartbeat_age_ms: null }, projects: [], engines: [], sessions: [], pipelines: [], runs: [], steps: [], gates: [], needs_you: [], panes: [], snapshots: [] };
}

let lastGood: Snapshot | null = null;

function read(): Snapshot {
  const d = db();
  if (!d) return emptySnapshot();
  try {
    lastGood = snapshot(d, view.projectId, view.runId);
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

function push(): void {
  if (!win || win.isDestroyed()) return;
  syncPanes();
  const s = read();
  lastOnline = s.core.online;
  win.webContents.send('snapshot', s);
}

function schedulePush(): void {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    push();
  }, DEBOUNCE_MS);
}

/** Watches the data folder for troop.db* writes, and polls PRAGMA data_version and the heartbeat every second. */
function watch(): void {
  const dir = homeDir();
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.watch(dir, (_event, name) => {
      if (name && String(name).startsWith(path.basename(dbFile()))) schedulePush();
    });
  } catch {}
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
    if (changed || s.core.online !== lastOnline) schedulePush();
  }, POLL_MS);
}

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file:') && fileURLToPath(url.split(/[?#]/)[0]) === INDEX;
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

function handlers(): void {
  const on = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (e, ...args) => {
      if (!trusted(e)) throw new Error('untrusted sender');
      return fn(...args);
    });
  };

  on('view', (v: { projectId?: unknown; runId?: unknown }) => {
    view = { projectId: typeof v?.projectId === 'string' ? v.projectId : null, runId: typeof v?.runId === 'string' ? v.runId : null };
    push();
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

  on('readPipeline', (id: unknown) => {
    const d = db();
    const row = d && typeof id === 'string' ? (d.prepare('SELECT path FROM pipeline WHERE id = ?').get(id) as { path: string } | undefined) : undefined;
    if (!row) return null;
    try {
      return fs.readFileSync(row.path, 'utf8');
    } catch {
      return null;
    }
  });

  on('savePipeline', (projectId: unknown, text: unknown) => {
    const d = db();
    const project = d && typeof projectId === 'string' ? (d.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined) : undefined;
    if (!project || typeof text !== 'string') return { ok: false, error: 'pick a project first' };
    let json: { id?: unknown };
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
    }
    if (typeof json.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(json.id)) return { ok: false, error: 'the pipeline id must be lower-case letters, digits and dashes' };
    const dir = path.join(project.path, '.troop', 'pipelines');
    const file = path.join(dir, `${json.id}.json`);
    if (!inside(dir, file)) return { ok: false, error: 'bad pipeline id' };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    return { ok: true, path: file.split(String.fromCharCode(92)).join('/') };
  });

  on('runLog', (runId: unknown) => {
    const d = db();
    const row = d && typeof runId === 'string' ? (d.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as { run_dir: string } | undefined) : undefined;
    if (!row) return [];
    try {
      const text = fs.readFileSync(path.join(row.run_dir, 'log.jsonl'), 'utf8');
      return text.trim().split('\n').slice(-50);
    } catch {
      return [];
    }
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
      await panes.userNavigate(paneId, /^[a-z]+:/i.test(url) ? url : `https://${url}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  on('panePick', async (paneId: unknown) => {
    if (typeof paneId !== 'string' || !panes) return false;
    await panes.pick(paneId);
    return true;
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
    const body = [
      `[comment ${id}] ${c.note}`,
      `Page: ${String(c.url ?? '')}`,
      `Element: ${String(c.selector ?? '')}`,
      '```html',
      String(c.html ?? '').slice(0, 2000),
      '```',
      `Crop: ${crop.split(String.fromCharCode(92)).join('/')}`,
    ].join('\n');
    const rw = new DatabaseSync(dbFile());
    try {
      rw.exec('PRAGMA busy_timeout = 2000');
      rw.prepare("INSERT INTO comment (id, at, session_id, kind, body, crop_path) VALUES (?, ?, ?, 'element', ?, ?)")
        .run(id, new Date().toISOString(), c.session_id, body, crop.split(String.fromCharCode(92)).join('/'));
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      rw.close();
    }
    await call('comment.deliver', { comment_id: id }, { ui: true });
    return { ok: true, comment_id: id };
  });

  on('snapshotImage', (file: unknown) => {
    if (typeof file !== 'string' || !inside(path.join(homeDir(), 'snapshots'), file)) return null;
    try {
      return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      return null;
    }
  });

  on('longtasks', (entries: unknown) => appendLine('METATROOPER_LONGTASK_LOG', { at: Date.now(), entries }));
  on('probe', (state: unknown) => appendLine('METATROOPER_WORKBENCH_PROBE', { at: Date.now(), state }));
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'Metatrooper',
    backgroundColor: '#111316',
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
  win.webContents.once('did-finish-load', push);
  win.on('closed', () => {
    panes?.closeAll();
    win = null;
  });
  panes = new PaneManager(win, {
    db,
    probe: (entry) => appendLine('METATROOPER_WORKBENCH_PROBE', { at: Date.now(), state: entry }),
    urlChanged: (paneId, url) => { void call('pane.url', { pane_id: paneId, url }, { ui: true }); },
    commentPicked: (info) => win?.webContents.send('comment-picked', info),
  });
  void win.loadFile(INDEX, process.env.METATROOPER_WORKBENCH_PROBE ? { query: { probe: '1' } } : {});
}

app.setPath('userData', path.join(homeDir(), 'workbench'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    lockDown();
    handlers();
    createWindow();
    watch();
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
    }).catch((e) => console.error(`browser pipe did not start: ${(e as Error).message}`));
  });
  app.on('window-all-closed', () => app.quit());
}
