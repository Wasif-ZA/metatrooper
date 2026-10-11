import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, runNode, scriptedGh, sleep, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

function store(home: string) {
  const db = new DatabaseSync(join(home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 2000');
  return db;
}

function gitRepo(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@x.example');
  git('config', 'user.name', 'T');
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
}

async function ownersHarness() {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }, {
    id: 'claude', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 2, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  const sleeper = join(isolated.home, 'sleeper.js');
  writeFileSync(sleeper, 'setTimeout(() => {}, 600000);\n');
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const repo = join(isolated.home, 'repo');
  gitRepo(repo, { 'a.txt': 'one\n', 'x.ts': 'let x = 1;\n' });
  const pipe = await client(isolated.prefix);
  const opened = await pipe.request('project.open', { path: repo });
  pipe.close();
  const projectId = opened.result.project_id;
  const db = store(isolated.home);
  return {
    ...isolated, env, repo, projectId, db, sleeper,
    async launch(extra: Record<string, unknown> = {}) {
      const p = await client(isolated.prefix);
      try {
        const r = await p.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: sleeper, ...extra });
        assert.ok(r.result?.session_id, JSON.stringify(r));
        return r.result.session_id as string;
      } finally { p.close(); }
    },
    hook(kind: string, body: Record<string, unknown>, sessionId?: string) {
      const e = { ...env };
      if (sessionId) e.TROOP_SESSION_ID = sessionId; else delete e.TROOP_SESSION_ID;
      return runNode(['core/event.js', `claude.${kind}`], e, JSON.stringify({ cwd: repo, ...body }));
    },
    async turnStart(id: string, native: string) {
      const before = (db.prepare('SELECT turn_base FROM session WHERE id = ?').get(id) as { turn_base: string | null } | undefined)?.turn_base ?? null;
      db.prepare('UPDATE session SET turn_base = NULL WHERE id = ?').run(id);
      await this.hook('UserPromptSubmit', { session_id: native, prompt: 'go' }, id);
      await until(() => (db.prepare('SELECT state, turn_base FROM session WHERE id = ?').get(id) as { state: string; turn_base: string | null }).turn_base !== null, 3000);
      return before;
    },
    claims(id: string) {
      return (db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = ? ORDER BY seq").all(id) as Array<{ payload: string }>).map((r) => JSON.parse(r.payload));
    },
    async owners(path?: string) {
      const r = await runNode(['core/cli.ts', 'owners', ...(path ? [path] : []), '--project', repo, '--json'], env);
      assert.equal(r.code, 0, r.stderr);
      return JSON.parse(r.stdout) as Array<{ path: string; owners: Array<{ id: string; title: string; state: string }>; shared: boolean; unclaimed: boolean }>;
    },
    async teardown() {
      db.close();
      await teardownCore(core, isolated);
    },
  };
}

test('M4-26 and M4-32: a file changed only through the shell is claimed at Stop; an untracked file from before the turn is not, one made in it is', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    writeFileSync(join(h.repo, 'before.txt'), 'old\n');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(h.repo, 'before.txt'), past, past);
    await h.turnStart(a, 'native-a');
    await sleep(20);
    execFileSync('sed', ['-i', 's/one/one and two/', 'a.txt'], { cwd: h.repo });
    writeFileSync(join(h.repo, 'made.txt'), 'new\n');
    await h.hook('Stop', { session_id: 'native-a', stop_hook_active: false }, a);
    await until(() => h.claims(a).length === 1, 10000);
    assert.deepEqual(h.claims(a)[0].files.map((f: { path: string }) => f.path), ['a.txt', 'made.txt']);
    const rows = await h.owners();
    const by = Object.fromEntries(rows.map((r) => [r.path, r]));
    assert.deepEqual(by['a.txt'].owners.map((o) => o.id), [a]);
    assert.deepEqual(by['made.txt'].owners.map((o) => o.id), [a]);
    assert.equal(by['before.txt'].unclaimed, true);
    assert.deepEqual((await h.owners('a.txt')).map((r) => r.path), ['a.txt']);
    execFileSync('git', ['commit', '-qam', 'take a'], { cwd: h.repo });
    assert.equal((await h.owners()).some((r) => r.path === 'a.txt'), false);
  } finally { await h.teardown(); }
});

