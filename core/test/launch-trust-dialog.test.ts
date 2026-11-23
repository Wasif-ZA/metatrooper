import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { isolation, pipePath, root, runNode } from './helpers.ts';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines, type EngineSpec } from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents } from '../src/events/processor.ts';
import { nextState } from '../src/events/state.ts';
import { checkTrustDialog } from '../src/sessions/trust-dialog.ts';
import { dropSecret, issueSecret } from '../src/sessions/secret.ts';
import { buildMethods } from '../src/methods.ts';
import { E, RpcError } from '../src/pipe/errors.ts';
import { canonicalPath } from '../src/project.ts';

const dialog = async () => ['Do you trust the files in this folder?', 'Yes, I trust this folder'];

async function fixture(engine = 'claude') {
  const iso = isolation();
  const trustedFile = join(iso.home, 'trusted.json');
  writeFileSync(trustedFile, JSON.stringify({ trusted: [] }));
  // Every trust destination is absolute and inside this fixture, including project.open's registry.
  const engines: EngineSpec[] = BUILT_IN.map((e) => ({ ...e,
    trust: { kind: 'json-list', file: trustedFile, at: ['trusted'], path_style: 'posix' },
  }));
  const enginesFile = join(iso.home, 'engines.json');
  writeFileSync(enginesFile, JSON.stringify(engines));
  const vars = {
    HOME: iso.home, USERPROFILE: iso.home, METATROOPER_HOME: iso.home,
    METATROOPER_ENGINES: enginesFile, METATROOPER_FAKE_DPAPI: '1',
    METATROOPER_CLAUDE_SETTINGS: join(iso.home, 'claude-settings.json'),
    METATROOPER_CODEX_CONFIG: join(iso.home, 'codex-config.toml'),
  };
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const db = openCoreDb();
  const id = randomUUID();
  syncEngines(db, engines);
  const at = '2026-11-23T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
    .run('p', iso.home, 'trust fixture', at, at);
  db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at)
    VALUES (?, 'p', ?, 'pty', 'starting', ?, ?)`).run(id, engine, at, at);
  const row = () => ({ ...db.prepare('SELECT state, wait_reason FROM session WHERE id = ?').get(id) });
  const count = (kind: string) => Number(db.prepare('SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = ?').get(id, kind)!.n);
  const send = (kind: string, payload: Record<string, unknown> = {}) => {
    appendEvent(kind, id, payload, db);
    processEvents(db);
  };
  send('launch');
  return { ...iso, db, id, engines, trustedFile, row, count, send, close() {
    dropSecret(id);
    db.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(iso.home, { recursive: true, force: true });
  } };
}

async function detect(h: Awaited<ReturnType<typeof fixture>>, read: (id: string, n: number) => Promise<string[] | null> = dialog) {
  await checkTrustDialog(h.db, read);
  processEvents(h.db);
  assert.deepEqual(h.row(), { state: 'waiting_for_you', wait_reason: 'trust' });
}

test('1: a launch-only Claude session waits for folder trust', async () => {
  // protects=Claude launch trust detection and reason fails_when=trust detection or reason assignment is removed
  const h = await fixture();
  try {
    assert.equal(h.count('launch'), 1);
    assert.deepEqual(h.row(), { state: 'starting', wait_reason: null });
    await detect(h, async (id, n) => {
      assert.equal(id, h.id);
      assert.equal(n, 20);
      return dialog();
    });
    assert.equal(h.count('core.trust-dialog'), 1);
  } finally { h.close(); }
});

test('2: a no-prompt launch stalled to idle becomes a visible trust wait', async () => {
  // protects=idle no-prompt launch visibility fails_when=idle sessions are excluded from trust detection
  const h = await fixture();
  try {
    h.send('core.stalled', { prompt: false });
    assert.deepEqual(h.row(), { state: 'idle', wait_reason: null });
    await detect(h);
    assert.equal(h.count('core.trust-dialog'), 1);
  } finally { h.close(); }
});

test('3: Codex folder trust matching is case-insensitive', async () => {
  // protects=Codex built-in trust pattern and case folding fails_when=Codex pattern or case folding is removed
  const h = await fixture('codex');
  try { await detect(h, async () => ['tRuSt ThIs FoLdEr?']); }
  finally { h.close(); }
});

test('4: real engine activity blocks trust phrase false positives', async () => {
  // protects=post-prompt and post-tool false-positive guard fails_when=engine activity no longer excludes detection
  for (const kind of ['claude.UserPromptSubmit', 'claude.PreToolUse']) {
    const h = await fixture();
    try {
      h.send(kind, kind.endsWith('PreToolUse') ? { tool_name: 'Read', tool_use_id: 'tool' } : {});
      assert.equal(h.row().state, 'working');
      const before = h.row();
      await checkTrustDialog(h.db, dialog);
      processEvents(h.db);
      assert.deepEqual(h.row(), before);
      assert.equal(h.count('core.trust-dialog'), 0);
      // A second launch-only session proves the detector is active in this same database.
      const control = randomUUID();
      h.db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at)
        SELECT ?, project_id, engine_id, host, 'starting', state_at, started_at FROM session WHERE id = ?`).run(control, h.id);
      appendEvent('launch', control, {}, h.db);
      processEvents(h.db);
      await checkTrustDialog(h.db, dialog);
      processEvents(h.db);
      assert.equal(h.db.prepare('SELECT wait_reason FROM session WHERE id = ?').get(control)!.wait_reason, 'trust');
      assert.deepEqual(h.row(), before);
    } finally { h.close(); }
  }
});

