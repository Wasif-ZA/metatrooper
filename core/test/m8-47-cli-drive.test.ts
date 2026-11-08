import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, runNode, startCore, teardownCore, uiHello, until } from './helpers.ts';

const knownSecret = 'violet river paper lantern';
const credential = 'sk-' + 'A1b2C3d4'.repeat(5);
let h: ReturnType<typeof isolation>;
let core: Awaited<ReturnType<typeof startCore>>;
let pipe: Awaited<ReturnType<typeof client>>;
let db: DatabaseSync;
let liveId: string;
let project: string;
let script: string;

async function cli(...args: string[]) {
  return await runNode(['core/cli.ts', ...args, '--json'], h.env) as { code: number; stdout: string; stderr: string };
}

function ok(result: { code: number; stdout: string; stderr: string }) {
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

function seed(state: string, host = 'pty', reason: string | null = null): string {
  const id = 'ses_' + randomUUID();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, wait_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, project, 'fake', host, state, at, at, reason);
  return id;
}

async function read(id = liveId, lines = 500): Promise<string[]> {
  const reply = await pipe.request('session.read', { session_id: id, lines });
  assert.equal(reply.error, undefined, JSON.stringify(reply));
  return reply.result.lines;
}

before(async () => {
  h = isolation();
  delete h.env.TROOP_SESSION_ID;
  const registry = join(h.home, 'engines.json');
  script = join(h.home, 'fake-drive.cjs');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  writeFileSync(script, [
    "const readline = require('node:readline');",
    "for (let i = 1; i <= 60; i++) console.log('row-' + String(i).padStart(3, '0') + '   ');",
    'console.log(' + JSON.stringify('known=' + knownSecret) + ');',
    'console.log(' + JSON.stringify('credential=' + credential) + ');',
    "console.log('DRIVE_READY');",
    "readline.createInterface({ input: process.stdin }).on('line', text => {",
    "  if (text === 'finish') { console.log('DRIVE_FINAL_RESULT'); process.exit(0); }",
    "  console.log('RECEIVED:' + JSON.stringify(text));",
    '});',
  ].join('\n'));
  h.env.METATROOPER_ENGINES = registry;
  try {
    core = await startCore(h);
    pipe = await client(h.prefix);
    db = new DatabaseSync(join(h.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    const dir = join(h.home, 'project');
    mkdirSync(dir);
    const opened = await pipe.request('project.open', { path: dir });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    project = opened.result.project_id;
    const ui = await client(h.prefix);
    try {
      await uiHello(ui, h.home);
      const saved = await ui.request('browser.secret.set', { name: 'DRIVE_TEST', origin: 'https://drive.test', value: knownSecret });
      assert.equal(saved.error, undefined, JSON.stringify(saved));
    } finally { ui.close(); }
    const launched = ok(await cli('launch', 'fake', '--project', dir, '--prompt', script));
    assert.equal(typeof launched.session_id, 'string');
    liveId = launched.session_id;
    await until(async () => (await read()).at(-1) === 'DRIVE_READY', 10000);
  } catch (error) {
    pipe?.close();
    db?.close();
    if (core) await teardownCore(core, h);
    else rmSync(h.home, { recursive: true, force: true });
    throw error;
  }
});

after(async () => {
  pipe?.close();
  db?.close();
  if (core) await teardownCore(core, h);
});

test('CLI wait returns all four target states and identifies exactly the person-waiting state', async () => {
  for (const state of ['done', 'waiting_for_you', 'idle', 'exited']) {
    const reason = state === 'waiting_for_you' ? 'Approve the tool request' : null;
    const id = seed(state, 'pty', reason);
    assert.deepEqual(ok(await cli('wait', id, '--timeout', '2')), {
      state, timed_out: false, wait_reason: reason, waiting_on_person: state === 'waiting_for_you',
    });
  }
});

test('CLI wait exits 4 with timeout JSON when a working session reaches no target state', async () => {
  const id = seed('working');
  const started = performance.now();
  const result = await cli('wait', id, '--timeout', '1');
  assert.equal(result.code, 4, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    state: 'working', timed_out: true, wait_reason: null, waiting_on_person: false,
  });
  assert.ok(performance.now() - started >= 1000, 'wait returned before its one-second deadline');
});

test('CLI read defaults to 50 rows and honors --lines 1 and 500 in oldest-first order', async () => {
  const defaults = ok(await cli('read', liveId));
  assert.equal(defaults.session_id, liveId);
  assert.equal(defaults.state, db.prepare('SELECT state FROM session WHERE id = ?').get(liveId)!.state);
  assert.equal(defaults.lines.length, 50);
  assert.equal(defaults.lines[0], 'row-014');
  assert.equal(defaults.lines.at(-1), 'DRIVE_READY');
  const one = ok(await cli('read', liveId, '--lines', '1'));
  assert.deepEqual(one.lines, ['DRIVE_READY']);
  const all = ok(await cli('read', liveId, '--lines', '500'));
  assert.deepEqual(all.lines.filter((line: string) => line.startsWith('row-')),
    Array.from({ length: 60 }, (_, i) => 'row-' + String(i + 1).padStart(3, '0')));
  assert.deepEqual(defaults.lines, all.lines.slice(-50));
});

test('session.read rejects invalid row counts with -32602 and an unknown session with -32002', async () => {
  const invalid = [0, -1, 501, 1.5, '2', null, true];
  const rpcCodes: unknown[] = [];
  for (const lines of invalid) {
    const reply = await pipe.request('session.read', { session_id: liveId, lines });
    rpcCodes.push(reply.error?.code ?? 'accepted');
  }
  const cliCodes: unknown[] = [];
  for (const lines of ['0', '501', '1.5', 'nope']) {
    const result = await cli('read', liveId, '--lines', lines);
    cliCodes.push({ lines, exit: result.code, error: JSON.parse(result.stdout).error?.code ?? 'accepted' });
  }
  const unknown = await pipe.request('session.read', { session_id: 'ses_missing' });
  assert.equal(unknown.error?.code, -32002);
  assert.deepEqual({ rpc: rpcCodes, cli: cliCodes }, {
    rpc: invalid.map(() => -32602),
    cli: ['0', '501', '1.5', 'nope'].map(lines => ({ lines, exit: 1, error: -32602 })),
  });
});

test('CLI read redacts a known secret and a credential-looking token while preserving surrounding output', async () => {
  const result = ok(await cli('read', liveId, '--lines', '500'));
  assert.ok(result.lines.includes('DRIVE_READY'));
  const known = result.lines.find((line: string) => line.startsWith('known='));
  const token = result.lines.find((line: string) => line.startsWith('credential='));
  assert.equal(typeof known, 'string', 'known secret fixture was never read');
  assert.equal(typeof token, 'string', 'credential fixture was never read');
  assert.notEqual(known, 'known=' + knownSecret);
  assert.notEqual(token, 'credential=' + credential);
  assert.ok(!result.lines.join('\n').includes(knownSecret));
  assert.ok(!result.lines.join('\n').includes(credential));
});

test('CLI send joins text positionals, presses Enter and accepts the 4000-character boundary', async () => {
  assert.deepEqual(ok(await cli('send', liveId, 'hello', 'other', 'agent')), { sent: true });
  await until(async () => (await read()).includes('RECEIVED:"hello other agent"'), 5000);
  const text = 'a '.repeat(2000);
  const reply = await pipe.request('session.send', { session_id: liveId, text });
  assert.deepEqual(reply.result, { sent: true });
  await until(async () => (await read()).includes('RECEIVED:' + JSON.stringify(text)), 5000);
});

test('session.send rejects empty, oversized, non-string and control-character text with -32602', async () => {
  const invalid = ['', 'x'.repeat(4001), null, 12, ...Array.from({ length: 32 }, (_, i) => 'before' + String.fromCharCode(i) + 'after'), 'before\x7fafter'];
  for (const text of invalid) {
    const reply = await pipe.request('session.send', { session_id: liveId, text });
    assert.equal(reply.error?.code, -32602, JSON.stringify({ text, reply }));
    assert.match(reply.error.message, /text/);
  }
});

test('CLI and RPC send cannot answer a session waiting on a person', async () => {
  const previous = db.prepare('SELECT state, wait_reason FROM session WHERE id = ?').get(liveId)!;
  db.prepare("UPDATE session SET state = 'waiting_for_you', wait_reason = 'Approve the tool request' WHERE id = ?").run(liveId);
  const before = await read();
  try {
    const result = await cli('send', liveId, 'yes');
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, -32602);
    assert.match(JSON.parse(result.stdout).error.message, /waiting on a person/);
    const reply = await pipe.request('session.send', { session_id: liveId, text: 'approve' });
    assert.equal(reply.error?.code, -32602);
    assert.match(reply.error.message, /only the user/);
    assert.deepEqual(await read(), before);
    assert.equal(db.prepare('SELECT state FROM session WHERE id = ?').get(liveId)!.state, 'waiting_for_you');
  } finally {
    db.prepare('UPDATE session SET state = ?, wait_reason = ? WHERE id = ?').run(previous.state, previous.wait_reason, liveId);
  }
});

