import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, runNode, sleep, startCore, teardownCore, until } from './helpers.ts';

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
