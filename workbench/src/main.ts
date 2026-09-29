import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { dbFile, homeDir } from '../../core/src/paths.ts';
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
]);

let win: BrowserWindow | null = null;
let reader: DatabaseSync | null = null;
let view: { projectId: string | null; runId: string | null } = { projectId: null, runId: null };
let lastVersion = -1;
let lastOnline: boolean | null = null;
let pushTimer: NodeJS.Timeout | null = null;

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
  return { at: Date.now(), core: { online: false, pid: null, heartbeat_age_ms: null }, projects: [], engines: [], sessions: [], pipelines: [], runs: [], steps: [], gates: [], needs_you: [] };
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

function push(): void {
  if (!win || win.isDestroyed()) return;
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
  win.on('closed', () => { win = null; });
  void win.loadFile(INDEX, process.env.METATROOPER_WORKBENCH_PROBE ? { query: { probe: '1' } } : {});
}

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
  });
  app.on('window-all-closed', () => app.quit());
}
