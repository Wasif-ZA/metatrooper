import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';
import { DEFAULTS } from '../../core/src/settings.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const termSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const fn = (name: string, src = appSource) => src.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\r?\\n}\\r?\\n`, 'm'))![0];

/** Frames made by the stubbed BrowserWindow, with what was done to each. */
const made: any[] = [];

// Stub Electron so the real browser server, pane manager and frame code run without a browser process.
async function load() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron'
        ? {
            format: 'module',
            shortCircuit: true,
            source: `export const app = {}, clipboard = {}, Menu = {}, nativeImage = {}, session = {}, WebContentsView = {};
              export const screen = { screenToDipRect: (_w, r) => ({ x: r.x / 2, y: r.y / 2, width: r.width / 2, height: r.height / 2 }) };
              export class BrowserWindow {
                constructor(opts) { this.opts = opts; this.calls = []; this.bounds = { x: 0, y: 0, width: 0, height: 0 }; this.visible = false; this.destroyed = false; globalThis.__frames.push(this); }
                setIgnoreMouseEvents(v) { this.calls.push(['ignore', v]); } setContentProtection(v) { this.calls.push(['protect', v]); } setAlwaysOnTop(...a) { this.calls.push(['top', ...a]); }
                loadURL(u) { this.url = u; return Promise.resolve(); } getBounds() { return this.bounds; } setBounds(b) { this.bounds = b; this.calls.push(['bounds', b]); }
                isVisible() { return this.visible; } showInactive() { this.visible = true; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
              }`,
          }
        : nextLoad(url, context);
    },
  });
  (globalThis as any).__frames = made;
  try {
    const panes = await import('../src/browser/panes.ts');
    const server = await import('../src/browser/server.ts');
    const frames = await import('../src/desktop-frames.ts');
    return { ...panes, ...server, ...frames };
  } finally {
    hook.deregister();
  }
}

function db(): DatabaseSync {
  const d = new DatabaseSync(':memory:');
  d.exec(schema);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  d.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('claude', '{}', 1, 'local-cli')").run();
  for (const [id, pid] of [['session-a', process.pid], ['session-b', 1]] as const) {
    d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?, ?)").run(id, now, now, pid);
  }
  return d;
}

const pause = (d: DatabaseSync, at: string, resumed: Record<string, string> = {}) => {
  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_paused_at', ?)").run(at);
  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_resumed', ?)").run(JSON.stringify(resumed));
};

