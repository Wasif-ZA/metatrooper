import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, harness, isolation, root, runNode, startCore, stopCore, teardownCore, until, uiHello } from './helpers.ts';

before(buildGenerated);

function database(home) { return new DatabaseSync(join(home, 'troop.db')); }
function now() { return new Date().toISOString(); }
function command(db, id, method, params, status = 'queued') {
  db.prepare('INSERT INTO command (id, at, origin, method, params, status) VALUES (?, ?, ?, ?, ?, ?)').run(id, now(), 'cli', method, JSON.stringify(params), status);
}

test('core initializes the contracted schema in WAL mode', async () => {
  const h = await harness();
  try {
    const db = database(h.home);
    try {
      const sql = readFileSync(join(root, 'contracts/schema.sql'), 'utf8');
      const expected = [...sql.matchAll(/CREATE TABLE\s+(\w+)/g)].map(match => match[1]).sort();
      const actual = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name).sort();
      assert.deepEqual(actual, expected);
      assert.ok(actual.includes('needs_you'));
      assert.deepEqual(db.prepare('PRAGMA table_info(needs_you)').all().map(row => row.name), ['id', 'at', 'kind', 'ref', 'text', 'resolved_at', 'read_at', 'notified_at']);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode.toLowerCase(), 'wal');
    } finally { db.close(); }
  } finally { await h.teardown(); }
});

test('generated core files match build.ts', async () => {
  const result = await runNode(['core/build.ts', '--check'], process.env);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test('core package declares AGPL-3.0', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'core/package.json'), 'utf8'));
  assert.match(manifest.license, /^AGPL-3\.0/);
});

test('project.open uses canonical path sha1 and opens work/ACU paths', async () => {
  const h = await harness();
  try {
    const project = join(h.home, 'Project');
    mkdirSync(project);
    const pipe = await client(h.prefix);
    try {
      const first = await pipe.request('project.open', { path: project });
      const db = database(h.home);
      let canonical;
      try { canonical = db.prepare('SELECT path FROM project WHERE id = ?').get(first.result.project_id).path; }
      finally { db.close(); }
      assert.equal(first.result.project_id, createHash('sha1').update(canonical).digest('hex'));
      const second = await pipe.request('project.open', { path: project + '/' });
      assert.equal(second.result.project_id, first.result.project_id);
      const slashAndDriveCase = project.replaceAll(String.fromCharCode(92), '/').replace(/^./, project[0].toLowerCase());
      const third = await pipe.request('project.open', { path: slashAndDriveCase });
      assert.equal(third.result.project_id, first.result.project_id);
      if (process.platform === 'win32') {
        const fourth = await pipe.request('project.open', { path: slashAndDriveCase.toLowerCase() + '/' });
        assert.equal(fourth.result.project_id, first.result.project_id);
      }
      const acu = join(h.home, 'work', 'ACU', 'repo');
      mkdirSync(acu, { recursive: true });
      const inside = await pipe.request('project.open', { path: acu });
      assert.ok(inside.result?.project_id);
      const sneaky = join(h.home, 'innocent');
      symlinkSync(acu, sneaky, 'junction');
      for (const p of [acu.toLowerCase().split('/').join('\\'), acu.split(/[\\/]/).join('//'), sneaky, join(h.home, 'work'), h.home]) {
        const r = await pipe.request('project.open', { path: p });
        assert.ok(r.result?.project_id, p);
      }
    } finally { pipe.close(); }
  } finally { await h.teardown(); }
});

test('event writer appends one redacted row and never stores a marker', async () => {
  const h = await harness();
  try {
    const marker = `PRIVATE_${randomUUID()}`;
    const env = { ...h.env, TROOP_SESSION_ID: randomUUID() };
    const input = { session_id: 'native', cwd: h.home, transcript_path: '/transcript', tool_name: 'Bash', tool_use_id: 'tool', tool_input: { command: `echo ${marker}` }, tool_response: marker, future_field: marker };
    const result = await runNode(['core/event.js', 'claude.PreToolUse'], env, JSON.stringify(input));
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    const db = database(h.home);
    try {
      const rows = db.prepare('SELECT kind, source, session_id, payload FROM event WHERE session_id = ?').all(env.TROOP_SESSION_ID);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].kind, 'claude.PreToolUse');
      assert.equal(rows[0].source, 'claude-hook');
      assert.equal(JSON.stringify(rows).includes(marker), false);
      const dump = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().flatMap(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all());
      assert.equal(JSON.stringify(dump).includes(marker), false);
      const logs = join(h.home, 'logs');
      if (existsSync(logs)) for (const file of readdirSync(logs)) assert.equal(readFileSync(join(logs, file), 'utf8').includes(marker), false, file);
    } finally { db.close(); }
  } finally { await h.teardown(); }
});

