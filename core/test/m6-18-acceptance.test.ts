import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { Desktop } from '../src/desktop/driver.ts';
import { DEFAULTS } from '../src/settings.ts';

const WINDOW = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'fake.exe', title: 'Fixture', controls: [{ name: 'Editor', automation_id: 'editor', role: 'edit', rid: '42.7' }] };
const PARAMS = { session_id: 's1', pid: process.pid, window: 100, ref: 'e1' };
const MARKER = 'Zq7xMarker24charsUnique9';
const rows = (file: string): any[] => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];

/** The real Desktop driver over the fake UIA helper, as in m6-15-hardening; `extra` is what the helper adds to describe. */
function fixture(t: any, extra: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'm6-18-acceptance-'));
  const statePath = join(home, 'state.json');
  const logPath = join(home, 'input.jsonl');
  const update = (e: Record<string, unknown>) => writeFileSync(statePath, JSON.stringify({ windows: [{ ...WINDOW, describe_extra: e }] }));
  update(extra);
  const env = { METATROOPER_UIA_HELPER: join(import.meta.dirname, 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: '0' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const db = new DatabaseSync(join(home, 'synthetic.sqlite'));
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec("PRAGMA foreign_keys=OFF; INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('p1','/fixture','Fixture','t','t'); INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,pid) VALUES ('s1','p1','fake','pty','working','t','t',1); INSERT INTO plugin (id,enabled,manifest,path,source,permissions,version,installed_at) VALUES ('desktop',1,'{}','','builtin','[]','1','t'); INSERT INTO grant (id,session_id,hwnd,pid,process_start,exe,title,created_at) VALUES ('gr_fixture','s1',100,4100,'2026-10-12T01:00:00.000Z','fake.exe','Fixture','t')");
  const desktop = new Desktop(db);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  (desktop as any).bound.add('s1 ' + process.pid);
  Object.assign(desktop as any, { uiPid: process.pid, uiStart: `start-of-${process.pid}`, noTakeover: null });
  db.prepare("UPDATE session SET pid=? WHERE id='s1'").run(process.pid);
  const call = (method: string, p: object = PARAMS) => Promise.resolve(methods.get(method).handler(p));
  t.after(async () => {
    const child = (desktop.helper as any).child;
    desktop.helper.stop();
    if (child && child.exitCode === null) await new Promise(r => child.once('exit', r));
    db.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { call, update, inputs: () => rows(logPath) };
}

let hookId = 0;
/** metatrooper-desktop's tool callback over the real driver, approvals auto-approved, cursor.glide recorded with its reply. */
async function hookTool(t: any, f: ReturnType<typeof fixture>) {
  const bridge: any = { glides: [], glideReplies: [], approvals: [] };
  bridge.call = async (method: string, params: any) => {
    if (method === 'approval.check') { bridge.approvals.push(params); return { kind: 'reply', reply: { result: { decision: 'approved' } } }; }
    try { return { kind: 'reply', reply: { result: await f.call(method, params) } }; }
    catch (e: any) { return { kind: 'reply', reply: { error: { code: e.code, message: e.message } } }; }
  };
  bridge.glide = (params: any) => {
    bridge.glides.push(structuredClone(params));
    const reply = { result: { arrived: true, ms: 0, shown: params.target_rect_px !== null, late: false } };
    bridge.glideReplies.push(reply);
    return reply;
  };
  (globalThis as any).__m618Hook = bridge;
  const suffix = hookId++;
  const sources: Record<string, string> = {
    '../pipe/client.ts': 'export const call = (...args) => globalThis.__m618Hook.call(...args);',
    './workbench-pipe.ts': "export const findSession = () => 's1'; export class WorkbenchPipe { sessionId = 's1'; async available() { return true; } async call(method, params) { return method === 'cursor.glide' ? globalThis.__m618Hook.glide(params) : { error: { code: -32601, message: 'no' } }; } }",
    './mcp-stdio.ts': 'export const serveMcp = (_name, _tools, callback) => { globalThis.__m618Hook.tool = callback; };',
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.includes('/hook/desktop-mcp.ts') && sources[specifier]) return { url: 'test:m618-hook-' + suffix + '/' + specifier, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      const key = Object.keys(sources).find(k => url === 'test:m618-hook-' + suffix + '/' + k);
      return key ? { format: 'module', shortCircuit: true, source: sources[key] } : next(url, context);
    },
  });
  try { await import('../src/hook/desktop-mcp.ts?m618=' + suffix); }
  finally { hooks.deregister(); }
  t.after(() => { delete (globalThis as any).__m618Hook; });
  return bridge;
}

test('M6-18 describe: minimized passes through; covered_by drops the granted app and the workbench, keeps another program', { timeout: 30000 }, async t => {
  // protects=M6-18l the core only reports a real cover: not the granted app's own windows, not the workbench overlay or frames
  // fails_when=driver.describe drops the pid filter, passes covered_pid out, or loses minimized
  // no_claim=WindowFromPoint and the owner walk in uia-helper.ps1 (needs a desktop)
  const f = fixture(t);
  const cases: Array<[Record<string, unknown>, boolean, string]> = [
    [{}, false, ''],
    [{ minimized: true }, true, ''],
    [{ covered_by: 'Fixture - child', covered_pid: 4100 }, false, ''],
    [{ covered_by: 'MetaTrooper overlay', covered_pid: process.pid }, false, ''],
    [{ covered_by: 'Calculator', covered_pid: 4200 }, false, 'Calculator'],
  ];
  for (const [extra, minimized, covered] of cases) {
    f.update(extra);
    const d = await f.call('desktop.describe') as any;
    assert.equal(d.minimized, minimized, JSON.stringify(extra));
    assert.equal(d.covered_by, covered, JSON.stringify(extra));
    assert.equal('covered_pid' in d, false, 'covered_pid stays inside the core');
  }
});

test('M6-18 caption: " behind <title>" for a covered target, the full title passed to the workbench for scrubbing; a minimised window sends no rect', { timeout: 30000 }, async t => {
  // protects=M6-18l the caption names the covering window whole; a minimised target draws no cursor
  // fails_when=caption() drops the suffix, cuts the title before scrubbing, or a minimised rect is still sent
  // no_claim=the workbench drawing the caption (overlay renderer)
  const f = fixture(t);
  const hook = await hookTool(t, f);
  const long = 'A very long covering window title that runs past forty';
  const forty = 'x'.repeat(40);
  f.update({ covered_by: long, covered_pid: 4200 });
  await hook.tool('click', { window: 100, ref: 'e1' });
  f.update({ covered_by: forty, covered_pid: 4200 });
  await hook.tool('click', { window: 100, ref: 'e1' });
  f.update({});
  await hook.tool('click', { window: 100, ref: 'e1' });
  f.update({ minimized: true });
  await hook.tool('click', { window: 100, ref: 'e1' });
  const caps = hook.glides.map((g: any) => g.caption);
  assert.equal(caps[0], `click Editor behind ${long}`);
  assert.equal(caps[1], `click Editor behind ${forty}`);
  assert.equal(caps[2], 'click Editor');
  assert.deepEqual(hook.glides.map((g: any) => g.target_rect_px), [[10, 10, 50, 20], [10, 10, 50, 20], [10, 10, 50, 20], null]);
  assert.deepEqual(hook.glides.map((g: any) => g.session), ['s1', 's1', 's1', 's1']);
});

test('M6-18i desktop: a 24-character typed marker is in no cursor.glide message or reply', { timeout: 30000 }, async t => {
  // protects=M6-18i typed text never reaches the workbench cursor on the desktop path
  // fails_when=caption() or the glide params carry args.text
  // no_claim=the approval row (M6-02 decides what it shows) or desktop.act, which must carry the text
  const f = fixture(t);
  const hook = await hookTool(t, f);
  f.update({ covered_by: 'Calculator', covered_pid: 4200 });
  const out = await hook.tool('type', { window: 100, ref: 'e1', text: MARKER });
  assert.equal(out.isError, undefined, JSON.stringify(out));
  assert.ok(f.inputs().some(i => i.op === 'set_text'), 'the text was typed');
  assert.equal(hook.glides.length, 1);
  assert.equal(hook.glides[0].caption, 'type 24 characters behind Calculator');
  for (const [what, v] of [['glide params', hook.glides], ['glide reply', hook.glideReplies], ['tool reply', out]] as const) {
    assert.ok(!JSON.stringify(v).includes(MARKER), `${what} hold the typed text`);
    assert.ok(!JSON.stringify(v).includes(MARKER.slice(0, 8)), `${what} hold part of the typed text`);
  }
});

test('M6-18 settings: agent_cursor defaults; an unknown mode reads as snappy and is logged once', async t => {
  // protects=Change 8: the agent_cursor group and the mode fallback the workbench reads it through
  // fails_when=a default changes, a wrong-typed key overrides its default, modeOf passes an unknown mode through, or it logs every read
  // no_claim=/demo-capture setting show_in_recordings for its own instance
  assert.deepEqual(DEFAULTS.agent_cursor, { mode: 'snappy', show_caption: true, idle_fade_ms: 5000, show_in_recordings: false });
  const home = mkdtempSync(join(tmpdir(), 'm6-18-settings-'));
  const saved = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  const logged: string[] = [];
  const error = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.join(' ')); };
  t.after(() => {
    console.error = error;
    if (saved === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ agent_cursor: { mode: 'zoom', idle_fade_ms: 'soon' } }));
  const { settings } = await import('../src/settings.ts?m618-settings');
  const { modeOf } = await import('../../workbench/src/cursor-glide.ts?m618-once');
  const c = settings().agent_cursor;
  assert.equal(c.idle_fade_ms, 5000, 'a wrong-typed key keeps its default');
  assert.equal(c.show_caption, true);
  assert.equal(c.show_in_recordings, false);
  assert.equal(modeOf(c.mode), 'snappy');
  assert.equal(modeOf(c.mode), 'snappy');
  assert.equal(modeOf(undefined), 'snappy');
  for (const m of ['off', 'instant', 'snappy', 'human']) assert.equal(modeOf(m), m);
  assert.equal(logged.length, 1, 'logged once');
  assert.match(logged[0], /zoom/);
});