test('5b: core events such as core.seen or core.resumed before the first check do not block detection', async () => {
  // protects=engine-evidence guard fails_when=any non-engine event (the user opening the stuck tile) switches detection off
  for (const kind of ['core.seen', 'core.resumed', 'term.bell']) {
    const h = await fixture('claude');
    try {
      h.send(kind, {});
      await detect(h, dialog);
    } finally { h.close(); }
  }
});

test('5: SessionStart alone does not block folder trust detection', async () => {
  // protects=SessionStart exemption fails_when=SessionStart is mistaken for substantive engine activity
  for (const engine of ['claude', 'codex', 'agy']) {
    const h = await fixture(engine);
    try {
      h.send(`${engine === 'agy' ? 'gemini' : engine}.SessionStart`, { session_id: 'conversation' });
      await detect(h, engine === 'codex' ? async () => ['Trust this folder?'] : dialog);
    } finally { h.close(); }
  }
});

test('6: disappearing folder trust question clears the reason and returns to idle', async () => {
  // protects=trust-cleared event and reason reset fails_when=clearing detection or idle transition is removed
  const h = await fixture();
  try {
    await detect(h);
    await checkTrustDialog(h.db, async () => ['Ready for your prompt']);
    assert.equal(h.count('core.trust-cleared'), 1);
    processEvents(h.db);
    assert.deepEqual(h.row(), { state: 'idle', wait_reason: null });
  } finally { h.close(); }
});

test('7: terminal output cannot answer a folder trust question', async () => {
  // protects=askInWait trust hold fails_when=core.trust-dialog is removed from askInWait
  const h = await fixture();
  try {
    await detect(h);
    h.send('term.output', { bytes: 42 });
    assert.deepEqual(h.row(), { state: 'waiting_for_you', wait_reason: 'trust' });
    assert.equal(h.count('term.output'), 1);
  } finally { h.close(); }
});

test('8: consecutive checks append only one pending trust-dialog event', async () => {
  // protects=pending trust event deduplication fails_when=two checks before processing append duplicate trust events
  const h = await fixture();
  try {
    await checkTrustDialog(h.db, dialog);
    assert.equal(h.count('core.trust-dialog'), 1);
    await checkTrustDialog(h.db, dialog);
    assert.equal(h.count('core.trust-dialog'), 1);
    processEvents(h.db);
    await detect(h);
    assert.equal(h.count('core.trust-dialog'), 1);
  } finally { h.close(); }
});

test('9: a missing terminal appends nothing and does not clear an existing trust wait', async () => {
  // protects=null terminal handling fails_when=null is treated as an empty screen or creates a trust event
  const h = await fixture();
  try {
    const count = () => h.db.prepare('SELECT count(*) AS n FROM event').get()!.n;
    const before = count();
    let reads = 0;
    await checkTrustDialog(h.db, async () => { reads++; return null; });
    assert.equal(reads, 1);
    assert.equal(count(), before);
    assert.deepEqual(h.row(), { state: 'starting', wait_reason: null });
    await detect(h);
    const waiting = count();
    await checkTrustDialog(h.db, async () => null);
    assert.equal(count(), waiting);
    assert.deepEqual(h.row(), { state: 'waiting_for_you', wait_reason: 'trust' });
  } finally { h.close(); }
});

