import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { glideMs } from '../src/cursor-glide.ts';
import { sessionColour } from '../src/colour.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const termSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MARKER = 'Zq7xMarker24charsUnique9';
// D49: the hue hash is stable across restarts, so these literals must not move
const COLOUR_A = 'hsl(314, 85%, 60%)';
const COLOUR_B = 'hsl(315, 85%, 60%)';

/** A fake overlay webContents: records sends; answers `cursor.arrived` after `ms` (as the real overlay does when its last sample is drawn), never, or not at all once destroyed. */
function contents() {
  const listeners = new Set<(...a: any[]) => void>();
  const wc = {
    sent: [] as Array<[string, any]>,
    answer: 'yes' as 'yes' | 'never',
    destroyed: false,
    isDestroyed() { return wc.destroyed; },
    send(ch: string, m: any) {
      if (wc.destroyed || (globalThis as any).__m618.sendThrows) throw new Error('Object has been destroyed');
      wc.sent.push([ch, structuredClone(m)]);
      if (ch === 'cursor.glide' && wc.answer === 'yes') setTimeout(() => { for (const f of [...listeners]) f({}, { id: m.id, at: Date.now(), x: m.to.x, y: m.to.y }); }, m.ms);
    },
    ipc: { on: (ch: string, f: any) => { if (ch === 'cursor.arrived') listeners.add(f); }, removeListener: (_ch: string, f: any) => listeners.delete(f) },
    glides: () => wc.sent.filter(([c]) => c === 'cursor.glide').map(([, m]) => m),
    hides: () => wc.sent.filter(([c]) => c === 'cursor.hide').map(([, m]) => m),
  };
  return wc;
}

const fake: any = { wins: [] as any[], displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }], contents };
(globalThis as any).__m618 = fake;

// Stub Electron so the real pane manager, browser server and desktop overlay host run without a browser process.
async function load() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron-m6-18', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron-m6-18'
        ? {
            format: 'module',
            shortCircuit: true,
            source: `const S = () => globalThis.__m618;
              export const app = {}, clipboard = {}, Menu = {}, nativeImage = {}, session = {}, WebContentsView = {};
              export const screen = { screenToDipRect: (_w, r) => r, getDisplayMatching: (r) => S().displays.find((d) => r.x + r.width / 2 >= d.bounds.x && r.x + r.width / 2 < d.bounds.x + d.bounds.width) ?? S().displays[0], getAllDisplays: () => S().displays, on() {} };
              export class BrowserWindow {
                constructor(opts) { if (S().ctorThrows) throw new Error('could not make a window'); this.opts = opts; this.calls = []; this.bounds = { x: 0, y: 0, width: 0, height: 0 }; this.visible = false; this.top = false; this.destroyed = false; this.webContents = S().contents(); S().wins.push(this); }
                setIgnoreMouseEvents(v) { this.calls.push(['ignore', v]); } setContentProtection(v) { this.calls.push(['protect', v]); }
                setAlwaysOnTop(v, level) { this.top = v; this.calls.push(['top', v, level]); } isAlwaysOnTop() { return this.top; } moveTop() { this.calls.push(['moveTop']); }
                loadFile(f) { this.file = f; return S().loadNever ? new Promise(() => {}) : S().destroyOnLoad ? Promise.resolve().then(() => { this.destroyed = true; }) : Promise.resolve(); } loadURL(u) { this.url = u; return Promise.resolve(); }
                getBounds() { return this.bounds; } setBounds(b) { this.bounds = b; }
                isVisible() { return this.visible; } showInactive() { this.visible = true; this.calls.push(['showInactive']); } show() { this.visible = true; this.calls.push(['show']); } focus() { this.calls.push(['focus']); }
                hide() { this.visible = false; this.calls.push(['hide']); } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
              }`,
          }
        : nextLoad(url, context);
    },
  });
  try {
    const panes = await import('../src/browser/panes.ts');
    const server = await import('../src/browser/server.ts');
    const overlay = await import('../src/desktop-overlay.ts');
    return { ...panes, ...server, ...overlay };
  } finally {
    hook.deregister();
  }
}
const mods = await load();

