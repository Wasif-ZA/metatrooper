import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

test('D9 a re-save that fails at any file write or rename leaves the old origin and value together, or the new ones together, never a mix', () => withDb(async (db, home) => {
  const { setBrowserSecret } = await import('../src/secrets.ts');
  const { browserSecretOrigin } = await import('../src/browser/secret-origin.ts');
  const dir = `${home}/secrets/core-browser`;
  const real = { write: fs.writeFileSync, rename: fs.renameSync };
  for (let k = 1; ; k++) {
    setBrowserSecret(db, 'PAIR', 'https://a.test', 'first-value');
    let calls = 0;
    const failing = <F extends (...a: never[]) => unknown>(f: F) => ((...a: never[]) => { if (++calls === k) throw new Error(`fault ${k}`); return f(...a); }) as unknown as F;
    fs.writeFileSync = failing(real.write);
    fs.renameSync = failing(real.rename);
    let threw = false;
    try { setBrowserSecret(db, 'PAIR', 'https://b.test', 'second-value'); } catch { threw = true; } finally { Object.assign(fs, { writeFileSync: real.write, renameSync: real.rename }); }
    // a module copy with an empty cache reads the value from disk
    const fresh = await import(`../src/secrets.ts?fault=${k}`);
    const pair = [browserSecretOrigin('PAIR'), fresh.getSecret('core-browser', 'PAIR')];
    assert.deepEqual(pair, threw ? ['https://a.test', 'first-value'] : ['https://b.test', 'second-value'], `fault at call ${k}`);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('PAIR')).sort(), ['PAIR.dpapi', 'PAIR.origin'], `no file left over after a fault at call ${k}`);
    if (!threw) break;
  }
}));