test('CLI send refuses an external-host session', async () => {
  const id = seed('idle', 'external');
  const result = await cli('send', id, 'hello');
  assert.equal(result.code, 1, result.stdout + result.stderr);
  const reply = JSON.parse(result.stdout);
  assert.equal(reply.error.code, -32602);
  assert.match(reply.error.message, /outside|external/);
});

test('piped CLI stdin cannot resolve a gate and the unauthenticated CLI pipe requires UI', async () => {
  const session = seed('waiting_for_you');
  const approval = 'ap_' + randomUUID();
  db.prepare("INSERT INTO approval (id, session_id, surface, target, action, action_hash, summary, reason, status, created_at) VALUES (?, ?, 'browser', 'https://drive.test', 'click', 'hash', 'Send', 'external action', 'waiting', ?)")
    .run(approval, session, new Date().toISOString());
  const result = await runNode(['core/cli.ts', 'approval.resolve', approval, 'approve', '--json'], h.env, 'yes\napprove\n') as { code: number; stdout: string; stderr: string };
  assert.equal(result.code, 2, result.stdout + result.stderr);
  const reply = await pipe.request('approval.resolve', { approval_id: approval, decision: 'approve' });
  assert.equal(reply.error?.code, -32012);
  assert.deepEqual(db.prepare('SELECT status, decided_at FROM approval WHERE id = ?').get(approval),
    Object.assign(Object.create(null), { status: 'waiting', decided_at: null }));
});