/** A real PaneManager with CDP, targeting and the page stubbed; pointAt, clickAt, recheck and the cursor wait run for real. */
function browser(look: (session: string) => Record<string, unknown> = () => ({})) {
  const probes: any[] = [];
  const inputs: Array<{ method: string; params: any; at: number }> = [];
  const children: any[] = [];
  const removed: any[] = [];
  const win = { isDestroyed: () => false, contentView: { children, addChildView: (v: any) => children.push(v), removeChildView: (v: any) => { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); removed.push(v); } } };
  const manager: any = new mods.PaneManager(win as any, { db: () => null, probe: (r: any) => probes.push(structuredClone(r)), cursor: look } as any);
  const wc = contents();
  const pane: any = { row: { id: 'pane-1', session_id: 'session-a' }, overlay: { webContents: wc }, view: { webContents: { getZoomFactor: () => 1, getURL: () => 'http://fixture.test/' } }, shownSize: { width: 1920, height: 1080 }, handoff: null, navs: 0, errorFor: null, cursors: new Map() };
  manager.panes.set('pane-1', pane);
  manager.answer = async (_p: any, _s: string, work: () => Promise<unknown>) => work();
  // a ref is "x,y": the element's centre, 80 x 30 CSS pixels
  manager.target = async (_p: any, ref: string) => { const [x, y] = ref.split(',').map(Number); return { node: { backendNodeId: 1 }, x, y, size: { width: 80, height: 30 } }; };
  manager.focusOn = async () => {};
  manager.cmd = async (_p: any, method: string, params: any) => { inputs.push({ method, params, at: Date.now() }); return {}; };
  const click = (ref: string, session = 'session-a') => manager.run(pane, 'click', { _session: session, ref });
  const firstMouse = (from: number) => inputs.slice(from).find((i) => i.method === 'Input.dispatchMouseEvent')!;
  return { manager, pane, wc, probes, inputs, children, removed, click, firstMouse };
}

const deskLook = (session: string, o: Record<string, unknown> = {}) => ({ mode: 'snappy' as const, reducedMotion: false, colour: sessionColour(session), label: 'claude · fix', showCaption: true, idleFadeMs: 5000, protect: true, ...o });

test('M6-18i browser: a 24-character typed marker is in no overlay message, probe row or reply', async () => {
  // protects=M6-18i typed text never leaves the input path on the browser host
  // fails_when=pointAt or the type case puts the text into the caption, the chip or the probe row
  // no_claim=what the overlay renderer draws from a caption; the CDP insertText itself carries the text by design
  const b = browser();
  await b.click('100,100');
  const reply = await b.manager.run(b.pane, 'type', { _session: 'session-a', ref: '400,100', text: MARKER });
  assert.deepEqual(reply, { ok: true });
  assert.equal(b.inputs.filter((i) => i.method === 'Input.insertText').map((i) => i.params.text).join(''), MARKER, 'the text was typed');
  const glide = b.wc.glides().at(-1);
  assert.equal(glide.caption, 'type 24 characters');
  for (const [what, v] of [['overlay messages', b.wc.sent], ['probe rows', b.probes], ['reply', reply]] as const) {
    assert.ok(!JSON.stringify(v).includes(MARKER), `${what} hold the typed text`);
    assert.ok(!JSON.stringify(v).includes(MARKER.slice(0, 8)), `${what} hold part of the typed text`);
  }
});