test('D9 Linux keyring: a re-save stores the value under a new entry id; a failed save clears its new entry and keeps the old, and a committed one clears the old', async () => {
  const iso = isolation();
  try {
    const bin = `${iso.home}/bin`;
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(`${bin}/secret-tool`, '');
    const src = (f: string) => JSON.stringify(new URL(`../src/${f}`, import.meta.url).href);
    // secret-tool and the platform are faked, so the Linux path runs on any machine
    const script = `
      import { mock } from 'node:test';
      import fs from 'node:fs';
      import * as cp from 'node:child_process';
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const entries = [];
      const has = (e, attrs) => Object.entries(attrs).every(([k, v]) => e.attrs[k] === v);
      const fake = (cmd, args, opts) => {
        if (cmd !== 'secret-tool') return cp.spawnSync(cmd, args, opts);
        const rest = args.slice(1).filter((a) => !a.startsWith('--label='));
        const attrs = Object.fromEntries(rest.flatMap((a, i) => (i % 2 ? [] : [[a, rest[i + 1]]])));
        if (args[0] === 'store') { const i = entries.findIndex((e) => JSON.stringify(e.attrs) === JSON.stringify(attrs)); if (i >= 0) entries.splice(i, 1); entries.push({ attrs, secret: opts.input }); return { status: 0, stdout: '' }; }
        if (args[0] === 'lookup') { const e = entries.find((x) => has(x, attrs)); return e ? { status: 0, stdout: e.secret } : { status: 1, stdout: '', stderr: 'no entry' }; }
        if (args[0] === 'clear') { for (let i = entries.length - 1; i >= 0; i--) if (has(entries[i], attrs)) entries.splice(i, 1); return { status: 0, stdout: '' }; }
      };
      mock.module('node:child_process', { namedExports: { ...cp, spawnSync: fake } });
      const { openCoreDb } = await import(${src('store/db.ts')});
      const { setBrowserSecret } = await import(${src('secrets.ts')});
      const db = openCoreDb();
      setBrowserSecret(db, 'KR', 'https://a.test', 'first-value');
      const write = fs.writeFileSync;
      fs.writeFileSync = (f, ...a) => { if (String(f).endsWith('.tmp')) throw new Error('disk full'); return write(f, ...a); };
      try { setBrowserSecret(db, 'KR', 'https://b.test', 'second-value'); } catch {}
      fs.writeFileSync = write;
      const afterFail = [entries.length, (await import(${src('secrets.ts')} + '?1')).getSecret('core-browser', 'KR')];
      setBrowserSecret(db, 'KR', 'https://b.test', 'second-value');
      const afterSave = [entries.length, (await import(${src('secrets.ts')} + '?2')).getSecret('core-browser', 'KR')];
      db.close();
      console.log(JSON.stringify({ afterFail, afterSave }));
    `;
    const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', '--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...iso.env, PATH: bin, Path: bin, METATROOPER_FAKE_DPAPI: '' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { afterFail: [1, 'first-value'], afterSave: [1, 'second-value'] });
  } finally {
    rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

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

test('D16 an older Stop spooled behind a held lock does not undo a newer UserPromptSubmit stored directly: the session stays working', () => withDb(async (db, home) => {
  const { runNode } = await import('./helpers.ts');
  const { ingestSpools } = await import('../src/sandbox/spool.ts');
  const { processEvents } = await import('../src/events/processor.ts');
  const { ulid } = await import('../src/time.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const id = ulid();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'p', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'e1', 'pty', 'working', ?, ?)").run(id, at, at);
  const hook = (kind: string) => runNode(['core/src/hook/event.ts', `claude.${kind}`, '--session', id], { ...process.env, METATROOPER_HOME: home }, JSON.stringify({ session_id: 'native-1', hook_event_name: kind, prompt: 'next' })) as Promise<{ code: number; stderr: string }>;
  const locker = new DatabaseSync(`${home}/troop.db`);
  locker.exec('BEGIN IMMEDIATE');
  try { assert.equal((await hook('Stop')).code, 0); } finally { locker.exec('COMMIT'); locker.close(); }
  assert.equal((await hook('UserPromptSubmit')).code, 0);
  // the core applies the direct event first, as when it lands between two spool passes
  processEvents(db);
  ingestSpools(db);
  processEvents(db);
  const rows = db.prepare("SELECT kind FROM event WHERE session_id = ? AND kind LIKE 'claude.%' ORDER BY julianday(at)").all(id).map((r) => r.kind);
  assert.deepEqual(rows, ['claude.Stop', 'claude.UserPromptSubmit'], 'the spooled Stop keeps the time it happened');
  assert.equal((db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string }).state, 'working');
}));

test('D16 an oversized spool of an exited session is still deleted, after the too-large notice', () => withDb(async (db, home) => {
  const { ingestSpools } = await import('../src/sandbox/spool.ts');
  const { ulid } = await import('../src/time.ts');
  const id = ulid();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'p', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'e1', 'pty', 'exited', ?, ?)").run(id, at, at);
  fs.mkdirSync(`${home}/spool/${id}`, { recursive: true });
  fs.writeFileSync(`${home}/spool/${id}/events.ndjson`, Buffer.alloc(10 * 1024 * 1024 + 1, 10));
  ingestSpools(db);
  assert.equal(fs.existsSync(`${home}/spool/${id}`), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM needs_you WHERE kind = 'spool-too-large' AND ref = ?").get(id)!.n, 1);
}));

test('D19 a writer refuses a destination it does not own and records nothing; deletion never follows a junction or symlink out of the home', () => withDb(async (db, home) => {
  const { mcpAttachArgs, removeSessionFiles } = await import('../src/plugins/mcp.ts');
  const { sessionHookEnv } = await import('../src/hooks/install.ts');
  const { BUILT_IN } = await import('../src/engines/registry.ts');
  const { ulid } = await import('../src/time.ts');
  const claude = BUILT_IN.find((e) => e.id === 'claude')!;
  const gemini = { id: 'gem', hooks: { kind: 'gemini-system-settings', events: ['AfterAgent'] } } as never;
  const records = () => db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'session_files:%'").get()!.n;
  const [taken, moved] = [ulid(), ulid()];
  fs.mkdirSync(`${home}/mcp`, { recursive: true });
  fs.writeFileSync(`${home}/mcp/${taken}.json`, 'mine');
  assert.throws(() => mcpAttachArgs(db, claude, taken, true), /already exists and Ouros did not write it/);
  assert.equal(fs.readFileSync(`${home}/mcp/${taken}.json`, 'utf8'), 'mine');
  assert.equal(records(), 0, 'nothing recorded for a file it did not write');
  // a recorded file whose folder is later swapped for a junction to a folder outside the home
  sessionHookEnv(gemini, moved, db);
  const outside = `${home}-outside`;
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(`${outside}/${moved}.json`, 'keep');
  try {
    fs.renameSync(`${home}/engines/gemini`, `${home}/engines/gemini-real`);
    fs.symlinkSync(outside, `${home}/engines/gemini`, 'junction');
    assert.throws(() => sessionHookEnv(gemini, ulid(), db), /not inside Ouros's home/);
    removeSessionFiles(db, moved);
    assert.equal(fs.readFileSync(`${outside}/${moved}.json`, 'utf8'), 'keep');
    assert.equal(records(), 0);
  } finally {
    fs.rmSync(`${home}/engines/gemini`, { force: true, recursive: false });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}));

test('D5 an agent connection (no ui.hello) cannot set browser.allow_origins over the core pipe', async () => {
  const { harness, client } = await import('./helpers.ts');
  const h = await harness();
  try {
    const agent = await client(h.prefix);
    const reply = await agent.request('settings.set', { key: 'browser.allow_origins', value: ['https://agent.test'] });
    agent.socket.destroy();
    assert.equal(reply.error?.code, -32012);
    assert.equal(fs.existsSync(`${h.home}/settings.json`), false);
  } finally { await h.teardown(); }
});

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


test('D4 a missing enumerated secret fails closed and cache removals retain values for later scrubbing', () => withDb(async (db) => {
  const store = await import('../src/secrets.ts?missing-review');
  store.setBrowserSecret(db, 'MISSING_REVIEW', 'https://bank.test', 'orchidriver');
  assert.ok(store.scrubSecretValues().includes('orchidriver'));
  const file = store.secretPath('core-browser', 'MISSING_REVIEW');
  const stat = fs.statSync;
  fs.statSync = ((p: fs.PathLike, ...args: never[]) => String(p) === file ? undefined : (stat as (...a: unknown[]) => unknown)(p, ...args)) as typeof fs.statSync;
  try {
    assert.equal(store.getSecret('core-browser', 'MISSING_REVIEW'), null);
    assert.ok(store.knownSecretValues().includes('orchidriver'));
    assert.throws(() => store.scrubSecretValues(), /secret.*unavailable/i);
  } finally { fs.statSync = stat; }
  assert.ok(store.scrubSecretValues().includes('orchidriver'));
  store.deleteSecret('core-browser', 'MISSING_REVIEW');
  assert.ok(store.knownSecretValues().includes('orchidriver'));
  store.setBrowserSecret(db, 'MISSING_REVIEW', 'https://bank.test', 'willowbrook');
  store.deleteSecrets(db, 'core-browser');
  assert.ok(store.knownSecretValues().includes('willowbrook'));
}));