test('M6-15 cursor.glide on the workbench pipe answers only the bound session', async () => {
  const { PaneManager, startBrowserServer } = await load();
  const d = db();
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\mt-glide-${randomUUID()}` : `/tmp/mt-glide-${randomUUID()}.sock`;
  const server = await startBrowserServer(pipe, { db: () => d, uiKey: () => null, panes: new PaneManager({} as any, { db: () => d } as any), refreshPanes: () => {}, openPane: async () => 'unused' });
  const sock = net.connect(pipe);
  try {
    await new Promise((r) => sock.once('connect', r));
    let buf = '';
    const replies = new Map<string, any>();
    sock.setEncoding('utf8');
    sock.on('data', (c: string) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); } });
    const call = async (id: string, method: string, params: object) => {
      sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      for (let i = 0; i < 400 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 25));
      return replies.get(id);
    };
    assert.equal((await call('0', 'cursor.glide', { session: 'session-a', target_rect_px: [1, 2, 3, 4], caption: 'click Save' })).error.code, -32030, 'unbound');
    assert.equal((await call('1', 'browser.hello', { session_id: 'session-a', pid: process.pid })).result.bound, 'session');
    assert.deepEqual((await call('2', 'cursor.glide', { session: 'session-a', target_rect_px: [1, 2, 3, 4], caption: 'click Save' })).result, { arrived: true });
    assert.equal((await call('3', 'cursor.glide', { session: 'session-b', target_rect_px: [1, 2, 3, 4], caption: 'x' })).error.code, -32030, 'another session');
  } finally {
    sock.destroy();
    server.close();
    d.close();
  }
});

test('M6-15 D62: a paused session gets "paused by the user" at browser dispatch; a resumed one does not', async () => {
  const { PaneManager } = await load();
  const d = db();
  try {
    const manager = new PaneManager({} as any, { db: () => d } as any);
    const recheck = (session: string) => (manager as any).recheck({}, 'click', { _session: session });
    await recheck('session-a');
    pause(d, '2026-10-12T10:00:00.000Z');
    await assert.rejects(recheck('session-a'), /paused by the user/);
    await assert.rejects(recheck('session-b'), /paused by the user/);
    pause(d, '2026-10-12T10:00:00.000Z', { 'session-a': '2026-10-12T10:00:05.000Z' });
    await recheck('session-a');
    await assert.rejects(recheck('session-b'), /paused by the user/);
    pause(d, '2026-10-12T10:00:09.000Z', { 'session-a': '2026-10-12T10:00:05.000Z' });
    await assert.rejects(recheck('session-a'), /paused by the user/, 'a later pause holds it again');
    assert.throws(() => (manager as any).notPaused({ _session: 'session-b' }), /paused by the user/);
  } finally {
    d.close();
  }
});

test('M6-15 the snapshot carries live grants and the paused sessions', () => {
  const d = db();
  try {
    const now = new Date().toISOString();
    d.prepare("INSERT INTO grant (id, session_id, hwnd, pid, process_start, exe, title, created_at) VALUES ('gr_1', 'session-a', 100, 4100, 't', 'Notepad.exe', 'Untitled - Notepad', ?)").run(now);
    d.prepare("INSERT INTO grant (id, session_id, hwnd, pid, process_start, exe, title, created_at, ended_at) VALUES ('gr_0', 'session-a', 99, 4100, 't', 'Notepad.exe', 'old', ?, ?)").run(now, now);
    let s = snapshot(d, 'p1');
    assert.deepEqual(s.grants!.map((g) => ({ ...g })), [{ id: 'gr_1', session_id: 'session-a', hwnd: 100, title: 'Untitled - Notepad', exe: 'Notepad.exe' }]);
    assert.deepEqual(s.paused, []);
    pause(d, now, { 'session-b': new Date(Date.parse(now) + 1000).toISOString() });
    s = snapshot(d, 'p1');
    assert.deepEqual(s.paused, ['session-a']);
  } finally {
    d.close();
  }
});

test('M6-15 tile chips: paused, driving, or give window; none for shells and exited sessions', () => {
  const ui = { snap: { grants: [{ id: 'gr_1', session_id: 'a', title: 'Untitled - Notepad', hwnd: 100 }], paused: ['b'] } };
  const { deskChips } = new Function('ui', `${fn('deskChips')}; return { deskChips };`)(ui);
  assert.deepEqual(deskChips({ id: 'a', state: 'working' }), { paused: false, grants: [{ id: 'gr_1', title: 'Untitled - Notepad' }] });
  assert.deepEqual(deskChips({ id: 'b', state: 'working' }), { paused: true, grants: [] });
  assert.equal(deskChips({ id: 'sh_1', shell: true, state: 'working' }), null);
  assert.equal(deskChips({ id: 'a', state: 'exited' }), null);
  assert.equal(deskChips({ id: 'a', host: 'external', state: 'working' }), null);

  const body = termSource.match(/ {2}function deskHtml\(d\) \{[^]*?\n {2}\}\n/)![0];
  const deskHtml = new Function(`function escapeAttr(v) { return String(v).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'); }\n${body}; return deskHtml;`)();
  assert.equal(deskHtml(null), '');
  assert.match(deskHtml({ paused: false, grants: [] }), /data-action="grant-give"[^>]*>Give window</);
  const driving = deskHtml({ paused: true, grants: [{ id: 'gr_1', title: '<b>' + 'x'.repeat(60) }] });
  assert.match(driving, /data-action="takeover-resume"[^>]*>paused by you · Resume</);
  assert.match(driving, /data-action="grant-menu" data-grant="gr_1"[^>]*>driving: &#60;b&#62;x+…</);
  assert.doesNotMatch(driving, /grant-give/);
});

test('M6-15 give window grants the picked candidate with the pid and process start the list showed', async () => {
  const sent: any[] = [];
  const windows = [{ hwnd: 100, title: 'Untitled - Notepad', exe: 'Notepad.exe', pid: 4100, process_start: '2026-10-12T01:00:00.000Z' }, { hwnd: 200, title: 'Calculator', exe: 'CalculatorApp.exe', pid: 4200, process_start: '2026-10-12T01:00:01.000Z' }];
  const rpc = async (method: string, params: any) => { sent.push([method, params]); return { result: method === 'grant.candidates' ? { windows } : {} }; };
  let menu: any[] = [];
  const api = { paneMenu: async (items: any[]) => { menu = items; return '200'; } };
  const giveWindow = new Function('rpc', 'toast', 'api', `${fn('giveWindow')}; return giveWindow;`)(rpc, () => {}, api);
  await giveWindow('session-a', { left: 0, bottom: 0 });
  assert.deepEqual(menu.map((m) => m.id), ['100', '200']);
  assert.deepEqual(sent.at(-1), ['grant.window', { session_id: 'session-a', hwnd: 200, pid: 4200, process_start: '2026-10-12T01:00:01.000Z' }]);
});

test('M6-15 watch layout rows group granted windows under their session, and Ctrl+Alt+W toggles it', () => {
  const { watchRows } = new Function(`${fn('watchRows')}; return { watchRows };`)();
  const snap = { sessions: [{ id: 'a', engine_id: 'claude', state: 'working' }], grants: [{ id: 'g1', session_id: 'a', title: 'N' }, { id: 'g2', session_id: 'z', title: 'C' }, { id: 'g3', session_id: 'a', title: 'S' }] };
  const rows = watchRows(snap);
  assert.deepEqual(rows.map((r: any) => [r.session.id, r.grants.map((g: any) => g.id)]), [['a', ['g1', 'g3']], ['z', ['g2']]]);
  assert.deepEqual(watchRows({ sessions: [], grants: [] }), []);

  const ui: any = { snap: { sessions: [] }, watch: false };
  let rendered = 0;
  const wallKeys = new Function('ui', 'render', `${fn('watchKeys')}; return watchKeys;`)(ui, () => { rendered++; });
  const key = (o: object) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: '', preventDefault() {}, stopImmediatePropagation() {}, ...o });
  wallKeys(key({ ctrlKey: true, altKey: true, code: 'KeyW' }));
  assert.equal(ui.watch, true);
  wallKeys(key({ ctrlKey: true, altKey: true, code: 'KeyW' }));
  assert.equal(ui.watch, false);
  wallKeys(key({ altKey: true, code: 'KeyW' }));
  assert.equal(ui.watch, false, 'Alt+W alone does nothing');
  assert.equal(rendered, 2);
});