test('M6-18j cursor.glide fails -32030 unbound or for another session, and nothing is drawn', async () => {
  // protects=M6-18j one session cannot move another session's cursor or draw one unbound
  // fails_when=server.ts drops or loosens the bound-session check before calling the desktop host
  // no_claim=the browser.hello binding rules themselves (M6-15)
  const d = new DatabaseSync(':memory:');
  d.exec(schema);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  d.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('claude', '{}', 1, 'local-cli')").run();
  for (const [id, pid] of [['session-a', process.pid], ['session-b', 1]] as const) d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?, ?)").run(id, now, now, pid);
  const drawn: any[] = [];
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\mt-m618-${randomUUID()}` : `/tmp/mt-m618-${randomUUID()}.sock`;
  const server = await mods.startBrowserServer(pipe, { db: () => d, uiKey: () => null, panes: {} as any, refreshPanes: () => {}, openPane: async () => 'unused', glide: async (s: string, r: unknown, c: string) => { drawn.push([s, r, c]); return { arrived: true, ms: 0, shown: true, late: false }; } });
  const sock = net.connect(pipe);
  try {
    await new Promise((r) => sock.once('connect', r));
    let buf = '';
    const replies = new Map<string, any>();
    sock.setEncoding('utf8');
    sock.on('data', (c: string) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); } });
    const call = async (id: string, method: string, params: object) => {
      sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      for (let i = 0; i < 400 && !replies.has(id); i++) await sleep(10);
      return replies.get(id);
    };
    assert.equal((await call('0', 'cursor.glide', { session: 'session-a', target_rect_px: [1, 2, 30, 40], caption: 'click Save' })).error.code, -32030, 'unbound');
    assert.equal(drawn.length, 0, 'unbound draws nothing');
    assert.equal((await call('1', 'browser.hello', { session_id: 'session-a', pid: process.pid })).result.bound, 'session');
    assert.equal((await call('2', 'cursor.glide', { session: 'session-b', target_rect_px: [1, 2, 30, 40], caption: 'click Save' })).error.code, -32030, 'another session');
    assert.equal((await call('3', 'cursor.glide', { target_rect_px: [1, 2, 30, 40], caption: 'click Save' })).error.code, -32030, 'no session named');
    assert.equal(drawn.length, 0, 'another session draws nothing');
    assert.deepEqual((await call('4', 'cursor.glide', { session: 'session-a', target_rect_px: [1, 2, 30, 40], caption: 'click Save' })).result, { arrived: true, ms: 0, shown: true, late: false });
    assert.deepEqual(drawn, [['session-a', [1, 2, 30, 40], 'click Save']]);
  } finally {
    sock.destroy();
    server.close();
    d.close();
  }
});

test('M6-18h browser: an overlay that never answers delays input by ms + 16 and the row says late', async () => {
  // protects=M6-18h D57 a silent overlay costs exactly ms + 16 and never blocks input
  // fails_when=the arrived wait goes, the ms + 16 timeout goes, or late is not marked
  // no_claim=real Electron ipc delivery; tolerance is -10 ms / +40 ms (Windows timer jitter), the spec says +/-10
  const b = browser();
  await b.click('100,100');
  b.wc.answer = 'never';
  const t0 = b.inputs.length;
  assert.deepEqual(await b.click('400,100'), { ok: true });
  const row = b.probes.filter((p) => p.kind === 'cursor').at(-1);
  assert.equal(row.ms, glideMs(300, 80));
  assert.ok(row.ms > 0);
  assert.equal(row.late, true);
  assert.equal(row.arrived_at, null);
  assert.equal(row.at, null);
  const added = b.firstMouse(t0).at - row.requested_at;
  assert.ok(added >= row.ms + 16 - 10 && added <= row.ms + 16 + 40, `added ${added} ms for ms ${row.ms}`);
  assert.ok(b.probes.findIndex((p) => p === row) < b.probes.findIndex((p, i) => p.kind === 'click' && i > b.probes.indexOf(row)), 'cursor row before the click row');
});

test('M6-18h browser: a destroyed overlay view waits the same, sends nothing, and the action succeeds', async () => {
  // protects=M6-18h D57 a destroyed overlay never blocks or breaks input
  // fails_when=pointAt sends to a destroyed overlay (throws), skips the wait, or blocks
  // no_claim=a crashed but not destroyed renderer (that is the never-answers case)
  const b = browser();
  await b.click('100,100');
  b.wc.destroyed = true;
  const sent = b.wc.sent.length;
  const t0 = b.inputs.length;
  assert.deepEqual(await b.click('400,100'), { ok: true });
  const row = b.probes.filter((p) => p.kind === 'cursor').at(-1);
  assert.equal(b.wc.sent.length, sent, 'nothing sent to a destroyed overlay');
  assert.equal(row.late, true);
  const added = b.firstMouse(t0).at - row.requested_at;
  assert.ok(added >= row.ms + 16 - 10 && added <= row.ms + 16 + 40, `added ${added} ms for ms ${row.ms}`);
});

test('M6-18h browser: an overlay that answers lets input go on arrived, not before', async () => {
  // protects=M6-18a/e the input lands after the cursor arrives, and the row carries arrived_at
  // fails_when=the arrived wait goes (input before arrived), or arrived_at / at are not recorded
  // no_claim=the 250 ms p95 over 100 real actions (hand-back run)
  const b = browser();
  await b.click('100,100');
  const t0 = b.inputs.length;
  await b.click('400,100');
  const row = b.probes.filter((p) => p.kind === 'cursor').at(-1);
  assert.equal(row.late, false);
  assert.equal(typeof row.arrived_at, 'number');
  assert.deepEqual(row.at, { x: 400, y: 100 });
  assert.ok(row.arrived_at >= row.requested_at);
  const input = b.firstMouse(t0).at;
  assert.ok(input >= row.arrived_at, 'input after arrived');
  assert.ok(input - row.requested_at >= row.ms - 5 && input - row.requested_at < row.ms + 16 + 40, `added ${input - row.requested_at}`);
});

test('M6-18h desktop: an overlay window that never answers replies late at ms + 16', async () => {
  // protects=M6-18h D57 on the desktop host: the pipe reply comes at ms + 16 marked late
  // fails_when=desktopGlide drops the arrived wait or the timeout
  // no_claim=the core's desktop.act timing (hand-back Notepad run)
  fake.wins.length = 0;
  try {
    await mods.desktopGlide('h-desk', [100, 100, 80, 30], 'click Save', deskLook('h-desk'));
    fake.wins[0].webContents.answer = 'never';
    const t0 = Date.now();
    const r = await mods.desktopGlide('h-desk', [400, 100, 80, 30], 'click Open', deskLook('h-desk'));
    const took = Date.now() - t0;
    assert.equal(r.ms, glideMs(300, 80));
    assert.deepEqual(r, { arrived: true, ms: r.ms, shown: true, late: true });
    assert.ok(took >= r.ms + 16 - 10 && took <= r.ms + 16 + 40, `took ${took} for ms ${r.ms}`);
    fake.wins[0].webContents.answer = 'yes';
    const t1 = Date.now();
    const ok = await mods.desktopGlide('h-desk', [100, 100, 80, 30], 'click Save', deskLook('h-desk'));
    assert.equal(ok.late, false);
    assert.ok(Date.now() - t1 >= ok.ms - 5, 'waits for arrived');
  } finally {
    mods.closeDesktopOverlay();
  }
});

test('M6-18k desktop overlay window: not focusable, click-through, protected, shown inactive; hidden and off top 1,500 ms after the last action', async () => {
  // protects=M6-18k the overlay never takes focus or clicks and does not stay above other windows
  // fails_when=a window flag goes, show() replaces showInactive(), the window is left always on top, or the 1,500 ms timer is not reset by a later action
  // no_claim=the real focused window before and after a click (needs a desktop)
  fake.wins.length = 0;
  try {
    const t0 = Date.now();
    const r = await mods.desktopGlide('k-desk', [100, 100, 80, 30], 'click Save', deskLook('k-desk'));
    assert.equal(r.shown, true);
    assert.equal(fake.wins.length, 1);
    const w = fake.wins[0];
    assert.equal(w.opts.focusable, false);
    assert.equal(w.opts.transparent, true);
    assert.equal(w.opts.frame, false);
    assert.equal(w.opts.skipTaskbar, true);
    assert.equal(w.opts.hasShadow, false);
    assert.equal(w.opts.show, false);
    assert.equal(w.opts.webPreferences.sandbox, true);
    assert.match(String(w.file), /overlay\.html$/);
    assert.deepEqual(w.calls.find((c: any[]) => c[0] === 'ignore'), ['ignore', true]);
    assert.deepEqual(w.calls.filter((c: any[]) => c[0] === 'protect').at(-1), ['protect', true]);
    assert.deepEqual(w.bounds, fake.displays[0].bounds);
    assert.equal(w.isVisible(), true);
    assert.equal(w.isAlwaysOnTop(), true);
    assert.ok(w.calls.some((c: any[]) => c[0] === 'top' && c[1] === true && c[2] === 'floating'));
    assert.ok(w.calls.some((c: any[]) => c[0] === 'showInactive'));
    await sleep(500);
    assert.ok(w.calls.filter((c: any[]) => c[0] === 'moveTop').length >= 4, 'z-order re-asserted about every 100 ms');
    await sleep(1000 - (Date.now() - t0));
    await mods.desktopGlide('k-desk', [400, 100, 80, 30], 'click Open', deskLook('k-desk'));
    const second = Date.now();
    await sleep(1700 - (Date.now() - t0));
    assert.equal(w.isVisible(), true, 'a later action restarts the 1,500 ms');
    assert.equal(w.isAlwaysOnTop(), true);
    await sleep(second + 1500 + 150 - Date.now());
    assert.equal(w.isVisible(), false, 'hidden 1,500 ms after the last action');
    assert.equal(w.isAlwaysOnTop(), false, 'not always on top once hidden');
    assert.ok(!w.calls.some((c: any[]) => c[0] === 'show' || c[0] === 'focus'), 'never shown with focus');
    const moves = w.calls.filter((c: any[]) => c[0] === 'moveTop').length;
    await sleep(250);
    assert.equal(w.calls.filter((c: any[]) => c[0] === 'moveTop').length, moves, 'no z-order raise while hidden');
    await mods.desktopGlide('k-desk2', [100, 100, 80, 30], 'click Save', deskLook('k-desk2', { protect: false }));
    assert.deepEqual(w.calls.filter((c: any[]) => c[0] === 'protect').at(-1), ['protect', false], 'show_in_recordings lifts content protection');
  } finally {
    mods.closeDesktopOverlay();
  }
});

test('M6-18l desktop: a minimised or empty target replies shown false, draws nothing and hides the cursor', async () => {
  // protects=M6-18l no cursor floats over a minimised or closed window
  // fails_when=desktopGlide glides to a null or zero-size rect, or leaves the old cursor showing
  // no_claim=that the core detects minimised windows (core test) or a real covered window
  fake.wins.length = 0;
  try {
    await mods.desktopGlide('l-desk', [100, 100, 80, 30], 'click Save', deskLook('l-desk'));
    const wc = fake.wins[0].webContents;
    const glides = wc.glides().length;
    for (const rect of [null, [100, 100, 0, 30]]) {
      assert.deepEqual(await mods.desktopGlide('l-desk', rect, 'click Save', deskLook('l-desk')), { arrived: true, ms: 0, shown: false, late: false });
    }
    assert.equal(wc.glides().length, glides, 'no glide sent');
    assert.deepEqual(wc.hides(), [{ session: 'l-desk' }]);
  } finally {
    mods.closeDesktopOverlay();
  }
});

test('M6-18n browser: an idle cursor gets cursor.hide after idle_fade_ms, and the view detaches 300 ms after the last one', async () => {
  // protects=M6-18n idle cursors fade and the overlay view does not linger over the page
  // fails_when=no cursor.hide is sent, the view detaches while another cursor shows, or never detaches
  // no_claim=the 300 ms CSS fade in the renderer
  const b = browser(() => ({ idleFadeMs: 80 }));
  const t0 = Date.now();
  await b.click('100,100', 'session-a');
  assert.ok(b.children.includes(b.pane.overlay), 'attached on a glide');
  await sleep(150 - (Date.now() - t0));
  await b.click('200,200', 'session-b');
  assert.deepEqual(b.wc.hides(), [{ session: 'session-a' }], 'a hides after its idle time');
  assert.ok(b.children.includes(b.pane.overlay), 'still attached while session-b shows');
  await sleep(800 - (Date.now() - t0));
  assert.deepEqual(b.wc.hides(), [{ session: 'session-a' }, { session: 'session-b' }]);
  assert.ok(!b.children.includes(b.pane.overlay), 'detached after the last cursor faded');
});

test('M6-18n browser: the view stays attached through the last cursor fade (300 ms)', async () => {
  // protects=M6-18n "detached once its last cursor is gone", not part way through its fade
  // fails_when=an older cursor's removal timer detaches the view during a newer cursor's fade
  // no_claim=the renderer's fade itself
  const b = browser(() => ({ idleFadeMs: 80 }));
  const t0 = Date.now();
  await b.click('100,100', 'session-a');
  await sleep(150 - (Date.now() - t0));
  await b.click('200,200', 'session-b');
  const bAt = Date.now();
  await sleep(bAt + 80 + 250 - Date.now());
  assert.deepEqual(b.wc.hides().map((h) => h.session), ['session-a', 'session-b']);
  assert.ok(b.children.includes(b.pane.overlay), 'session-b is still fading (its 300 ms ends 50 ms from now)');
});

test('M6-18n desktop: an idle cursor gets cursor.hide after idle_fade_ms', async () => {
  // protects=M6-18n the contract's "main sends cursor.hide after idle_fade_ms" on the desktop host
  // fails_when=the desktop host has no idle timer per cursor
  // no_claim=the window-level hide at 1,500 ms (M6-18k)
  fake.wins.length = 0;
  try {
    await mods.desktopGlide('n-desk', [100, 100, 80, 30], 'click Save', deskLook('n-desk', { idleFadeMs: 200 }));
    await sleep(350);
    assert.deepEqual(fake.wins[0].webContents.hides(), [{ session: 'n-desk' }]);
  } finally {
    mods.closeDesktopOverlay();
  }
});

test('M6-18o two sessions: own colours on both cursors, the tile dot and the watch dot', async () => {
  // protects=M6-18o D48/D49 one colour per session everywhere, stable across restarts
  // fails_when=a host uses another key (pane id, a fixed colour) for the colour, the hash changes, or the tile/watch dot drops it
  // no_claim=that two arbitrary sessions always differ (D49: usually)
  assert.equal(sessionColour('session-a'), COLOUR_A);
  assert.equal(sessionColour('session-b'), COLOUR_B);
  const b = browser();
  await b.click('100,100', 'session-a');
  await b.click('400,400', 'session-b');
  assert.deepEqual(b.wc.glides().map((m) => [m.session, m.colour]), [['session-a', COLOUR_A], ['session-b', COLOUR_B]]);

  fake.wins.length = 0;
  try {
    await mods.desktopGlide('session-a', [100, 100, 80, 30], 'click Save', deskLook('session-a'));
    await mods.desktopGlide('session-b', [900, 500, 80, 30], 'click Open', deskLook('session-b'));
    assert.deepEqual(fake.wins[0].webContents.glides().map((m: any) => [m.session, m.colour]), [['session-a', COLOUR_A], ['session-b', COLOUR_B]]);
    const grants = [{ id: 'gr_a', session_id: 'session-a', hwnd: 1, title: 'A', rect: [0, 0, 800, 600], minimized: false }, { id: 'gr_b', session_id: 'session-b', hwnd: 2, title: 'B', rect: [800, 400, 400, 300], minimized: false }];
    mods.refitCursors(grants);
    const dots = mods.cursorDots();
    assert.equal(dots.gr_a.colour, COLOUR_A);
    assert.equal(dots.gr_b.colour, COLOUR_B);
    assert.ok(Math.abs(dots.gr_a.fx - 140 / 800) < 1e-9 && Math.abs(dots.gr_a.fy - 115 / 600) < 1e-9);

    // the watch thumbnail dot, run from app.js with those dots
    const body = appSource.match(/^async function refreshThumbs\(\)[^]*?\r?\n}\r?\n/m)![0];
    const dot = (id: string) => ({ dataset: { dot: id }, hidden: true, style: {} as Record<string, string> });
    const els = [dot('gr_a'), dot('gr_b'), dot('gr_gone')];
    const document = { querySelectorAll: (sel: string) => (sel.includes('wdot') ? els : []) };
    const refreshThumbs = new Function('ui', 'api', 'document', `${body}; return refreshThumbs;`)({ watch: true, snap: { grants } }, { desktopThumbs: async () => ({ shots: {}, dots }) }, document);
    await refreshThumbs();
    assert.deepEqual(els.map((e) => [e.hidden, e.style.background]), [[false, COLOUR_A], [false, COLOUR_B], [true, undefined]]);
  } finally {
    mods.closeDesktopOverlay();
  }

  // the tile dot: main adds colour per session, terminal.js paints it beside the state dot
  assert.match(mainSource, /sessions: s\.sessions\.map\(\(x\) => \(\{ \.\.\.x, colour: sessionColour\(x\.id\) \}\)\)/);
  assert.match(mainSource, /function cursorLook\([^]*?colour: sessionColour\(sessionId\)/);
  const label = termSource.match(/^ {2}function label\(t, x\) \{[^]*?\n {2}\}\r?\n/m)![0];
  const el: Record<string, any> = {};
  const node = (sel: string) => (el[sel] ??= { textContent: '', hidden: false, dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} } });
  const t = { el: { querySelector: node, dataset: {}, classList: { toggle() {}, add() {} } }, term: { options: {}, write() {} } };
  new Function('escapeAttr', 'deskHtml', 'selected', `${label}; return label;`)(String, () => '', null)(t, { state: 'working', engine_id: 'claude', colour: COLOUR_A, task: 'x', words: 'working' });
  assert.equal(el['.cdot'].hidden, false);
  assert.equal(el['.cdot'].style.background, COLOUR_A);
  assert.ok(termSource.indexOf('<span class="dot"></span><span class="cdot"') >= 0, 'colour dot sits beside the kept state dot, before the engine');
});

test('M6-18g rules through the browser host: first at target, 3 px, 300 px, 50% diagonal, reduced motion, instant, off', async () => {
  // protects=M6-18g which actions glide and which snap, as the overlay is told
  // fails_when=a rule moves, the host passes the wrong host size, or mode off still sends to the overlay
  // no_claim=how the renderer draws a snap or a flash
  const b = browser();
  await b.click('500,400');
  await b.click('503,400');
  await b.click('803,400');
  await b.click('100,500');
  await b.click('1201,500');
  await b.click('99,500');
  const g = b.wc.glides();
  assert.deepEqual([g[0].from, g[0].to, g[0].ms], [{ x: 500, y: 400 }, { x: 500, y: 400 }, 0], 'first action appears at the target');
  assert.equal(g[1].ms, 0, '3 px: ripple only');
  assert.ok(g[2].ms > 0, '300 px glides');
  assert.ok(g[4].ms > 0, '1,101 px on 1920x1080 glides (D54)');
  assert.equal(g[5].ms, 0, '1,102 px is over half the diagonal: snap');
  assert.deepEqual(g[5].targetRect, { x: 59, y: 485, width: 80, height: 30 });

  let look: Record<string, unknown> = { reducedMotion: true };
  const r = browser(() => look);
  await r.click('100,100');
  await r.click('400,100');
  assert.deepEqual(r.wc.glides().map((m) => [m.ms, m.reducedMotion]), [[0, true], [0, true]]);
  look = { mode: 'instant' };
  await r.click('100,100');
  assert.deepEqual(r.wc.glides().at(-1).ms, 0);
  assert.equal(r.wc.glides().at(-1).mode, 'instant');
  look = { mode: 'off' };
  const sent = r.wc.sent.length;
  const t0 = Date.now();
  assert.deepEqual(await r.click('900,700'), { ok: true });
  assert.ok(Date.now() - t0 < 20, 'off: input goes straight on');
  assert.equal(r.wc.sent.length, sent, 'off: no overlay message');
});

test('M6-18g mode off on the pipe: cursor.glide replies shown false within 20 ms and makes no window', async () => {
  // protects=M6-18g agent_cursor.mode off turns the desktop cursor off without a revert
  // fails_when=desktopGlide opens a window or waits in mode off
  // no_claim=reading mode from settings.json (core test covers the fallback)
  fake.wins.length = 0;
  const t0 = Date.now();
  assert.deepEqual(await mods.desktopGlide('g-off', [100, 100, 80, 30], 'click Save', deskLook('g-off', { mode: 'off' })), { arrived: true, ms: 0, shown: false, late: false });
  assert.ok(Date.now() - t0 < 20);
  assert.equal(fake.wins.length, 0);
});

test('M6-18f glide time: clamp values', () => {
  // protects=M6-18f the formula and its 90..220 clamp, as worked in the contract
  // fails_when=the constants, the log base, the clamp or the rounding change
  // no_claim=that the overlay plays the glide in that time
  assert.equal(glideMs(600, 80), 220);
  assert.equal(glideMs(40, 120), 93);
  assert.equal(glideMs(300, 80), 194);
  assert.equal(glideMs(0, 80), 90);
  assert.equal(glideMs(5, 1000), 90);
  assert.equal(glideMs(1e9, 1), 220);
  assert.equal(glideMs(100, 0), glideMs(100, 1), 'a zero width counts as 1 px');
  for (let d = 0; d <= 3000; d += 37) assert.ok(glideMs(d + 37, 60) >= glideMs(d, 60), 'rises with D');
  for (let w = 1; w <= 900; w += 31) assert.ok(glideMs(400, w + 31) <= glideMs(400, w), 'falls with W');
});

/** A bound workbench pipe over a real browser server; `glide` is the desktop host dependency. */
async function boundPipe(glide: (s: string, r: unknown, c: string) => Promise<any>) {
  const d = new DatabaseSync(':memory:');
  d.exec(schema);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  d.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('claude', '{}', 1, 'local-cli')").run();
  d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('session-a', 'p1', 'claude', 'pty', 'working', ?, ?, ?)").run(now, now, process.pid);
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\mt-m618f-${randomUUID()}` : `/tmp/mt-m618f-${randomUUID()}.sock`;
  const server = await mods.startBrowserServer(pipe, { db: () => d, uiKey: () => null, panes: {} as any, refreshPanes: () => {}, openPane: async () => 'unused', glide });
  const sock = net.connect(pipe);
  await new Promise((r) => sock.once('connect', r));
  let buf = '';
  const replies = new Map<string, any>();
  sock.setEncoding('utf8');
  sock.on('data', (c: string) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); } });
  let n = 0;
  const call = async (method: string, params: object) => {
    const id = String(n++);
    sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let i = 0; i < 400 && !replies.has(id); i++) await sleep(10);
    return replies.get(id);
  };
  await call('browser.hello', { session_id: 'session-a', pid: process.pid });
  return { call, close: () => { sock.destroy(); server.close(); d.close(); } };
}