test('event writer without TROOP_SESSION_ID produces no output or row', async () => {
  const h = await harness();
  try {
    const db = database(h.home);
    const before = db.prepare('SELECT count(*) AS n FROM event').get().n;
    const env = { ...h.env };
    delete env.TROOP_SESSION_ID;
    const result = await runNode(['core/event.js', 'claude.PreToolUse'], env, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo secret' } }));
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(db.prepare('SELECT count(*) AS n FROM event').get().n, before);
    db.close();
  } finally { await h.teardown(); }
});

test('all Claude hooks and the Codex notify hook exit silently when no database or core exists', async () => {
  const isolated = isolation();
  try {
    for (const kind of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']) {
      const result = await runNode(['core/event.js', `claude.${kind}`], { ...isolated.env, TROOP_SESSION_ID: 'offline' }, '{}');
      assert.equal(result.code, 0, kind);
      assert.equal(result.stdout, '', kind);
      assert.equal(result.stderr, '', kind);
    }
    const notify = await runNode(['core/codex-notify.js', JSON.stringify({ type: 'agent-turn-complete', 'turn-id': 't1' })], { ...isolated.env, TROOP_SESSION_ID: 'offline' });
    assert.equal(notify.code, 0);
    assert.equal(notify.stdout + notify.stderr, '');
    assert.ok(!existsSync(join(isolated.home, 'troop.db')), 'an offline hook created the database');
  } finally { rmSync(isolated.home, { recursive: true, force: true }); }
});

test('launcher exits silently with no core and adds under one second to engine start', async () => {
  const isolated = isolation();
  try {
    const baseline = await runNode(['-e', 'process.exit(0)'], isolated.env);
    const args = Buffer.from(JSON.stringify([process.execPath, '-e', 'process.exit(0)'])).toString('base64');
    const result = await runNode(['core/launch.js', '--session', randomUUID(), '--engine', 'fake', '--args-b64', args], isolated.env);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.ok(result.ms - baseline.ms < 1000);
  } finally { rmSync(isolated.home, { recursive: true, force: true }); }
});

test('launcher preserves every argument, records its own pid, and passes through exit codes', async () => {
  const h = await harness();
  try {
    const session = randomUUID();
    const argumentsToPass = ['a b; c', 'quote"s', 'say "hi" now', `tail${String.fromCharCode(92)}`, ''];
    const code = 'console.log(JSON.stringify({args:process.argv.slice(1),session:process.env.TROOP_SESSION_ID,parent:process.ppid}))';
    const args = Buffer.from(JSON.stringify([process.execPath, '-e', code, ...argumentsToPass])).toString('base64');
    const result = await runNode(['core/launch.js', '--session', session, '--engine', 'fake', '--args-b64', args], h.env);
    assert.equal(result.code, 0, result.stderr);
    const observed = JSON.parse(result.stdout.trim());
    assert.deepEqual(observed.args, argumentsToPass);
    assert.equal(observed.session, session);
    const store = database(h.home);
    try {
      const rows = store.prepare("SELECT session_id, kind, source, payload FROM event WHERE session_id = ? AND kind = 'launch'").all(session);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source, 'launch');
      const payload = JSON.parse(rows[0].payload);
      assert.equal(payload.session_id, session);
      assert.equal(payload.engine, 'fake');
      assert.equal(payload.cwd, root);
      assert.equal(payload.pid, observed.parent);
      assert.ok(typeof payload.started_at === 'string');
    } finally { store.close(); }
    const exitArgs = Buffer.from(JSON.stringify([process.execPath, '-e', 'process.exit(23)'])).toString('base64');
    const exitResult = await runNode(['core/launch.js', '--session', randomUUID(), '--engine', 'fake', '--args-b64', exitArgs], h.env);
    assert.equal(exitResult.code, 23, exitResult.stderr);
  } finally { await h.teardown(); }
});