test('M4-28: an Edit on a file a working session owns prints a warning naming it, an unclaimed file prints nothing, inside the hook budget', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    const b = await h.launch();
    await h.turnStart(a, 'native-a');
    await sleep(20);
    writeFileSync(join(h.repo, 'a.txt'), 'changed by a\n');
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    await h.turnStart(a, 'native-a');
    const insert = h.db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', NULL, 'core.filler', '{}', 1)");
    h.db.exec('BEGIN');
    for (let i = 0; i < 10_000; i++) insert.run(new Date().toISOString());
    h.db.exec('COMMIT');
    const warned = await h.hook('PreToolUse', { session_id: 'native-b', tool_name: 'Edit', tool_input: { file_path: join(h.repo, 'a.txt') } }, b);
    assert.equal(warned.code, 0);
    const out = JSON.parse(warned.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, new RegExp(`a\\.txt has uncommitted changes from session .*\\(${a.slice(0, 8)}\\), state working\\. Edit only your own lines`));
    assert.ok(warned.ms < 240, `hook took ${Math.round(warned.ms)} ms`);
    const quiet = await h.hook('PreToolUse', { session_id: 'native-b', tool_name: 'Edit', tool_input: { file_path: join(h.repo, 'x.ts') } }, b);
    assert.equal(quiet.stdout, '');
    const own = await h.hook('PreToolUse', { session_id: 'native-a', tool_name: 'Edit', tool_input: { file_path: join(h.repo, 'a.txt') } }, a);
    assert.equal(own.stdout, '');
  } finally { await h.teardown(); }
});

test('M4-29: two sessions change one file in overlapping turns with no hint: shared, and each gets exactly one notice', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    const b = await h.launch();
    await h.turnStart(a, 'native-a');
    await h.turnStart(b, 'native-b');
    await sleep(20);
    writeFileSync(join(h.repo, 'x.ts'), 'let x = 22;\n');
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    await h.hook('Stop', { session_id: 'native-b' }, b);
    await until(() => h.claims(b).length === 1, 10000);
    const x = (await h.owners()).find((r) => r.path === 'x.ts')!;
    assert.equal(x.shared, true);
    assert.deepEqual(x.owners.map((o) => o.id).sort(), [a, b].sort());
    for (const [id, native, other] of [[a, 'native-a', b], [b, 'native-b', a]]) {
      const first = await h.hook('UserPromptSubmit', { session_id: native, prompt: 'next' }, id);
      const ctx = JSON.parse(first.stdout).hookSpecificOutput.additionalContext as string;
      assert.match(ctx, /^Notices from MetaTrooper:/);
      assert.equal(ctx.match(/\[notice /g)!.length, 1);
      assert.match(ctx, new RegExp(`Also changed by session .*\\(${other.slice(0, 8)}\\), uncommitted: x\\.ts`));
      const again = await h.hook('UserPromptSubmit', { session_id: native, prompt: 'again' }, id);
      assert.equal(again.stdout, '');
    }
  } finally { await h.teardown(); }
});

test('M4-29: a Read hint gives an overlapping file to the session that named it, not shared', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    const b = await h.launch();
    await h.turnStart(a, 'native-a');
    await h.turnStart(b, 'native-b');
    await sleep(20);
    await h.hook('PostToolUse', { session_id: 'native-b', tool_name: 'Write', tool_input: { file_path: join(h.repo, 'x.ts') } }, b);
    writeFileSync(join(h.repo, 'x.ts'), 'let x = 333;\n');
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    assert.deepEqual(h.claims(a)[0].files, []);
    await h.hook('Stop', { session_id: 'native-b' }, b);
    await until(() => h.claims(b).length === 1, 10000);
    const x = (await h.owners()).find((r) => r.path === 'x.ts')!;
    assert.equal(x.shared, false);
    assert.deepEqual(x.owners.map((o) => o.id), [b]);
  } finally { await h.teardown(); }
});

