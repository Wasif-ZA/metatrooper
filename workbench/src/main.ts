import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { PARENT_SESSION_ENV } from '../../core/src/terminal/parent-env.ts';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { browserPipe, corePipe, dbFile, homeDir, logsDir, uiKeyFile } from '../../core/src/paths.ts';
import { captureProcessLog } from '../../core/src/log.ts';
import { ulid } from '../../core/src/time.ts';
import { PaneManager, ToolError, type PaneRow } from './browser/panes.ts';
import { startBrowserServer } from './browser/server.ts';
import { typedUrl } from '../../core/src/browser/policy.ts';
import { openReaderDb } from '../../core/src/store/db.ts';
import { call } from '../../core/src/pipe/client.ts';
import { dataVersion, readRunFile, snapshot, withLiveText, type LiveText, type Snapshot } from './queries.ts';
import { gitIn, handback } from './handback.ts';
import { gitAct, gitView, ownerGroups, runIn, type GitView } from './gitpane.ts';
import { owners, repoOf } from '../../core/src/sessions/owners.ts';
import { diffLineBody, filesBody } from './comments.ts';
import { attachTerm, detachTerm, termInput, termResize } from './terminals.ts';
import { activeTheme, settings, settingsFile } from '../../core/src/settings.ts';
import { refreshRowGit, rowGit } from './rowgit.ts';
import { paneData } from '../../core/src/pipelines/panes.ts';
import { runDetail, runShot } from './rundetail.ts';

captureProcessLog('workbench', false);

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, '..', 'renderer', 'index.html');
const DEBOUNCE_MS = 50;
const POLL_MS = 1000;

