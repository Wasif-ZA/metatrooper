import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isolation, until } from './helpers.ts';

const home = isolation();
const prior = { METATROOPER_HOME: process.env.METATROOPER_HOME, METATROOPER_PIPE_PREFIX: process.env.METATROOPER_PIPE_PREFIX, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let term: typeof import('../src/terminal/index.ts');
let buildMethods: typeof import('../src/methods.ts').buildMethods;
let schemaFile: string;

before(async () => {
  Object.assign(process.env, { METATROOPER_HOME: home.home, METATROOPER_PIPE_PREFIX: home.prefix, HOME: home.home, USERPROFILE: home.home });
  term = await import('../src/terminal/index.ts');
  ({ buildMethods } = await import('../src/methods.ts'));
  ({ schemaFile } = await import('../src/paths.ts'));
});

after(() => {
  term?.killAll();
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const [k, v] of Object.entries(prior)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const ECHO = "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>process.stdout.write(d));setInterval(()=>{},1000)";

/** One session `s` on engine `fake` (typed into) or `hooked` (hooks engine), with surface `screen` drawn at seq 1; `live` opens an echo terminal for it. */
async function harness(t: any, o: { engine?: 'fake' | 'hooked'; state?: string; host?: string; live?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', home.home, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{"id":"fake","state_source":"process"}', 1, 'local-cli');
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('hooked', '{"id":"hooked","state_source":"hooks"}', 1, 'local-cli');
  const id = `ev-${Math.random().toString(36).slice(2)}`;
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'project', o.engine ?? 'fake', o.host ?? 'pty', o.state ?? 'idle', at, at);
  if (o.live) {
    term.open(id, [process.execPath, '-e', ECHO], home.home, process.env, 400, 10);
    t.after(async () => { term.kill(id); await until(() => !term.has(id), 5000); });
  }
  t.after(() => db.close());
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'synthetic-key' });
  const call = (method: string, params: any) => methods.get(method)!.handler(params, { ui: false, origin: 'test' }) as any;
  call('ui.show', { session_id: id, surface: 'screen', title: 'Synthetic screen', spec: { type: 'text', text: 'hello' } });
  const click = (extra: any = {}) => call('ui.event', { surface: 'screen', seq: 1, event: 'press', context: { row: 3 }, ...extra });
  const notices = () => db.prepare("SELECT body, prompt_at FROM comment WHERE session_id = ? AND kind = 'notice'").all(id) as Array<{ body: string; prompt_at: string | null }>;
  const inbox = () => db.prepare("SELECT text FROM needs_you WHERE ref = ? AND kind = 'other'").all(id) as Array<{ text: string }>;
  const screen = async () => (await term.screenText(id)) ?? '';
  return { db, id, call, click, notices, inbox, screen };
}

const LINE = '[ouros-ui] {"surface":"screen","seq":1,"event":"press","context":{"row":3}}';

test('a click on a live surface queues one [ouros-ui] line with surface, seq, event and context', async t => {
  const h = await harness(t, { live: true });
  assert.deepEqual(h.click(), { delivered: true, to: 'session', seq: 1, typed: true });
  assert.deepEqual(h.notices().map(n => n.body), [LINE]);
  assert.deepEqual(h.inbox(), []);
  await until(async () => (await h.screen()).includes(LINE), 5000);
});

test('an old seq is dropped as stale', async t => {
  const h = await harness(t, { live: true });
  h.call('ui.show', { session_id: h.id, surface: 'screen', title: 'Redrawn', spec: { type: 'text', text: 'again' } });
  assert.deepEqual(h.click(), { delivered: false, to: null, dropped: 'stale', seq: 2 });
  assert.deepEqual(h.notices(), []);
  assert.deepEqual(h.inbox(), []);
});

test('the same event twice at one seq is dropped as repeat', async t => {
  const h = await harness(t, { live: true });
  assert.equal(h.click().to, 'session');
  assert.deepEqual(h.click(), { delivered: false, to: null, dropped: 'repeat', seq: 1 });
  assert.equal(h.click({ event: 'other' }).to, 'session');
  assert.equal(h.notices().length, 2);
});

test("a click on an exited session's surface becomes one needs_you row", async t => {
  const h = await harness(t, { state: 'exited' });
  assert.deepEqual(h.click(), { delivered: true, to: 'inbox', seq: 1 });
  assert.equal(h.inbox().length, 1);
  assert.ok(h.inbox()[0].text.includes(LINE));
  assert.deepEqual(h.notices(), []);
  assert.equal(h.click().dropped, 'repeat');
  assert.equal(h.inbox().length, 1);
});

for (const state of ['idle', 'done', 'working']) {
  test(`a click on a ${state} hooks session is typed and submitted now, and marked so the prompt hook does not repeat it`, async t => {
    const h = await harness(t, { engine: 'hooked', state, live: true });
    assert.deepEqual(h.click(), { delivered: true, to: 'session', seq: 1, typed: true });
    const [n, ...rest] = h.notices();
    assert.deepEqual(rest, []);
    assert.equal(n.body, LINE);
    assert.ok(n.prompt_at);
    await until(async () => (await h.screen()).includes(LINE), 5000);
    assert.equal((await h.screen()).split(LINE).length, 2);
  });
}

test('a click on a hooks session waiting on a person is held for its next prompt, not typed', async t => {
  const h = await harness(t, { engine: 'hooked', state: 'waiting_for_you', live: true });
  assert.deepEqual(h.click(), { delivered: true, to: 'session', seq: 1, typed: false });
  assert.deepEqual(h.notices().map(n => ({ ...n })), [{ body: LINE, prompt_at: null }]);
  assert.ok(!(await h.screen()).includes(LINE));
});

for (const [name, o] of [['an idle hooks session with no terminal', { engine: 'hooked', state: 'idle' }], ['an external hooks session', { engine: 'hooked', state: 'working', host: 'external' }]] as const) {
  test(`a click on ${name} becomes one needs_you row`, async t => {
    const h = await harness(t, o);
    assert.deepEqual(h.click(), { delivered: true, to: 'inbox', seq: 1 });
    assert.equal(h.inbox().length, 1);
    assert.deepEqual(h.notices(), []);
  });
}

test('a click that cannot be typed becomes one needs_you row and no notice', async t => {
  const h = await harness(t);
  assert.deepEqual(h.click(), { delivered: true, to: 'inbox', seq: 1 });
  assert.equal(h.inbox().length, 1);
  assert.deepEqual(h.notices(), []);
});
