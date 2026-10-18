import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { isolation, withEnv } from './helpers.ts';

/** Runs `fn` with METATROOPER_HOME on a fresh folder and an open core database there. */
async function withDb<T>(fn: (db: DatabaseSync, home: string) => Promise<T> | T): Promise<T> {
  const iso = isolation();
  const prior = { home: process.env.METATROOPER_HOME, prefix: process.env.METATROOPER_PIPE_PREFIX };
  process.env.METATROOPER_HOME = iso.home;
  process.env.METATROOPER_PIPE_PREFIX = iso.prefix;
  const { openCoreDb } = await import('../src/store/db.ts');
  const db = openCoreDb();
  try {
    return await fn(db, iso.home);
  } finally {
    db.close();
    if (prior.home === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior.home;
    if (prior.prefix === undefined) delete process.env.METATROOPER_PIPE_PREFIX; else process.env.METATROOPER_PIPE_PREFIX = prior.prefix;
    rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('D9 a re-save whose write or encrypt fails keeps the old secret and its origin', () => withDb(async (db) => {
  const { setBrowserSecret, getSecret } = await import('../src/secrets.ts');
  const { browserSecretOrigin } = await import('../src/browser/secret-origin.ts');
  setBrowserSecret(db, 'KEEP_ME', 'https://a.test/login', 'first-value');
  const write = fs.writeFileSync;
  fs.writeFileSync = ((file: fs.PathOrFileDescriptor, ...rest: never[]) => {
    if (String(file).endsWith('.tmp')) throw new Error('disk full');
    return (write as (...a: unknown[]) => void)(file, ...rest);
  }) as typeof fs.writeFileSync;
  try {
    assert.throws(() => setBrowserSecret(db, 'KEEP_ME', 'https://b.test/login', 'second-value'), /disk full/);
  } finally {
    fs.writeFileSync = write;
  }
  assert.equal(browserSecretOrigin('KEEP_ME'), 'https://a.test');
  assert.equal(getSecret('core-browser', 'KEEP_ME'), 'first-value');
  if (process.platform === 'win32') {
    // no powershell on PATH: DPAPI cannot encrypt
    withEnv({ PATH: '', Path: '' }, () => assert.throws(() => setBrowserSecret(db, 'KEEP_ME', 'https://b.test/login', 'third-value'), /powershell failed/));
    assert.equal(browserSecretOrigin('KEEP_ME'), 'https://a.test');
    assert.equal(getSecret('core-browser', 'KEEP_ME'), 'first-value');
  }
  setBrowserSecret(db, 'KEEP_ME', 'https://b.test/login', 'second-value');
  assert.equal(browserSecretOrigin('KEEP_ME'), 'https://b.test');
  assert.equal(getSecret('core-browser', 'KEEP_ME'), 'second-value');
}));

test('D5 allow_origins in the agent-writable .troop/config.json no longer silences the new-origin ask; only the UI-only browser.allow_origins setting does', () => withDb(async (db, home) => {
  const { Approvals } = await import('../src/approvals.ts');
  const { buildMethods } = await import('../src/methods.ts');
  const project = `${home}/project`;
  fs.mkdirSync(`${project}/.troop`, { recursive: true });
  fs.writeFileSync(`${project}/.troop/config.json`, JSON.stringify({ allow_origins: ['https://agent.test'] }));
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', project, 'p', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p1', 'e1', 'pty', 'working', ?, ?)").run(at, at);
  const approvals = new Approvals(db, 60_000);
  const check = { session_id: 's1', surface: 'browser', target: 'https://agent.test', action: 'click', args: { ref: 'e1' }, control: { automation_id: 'go', name: 'Go', role: 'button' } };
  const asked = approvals.check(check);
  const row = await new Promise<{ id: string; reason: string }>((res) => { const t = setInterval(() => { const r = db.prepare("SELECT id, reason FROM approval WHERE status = 'waiting'").get(); if (r) { clearInterval(t); res(r as never); } }, 10); });
  assert.equal(row.reason, 'new origin');
  approvals.resolve({ approval_id: row.id, decision: 'reject' });
  assert.equal((await asked).decision, 'rejected');
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' });
  assert.equal(methods.get('settings.set')!.needsUi, true);
  await methods.get('settings.set')!.handler({ key: 'browser.allow_origins', value: ['https://agent.test/'] });
  assert.deepEqual(await approvals.check({ ...check, args: { ref: 'e2' } }), { decision: 'allow' });
}));

test('D16 a hook event that meets a held database lock is spooled, not dropped, and the core moves it into event', () => withDb(async (db, home) => {
  const { runNode } = await import('./helpers.ts');
  const { ingestSpools } = await import('../src/sandbox/spool.ts');
  const { ulid } = await import('../src/time.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const id = ulid();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'p', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'e1', 'pty', 'working', ?, ?)").run(id, at, at);
  const locker = new DatabaseSync(`${home}/troop.db`);
  locker.exec('BEGIN IMMEDIATE');
  let r: { code: number; stderr: string };
  try {
    r = await runNode(['core/src/hook/event.ts', 'claude.Stop', '--session', id], { ...process.env, METATROOPER_HOME: home }, JSON.stringify({ session_id: 'native-1', hook_event_name: 'Stop' })) as never;
  } finally {
    locker.exec('COMMIT');
    locker.close();
  }
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.existsSync(`${home}/logs/event-errors.log`), false, 'nothing was dropped');
  const line = JSON.parse(fs.readFileSync(`${home}/spool/${id}/events.ndjson`, 'utf8').trim());
  assert.equal(line.kind, 'claude.Stop');
  ingestSpools(db);
  const rows = db.prepare("SELECT session_id, json_extract(payload, '$.session_id') AS native FROM event WHERE kind = 'claude.Stop'").all();
  assert.deepEqual(rows.map((x) => ({ ...x })), [{ session_id: id, native: 'native-1' }]);
}));

test('D19 the sweep and session exit delete only files MetaTrooper recorded as its own, never a user file named like a session id', () => withDb(async (db, home) => {
  const { recordSessionFile, removeSessionFiles, sweepSessionFiles } = await import('../src/plugins/mcp.ts');
  const { ulid } = await import('../src/time.ts');
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'p', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
  const [gone, live] = [ulid(), ulid()];
  for (const [id, state] of [[gone, 'exited'], [live, 'working']]) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'e1', 'pty', ?, ?, ?)").run(id, state, at, at);
  const mcp = `${home}/mcp`;
  fs.mkdirSync(mcp, { recursive: true });
  for (const name of [`${gone}.json`, `${gone}.settings.json`, `${live}.json`]) fs.writeFileSync(`${mcp}/${name}`, '{}');
  recordSessionFile(db, gone, `${mcp}/${gone}.json`);
  recordSessionFile(db, live, `${mcp}/${live}.json`);
  // a recorded path outside MetaTrooper's home is never deleted
  const outside = `${home}-outside.txt`;
  fs.writeFileSync(outside, 'keep');
  recordSessionFile(db, gone, outside);
  try {
    sweepSessionFiles(db);
    assert.deepEqual(fs.readdirSync(mcp).sort(), [`${gone}.settings.json`, `${live}.json`].sort(), 'the unrecorded file named like a session survives');
    assert.ok(fs.existsSync(outside));
    removeSessionFiles(db, gone);
    assert.ok(fs.existsSync(`${mcp}/${gone}.settings.json`));
    removeSessionFiles(db, live);
    assert.deepEqual(fs.readdirSync(mcp), [`${gone}.settings.json`]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'session_files:%'").get()!.n, 0);
  } finally { fs.rmSync(outside, { force: true }); }
}));

test('D3 the core and terminal pipes never speak first: a connected client that sends nothing receives nothing, and a line then gets a reply', async () => {
  const { harness, pipePath } = await import('./helpers.ts');
  const net = await import('node:net');
  const h = await harness();
  try {
    for (const [name, line] of [[h.prefix, { jsonrpc: '2.0', id: 'p', method: 'core.ping' }], [`${h.prefix}-term`, { op: 'nonsense' }]] as const) {
      const sock = net.connect(pipePath(name));
      await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
      let got = '';
      sock.on('data', (c) => { got += c; });
      await new Promise((res) => setTimeout(res, 300));
      assert.equal(got, '', `${name} spoke first`);
      sock.write(JSON.stringify(line) + '\n');
      for (let i = 0; i < 100 && !got.includes('\n'); i++) await new Promise((res) => setTimeout(res, 20));
      assert.ok(got.includes('\n'), `${name} answered a line`);
      sock.destroy();
    }
  } finally { await h.teardown(); }
});