test('M6-18h desktop hook: a workbench glide error other than -32030 still sends the input; -32030 stops it', { timeout: 30000 }, async t => {
  // protects=D57 a cursor that failed to draw never blocks the input; the bound-session refusal still does
  // fails_when=input() returns on any glide error
  // no_claim=the workbench side (workbench/test/m6-18-acceptance)
  const f = fixture(t);
  const hook = await hookTool(t, f);
  hook.glide = () => ({ error: { code: -32099, message: 'overlay failed' } });
  const out = await hook.tool('click', { window: 100, ref: 'e1' });
  assert.equal(out.isError, undefined, JSON.stringify(out));
  const sent = f.inputs().length;
  assert.ok(sent > 0, 'the click was sent');
  hook.glide = () => ({ error: { code: -32030, message: 'this connection is not bound to that session' } });
  const refused = await hook.tool('click', { window: 100, ref: 'e1' });
  assert.equal(refused.isError, true);
  assert.equal(f.inputs().length, sent, 'nothing sent after a refusal');
});

test('M6-18e desktop hook: with METATROOPER_WORKBENCH_PROBE set, each input writes its time after the glide reply and no typed text', { timeout: 30000 }, async t => {
  // protects=M6-18e the desktop input time row the p95 measurement needs
  // fails_when=input() writes no probe row, writes it before the glide reply, or puts args in it
  // no_claim=the workbench cursor row (workbench test)
  const f = fixture(t);
  const hook = await hookTool(t, f);
  const file = join(mkdtempSync(join(tmpdir(), 'm6-18-probe-')), 'probe.jsonl');
  const saved = process.env.METATROOPER_WORKBENCH_PROBE;
  process.env.METATROOPER_WORKBENCH_PROBE = file;
  t.after(() => { if (saved === undefined) delete process.env.METATROOPER_WORKBENCH_PROBE; else process.env.METATROOPER_WORKBENCH_PROBE = saved; });
  let repliedAt = 0;
  const glide = hook.glide;
  hook.glide = (p: any) => { repliedAt = Date.now(); return glide(p); };
  await hook.tool('type', { window: 100, ref: 'e1', text: MARKER });
  const got = rows(file);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].state, { kind: 'desktop-input', session: 's1', tool: 'type' });
  assert.ok(got[0].at >= repliedAt);
  assert.ok(!readFileSync(file, 'utf8').includes(MARKER.slice(0, 8)));
});


test('D4 desktop hook preserves a covering secret across the old title cut for workbench scrubbing', { timeout: 30000 }, async t => {
  const f = fixture(t);
  const hook = await hookTool(t, f);
  const title = 'x'.repeat(35) + 'orchidriver';
  f.update({ covered_by: title, covered_pid: 4200 });
  await hook.tool('click', { window: 100, ref: 'e1' });
  assert.equal(hook.glides[0].caption, 'click Editor behind ' + title);
});
