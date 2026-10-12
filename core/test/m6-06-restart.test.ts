import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, pipePath, sleep, startCore, teardownCore, until } from './helpers.ts';

type TerminalModule = typeof import('../src/terminal/index.ts');
type TermPipeModule = typeof import('../src/terminal/pipe.ts');
type ResumeModule = typeof import('../src/sessions/resume-all.ts');

const home = isolation();
const prior = { ...process.env };
let term: TerminalModule;
let termPipe: TermPipeModule;
let R: ResumeModule;

before(async () => {
  await buildGenerated();
  Object.assign(process.env, home.env);
  mkdirSync(home.home, { recursive: true });
  term = await import('../src/terminal/index.ts');
  termPipe = await import('../src/terminal/pipe.ts');
  R = await import('../src/sessions/resume-all.ts');
});

after(async () => {
  term?.killAll();
  await sleep(200);
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
  Object.assign(process.env, prior);
});

/** A Resumer on a fake clock; `states` and `screens` are keyed by the new ids it hands out (n1, n2, ...). */
function fakeResumer(queue: Array<{ id: string; engine: string }>, auth: Record<string, string> = {}) {
  let clock = 0;
  let n = 0;
  const states: Record<string, string> = {};
  const screens: Record<string, string> = {};
  const launches: Array<{ old: string; id: string; at: number }> = [];
  const raised: string[] = [];
  const resumer = new R.Resumer(queue, {
    resume: async (old) => { const id = `n${++n}`; states[id] = 'starting'; launches.push({ old, id, at: clock }); return id; },
    stateOf: (id) => states[id],
    screenText: async (id) => screens[id] ?? null,
    authError: (engine) => auth[engine],
    raise: (engine) => { raised.push(engine); },
    now: () => clock,
    rand: () => 0.5,
  });
  const run = async (until: number, each: () => void = () => {}) => {
    let most = 0;
    while (clock <= until && !resumer.done()) {
      await resumer.tick();
      most = Math.max(most, resumer.inFlight());
      each();
      clock += 250;
    }
    return most;
  };
  return { resumer, states, screens, launches, raised, run, now: () => clock };
}

test('M6-06a resumes at most 3 at once, 2 s plus jitter apart, and the 4th once a slot frees', async () => {
  const f = fakeResumer(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, engine: 'x' })));
  const most = await f.run(60_000);
  assert.equal(most, R.MAX_AT_ONCE);
  assert.deepEqual(f.launches.map((l) => l.old), ['a', 'b', 'c', 'd', 'e']);
  for (let i = 1; i < f.launches.length; i++) assert.ok(f.launches[i].at - f.launches[i - 1].at >= R.GAP_MS, JSON.stringify(f.launches));
  assert.ok(f.launches[1].at - f.launches[0].at <= R.GAP_MS + R.JITTER_MS);
  // nothing leaves `starting`, so the 4th waits for the first one's window to close
  assert.ok(f.launches[3].at >= R.WINDOW_MS, JSON.stringify(f.launches));
  assert.ok(f.launches[3].at < 30_000);
});

test('M6-06a a session that leaves starting frees its slot at once', async () => {
  const f = fakeResumer(['a', 'b', 'c', 'd'].map((id) => ({ id, engine: 'x' })));
  await f.run(60_000, () => { for (const l of f.launches) if (f.now() - l.at >= 1000) f.states[l.id] = 'idle'; });
  assert.equal(f.launches.length, 4);
  assert.ok(f.launches[3].at < R.WINDOW_MS, JSON.stringify(f.launches));
});

test('M6-06b two auth_error screens stop that engine and raise one item; other engines still resume', async () => {
  const queue = [{ id: 'c1', engine: 'claude' }, { id: 'c2', engine: 'claude' }, { id: 'g1', engine: 'gemini' }, { id: 'c3', engine: 'claude' }, { id: 'c4', engine: 'claude' }];
  const f = fakeResumer(queue, { claude: 'please run /login', gemini: 'needs auth' });
  await f.run(60_000, () => {
    for (const l of f.launches) f.screens[l.id] = l.old.startsWith('c') ? 'Welcome\nInvalid API key. Please run /login' : 'gemini ready';
  });
  assert.deepEqual(f.launches.map((l) => l.old), ['c1', 'c2', 'g1']);
  assert.deepEqual(f.raised, ['claude']);
  assert.ok(f.resumer.blocked.has('claude'));
  assert.ok(!f.resumer.blocked.has('gemini'));
});

test('M6-06b one auth failure is not enough, a bad pattern never matches, and a failure counts once', async () => {
  const f = fakeResumer([{ id: 'a', engine: 'x' }, { id: 'b', engine: 'y' }, { id: 'c', engine: 'x' }], { x: 'sign in', y: '(' });
  await f.run(60_000, () => {
    for (const l of f.launches) f.screens[l.id] = l.old === 'a' ? 'please sign in' : l.old === 'b' ? '(((' : 'ok';
  });
  assert.equal(f.launches.length, 3);
  assert.deepEqual(f.raised, []);
});

async function rawClient(path: string) {
  const socket: Socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const messages: Array<{ op: string; data?: string; code?: string | number }> = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffer.slice(0, nl))); buffer = buffer.slice(nl + 1); }
  });
  return { messages, send: (m: object) => socket.write(JSON.stringify(m) + '\n') };
}