test('M4-27: a Claude session with no TROOP_SESSION_ID in a registered project is adopted as external and its edits are claimed; one outside every project leaves no trace', async () => {
  const h = await ownersHarness();
  try {
    const t0 = Date.now();
    await h.hook('UserPromptSubmit', { session_id: 'outside-1', prompt: 'hi' });
    await until(() => h.db.prepare("SELECT 1 FROM session WHERE native_id = 'outside-1' AND host = 'external'").get(), 2000);
    assert.ok(Date.now() - t0 < 2000);
    const id = (h.db.prepare("SELECT id FROM session WHERE native_id = 'outside-1'").get() as { id: string }).id;
    const listed = await runNode(['core/cli.ts', 'sessions', '--json'], h.env);
    assert.equal(JSON.parse(listed.stdout).find((s: { id: string }) => s.id === id).host, 'external');
    await until(() => (h.db.prepare('SELECT turn_base FROM session WHERE id = ?').get(id) as { turn_base: string | null }).turn_base !== null, 3000);
    await sleep(20);
    writeFileSync(join(h.repo, 'a.txt'), 'outside edit\n');
    await h.hook('Stop', { session_id: 'outside-1' });
    await until(() => h.claims(id).length === 1, 3000);
    assert.deepEqual((await h.owners('a.txt'))[0].owners.map((o) => o.id), [id]);
    await sleep(5500);
    assert.notEqual((h.db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string }).state, 'exited');
    await h.hook('SessionEnd', { session_id: 'outside-1', reason: 'exit' });
    await until(() => (h.db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string }).state === 'exited', 3000);
    await h.hook('UserPromptSubmit', { session_id: 'outside-1', prompt: 'resumed' });
    await until(() => h.db.prepare("SELECT 1 FROM session WHERE native_id = 'outside-1' AND host = 'external' AND state != 'exited'").get(), 2000);
    assert.equal((h.db.prepare("SELECT count(*) AS n FROM session WHERE native_id = 'outside-1'").get() as { n: number }).n, 2);
    const elsewhere = join(h.home, 'elsewhere');
    mkdirSync(elsewhere);
    const e = { ...h.env };
    delete e.TROOP_SESSION_ID;
    await runNode(['core/event.js', 'claude.UserPromptSubmit'], e, JSON.stringify({ session_id: 'outside-2', cwd: elsewhere, prompt: 'x' }));
    await sleep(300);
    assert.equal(h.db.prepare("SELECT 1 FROM event WHERE json_extract(payload, '$.session_id') = 'outside-2'").get(), undefined);
    assert.equal(h.db.prepare("SELECT 1 FROM session WHERE native_id = 'outside-2'").get(), undefined);
  } finally { await h.teardown(); }
});