test('M6-15 a click-through frame per live grant, moved with the window, gone when the grant ends or the window is minimised', async () => {
  const { syncFrames, frameBounds, sessionColour } = await load();
  made.length = 0;
  const g = { id: 'gr_1', session_id: 'session-a', hwnd: 100, title: 'N', rect: [200, 100, 800, 600], minimized: false };
  syncFrames([g]);
  assert.equal(made.length, 1);
  const f = made[0];
  assert.equal(f.opts.focusable, false);
  assert.equal(f.opts.transparent, true);
  assert.equal(f.opts.frame, false);
  assert.equal(f.opts.skipTaskbar, true);
  assert.deepEqual(f.calls.find((c: any[]) => c[0] === 'ignore'), ['ignore', true]);
  assert.ok(f.visible);
  assert.match(decodeURIComponent(f.url), new RegExp(`border:3px solid ${sessionColour('session-a').replace(/[()]/g, '\\$&')}`));
  // physical pixels to DIPs (the stub halves them), grown by the 3 px border
  assert.deepEqual(f.bounds, process.platform === 'win32' ? { x: 97, y: 47, width: 406, height: 306 } : { x: 197, y: 97, width: 806, height: 606 });
  assert.deepEqual(frameBounds([10, 20, 30, 40], (r: any) => r), { x: 7, y: 17, width: 36, height: 46 });
  syncFrames([{ ...g, rect: [400, 100, 800, 600] }]);
  assert.equal(made.length, 1, 'moved, not remade');
  syncFrames([{ ...g, minimized: true }]);
  assert.equal(f.destroyed, true);
  assert.equal(syncFrames.count(), 0);
  syncFrames([g]);
  syncFrames([]);
  assert.equal(made[1].destroyed, true);
  assert.notEqual(sessionColour('session-a'), sessionColour('session-b'));
});