export const UI_METHODS = new Set([
  'project.open', 'session.launch', 'session.focus', 'session.seen', 'session.hide', 'project.clear', 'engines.check',
  'run.start', 'run.cancel', 'run.resume', 'gate.resolve', 'pipeline.validate', 'template.list', 'variant.pick', 'variant.discard', 'variant.combine', 'needs.dismiss',
  'session.paste-prompt', 'run.item-set', 'shell.list', 'shell.open', 'shell.close', 'session.clear-status', 'session.resume', 'needs_you.mark-read', 'needs_you.mark-unread', 'pane.open', 'pane.close', 'pane.assign', 'pane.capture', 'board.pin', 'board.remove',
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
  return { at: Date.now(), core: { online: false, pid: null, heartbeat_age_ms: null }, projects: [], engines: [], sessions: [], pipelines: [], runs: [], steps: [], gates: [], needs_you: [], panes: [], snapshots: [], board: [], limits: [], variants: [], selected: null, git: {} };
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

function read(): Snapshot {
  const d = db();
  if (!d) return emptySnapshot();
  try {
    lastGood = { ...withLiveText(snapshot(d, view.projectId, view.runId), liveText), git: rowGit() };
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

/** One Windows toast per new needs-you row; clicking it shows the window and selects the session it is about. */
function toastNew(s: Snapshot): void {
  const ids = new Set(s.needs_you.map((n) => n.id));
  if (!toasted) { toasted = ids; return; }
  for (const n of s.needs_you) {
    if (toasted.has(n.id) || n.read_at) continue;
    toasted.add(n.id);
    if (!Notification.isSupported()) continue;
    const note = new Notification({ title: n.kind === 'done' ? 'Agent finished' : n.kind === 'failed' ? 'Agent failed' : 'MetaTrooper needs you', body: n.text, silent: false });
    note.on('click', () => {
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      const target = n.kind === 'done' || n.kind === 'failed' ? n.ref : null;
      if (target) void call('session.focus', { session_id: target }, { ui: true }).then(schedulePush);
    });
    note.show();
  }
  for (const id of [...toasted]) if (!ids.has(id)) toasted.delete(id);
}

function push(): void {
  if (!win || win.isDestroyed()) return;
  syncPanes();
  const s = read();
  lastOnline = s.core.online;
  toastNew(s);
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
    void pollLiveText();
  }, POLL_MS);
}

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file:') && fileURLToPath(url.split(/[?#]/)[0]) === INDEX;
}

async function saveComment(id: string, sessionId: string, kind: 'element' | 'diff-line' | 'file', body: string, crop: string | null): Promise<{ ok: boolean; error?: string; comment_id?: string }> {
  const rw = new DatabaseSync(dbFile());
  try {
    rw.exec('PRAGMA busy_timeout = 2000');
    rw.prepare('INSERT INTO comment (id, at, session_id, kind, body, crop_path) VALUES (?, ?, ?, ?, ?, ?)').run(id, new Date().toISOString(), sessionId, kind, body, crop);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    rw.close();
  }
  await call('comment.deliver', { comment_id: id }, { ui: true });
  return { ok: true, comment_id: id };
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

  on('readRunFile', (runId: unknown, name: unknown) => {
    const d = db();
    return d ? readRunFile(d, runId, name) : null;
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
    const builtin = path.resolve(here, '..', '..', 'pipelines', `${json.id}.json`);
    const shipped = fs.existsSync(builtin) ? { path: builtin } : (d.prepare("SELECT path FROM pipeline WHERE id = ? AND source <> 'project'").get(json.id) as { path: string } | undefined);
    if (shipped) {
      try {
        if (JSON.stringify(JSON.parse(fs.readFileSync(shipped.path, 'utf8'))) === JSON.stringify(json)) {
          fs.rmSync(path.join(project.path, '.troop', 'pipelines', `${json.id}.json`), { force: true });
          return { ok: true, unchanged: true, path: shipped.path.split(String.fromCharCode(92)).join('/') };
        }
      } catch {}
    }
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
    if (typeof file !== 'string' || !['snapshots', 'boards'].some((d) => inside(path.join(homeDir(), d), file))) return null;
    try {
      return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      return null;
    }
  });

  on('review', (runId: unknown) => {
    const d = db();
    const row = d && typeof runId === 'string' ? (d.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as { run_dir: string } | undefined) : undefined;
    if (!row) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(row.run_dir, 'review-buckets.json'), 'utf8'));
    } catch {
      return null;
    }
  });

  on('handback', (projectId: unknown, runId: unknown) => {
    const d = db();
    const project = d && typeof projectId === 'string' ? (d.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined) : undefined;
    if (!project) return { error: 'pick a project first' };
    const picked = d && typeof runId === 'string'
      ? (d.prepare("SELECT v.idx, v.worktree, v.branch FROM variant v JOIN run r ON r.id = v.run_id WHERE v.run_id = ? AND r.project_id = ? AND v.status = 'picked' ORDER BY v.idx LIMIT 1").get(runId, projectId) as { idx: number; worktree: string; branch: string } | undefined)
      : undefined;
    try {
      if (picked) {
        const base = gitIn(project.path)(['merge-base', 'HEAD', picked.branch]).trim();
        return { ...handback(gitIn(picked.worktree), { base, cwd: picked.worktree }), variant: picked.idx, branch: picked.branch };
      }
      return handback(gitIn(project.path));
    } catch (e) {
      return { error: (e as Error).message.split(String.fromCharCode(10))[0] };
    }
  });

  on('handbackFile', (projectId: unknown, runId: unknown, file: unknown) => {
    const d = db();
    if (!d || typeof projectId !== 'string' || typeof file !== 'string') return null;
    const project = d.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) return null;
    const picked = typeof runId === 'string'
      ? (d.prepare("SELECT v.worktree, v.branch FROM variant v JOIN run r ON r.id = v.run_id WHERE v.run_id = ? AND r.project_id = ? AND v.status = 'picked' ORDER BY v.idx LIMIT 1").get(runId, projectId) as { worktree: string; branch: string } | undefined)
      : undefined;
    try {
      if (picked) {
        const base = gitIn(project.path)(['merge-base', 'HEAD', picked.branch]).trim();
        return gitIn(picked.worktree)(['diff', base, '--', file]);
      }
      return gitIn(project.path)(['diff', '--cached', '--', file]);
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
      const repo = repoOf(project.path);
      let groups: GitView['groups'];
      try { if (repo && d) groups = ownerGroups(view.changes, owners(d, repo)); } catch {}
      return { ...view, groups, error };
    } catch (e) {
      return { error: why(e) };
    }
  });

  on('stepPane', (runId: unknown, stepId: unknown) => {
    const d = db();
    if (!d || typeof runId !== 'string' || typeof stepId !== 'string') return { error: 'no step' };
    return paneData(d, runId, stepId);
  });

  on('runShot', (runId: unknown, name: unknown) => {
    const d = db();
    return d ? runShot(d, runId, name) : null;
  });

  on('runDetail', (runId: unknown) => {
    const d = db();
    if (!d || typeof runId !== 'string') return { error: 'no run' };
    return runDetail(d, runId);
  });

  const cwdOf = (sessionId: unknown) => {
    const d = db();
    const row = d && typeof sessionId === 'string' ? (d.prepare('SELECT cwd FROM session WHERE id = ?').get(sessionId) as { cwd: string | null } | undefined) : undefined;
    return row?.cwd ?? null;
  };
  /** The commit the Diff tab compares against: the turn's start, HEAD, or where the branch left the default branch. */
  const diffBase = (sessionId: unknown, scope: unknown, cwd: string): string => {
    const g = gitIn(cwd);
    if (scope === 'turn') {
      const d = db();
      const row = d && typeof sessionId === 'string' ? (d.prepare('SELECT turn_base FROM session WHERE id = ?').get(sessionId) as { turn_base: string | null } | undefined) : undefined;
      if (row?.turn_base) return row.turn_base;
    }
    if (scope === 'branch') {
      for (const ref of ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master']) {
        try { return g(['merge-base', 'HEAD', ref]).trim(); } catch {}
      }
    }
    return 'HEAD';
  };
  on('sessionDiff', (sessionId: unknown, scope: unknown) => {
    const cwd = cwdOf(sessionId);
    if (!cwd) return { error: 'this session has no folder recorded' };
    try {
      const files = gitIn(cwd)(['diff', diffBase(sessionId, scope, cwd), '--numstat']).split(String.fromCharCode(10)).filter(Boolean).map((l) => {
        const [a, r, ...name] = l.split(String.fromCharCode(9));
        return { path: name.join(String.fromCharCode(9)), added: a === '-' ? null : Number(a), deleted: r === '-' ? null : Number(r) };
      });
      const untracked = gitIn(cwd)(['ls-files', '--others', '--exclude-standard']).split(String.fromCharCode(10)).filter(Boolean);
      return { files, untracked };
    } catch (e) {
      return { error: (e as Error).message.split(String.fromCharCode(10))[0] };
    }
  });
  on('sessionDiffFile', (sessionId: unknown, file: unknown, scope: unknown) => {
    const cwd = cwdOf(sessionId);
    if (!cwd || typeof file !== 'string') return null;
    try { return gitIn(cwd)(['diff', diffBase(sessionId, scope, cwd), '--', file]); } catch { return null; }
  });

  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  on('termAttach', (sessionId: unknown, cols: unknown, rows: unknown) => {
    if (typeof sessionId !== 'string') return false;
    attachTerm(sessionId, num(cols, settings().terminal.cols), num(rows, settings().terminal.rows), (sid, msg) => { if (win && !win.isDestroyed()) win.webContents.send('term', sid, msg); });
    return true;
  });
  on('uiSettings', () => ({ terminal: settings().terminal, ui: { ...settings().ui, themes: undefined }, theme: activeTheme(), themes: Object.entries(settings().ui.themes).map(([id, t]) => ({ id, label: t.label || id })) }));
  on('setTheme', (name: unknown) => {
    if (typeof name !== 'string' || !settings().ui.themes[name]) return false;
    let raw: Record<string, any> = {};
    try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
    raw.ui = { ...(raw.ui && typeof raw.ui === 'object' ? raw.ui : {}), theme: name };
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(raw, null, 2));
    return activeTheme();
  });
  on('termInput', (sessionId: unknown, data: unknown) => { if (typeof sessionId === 'string' && typeof data === 'string') termInput(sessionId, data); });
  on('termResize', (sessionId: unknown, cols: unknown, rows: unknown) => { if (typeof sessionId === 'string') termResize(sessionId, num(cols, settings().terminal.cols), num(rows, settings().terminal.rows)); });
  on('termDetach', (sessionId: unknown) => { if (typeof sessionId === 'string') detachTerm(sessionId); });

  on('readText', () => clipboard.readText());
  on('restartCore', async () => { await restartCore(); ownCore = true; return true; });
  on('stopCore', async () => { await stopCore(); return true; });
  on('openLogs', async () => { fs.mkdirSync(logsDir(), { recursive: true }); return (await shell.openPath(logsDir())) === ''; });
  on('copyText', (text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
    return true;
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
  win.webContents.once('did-finish-load', push);
  win.on('close', (e) => {
    if (closing || !ownCore) return;
    e.preventDefault();
    void onClose();
  });
  win.on('closed', () => {
    panes?.closeAll();
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
  void win.loadFile(INDEX, process.env.METATROOPER_WORKBENCH_PROBE ? { query: { probe: '1' } } : {});
}

const CORE_MAIN = path.join(here, '..', '..', 'core', 'src', 'main.ts');
const APP_DIR = path.resolve(here, '..');

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
  spawn('node', [CORE_MAIN], { cwd: path.dirname(path.dirname(CORE_MAIN)), detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
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

async function stopCore(): Promise<void> {
  await call('core.stop', {}, { ui: true });
  for (let i = 0; i < 40 && (await coreUp()); i++) await new Promise((r) => setTimeout(r, 250));
}

async function restartCore(): Promise<void> {
  await stopCore();
  await ensureCore();
}

/** Any open agent session or unfinished run counts, so an agent waiting on the user is never stopped unasked. */
function busy(): boolean {
  const s = lastGood;
  return !!s && (s.sessions.some((x) => x.state !== 'exited') || s.runs.some((r) => r.status === 'running' || r.status === 'paused'));
}

/** Closing asks only when the window started the core and work is open; an idle own core is stopped, a core started elsewhere is left alone. */
async function onClose(): Promise<void> {
  if (ownCore && busy()) {
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Keep running in the background', 'Stop everything', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Agents or runs are still open.',
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
  });
  app.whenReady().then(() => {
    lockDown();
    handlers();
    createWindow();
    void ensureCore().then(() => openFolder(folderArg(process.argv, process.cwd())));
    watch();
    const gitTick = async () => {
      try {
        const live = (lastGood?.sessions ?? []).filter((x) => x.state !== 'exited').map((x) => ({ id: x.id, cwd: x.cwd }));
        if (await refreshRowGit(live)) push();
      } catch {}
      setTimeout(gitTick, settings().terminal.git_every_ms);
    };
    void gitTick();
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