test('M8-47a: a parent launches a fake engine, waits for exit and reads its final output through CLI JSON', async () => {
  const parent = seed('working');
  const dir = db.prepare('SELECT path FROM project WHERE id = ?').get(project)!.path as string;
  const launched = await runNode(['core/cli.ts', 'launch', 'fake', '--project', dir, '--prompt', script, '--json'],
    { ...h.env, TROOP_SESSION_ID: parent }) as { code: number; stdout: string; stderr: string };
  const id = ok(launched).session_id;
  assert.equal(typeof id, 'string');
  assert.equal(db.prepare('SELECT parent_id FROM session WHERE id = ?').get(id)!.parent_id, parent);
  await until(async () => (await read(id)).at(-1) === 'DRIVE_READY', 10000);
  assert.deepEqual(ok(await cli('send', id, 'finish')), { sent: true });
  await until(() => db.prepare('SELECT state FROM session WHERE id = ?').get(id)!.state === 'exited', 10000);
  assert.deepEqual(ok(await cli('wait', id, '--timeout', '2')), {
    state: 'exited', timed_out: false, wait_reason: null, waiting_on_person: false,
  });
  const result = ok(await cli('read', id));
  assert.equal(result.session_id, id);
  assert.equal(result.state, 'exited');
  assert.ok(result.lines.includes('DRIVE_FINAL_RESULT'), JSON.stringify(result));
});