test('M6-15 the workbench may call the grant and resume methods, and the take-over key defaults to Ctrl+Alt+Q', () => {
  const raw = mainSource.match(/^export const UI_METHODS\s*=\s*new Set\(\[[^]*?\]\);/m)![0];
  const UI_METHODS: Set<string> = new Function(`${raw.replace(/^export\s+/, '')}; return UI_METHODS;`)();
  for (const m of ['grant.candidates', 'grant.window', 'grant.revoke', 'takeover.resume']) assert.ok(UI_METHODS.has(m), m);
  assert.equal(DEFAULTS.desktop.takeover_key, 'Control+Alt+Q');
  assert.match(mainSource, /globalShortcut\.register\(takeover,[^\n]*takeover\.pause/);
});

test('M6-15 the workbench tells every new core its pid, once per core pid', async () => {
  const body = fn('tellCoreOurPid', mainSource).replace(/: Promise<void>|: number \| null/g, '');
  const sent: number[] = [];
  let reply: any = { kind: 'reply', reply: { result: {} } };
  const make = new Function('call', 'process', `let toldPid = null; const takeoverKey = 'Control+Alt+Q'; const takeoverError = null;\n${body}; return tellCoreOurPid;`);
  const tell = make(async (method: string, p: any) => { assert.equal(method, 'desktop.ui-window'); assert.deepEqual(p, { pid: 4242, takeover_key: 'Control+Alt+Q', takeover_error: null }); sent.push(p.pid); return reply; }, { pid: 4242 });
  await tell(null);
  await tell(100);
  await tell(100);
  assert.deepEqual(sent, [4242], 'once for core 100');
  reply = { kind: 'offline' };
  await tell(200);
  reply = { kind: 'reply', reply: { result: {} } };
  await tell(200);
  await tell(200);
  assert.deepEqual(sent, [4242, 4242, 4242], 'a restarted core (new pid) is told again, retried until it answers');
});

for (const after of ['click', 'insertText'] as const) {
  test('M6-15 browser type stops ' + (after === 'click' ? 'insertText when paused after the click recheck' : 'submit Enter when paused after insertText'), async () => {
    const { PaneManager } = await load();
    const d = db();
    try {
      const manager: any = new PaneManager({} as any, { db: () => d, probe: () => {} } as any);
      const sent: Array<{ method: string; params: any }> = [];
      manager.answer = async (_pane: any, _session: string, action: () => Promise<unknown>) => action();
      manager.target = async () => ({ node: { backendNodeId: 1 }, x: 10, y: 20 });
      manager.pointAt = async () => {};
      manager.cmd = async (_pane: any, method: string, params: any) => {
        sent.push({ method, params });
        if ((after === 'click' && method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') || (after === 'insertText' && method === 'Input.insertText')) pause(d, new Date().toISOString());
        return {};
      };
      await assert.rejects(manager.run({ row: { id: 'pane-1' } }, 'type', { _session: 'session-a', ref: 'e1', text: 'hello', submit: true }), /paused by the user/);
      assert.equal(sent.filter((c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mouseReleased').length, 1);
      assert.deepEqual(sent.filter((c) => c.method === 'Input.insertText').map((c) => c.params.text), after === 'click' ? [] : ['hello']);
      assert.equal(sent.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.key === 'Enter').length, 0);
    } finally { d.close(); }
  });
}