test('M4-30 core half and M4-31: an exiting child leaves a Needs you row for its uncommitted files and hands back exactly one notice to its parent', async () => {
  const h = await ownersHarness();
  try {
    const p = await h.launch();
    const launched = await runNode(['core/cli.ts', 'launch', 'fake', '--project', h.repo, '--prompt', h.sleeper, '--json'], { ...h.env, TROOP_SESSION_ID: p });
    assert.equal(launched.code, 0, launched.stderr);
    const c = JSON.parse(launched.stdout).session_id as string;
    assert.equal((h.db.prepare('SELECT parent_id FROM session WHERE id = ?').get(c) as { parent_id: string }).parent_id, p);
    await h.turnStart(c, 'native-c');
    await sleep(20);
    writeFileSync(join(h.repo, 'a.txt'), 'child edit\n');
    writeFileSync(join(h.repo, 'child-new.txt'), 'new\n');
    await h.hook('Stop', { session_id: 'native-c' }, c);
    await until(() => h.claims(c).length === 1, 3000);
    await until(() => (h.db.prepare('SELECT pid FROM session WHERE id = ?').get(c) as { pid: number | null }).pid !== null, 3000);
    const pid = (h.db.prepare('SELECT pid FROM session WHERE id = ?').get(c) as { pid: number }).pid;
    process.kill(pid, 'SIGKILL');
    await until(() => (h.db.prepare('SELECT state FROM session WHERE id = ?').get(c) as { state: string }).state === 'exited', 8000);
    await until(() => h.db.prepare("SELECT 1 FROM comment WHERE session_id = ? AND kind = 'notice'").get(p), 3000);
    const row = h.db.prepare("SELECT text FROM needs_you WHERE kind = 'uncommitted' AND ref = ? AND resolved_at IS NULL").get(c) as { text: string };
    assert.match(row.text, new RegExp(`\\(${c.slice(0, 8)}\\) left 2 files uncommitted$`));
    const first = await h.hook('UserPromptSubmit', { session_id: 'native-p', prompt: 'next' }, p);
    const ctx = JSON.parse(first.stdout).hookSpecificOutput.additionalContext as string;
    assert.equal(ctx.match(/\[notice /g)!.length, 1);
    assert.match(ctx, new RegExp(`Session .*\\(${c.slice(0, 8)}\\), launched from this session, has ended\\.`));
    assert.match(ctx, /Files: a\.txt \(uncommitted\), child-new\.txt \(uncommitted\)\./);
    const second = await h.hook('UserPromptSubmit', { session_id: 'native-p', prompt: 'again' }, p);
    assert.equal(second.stdout, '');
    execFileSync('git', ['add', '-A'], { cwd: h.repo });
    execFileSync('git', ['commit', '-qm', 'child work'], { cwd: h.repo });
    await until(() => !h.db.prepare("SELECT 1 FROM needs_you WHERE kind = 'uncommitted' AND ref = ? AND resolved_at IS NULL").get(c), 12_000);
  } finally { await h.teardown(); }
});

test('a file the session committed during its turn is not claimed, so later edits by someone else stay unclaimed', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    await h.turnStart(a, 'native-a');
    await sleep(20);
    writeFileSync(join(h.repo, 'a.txt'), 'committed by a\n');
    writeFileSync(join(h.repo, 'x.ts'), 'let x = 4444;\n');
    execFileSync('git', ['commit', '-qm', 'a commits a.txt', '--', 'a.txt'], { cwd: h.repo });
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    assert.deepEqual(h.claims(a)[0].files.map((f: { path: string }) => f.path), ['x.ts']);
    writeFileSync(join(h.repo, 'a.txt'), 'a person edits it later\n');
    const rows = await h.owners();
    assert.equal(rows.find((r) => r.path === 'a.txt')!.unclaimed, true);
    assert.deepEqual(rows.find((r) => r.path === 'x.ts')!.owners.map((o) => o.id), [a]);
  } finally { await h.teardown(); }
});

test('a Read is not an ownership hint: one session reading while the other edits through the shell leaves the file shared', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    const b = await h.launch();
    await h.turnStart(a, 'native-a');
    await h.turnStart(b, 'native-b');
    await sleep(20);
    await h.hook('PostToolUse', { session_id: 'native-b', tool_name: 'Read', tool_input: { file_path: join(h.repo, 'x.ts') } }, b);
    writeFileSync(join(h.repo, 'x.ts'), 'let x = 55555;\n');
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    assert.deepEqual(h.claims(a)[0].files.map((f: { path: string; shared: boolean }) => [f.path, f.shared]), [['x.ts', true]]);
  } finally { await h.teardown(); }
});

test('claims from other repositories never push a still-dirty file out of the owners lookup or the edit warning', async () => {
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    const b = await h.launch();
    await h.turnStart(a, 'native-a');
    await sleep(20);
    writeFileSync(join(h.repo, 'a.txt'), 'owned by a\n');
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    const other = JSON.stringify({ repo: join(h.home, 'elsewhere'), turn_base: null, from: new Date().toISOString(), at: new Date().toISOString(), files: [{ path: 'a.txt', owners: [b], shared: false }] });
    const insert = h.db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)");
    h.db.exec('BEGIN');
    for (let i = 0; i < 2100; i++) insert.run(new Date().toISOString(), b, other);
    h.db.exec('COMMIT');
    assert.deepEqual((await h.owners('a.txt'))[0].owners.map((o) => o.id), [a]);
    await h.turnStart(a, 'native-a');
    const warned = await h.hook('PreToolUse', { session_id: 'native-b', tool_name: 'Edit', tool_input: { file_path: join(h.repo, 'a.txt') } }, b);
    assert.match(JSON.parse(warned.stdout).hookSpecificOutput.additionalContext, new RegExp(`\\(${a.slice(0, 8)}\\)`));
    assert.ok(warned.ms < 240, `hook took ${Math.round(warned.ms)} ms`);
  } finally { await h.teardown(); }
});