test('each Claude hook averages under 250 ms over ten runs', async () => {
  const h = await harness();
  try {
    for (const kind of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']) {
      const times = [];
      for (let i = 0; i < 10; i++) {
        const run = await runNode(['core/event.js', `claude.${kind}`], { ...h.env, TROOP_SESSION_ID: `speed-${kind}` }, JSON.stringify({ session_id: 'native', cwd: h.home }));
        assert.equal(run.code, 0, kind);
        times.push(run.ms);
      }
      assert.ok(times.reduce((sum, time) => sum + time, 0) / 10 < 250, `${kind}: ${times.join(', ')}`);
    }
  } finally { await h.teardown(); }
});

test('queued command executes on restart and duplicate pipe delivery runs once', async () => {
  const isolated = isolation();
  let core = await startCore(isolated);
  try {
    await stopCore(core, isolated);
    const db = database(isolated.home);
    const project = join(isolated.home, 'queued-project');
    mkdirSync(project);
    const queuedId = randomUUID();
    command(db, queuedId, 'project.open', { path: project });
    db.close();
    core = await startCore(isolated);
    const pipe = await client(isolated.prefix);
    try {
      const reply = await pipe.request('project.open', { path: project }, { id: queuedId });
      const check = database(isolated.home);
      try {
        await until(() => check.prepare('SELECT status FROM command WHERE id = ?').get(queuedId)?.status === 'ok');
        const row = check.prepare('SELECT status, result FROM command WHERE id = ?').get(queuedId);
        assert.equal(row.status, 'ok');
        assert.deepEqual(JSON.parse(row.result), reply.result);
        assert.equal(check.prepare('SELECT count(*) AS n FROM project').get().n, 1);
      } finally { check.close(); }
    } finally { pipe.close(); }
  } finally { await stopCore(core, isolated); rmSync(isolated.home, { recursive: true, force: true }); }
});

test('accepted commands re-execute and running commands become -32098 on restart', async () => {
  const isolated = isolation();
  let core = await startCore(isolated);
  try {
    await stopCore(core, isolated);
    const db = database(isolated.home);
    const project = join(isolated.home, 'recovery-project');
    mkdirSync(project);
    const accepted = randomUUID(), running = randomUUID();
    command(db, accepted, 'project.open', { path: project }, 'accepted');
    command(db, running, 'project.open', { path: join(isolated.home, 'never-opened') }, 'running');
    db.close();
    core = await startCore(isolated);
    const check = database(isolated.home);
    try {
      await until(() => check.prepare('SELECT status FROM command WHERE id = ?').get(accepted)?.status === 'ok');
      const interrupted = check.prepare('SELECT status, result FROM command WHERE id = ?').get(running);
      assert.equal(interrupted.status, 'error');
      assert.equal(JSON.parse(interrupted.result).code, -32098);
      const items = check.prepare('SELECT id, at, kind, ref, text, resolved_at FROM needs_you WHERE ref = ?').all(running);
      assert.equal(items.length, 1);
      assert.ok(items[0].id);
      assert.ok(items[0].at);
      assert.equal(items[0].kind, 'interrupted-command');
      assert.equal(items[0].ref, running);
      assert.ok(items[0].text.includes('project.open'));
      assert.equal(items[0].resolved_at, null);
      assert.equal(check.prepare('SELECT count(*) AS n FROM project').get().n, 1);
    } finally { check.close(); }
  } finally { await stopCore(core, isolated); rmSync(isolated.home, { recursive: true, force: true }); }
});

test('gate.resolve and core.stop require ui.hello on the same connection', async () => {
  const h = await harness();
  try {
    const untrusted = await client(h.prefix);
    try {
      const denied = await untrusted.request('gate.resolve', { gate_id: 'missing', decision: 'approve', action_hash: 'hash' }, { meta: { origin: 'workbench', sent_at: now() } });
      assert.equal(denied.error?.code, -32012);
      const stop = await untrusted.request('core.stop');
      assert.equal(stop.error?.code, -32012);
      assert.equal((await untrusted.request('core.ping')).result?.ok, true);
    } finally { untrusted.close(); }
    const trusted = await client(h.prefix);
    try { await uiHello(trusted, h.home); }
    finally { trusted.close(); }
  } finally { await h.teardown(); }
});