test('M6-06b an exited session keeps its last 200 rows, and attaching shows them then the exit code', async () => {
  const id = 'screen-test';
  const script = "for (let i = 0; i < 300; i++) console.log('row ' + i); console.log('LAST LINE'); setTimeout(() => process.exit(3), 300);";
  term.open(id, [process.execPath, '-e', script], home.home, process.env, 80, 24);
  await until(() => term.savedScreen(id) !== null, 8000);
  const saved = term.savedScreen(id)!;
  assert.equal(saved.code, 3);
  assert.match(saved.text, /LAST LINE/);
  assert.match(saved.text, /row 299/);
  assert.doesNotMatch(saved.text, /row 50\b/);
  assert.ok(saved.text.split('\n').length <= term.SCREEN_ROWS);
  assert.equal(await term.screenText(id), saved.text);

  const path = pipePath('m6-06-term');
  const server = await termPipe.startTermServer(path, 'k');
  try {
    const c = await rawClient(path);
    c.send({ op: 'attach', session: id, cols: 80, rows: 24, ui_key: 'k' });
    await until(() => c.messages.some((m) => m.op === 'exit'), 3000);
    assert.equal(c.messages[0].op, 'snapshot');
    assert.match(c.messages[0].data!, /LAST LINE/);
    assert.deepEqual(c.messages[1], { op: 'exit', code: 3 });
    const none = await rawClient(path);
    none.send({ op: 'attach', session: 'never-ran', cols: 80, rows: 24, ui_key: 'k' });
    await until(() => none.messages.length > 0, 3000);
    assert.deepEqual(none.messages[0], { op: 'error', code: 'no-session' });
  } finally { await new Promise((r) => server.close(r)); }
});

test('pruneScreens deletes saved screens older than 30 days', () => {
  const dir = term.screensDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'old.json'), '{}');
  term.pruneScreens(30, Date.now() + 31 * 86_400_000);
  assert.equal(term.savedScreen('old'), null);
});

// A spawned core: launch sessions, kill the core outright, start it again on the same home.

const STAY = "console.log('ENGINE READY'); setInterval(() => {}, 1000);";
const AUTH = "console.log('Error: please log in to continue'); setInterval(() => {}, 1000);";

function engine(id: string, script: string, extra: object = {}) {
  return { id, command: process.execPath, args: ['-e', script], prompt_arg: 'positional', state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'], ...extra };
}

async function launched(prefix: string, project: string, engines: string[]) {
  const pipe = await client(prefix);
  try {
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
    const ids: string[] = [];
    for (const e of engines) ids.push((await pipe.request('session.launch', { project_id: projectId, engine_id: e })).result.session_id);
    return ids;
  } finally { pipe.close(); }
}

async function killedAndRestarted(engines: object[], launch: string[]) {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify(engines));
  const isolated = { ...iso, env: { ...iso.env, METATROOPER_ENGINES: registry } };
  const project = join(iso.home, 'project');
  mkdirSync(project, { recursive: true });
  let core = await startCore(isolated);
  const old = await launched(iso.prefix, project, launch);
  const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
  await until(() => old.every((id) => db.prepare("SELECT 1 FROM event WHERE kind = 'launch' AND session_id = ?").get(id)), 8000);
  core.kill();
  await until(() => core.exitCode !== null || core.signalCode !== null, 5000);
  await sleep(500);
  const restartedAt = Date.now();
  core = await startCore(isolated);
  return { iso: isolated, db, old, restartedAt, core: () => core };
}

function resumedRows(db: DatabaseSync) {
  return db.prepare("SELECT e.session_id AS id, json_extract(e.payload, '$.from') AS old, s.started_at, s.engine_id FROM event e JOIN session s ON s.id = e.session_id WHERE e.kind = 'core.resumed' ORDER BY julianday(s.started_at)")
    .all() as Array<{ id: string; old: string; started_at: string; engine_id: string }>;
}

test('M6-06a killing the core brings 4 live sessions back within 30 s, never more than 3 resuming at once', { timeout: 90_000 }, async () => {
  const h = await killedAndRestarted([engine('one', STAY), engine('two', STAY), engine('three', STAY)], ['one', 'two', 'three', 'one']);
  try {
    await until(() => resumedRows(h.db).length === 4, 30_000);
    const rows = resumedRows(h.db);
    assert.deepEqual(new Set(rows.map((r) => r.old)), new Set(h.old));
    const starts = rows.map((r) => Date.parse(r.started_at));
    assert.ok(starts[3] - h.restartedAt < 30_000, `last resume ${starts[3] - h.restartedAt} ms after restart`);
    for (const t of starts) assert.ok(starts.filter((u) => u <= t && t < u + R.WINDOW_MS).length <= R.MAX_AT_ONCE, JSON.stringify(starts));
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= R.GAP_MS - 50, JSON.stringify(starts));
    for (const id of h.old) assert.equal((h.db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string }).state, 'exited');
    assert.deepEqual(rows.map((r) => r.engine_id).sort(), ['one', 'one', 'three', 'two']);
  } finally {
    h.db.close();
    await teardownCore(h.core(), h.iso);
  }
});

test('M6-06b an engine whose resume shows its auth_error twice stops being resumed and raises one needs-you item', { timeout: 90_000 }, async () => {
  const h = await killedAndRestarted([engine('locked', AUTH, { auth_error: 'please log in' }), engine('fine', STAY)], ['locked', 'locked', 'locked', 'fine']);
  try {
    await until(() => resumedRows(h.db).some((r) => r.engine_id === 'fine'), 30_000);
    await sleep(1000);
    const rows = resumedRows(h.db);
    assert.equal(rows.filter((r) => r.engine_id === 'locked').length, 2);
    const items = h.db.prepare("SELECT kind, text FROM needs_you WHERE ref = 'resume:locked'").all() as Array<{ kind: string; text: string }>;
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'other');
    assert.match(items[0].text, /locked needs signing in/);
  } finally {
    h.db.close();
    await teardownCore(h.core(), h.iso);
  }
});