test('M6-18i pipe: a caller caption reaches the desktop host only in an allowed form, with saved secrets scrubbed', async (t) => {
  // protects=M6-18i a caller cannot put typed text or a saved secret on screen through cursor.glide's caption
  // fails_when=server.ts forwards the caller's caption without safeCaption
  // no_claim=a click name that is not a secret (spec: "click Sign in" is shown)
  const home = (await import('node:fs')).mkdtempSync(resolve((await import('node:os')).tmpdir(), 'm6-18-cap-'));
  const saved = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  t.after(() => { if (saved === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = saved; });
  const { setSecret } = await import('../../core/src/secrets.ts');
  const SECRET = 'hunter2-Saved-Secret-77';
  setSecret(null as any, 'core-notify', 'm618', SECRET);
  const seen: string[] = [];
  const p = await boundPipe(async (_s, _r, c) => { seen.push(c); return { arrived: true, ms: 0, shown: true, late: false }; });
  try {
    const caps = [`type ${MARKER}`, `click ${SECRET}`, `click Save behind ${SECRET}`, `press ${MARKER}`, `${MARKER} click`, 'select now', 'type 24 characters behind Calculator', 'press Alt+F4', 'scroll', 'click Save'];
    for (const caption of caps) await p.call('cursor.glide', { session: 'session-a', target_rect_px: [1, 2, 30, 40], caption });
    assert.deepEqual(seen, ['type', 'click [secret]', 'click Save behind [secret]', 'press', '', 'select', 'type 24 characters behind Calculator', 'press Alt+F4', 'scroll', 'click Save']);
    assert.ok(!JSON.stringify(seen).includes(MARKER.slice(0, 8)) && !JSON.stringify(seen).includes(SECRET));
  } finally {
    p.close();
  }
});

test('M6-18f glideMs: a NaN distance or width still gives a clamped time', () => {
  // protects=M6-18f a bad rect never makes ms NaN (setTimeout(NaN) fires at once, so input would skip the glide)
  // fails_when=glideMs passes NaN through Math.max
  assert.equal(glideMs(NaN, 80), 90);
  assert.equal(glideMs(300, NaN), glideMs(300, 1));
});

test('M6-18h pipe: a desktop host that throws replies late and the input goes on', async () => {
  // protects=D57 an overlay failure is a late reply, not a pipe error that aborts the input
  // fails_when=server.ts lets a glide rejection become a JSON-RPC error
  // no_claim=the core side (core/test/m6-18-acceptance)
  const p = await boundPipe(async () => { throw new Error('overlay window could not be made'); });
  try {
    const r = await p.call('cursor.glide', { session: 'session-a', target_rect_px: [1, 2, 30, 40], caption: 'click' });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.result, { arrived: true, ms: 0, shown: false, late: true });
  } finally {
    p.close();
  }
});