test('batched commit times match one git log per file, including a file last changed by a conflict-resolving merge', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { commitTimes } = await import('../src/sessions/owners.ts');
  const dir = mkdtempSync(join(tmpdir(), 'troop-ctimes-'));
  try {
    gitRepo(dir, { 'a.txt': 'base\n', 'b.txt': 'base\n' });
    const t0 = Math.floor(Date.now() / 1000) - 3600;
    const at = (s: number) => ({ ...process.env, GIT_AUTHOR_DATE: `${t0 + s} +0000`, GIT_COMMITTER_DATE: `${t0 + s} +0000` });
    const git = (s: number, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: at(s) });
    git(10, 'checkout', '-q', '-b', 'side');
    writeFileSync(join(dir, 'a.txt'), 'side\n');
    git(10, 'commit', '-qam', 'side');
    git(20, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'main\n');
    writeFileSync(join(dir, 'b.txt'), 'main\n');
    git(20, 'commit', '-qam', 'main');
    try { git(30, 'merge', '-q', 'side'); } catch {}
    writeFileSync(join(dir, 'a.txt'), 'resolved\n');
    git(30, 'commit', '-qam', 'merge');
    const files = ['a.txt', 'b.txt'];
    const single = Object.fromEntries(files.map((f) => [f, Number(execFileSync('git', ['log', '-1', '--format=%ct', '--', f], { cwd: dir, encoding: 'utf8' }).trim()) * 1000]));
    assert.equal(single['a.txt'], (t0 + 30) * 1000);
    const batch = commitTimes(dir, files);
    assert.deepEqual(Object.fromEntries(files.map((f) => [f, batch.get(f)])), single);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveUncommitted runs git off the event loop: it returns first, then resolves only the row whose session owns nothing', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'troop-resolve-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { resolveUncommitted } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  try {
    const repo = join(home, 'repo');
    gitRepo(repo, { 'a.txt': 'one\n', 'b.txt': 'one\n' });
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).trim();
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(repo);
    for (const id of ['owner', 'idle']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at) VALUES (?, 'p', 'claude', 'pty', ?, 'idle', 'x', 'x')").run(id, repo);
    const at = new Date(Date.now() + 60_000).toISOString();
    db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 'owner', 'core.claim', ?, 1)").run(at, JSON.stringify({ repo: top, turn_base: null, from: at, at, files: [{ path: 'a.txt', owners: ['owner'], shared: false }] }));
    for (const id of ['owner', 'idle']) db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, 'x', 'uncommitted', ?, 't')").run(`n-${id}`, id);
    const open = () => (db.prepare("SELECT ref FROM needs_you WHERE kind = 'uncommitted' AND resolved_at IS NULL ORDER BY ref").all() as Array<{ ref: string }>).map((r) => r.ref);
    const pass = resolveUncommitted(db);
    assert.deepEqual(open(), ['idle', 'owner']);
    await pass;
    assert.deepEqual(open(), ['owner']);
  } finally {
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
});

test('markTurnBase never takes the index lock and records the same tree a plain stash create would', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'troop-turnbase-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { markTurnBase } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  try {
    const repo = join(home, 'repo');
    gitRepo(repo, { 'a.txt': 'one\n' });
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const expectedTree = git('rev-parse', `${git('stash', 'create')}^{tree}`);
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(repo);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at) VALUES ('s', 'p', 'claude', 'pty', ?, 'working', 'x', 'x')").run(repo);
    const lock = join(repo, '.git', 'index.lock');
    writeFileSync(lock, '');
    await markTurnBase(db, 's');
    assert.ok(existsSync(lock));
    rmSync(lock);
    const base = (db.prepare("SELECT turn_base FROM session WHERE id = 's'").get() as { turn_base: string | null }).turn_base;
    assert.ok(base);
    assert.equal(git('rev-parse', `${base}^{tree}`), expectedTree);
  } finally {
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
});