test('10: nextState handles trust transitions and preserves terminal states', () => {
  // protects=trust state transition table fails_when=trust-dialog or trust-cleared transitions are reverted
  for (const state of ['starting', 'idle', 'working']) {
    assert.equal(nextState(state, { kind: 'core.trust-dialog', payload: {} }), 'waiting_for_you', state);
  }
  for (const state of ['done', 'exited']) {
    assert.equal(nextState(state, { kind: 'core.trust-dialog', payload: {} }), null, state);
  }
  assert.equal(nextState('waiting_for_you', { kind: 'core.trust-cleared', payload: {} }), 'idle');
  assert.equal(nextState('working', { kind: 'core.trust-cleared', payload: {} }), null);
});

test('11: worktree.create requires UI or a valid live session secret', async () => {
  // protects=worktree handler authorization and secret access fails_when=secret proof is removed or unknown secrets are accepted
  const h = await fixture();
  try {
    const repo = join(h.home, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
    git('init', '-q');
    writeFileSync(join(repo, 'file.txt'), 'fixture\n');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
    const methods = buildMethods(h.db, { engines: () => h.engines, stop: () => {}, uiKey: 'fixture-key' });
    const { project_id } = await methods.get('project.open')!.handler({ path: repo }, { ui: false, origin: 'test' }) as { project_id: string };
    const method = methods.get('worktree.create')!;
    const needsUi = (error: unknown) => error instanceof RpcError && error.code === E.NEEDS_UI && error.code === -32012;
    await assert.rejects(async () => method.handler({ project_id, branch: 'missing-secret' }, { ui: false, origin: 'test' }), needsUi);
    await assert.rejects(async () => method.handler({ project_id, branch: 'unknown-secret', session_secret: 'unknown-secret' }, { ui: false, origin: 'test' }), needsUi);
    const secret = issueSecret(h.id, 'ask');
    for (const [branch, ctx, extra] of [
      ['agent-lane', { ui: false, origin: 'test' }, { session_secret: secret }],
      ['ui-lane', { ui: true, origin: 'test' }, {}],
    ] as const) {
      const result = await method.handler({ project_id, branch, ...extra }, ctx) as { path: string; branch: string; trusted: string[] };
      assert.equal(result.branch, branch);
      assert.deepEqual(result.trusted, h.engines.filter((e) => e.trust).map((e) => e.id));
      assert.equal(execFileSync('git', ['-C', result.path, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim(), branch);
      const trusted = JSON.parse(readFileSync(h.trustedFile, 'utf8')).trusted;
      assert.ok(trusted.includes(canonicalPath(realpathSync.native(result.path))));
    }
    assert.equal(git('branch', '--list', 'missing-secret', 'unknown-secret').trim(), '');
  } finally { h.close(); }
});

test('12: CLI launch forwards TROOP_SESSION_SECRET to worktree.create', async () => {
  // protects=launchOne session secret forwarding fails_when=worktree.create RPC omits session_secret
  const iso = isolation();
  const sockets = new Set<Socket>();
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        requests.push(request);
        let result: object | undefined;
        if (request.method === 'project.open') result = { project_id: 'fixture-project' };
        if (request.method === 'worktree.create') {
          const path = join(iso.home, 'lane');
          mkdirSync(path, { recursive: true });
          result = { path, branch: 'lane', trusted: true };
        }
        if (request.method === 'session.launch') result = { session_id: 'fixture-session', approval: 'ask' };
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(result ? { result } : {
          error: { code: -32601, message: `unexpected RPC: ${request.method}` },
        }) }) + '\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath(iso.prefix), resolve);
    });
    const secret = 'synthetic-launch-secret';
    const result = await runNode([join(root, 'core', 'cli.ts'), 'launch', 'claude', '--worktree', 'lane', '--project', iso.home], {
      ...iso.env, TROOP_SESSION_ID: '', TROOP_SESSION_SECRET: secret,
    });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const worktrees = requests.filter((r) => r.method === 'worktree.create');
    assert.equal(worktrees.length, 1);
    assert.deepEqual(worktrees[0].params, { project_id: 'fixture-project', branch: 'lane', session_secret: secret });
    assert.equal(requests.filter((r) => r.method === 'session.launch').length, 1);
    assert.match(result.stdout, /fixture-session/);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(iso.home, { recursive: true, force: true });
  }
});