test('offline CLI rejects focus and engine checks, queues project.open, and replays it on core start', async () => {
  const isolated = isolation();
  let core;
  try {
    const db = database(isolated.home);
    const sessionId = randomUUID();
    const at = now();
    try {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(readFileSync(join(root, 'contracts/schema.sql'), 'utf8'));
      db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
        .run('seed-project', isolated.home, 'seed', at, at);
      db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)')
        .run('codex', '{}', 1, 'local-cli');
      db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, 'seed-project', 'codex', 'pty', 'idle', at, at);

      for (const args of [['focus', sessionId.slice(0, 8), '--json'], ['engines', '--check', '--json']]) {
        const result = await runNode(['core/cli.ts', ...args], isolated.env);
        assert.equal(result.code, 3, result.stderr || result.stdout);
        assert.deepEqual(JSON.parse(result.stdout.trim()), { error: { code: -32099, message: 'core offline' } });
        assert.equal(db.prepare('SELECT count(*) AS n FROM command').get().n, 0);
      }

      const project = join(isolated.home, 'offline-open');
      mkdirSync(project);
      const baseline = await runNode(['-e', 'process.exit(0)'], isolated.env);
      const opened = await runNode(['core/cli.ts', 'open', project, '--json'], isolated.env);
      assert.equal(opened.code, 0, opened.stderr || opened.stdout);
      assert.ok(opened.ms <= baseline.ms + 300, `open took ${opened.ms} ms; process start took ${baseline.ms} ms`);
      const queued = JSON.parse(opened.stdout.trim());
      assert.deepEqual(Object.keys(queued), ['queued']);
      assert.ok(typeof queued.queued === 'string' && queued.queued.length > 0);
      const rows = db.prepare('SELECT id, method, origin, status FROM command').all().map(row => ({ ...row }));
      assert.deepEqual(rows, [{ id: queued.queued, method: 'project.open', origin: 'cli', status: 'queued' }]);

      core = await startCore(isolated);
      await until(() => db.prepare('SELECT status FROM command WHERE id = ?').get(queued.queued)?.status === 'ok', 2000);
      assert.equal(db.prepare('SELECT count(*) AS n FROM command').get().n, 1);
    } finally { db.close(); }
  } finally {
    if (core) await teardownCore(core, isolated);
    else rmSync(isolated.home, { recursive: true, force: true });
  }
});

test.skip('M1-10 needs a second standard Windows account to test pipe access', () => {});
test.skip('M1-02 and M1-03 need real Windows Terminal sessions and signed-in engines', () => {});

test('M1-08 queued commands run in the order they were queued, across a DST change and same-ms ties, within 2 s of restart', async () => {
  const isolated = isolation();
  let core = await startCore(isolated);
  try {
    await stopCore(core, isolated);
    const db = database(isolated.home);
    const stamps = ['2027-04-04T02:59:00.000+11:00', '2027-04-04T02:00:00.000+10:00', '2027-04-04T02:00:00.000+10:00'];
    const names = ['first', 'second', 'third'];
    names.forEach((name, i) => {
      mkdirSync(join(isolated.home, name));
      db.prepare("INSERT INTO command (id, at, origin, method, params, status) VALUES (?, ?, 'cli', 'project.open', ?, 'queued')")
        .run(`z-${names.length - i}`, stamps[i], JSON.stringify({ path: join(isolated.home, name) }));
    });
    db.close();
    core = await startCore(isolated);
    const check = database(isolated.home);
    try {
      await until(() => check.prepare("SELECT count(*) AS n FROM command WHERE status = 'ok'").get().n === names.length, 2000);
      assert.deepEqual(check.prepare('SELECT name FROM project ORDER BY rowid').all().map((r) => r.name), names);
    } finally { check.close(); }
  } finally { await stopCore(core, isolated); rmSync(isolated.home, { recursive: true, force: true }); }
});