test('a HEAD commit with an older committer date does not hide a newer commit of a claimed path', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { commitTimes } = await import('../src/sessions/owners.ts');
  const dir = mkdtempSync(join(tmpdir(), 'troop-skew-'));
  try {
    gitRepo(dir, { 'x.txt': '0\n', 'z.txt': '0\n' });
    const t0 = Math.floor(Date.now() / 1000) - 7200;
    const git = (s: number, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: `${t0 + s} +0000`, GIT_COMMITTER_DATE: `${t0 + s} +0000` } });
    writeFileSync(join(dir, 'x.txt'), 'after claim\n');
    git(40, 'commit', '-qam', 'x after claim');
    writeFileSync(join(dir, 'z.txt'), 'skewed\n');
    git(1, 'commit', '-qam', 'skewed head');
    const claimAt = (t0 + 30) * 1000;
    assert.equal(commitTimes(dir, ['x.txt']).get('x.txt'), (t0 + 40) * 1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commit times survive claimed paths whose names together exceed the Windows command line', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { commitTimes } = await import('../src/sessions/owners.ts');
  const dir = mkdtempSync(join(tmpdir(), 'troop-long-'));
  try {
    const names = Array.from({ length: 200 }, (_, i) => `${String(i).padStart(3, '0')}-${'n'.repeat(160)}.txt`);
    gitRepo(dir, Object.fromEntries(names.map((n) => [n, 'x\n'])));
    assert.ok(names.join(' ').length > 32_767);
    const head = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: dir, encoding: 'utf8' }).trim()) * 1000;
    const times = commitTimes(dir, names);
    assert.equal(times.size, names.length);
    assert.ok([...times.values()].every((t) => t === head));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a claim that lands during a resolve pass keeps its session row open until the next pass', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'troop-resolve-race-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { resolveUncommitted } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  try {
    const repo = join(home, 'repo');
    gitRepo(repo, { 'a.txt': 'one\n' });
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).trim();
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(repo);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at) VALUES ('s', 'p', 'claude', 'pty', ?, 'idle', 'x', 'x')").run(repo);
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES ('n-s', 'x', 'uncommitted', 's', 't')").run();
    const at = new Date(Date.now() + 60_000).toISOString();
    let injected = false;
    const seam = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          if (!injected && sql === 'SELECT state FROM session WHERE id = ?') {
            injected = true;
            target.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 's', 'core.claim', ?, 1)").run(at, JSON.stringify({ repo: top, turn_base: null, from: at, at, files: [{ path: 'a.txt', owners: ['s'], shared: false }] }));
          }
          return target.prepare(sql);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await resolveUncommitted(seam);
    assert.ok(injected);
    const open = () => db.prepare("SELECT resolved_at FROM needs_you WHERE id = 'n-s'").get() as { resolved_at: string | null };
    assert.equal(open().resolved_at, null);
    await resolveUncommitted(db);
    assert.equal(open().resolved_at, null);
  } finally {
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
});

test('a turn end and the next turn start in one batch: each claim records its own turn base', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'troop-turnorder-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { processEvents, turnJobsIdle } = await import('../src/events/processor.ts');
  const { appendEvent } = await import('../src/events/append.ts');
  const db = openCoreDb();
  try {
    const repo = join(home, 'repo');
    gitRepo(repo, { 'a.txt': 'one\n' });
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(repo);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at) VALUES ('s', 'p', 'claude', 'pty', ?, 'idle', 'x', 'x')").run(repo);
    const ev = (kind: string) => appendEvent(kind, 's', { session_id: 'native-s', cwd: repo }, db);
    const base = () => (db.prepare("SELECT turn_base FROM session WHERE id = 's'").get() as { turn_base: string | null }).turn_base;
    writeFileSync(join(repo, 'a.txt'), 'turn one\n');
    ev('claude.UserPromptSubmit');
    processEvents(db);
    await turnJobsIdle();
    const first = base();
    writeFileSync(join(repo, 'a.txt'), 'turn two\n');
    ev('claude.Stop');
    ev('claude.UserPromptSubmit');
    processEvents(db);
    await turnJobsIdle();
    const second = base();
    ev('claude.Stop');
    processEvents(db);
    await turnJobsIdle();
    assert.ok(first && second && first !== second);
    const claims = (db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = 's' ORDER BY seq").all() as Array<{ payload: string }>).map((r) => JSON.parse(r.payload).turn_base);
    assert.deepEqual(claims, [first, second]);
  } finally {
    await turnJobsIdle();
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
});