test('M6-18h desktop: an overlay page that never loads still replies late at ms + 16', async () => {
  // protects=D57 window creation and page load sit inside the input deadline
  // fails_when=desktopGlide awaits the page load before starting the ms + 16 wait
  // no_claim=a real slow Electron load
  fake.wins.length = 0;
  fake.loadNever = true;
  try {
    let t0 = Date.now();
    const first = await mods.desktopGlide('hl-desk', [100, 100, 80, 30], 'click', deskLook('hl-desk'));
    assert.deepEqual(first, { arrived: true, ms: 0, shown: true, late: true });
    assert.ok(Date.now() - t0 <= 16 + 40, `first took ${Date.now() - t0}`);
    t0 = Date.now();
    const r = await mods.desktopGlide('hl-desk', [400, 100, 80, 30], 'click', deskLook('hl-desk'));
    const took = Date.now() - t0;
    assert.deepEqual(r, { arrived: true, ms: glideMs(300, 80), shown: true, late: true });
    assert.ok(took >= r.ms + 16 - 10 && took <= r.ms + 16 + 40, `took ${took} for ms ${r.ms}`);
    assert.equal(fake.wins[0].webContents.glides().length, 0, 'nothing sent to a page that never loaded');
  } finally {
    fake.loadNever = false;
    mods.closeDesktopOverlay();
  }
});