test('a claim another session writes while a turn is being claimed is either seen or written after it', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'troop-claimrace-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { claimTurn } = await import('../src/sessions/owners.ts');
  const db = openCoreDb();
  try {
    const repo = join(home, 'repo');
    gitRepo(repo, { 'f.txt': 'one\n' });
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    writeFileSync(join(repo, 'f.txt'), 'two\n');
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(repo);
    for (const id of ['A', 'B', 'C']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at, turn_base) VALUES (?, 'p', 'claude', 'pty', ?, 'idle', 'x', 'x', ?)").run(id, repo, head);
    const claim = (id: string, at: string) => db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)").run(at, id, JSON.stringify({ repo: top, turn_base: head, from: at, at, files: [{ path: 'f.txt', owners: [id], shared: false }] }));
    const t = Date.now() + 60_000;
    claim('A', new Date(t).toISOString());
    const start = db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', 'B', 'claude.UserPromptSubmit', '{}', 1)").run(new Date(t + 1000).toISOString());
    const stop = db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', 'B', 'claude.Stop', '{}', 1)").run(new Date(t + 2000).toISOString());
    assert.ok(start.lastInsertRowid);
    let scheduled = false;
    const seam = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          if (!scheduled && sql.startsWith("SELECT seq, session_id, payload FROM event WHERE kind = 'core.claim'")) {
            scheduled = true;
            setImmediate(() => claim('C', new Date(t + 3000).toISOString()));
          }
          return target.prepare(sql);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await claimTurn(seam, 'B', Number(stop.lastInsertRowid));
    await new Promise((r) => setImmediate(r));
    const rows = db.prepare("SELECT seq, session_id, payload FROM event WHERE kind = 'core.claim' ORDER BY seq").all() as Array<{ seq: number; session_id: string; payload: string }>;
    const b = rows.find((r) => r.session_id === 'B')!;
    const c = rows.find((r) => r.session_id === 'C')!;
    assert.ok(b && c);
    const bOwners = JSON.parse(b.payload).files[0].owners as string[];
    if (c.seq < b.seq) assert.ok(bOwners.includes('C'), `B claimed after C but owners are ${bOwners}`);
    else assert.deepEqual(bOwners.sort(), ['A', 'B']);
  } finally {
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
});

test('an Edit on a file another session owns still warns when git does not answer in time', async () => {
  const { copyFileSync, mkdirSync: mk } = await import('node:fs');
  const { delimiter } = await import('node:path');
  const h = await ownersHarness();
  try {
    const a = await h.launch();
    const b = await h.launch();
    await h.turnStart(a, 'native-a');
    await sleep(20);
    writeFileSync(join(h.repo, 'a.txt'), 'changed by a\n');
    await h.hook('Stop', { session_id: 'native-a' }, a);
    await until(() => h.claims(a).length === 1, 10000);
    await h.turnStart(a, 'native-a');
    const bin = join(h.home, 'slow-git');
    mk(bin, { recursive: true });
    scriptedGh(bin, 'setTimeout(() => {}, 1500);\n');
    if (process.platform === 'win32') { copyFileSync(join(bin, 'gh.exe'), join(bin, 'git.exe')); copyFileSync(join(bin, 'gh.mjs'), join(bin, 'git.mjs')); }
    else { copyFileSync(join(bin, 'gh'), join(bin, 'git')); copyFileSync(join(bin, 'gh.mjs'), join(bin, 'git.mjs')); writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec node '${join(bin, 'git.mjs')}' "$@"\n`, { mode: 0o755 }); }
    const pathKey = Object.keys(h.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...h.env, TROOP_SESSION_ID: b, [pathKey]: `${bin}${delimiter}${h.env[pathKey] ?? ''}` };
    const warned = await runNode(['core/event.js', 'claude.PreToolUse'], env, JSON.stringify({ cwd: h.repo, session_id: 'native-b', tool_name: 'Edit', tool_input: { file_path: join(h.repo, 'a.txt') } })) as { code: number; stdout: string };
    assert.equal(warned.code, 0);
    const text: string = JSON.parse(warned.stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.includes('a.txt may have uncommitted changes (git did not answer in time to confirm) from session '), text);
    assert.ok(text.includes(`(${a.slice(0, 8)}), state working`), text);
    await sleep(1600);
  } finally { await h.teardown(); }
});