test('M6-18h desktop: a window that cannot be made, a send that throws, or a window destroyed during load reply late, never reject', async () => {
  // protects=D57 an overlay failure gives a late reply at ms + 16 and the input goes on
  // fails_when=a throw from new BrowserWindow or webContents.send escapes desktopGlide, or a destroyed-during-load window replies at once with ms 0
  // no_claim=the core's handling of the reply (core test)
  for (const flag of ['ctorThrows', 'sendThrows', 'destroyOnLoad']) {
    fake.wins.length = 0;
    try {
      fake[flag] = true;
      const t0 = Date.now();
      const r = await mods.desktopGlide('ht-desk', [100, 100, 80, 30], 'click', deskLook('ht-desk'));
      assert.deepEqual(r, { arrived: true, ms: 0, shown: true, late: true }, flag);
      assert.ok(Date.now() - t0 >= 16 - 10 && Date.now() - t0 <= 16 + 40, `${flag} took ${Date.now() - t0}`);
    } finally {
      fake[flag] = false;
      mods.closeDesktopOverlay();
    }
  }
});

test('M6-18e desktop: each glide writes a timing row (requested_at, arrived_at, late) without the caption; mode off writes one too', async () => {
  // protects=M6-18e the desktop half of the p95 measurement; M6-18g mode off is still measured
  // fails_when=desktopGlide writes no row, drops a timing field, or puts the caption in the row
  // no_claim=the core's input row (core test)
  const rows: any[] = [];
  mods.initDesktopOverlay((s: string) => deskLook(s), (r: any) => rows.push(structuredClone(r)));
  fake.wins.length = 0;
  try {
    await mods.desktopGlide('e-desk', [100, 100, 80, 30], 'click Save', deskLook('e-desk'));
    await mods.desktopGlide('e-desk', [400, 100, 80, 30], 'type 24 characters', deskLook('e-desk'));
    fake.wins[0].webContents.answer = 'never';
    await mods.desktopGlide('e-desk', [100, 100, 80, 30], 'click Save', deskLook('e-desk'));
    await mods.desktopGlide('e-desk', [100, 100, 80, 30], 'click Save', deskLook('e-desk', { mode: 'off' }));
    assert.equal(rows.length, 4);
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['arrived_at', 'host', 'kind', 'late', 'ms', 'requested_at', 'session', 'shown']);
    assert.ok(!JSON.stringify(rows).includes('Save') && !JSON.stringify(rows).includes('characters'));
    assert.equal(rows[1].ms, glideMs(300, 80));
    assert.equal(rows[1].late, false);
    assert.ok(rows[1].arrived_at - rows[1].requested_at >= rows[1].ms - 5);
    assert.deepEqual([rows[2].late, rows[2].arrived_at], [true, null]);
    assert.deepEqual([rows[3].shown, rows[3].ms, rows[3].late], [false, 0, false]);
  } finally {
    mods.initDesktopOverlay((s: string) => deskLook(s), () => {});
    mods.closeDesktopOverlay();
  }
});

test('M6-18e browser: mode off still writes a cursor row, shown false', async () => {
  // protects=M6-18e/g every browser action has a cursor row, so mode off runs are measurable
  // fails_when=pointAt returns in mode off without a row
  const b = browser(() => ({ mode: 'off' }));
  await b.click('100,100');
  const row = b.probes.find((p) => p.kind === 'cursor');
  assert.deepEqual([row.ms, row.late, row.shown], [0, false, false]);
});
