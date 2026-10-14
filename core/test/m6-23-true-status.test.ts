import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { openCoreDb } from '../src/store/db.ts';
import {
  BUILT_IN,
  dataEngines,
  syncEngines,
  titlePatterns,
  type EngineSpec,
} from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents, turnJobsIdle } from '../src/events/processor.ts';
import { buildPayload, rebuildPayload } from '../src/redact.ts';
import { checkHeldStops } from '../src/sessions/watch.ts';
import { checkFatal } from '../src/sessions/fatal.ts';
import * as term from '../src/terminal/index.ts';
import { liveText, wireTermEvents } from '../src/terminal/events.ts';
import { statePluginEnv } from '../src/sessions/launch.ts';
import { mcpAttachEnv } from '../src/plugins/mcp.ts';
import { engineSchemaErrors } from '../src/plugins/manifest.ts';
import { snapshot } from '../../workbench/src/queries.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const START = Date.parse('2026-10-14T10:00:00+11:00');
const WORKING_TITLE = '\u25D0 Background subagent sleep test';
const WORKING_TITLE_2 = '\u25D1 Background subagent sleep test';
const IDLE_TITLE = '\u2733 Background subagent sleep test';
const MARKER = 'synthetic_m623_private_marker';

const CAPTURED_STOP = {
  background_tasks: [
    {
      id: 'a050558653950c70b',
      type: 'subagent',
      status: 'running',
      description: '...',
      agent_type: 'general-purpose',
    },
    {
      id: 'bke4u32vm',
      type: 'shell',
      status: 'running',
      description: '...',
      command: 'sleep 45',
    },
  ],
  session_crons: [],
};

function fixtureEngine(
  id: string,
  fields: Partial<EngineSpec> = {},
): EngineSpec {
  return {
    id,
    command: process.execPath,
    version_cmd: [process.execPath, '--version'],
    state_source: 'process',
    roles: ['worker'],
    cost_rank: 5,
    usage_source: 'none',
    provider: 'local-cli',
    ...fields,
  };
}

async function until(
  predicate: () => unknown | Promise<unknown>,
  timeout = 8000,
): Promise<void> {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('fixture condition did not arrive before timeout');
}

async function memoryDb(engineId = 'claude', extra: EngineSpec[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'troop-m623-'));
  const vars = {
    HOME: home,
    USERPROFILE: home,
    METATROOPER_HOME: join(home, 'mt'),
    METATROOPER_FAKE_DPAPI: '1',
  };
  const previous = new Map(
    Object.keys(vars).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, vars);
  const db = openCoreDb();
  const id = `m623-${randomUUID()}`;
  syncEngines(db, [...BUILT_IN, ...extra]);
  db.prepare(
    'INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)',
  ).run('p', home, 'synthetic', new Date(START).toISOString(), new Date(START).toISOString());
  db.prepare(
    `INSERT INTO session
       (id, project_id, engine_id, host, state, state_at, started_at, native_id)
     VALUES (?, 'p', ?, 'pty', 'starting', ?, ?, 'conv')`,
  ).run(id, engineId, new Date(START).toISOString(), new Date(START).toISOString());

  const row = () => db.prepare(
    'SELECT state, state_at, wait_reason FROM session WHERE id = ?',
  ).get(id) as { state: string; state_at: string; wait_reason: string | null };

  const count = (kind: string) => Number(db.prepare(
    'SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = ?',
  ).get(id, kind)!.n);

  const notices = (kind: string) => db.prepare(
    'SELECT text FROM needs_you WHERE ref = ? AND kind = ? ORDER BY id',
  ).all(id, kind).map((r) => String(r.text));

  const send = (kind: string, raw: Record<string, unknown> = {}, at?: number) => {
    const input = kind.startsWith('claude.')
      ? { session_id: 'conv', ...raw }
      : raw;
    const payload = kind.startsWith('claude.') || kind === 'opencode.state'
      ? buildPayload(kind, input)
      : input;
    appendEvent(kind, id, payload, db);
    if (at !== undefined) {
      db.prepare(
        'UPDATE event SET at = ? WHERE seq = (SELECT max(seq) FROM event)',
      ).run(new Date(at).toISOString());
    }
    processEvents(db);
    return row().state;
  };

  const storedText = () => ['needs_you', 'event', 'session']
    .map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()))
    .join('\n');

  const close = async () => {
    await turnJobsIdle();
    db.prepare("UPDATE session SET state = 'exited' WHERE id = ?").run(id);
    await checkFatal(db, START, async () => []);
    db.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };

  return { home, db, id, row, count, notices, send, storedText, close };
}

const TERMINAL_FIXTURE = String.raw`
const fs = require('node:fs');
const command = process.argv[2];
let seen = 0;
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdout.write('FIXTURE-READY\r\n');
setInterval(() => {
  let x;
  try { x = JSON.parse(fs.readFileSync(command, 'utf8')); } catch { return; }
  if (x.n <= seen) return;
  seen = x.n;
  if (typeof x.title === 'string')
    process.stdout.write('\x1b]0;' + x.title + '\x07');
  if (typeof x.line === 'string')
    process.stdout.write(x.line + '\r\n');
  process.stdout.write('ACK:' + seen + '\r\n');
}, 10);
`;

async function terminalFixture(engineId = 'claude', extra: EngineSpec[] = []) {
  const h = await memoryDb(engineId, extra);
  const script = join(h.home, 'terminal-fixture.cjs');
  const command = join(h.home, 'terminal-command.json');
  writeFileSync(script, TERMINAL_FIXTURE);
  wireTermEvents(h.db);
  term.open(h.id, [process.execPath, script, command], h.home, process.env, 120, 30);
  let n = 0;
  try {
    await until(async () => (await term.lastLines(h.id, 20))?.includes('FIXTURE-READY'));
  } catch (error) {
    term.kill(h.id);
    await until(() => !term.has(h.id));
    term.setTermHooks({});
    await h.close();
    throw error;
  }

  const emit = async (fields: { title?: string; line?: string }) => {
    const next = ++n;
    writeFileSync(command, JSON.stringify({ n: next, ...fields }));
    await until(async () => (await term.lastLines(h.id, 20))?.includes(`ACK:${next}`));
  };

  const close = async () => {
    term.kill(h.id);
    await until(() => !term.has(h.id));
    await until(async () => (await term.snapshot(h.id)) === null);
    term.setTermHooks({});
    processEvents(h.db);
    await h.close();
  };

  return { ...h, emit, close };
}

test('M6-23a captured background Stop holds the turn until the exact fallback boundary', async () => {
  // protects=held Stop and fallback fails_when=Stop finishes early or fallback repeats no_claim=live Claude behavior
  const h = await memoryDb();
  try {
    const repo = join(h.home, 'repo');
    mkdirSync(repo);
    const gitEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(h.home, 'absent-gitconfig'),
      GIT_TERMINAL_PROMPT: '0',
    };
    const git = (args: string[]) => execFileSync('git', args, {
      cwd: repo,
      env: gitEnv,
      windowsHide: true,
      stdio: 'pipe',
    });
    git(['init', '--quiet']);
    writeFileSync(join(repo, 'sample.txt'), 'before\n');
    git(['add', 'sample.txt']);
    git([
      '-c', 'user.name=Synthetic',
      '-c', 'user.email=synthetic@example.invalid',
      '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'synthetic fixture',
    ]);
    h.db.prepare('UPDATE session SET cwd = ? WHERE id = ?').run(repo, h.id);
    assert.equal(h.send('claude.UserPromptSubmit'), 'working');
    await turnJobsIdle();
    writeFileSync(join(repo, 'sample.txt'), 'after\n');

    assert.equal(h.send('claude.Stop', CAPTURED_STOP, START), 'working');
    await turnJobsIdle();
    assert.deepEqual(h.notices('done'), []);
    assert.equal(h.count('core.claim'), 0);

    h.send('term.output', {}, START + 599_998);
    checkHeldStops(h.db, START + 599_999);
    assert.equal(h.count('core.stop-fallback'), 0);
    assert.equal(h.row().state, 'working');
    assert.deepEqual(h.notices('done'), []);

    checkHeldStops(h.db, START + 600_000);
    checkHeldStops(h.db, START + 600_001);
    assert.equal(h.count('core.stop-fallback'), 1);
    assert.equal(h.row().state, 'working');
    processEvents(h.db);
    await turnJobsIdle();
    assert.equal(h.row().state, 'done');
    assert.deepEqual(h.notices('done'), ['claude finished']);
    assert.equal(h.count('core.claim'), 1);

    checkHeldStops(h.db, START + 1_200_000);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 1);
    assert.deepEqual(h.notices('done'), ['claude finished']);
  } finally {
    await h.close();
  }
});

for (const type of ['subagent', 'teammate', 'workflow']) {
  test(`M6-23a unfinished ${type} holds Stop`, async () => {
    // protects=all holding task types fails_when=an unfinished orchestration task finishes the session no_claim=engine task discovery
    const h = await memoryDb();
    try {
      h.send('claude.UserPromptSubmit');
      for (const status of ['running', 'queued', 'pending']) {
        assert.equal(h.send('claude.Stop', {
          background_tasks: [{ type, status }],
        }), 'working');
        assert.deepEqual(h.notices('done'), []);
      }
    } finally {
      await h.close();
    }
  });
}

for (const tasks of [
  [{ type: 'shell', status: 'running' }],
  [{ type: 'subagent', status: 'completed' }],
  [{ type: 'subagent', status: 'failed' }],
  [{ type: 'subagent', status: 'killed' }],
  [{ type: 'subagent', status: 'stopped' }],
  [{ type: 'subagent', status: 'cancelled' }],
  [],
]) {
  test(`M6-23a Stop finishes with ${JSON.stringify(tasks)}`, async () => {
    // protects=nonholding Stops fails_when=shell or finished tasks hold the session no_claim=live task completion metadata
    const h = await memoryDb();
    try {
      h.send('claude.UserPromptSubmit');
      assert.equal(h.send('claude.Stop', { background_tasks: tasks }), 'done');
      assert.deepEqual(h.notices('done'), ['claude finished']);
    } finally {
      await h.close();
    }
  });
}

test('M6-23a PreToolUse resets the fallback window and a later Stop starts a new window', async () => {
  // protects=last nonterminal event fallback fails_when=an older Stop times out after newer work no_claim=timer scheduling
  const h = await memoryDb();
  try {
    h.send('claude.UserPromptSubmit');
    h.send('claude.Stop', CAPTURED_STOP, START);
    h.send('claude.PreToolUse', { tool_name: 'Read', tool_use_id: 'synthetic-tool' }, START + 300_000);
    checkHeldStops(h.db, START + 600_000);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 0);
    assert.equal(h.row().state, 'working');

    checkHeldStops(h.db, START + 899_999);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 0);
    assert.equal(h.row().state, 'working');

    checkHeldStops(h.db, START + 900_000);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 1);
    assert.equal(h.row().state, 'done');

    assert.equal(h.send('claude.UserPromptSubmit', {}, START + 1_000_000), 'working');
    assert.equal(h.send('claude.Stop', CAPTURED_STOP, START + 1_000_000), 'working');
    checkHeldStops(h.db, START + 1_599_999);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 1);
    checkHeldStops(h.db, START + 1_600_000);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 2);
    assert.equal(h.row().state, 'done');
  } finally {
    await h.close();
  }
});

test('M6-23a fallback fires after an own held Stop followed by foreign tool events', async () => {
  // protects=foreign tool event clock restart fails_when=foreign event blocks fallback or fires at original Stop boundary no_claim=subagent orchestration
  const h = await memoryDb();
  try {
    h.send('claude.UserPromptSubmit', { session_id: 'conv' }, START);
    h.send('claude.Stop', { ...CAPTURED_STOP, session_id: 'conv' }, START);
    assert.equal(h.row().state, 'working');

    h.send('claude.PostToolUse', {
      session_id: 'foreign-subagent',
      tool_name: 'Bash',
      tool_use_id: 'sub-tool',
      tool_response: 'ok',
    }, START + 300_000);
    assert.equal(h.row().state, 'working');

    checkHeldStops(h.db, START + 600_000);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 0);
    assert.equal(h.row().state, 'working');

    checkHeldStops(h.db, START + 899_999);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 0);
    assert.equal(h.row().state, 'working');

    checkHeldStops(h.db, START + 900_000);
    assert.equal(h.count('core.stop-fallback'), 1);
    processEvents(h.db);
    assert.equal(h.row().state, 'done');
    assert.deepEqual(h.notices('done'), ['claude finished']);
  } finally {
    await h.close();
  }
});

test('M6-23a a foreign conversation Stop never receives a fallback', async () => {
  // protects=own conversation fallback fails_when=a foreign Stop times out the parent no_claim=conversation relinking
  const h = await memoryDb();
  try {
    h.send('claude.UserPromptSubmit');
    h.send('claude.Stop', { ...CAPTURED_STOP, session_id: 'foreign' }, START);
    checkHeldStops(h.db, START + 600_000);
    processEvents(h.db);
    assert.equal(h.count('core.stop-fallback'), 0);
    assert.equal(h.row().state, 'working');
  } finally {
    await h.close();
  }
});

test('M6-23b StopFailure stores a safe reason, exposes it in snapshots and clears it on a prompt', async () => {
  // protects=wait reason storage and snapshot fails_when=reason is missing unsafe or stale no_claim=rate limit resumption
  const h = await memoryDb();
  try {
    for (const [error_type, reason] of [
      ['rate_limit', 'stopped: rate_limit'],
      ['Rate Limit!', 'stopped: error'],
      ['', 'stopped: error'],
      ['x'.repeat(41), 'stopped: error'],
    ]) {
      assert.equal(h.send('claude.UserPromptSubmit'), 'working');
      assert.equal(h.row().wait_reason, null);
      assert.equal(h.send('claude.StopFailure', { error_type }), 'waiting_for_you');
      assert.equal(h.row().wait_reason, reason);
      assert.equal(snapshot(h.db, 'p').sessions.find((s) => s.id === h.id)?.reason, reason);
      assert.equal(h.send('claude.UserPromptSubmit'), 'working');
      assert.equal(h.row().wait_reason, null);
      assert.equal(snapshot(h.db, 'p').sessions.find((s) => s.id === h.id)?.reason, null);
    }
    h.send('claude.Notification', { notification_type: 'agent_needs_input' });
    assert.equal(h.row().state, 'waiting_for_you');
    assert.equal(h.row().wait_reason, null);
  } finally {
    await h.close();
  }
});

test('M6-23b opencode permission and error reasons clear on every move out of waiting', async () => {
  // protects=opencode wait reasons fails_when=permission error or reason clearing is wrong no_claim=plugin bus transport
  const h = await memoryDb('opencode', [fixtureEngine('opencode', { state_plugin: 'plugins/opencode-state.js' })]);
  try {
    h.send('opencode.state', { state: 'working', seq: 1 });
    assert.equal(h.send('opencode.state', { state: 'waiting', why: 'permission', seq: 2 }), 'waiting_for_you');
    assert.equal(h.row().wait_reason, 'permission');
    h.send('opencode.state', { state: 'working', seq: 3 });
    assert.equal(h.row().wait_reason, null);
    h.send('opencode.state', { state: 'waiting', why: 'error', seq: 4 });
    assert.equal(h.row().wait_reason, 'stopped: error');
    h.send('opencode.state', { state: 'done', seq: 5 });
    assert.equal(h.row().wait_reason, null);
    h.send('opencode.state', { state: 'waiting', seq: 6 });
    assert.equal(h.row().wait_reason, null);
  } finally {
    await h.close();
  }
});

test('M6-23 wait_reason replaces current reason on subsequent waiting events', async () => {
  // protects=wait reason replacement semantics fails_when=earlier wait reason persists or replacement fails no_claim=error recovery
  const engine = fixtureEngine('opencode', { state_plugin: 'plugins/opencode-state.js' });
  const h = await memoryDb('opencode', [engine]);
  try {
    h.send('opencode.state', { state: 'working', seq: 1 });
    assert.equal(h.send('opencode.state', { state: 'waiting', why: 'permission', seq: 2 }), 'waiting_for_you');
    assert.equal(h.row().wait_reason, 'permission');
    assert.equal(h.send('opencode.state', { state: 'waiting', why: 'error', seq: 3 }), 'waiting_for_you');
    assert.equal(h.row().wait_reason, 'stopped: error');
    assert.equal(h.send('opencode.state', { state: 'waiting', seq: 4 }), 'waiting_for_you');
    assert.equal(h.row().wait_reason, null);
  } finally {
    await h.close();
  }

  const h2 = await memoryDb('claude');
  try {
    h2.send('claude.UserPromptSubmit');
    assert.equal(h2.send('claude.PermissionRequest', { tool_name: 'Bash', tool_use_id: 'tool-1' }), 'waiting_for_you');
    assert.equal(h2.row().wait_reason, null);
    assert.equal(h2.send('claude.StopFailure', { error_type: 'rate_limit' }), 'waiting_for_you');
    assert.equal(h2.row().wait_reason, 'stopped: rate_limit');
  } finally {
    await h2.close();
  }
});

test('M6-23b wait_reason is added idempotently to an existing database', async () => {
  // protects=legacy schema upgrade fails_when=reason column is absent duplicated or loses rows no_claim=numbered migration redesign
  const h = await memoryDb();
  try {
    h.db.exec('ALTER TABLE session DROP COLUMN wait_reason');
    const upgraded = openCoreDb();
    try {
      assert.equal(upgraded.prepare(
        'SELECT wait_reason FROM session WHERE id = ?',
      ).get(h.id)!.wait_reason, null);
      assert.deepEqual(upgraded.prepare(
        'SELECT id FROM schema_migration ORDER BY id',
      ).all().map((r) => Number(r.id)), [1, 2, 3]);
    } finally {
      upgraded.close();
    }
    const reopened = openCoreDb();
    try {
      assert.equal(reopened.prepare('PRAGMA table_info(session)').all()
        .filter((r) => r.name === 'wait_reason').length, 1);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM session').get()!.n, 1);
    } finally {
      reopened.close();
    }
  } finally {
    await h.close();
  }
});

for (const escape of ['\x1b', '\x1b[27u', '\x1b[27;1u']) {
  test(`M6-23c ${JSON.stringify(escape)} interrupts at 5000 ms through the real terminal`, async (t) => {
    // protects=Escape input and raw idle titles fails_when=accepted Escape fails or interrupt repeats no_claim=live Claude keyboard handling
    const h = await terminalFixture();
    let now = START;
    t.mock.method(Date, 'now', () => now);
    try {
      h.send('claude.UserPromptSubmit');
      await h.emit({ title: WORKING_TITLE });
      await h.emit({ title: WORKING_TITLE_2 });
      assert.equal(term.write(h.id, escape), true);
      now = START + 5000;
      await h.emit({ title: IDLE_TITLE });
      assert.equal(h.count('core.interrupted'), 1);
      processEvents(h.db);
      assert.equal(h.row().state, 'idle');
      assert.equal(h.row().wait_reason, null);
      await h.emit({ title: IDLE_TITLE + ' again' });
      processEvents(h.db);
      assert.equal(h.count('core.interrupted'), 1);
      assert.equal(h.count('core.title-state'), 0);
      assert.deepEqual(h.notices('done'), []);
      assert.ok(!h.storedText().includes('Background subagent sleep test'));
    } finally {
      t.mock.restoreAll();
      await h.close();
    }
  });
}

for (const scenario of ['late', 'arrow', 'new-hook', 'new-state-at', 'no-escape', 'not-working']) {
  test(`M6-23c idle title does not interrupt after ${scenario}`, async (t) => {
    // protects=interrupt baseline guards fails_when=late unrelated or changed baseline interrupts no_claim=OS key translation
    const h = await terminalFixture();
    let now = START;
    t.mock.method(Date, 'now', () => now);
    try {
      h.send('claude.UserPromptSubmit');
      await h.emit({ title: WORKING_TITLE });
      if (scenario === 'not-working') {
        h.db.prepare("UPDATE session SET state = 'idle' WHERE id = ?").run(h.id);
      }
      if (scenario !== 'no-escape') {
        assert.equal(term.write(h.id, scenario === 'arrow' ? '\x1b[A' : '\x1b'), true);
      }
      if (scenario === 'late') now += 5001;
      if (scenario === 'new-hook') {
        h.send('claude.PreToolUse', { tool_name: 'Read', tool_use_id: 'later-tool' });
      }
      if (scenario === 'new-state-at') {
        h.db.prepare('UPDATE session SET state_at = ? WHERE id = ?')
          .run('2026-10-14T10:00:01+11:00', h.id);
      }
      await h.emit({ title: IDLE_TITLE });
      processEvents(h.db);
      assert.equal(h.count('core.interrupted'), 0);
      assert.equal(h.row().state, scenario === 'not-working' ? 'idle' : 'working');
    } finally {
      t.mock.restoreAll();
      await h.close();
    }
  });
}

test('M6-23c a later Escape replaces the baseline and terminal events do not invalidate it', async (t) => {
  // protects=replaced Escape and terminal-only activity fails_when=first Escape or terminal seq blocks interruption no_claim=double-Escape engine semantics
  const h = await terminalFixture();
  let now = START;
  t.mock.method(Date, 'now', () => now);
  try {
    h.send('claude.UserPromptSubmit');
    await h.emit({ title: WORKING_TITLE });
    term.write(h.id, '\x1b');
    now += 4000;
    term.write(h.id, '\x1b');
    h.send('term.output');
    now += 4000;
    await h.emit({ title: IDLE_TITLE });
    processEvents(h.db);
    assert.equal(h.count('core.interrupted'), 1);
    assert.equal(h.row().state, 'idle');
  } finally {
    t.mock.restoreAll();
    await h.close();
  }
});

test('M6-23 title states use raw glyph changes before title dedupe and only append changed states', async () => {
  // protects=process title states and dedupe ordering fails_when=glyph-only state changes disappear or repeat no_claim=live process title conventions
  const engine = fixtureEngine('title-fixture', {
    state_titles: { working: '^[\\u25D0\\u25D1] ', waiting: '^WAIT ', idle: '^\\u2733 ' },
  });
  const h = await terminalFixture(engine.id, [engine]);
  try {
    await h.emit({ title: WORKING_TITLE });
    processEvents(h.db);
    assert.equal(h.row().state, 'working');
    await h.emit({ title: WORKING_TITLE_2 });
    processEvents(h.db);
    assert.equal(h.count('core.title-state'), 1);
    await h.emit({ title: IDLE_TITLE });
    processEvents(h.db);
    assert.equal(h.row().state, 'done');
    await h.emit({ title: 'wait permission' });
    processEvents(h.db);
    assert.equal(h.row().state, 'waiting_for_you');
    await h.emit({ title: IDLE_TITLE });
    processEvents(h.db);
    assert.equal(h.row().state, 'waiting_for_you');
    await h.emit({ title: WORKING_TITLE });
    processEvents(h.db);
    assert.equal(h.row().state, 'working');
    assert.deepEqual(h.db.prepare(
      "SELECT payload FROM event WHERE session_id = ? AND kind = 'core.title-state' ORDER BY seq",
    ).all(h.id).map((r) => JSON.parse(String(r.payload))), [
      { state: 'working' },
      { state: 'idle' },
      { state: 'waiting' },
      { state: 'idle' },
      { state: 'working' },
    ]);
    assert.ok(!h.storedText().includes('Background subagent sleep test'));
  } finally {
    await h.close();
  }
});

test('M6-23 title-state events cannot move a hooks engine', async () => {
  // protects=process-only title state processing fails_when=title events override hooks no_claim=terminal event generation
  const h = await memoryDb();
  try {
    h.send('claude.UserPromptSubmit');
    for (const state of ['idle', 'waiting']) {
      assert.equal(h.send('core.title-state', { state }), 'working');
    }
    h.send('claude.Stop');
    assert.equal(h.send('core.title-state', { state: 'working' }), 'done');
  } finally {
    await h.close();
  }
});

test('M6-23 term.output after a bell does not end an opencode permission wait or title wait', async () => {
  // protects=terminal output suppression during plugin and title waits fails_when=term.output clears an opencode or title wait no_claim=pty bell generation
  const engine = fixtureEngine('opencode', { state_plugin: 'plugins/opencode-state.js' });
  const h = await memoryDb('opencode', [engine]);
  try {
    h.send('opencode.state', { state: 'working', seq: 1 }, START);
    assert.equal(h.send('opencode.state', { state: 'waiting', why: 'permission', seq: 2 }, START + 1000), 'waiting_for_you');
    assert.equal(h.row().wait_reason, 'permission');
    h.send('term.bell', {}, START + 2000);
    assert.equal(h.row().state, 'waiting_for_you');
    h.send('term.output', {}, START + 3000);
    assert.equal(h.row().state, 'waiting_for_you');
    assert.equal(h.row().wait_reason, 'permission');
  } finally {
    await h.close();
  }

  const titleEngine = fixtureEngine('title-eng', {
    state_titles: { working: '^BUSY', waiting: '^WAIT', idle: '^IDLE' },
  });
  const h2 = await memoryDb(titleEngine.id, [titleEngine]);
  try {
    h2.send('core.title-state', { state: 'working' }, START);
    assert.equal(h2.send('core.title-state', { state: 'waiting' }, START + 1000), 'waiting_for_you');
    h2.send('term.bell', {}, START + 2000);
    assert.equal(h2.row().state, 'waiting_for_you');
    h2.send('term.output', {}, START + 3000);
    assert.equal(h2.row().state, 'waiting_for_you');
  } finally {
    await h2.close();
  }
});

for (const pattern of ['Credit balance is too low', 'Invalid API key']) {
  test(`M6-23d frozen ${pattern} raises one safe failed notice at 60000 ms`, async () => {
    // protects=fatal boundary dedupe and privacy fails_when=notice is early repeated or includes screen text no_claim=live authentication failures
    const h = await memoryDb();
    try {
      h.send('claude.UserPromptSubmit');
      const read = async (id: string, n: number) => {
        assert.equal(id, h.id);
        assert.equal(n, 20);
        return ['synthetic heading', `${pattern.toUpperCase()} ${MARKER}`];
      };
      await checkFatal(h.db, START, read);
      await checkFatal(h.db, START + 59_999, read);
      assert.deepEqual(h.notices('failed'), []);
      await checkFatal(h.db, START + 60_000, read);
      assert.deepEqual(h.notices('failed'), [`claude failed: ${pattern}`]);
      await checkFatal(h.db, START + 120_000, read);
      assert.deepEqual(h.notices('failed'), [`claude failed: ${pattern}`]);
      assert.equal(h.row().state, 'working');
      assert.ok(!h.storedText().includes(MARKER));
    } finally {
      await h.close();
    }
  });
}

test('M6-23d a changing fatal screen raises nothing for 120 seconds and restarts the freeze clock', async () => {
  // protects=screen hash reset fails_when=changing output counts as frozen no_claim=terminal rendering
  const h = await memoryDb();
  try {
    h.send('claude.UserPromptSubmit');
    for (let elapsed = 0; elapsed <= 120_000; elapsed += 5000) {
      await checkFatal(h.db, START + elapsed, async () => [
        `Invalid API key ${MARKER} revision ${elapsed}`,
      ]);
    }
    assert.deepEqual(h.notices('failed'), []);
    const frozen = async () => [`Invalid API key ${MARKER} revision 120000`];
    await checkFatal(h.db, START + 179_999, frozen);
    assert.deepEqual(h.notices('failed'), []);
    await checkFatal(h.db, START + 180_000, frozen);
    assert.deepEqual(h.notices('failed'), ['claude failed: Invalid API key']);
    assert.ok(!h.storedText().includes(MARKER));
  } finally {
    await h.close();
  }
});

test('M6-23d no match and leaving working both reset a pending fatal observation', async () => {
  // protects=fatal observation lifetime fails_when=an old observation survives recovery or idle no_claim=automatic retry
  const h = await memoryDb();
  try {
    h.send('claude.UserPromptSubmit');
    const fatal = async () => ['Invalid API key'];
    await checkFatal(h.db, START, fatal);
    await checkFatal(h.db, START + 30_000, async () => ['synthetic recovery']);
    await checkFatal(h.db, START + 60_000, fatal);
    await checkFatal(h.db, START + 119_999, fatal);
    assert.deepEqual(h.notices('failed'), []);
    h.send('core.interrupted');
    await checkFatal(h.db, START + 120_000, fatal);
    h.send('claude.UserPromptSubmit');
    await checkFatal(h.db, START + 180_000, fatal);
    assert.deepEqual(h.notices('failed'), []);
    await checkFatal(h.db, START + 240_000, fatal);
    assert.deepEqual(h.notices('failed'), ['claude failed: Invalid API key']);
  } finally {
    await h.close();
  }
});

test('M6-23d a real terminal fatal line raises a notice without storing its marker', async () => {
  // protects=terminal buffer fatal integration fails_when=printed fatal text is missed or persisted no_claim=live engine failures
  const h = await terminalFixture();
  try {
    h.send('claude.UserPromptSubmit');
    await h.emit({ line: `Invalid API key ${MARKER}` });
    assert.ok((await term.lastLines(h.id, 20))?.some((line) => line.includes(MARKER)));
    await checkFatal(h.db, START);
    await checkFatal(h.db, START + 59_999);
    assert.deepEqual(h.notices('failed'), []);
    await checkFatal(h.db, START + 60_000);
    await checkFatal(h.db, START + 120_000);
    assert.deepEqual(h.notices('failed'), ['claude failed: Invalid API key']);
    assert.ok(!h.storedText().includes(MARKER));
  } finally {
    await h.close();
  }
});

test('M6-23 lastLines joins wrapped rows and returns the newest nonempty lines in order', async () => {
  // protects=headless lastLines selection fails_when=wrapped or blank rows distort fatal input no_claim=all terminal escape sequences
  const h = await terminalFixture();
  try {
    term.resize(h.id, 24, 20);
    await h.emit({ line: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
    assert.deepEqual(await term.lastLines(h.id, 2), [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'ACK:1',
    ]);
    assert.equal(await term.lastLines(`absent-${randomUUID()}`, 20), null);
  } finally {
    await h.close();
  }
});

type BusEvent = { type: string; properties?: Record<string, unknown> };
type Report = {
  argv: string[];
  payload: { state: string; why?: string; seq: number; session_id?: string };
};

async function pluginReports(
  home: string,
  events: BusEvent[],
  expected: number,
  missing?: string,
): Promise<Report[]> {
  const folder = join(home, `plugin-${randomUUID()}`);
  mkdirSync(folder);
  const recorder = join(folder, 'record.cjs');
  const runner = join(folder, 'runner.mjs');
  const output = join(folder, 'reports');
  mkdirSync(output);
  writeFileSync(recorder, String.raw`
const fs = require('node:fs'), path = require('node:path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', x => { input += x; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  let order = 0;
  while (true) {
    try {
      fs.mkdirSync(path.join(process.env.M623_REPORTS, 'slot-' + order));
      break;
    } catch {
      order++;
    }
  }
  fs.writeFileSync(
    path.join(process.env.M623_REPORTS, 'report-' + String(order).padStart(5, '0') + '.json'),
    JSON.stringify({ argv: process.argv.slice(2), payload, order })
  );
});
`);
  writeFileSync(runner, `
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import plugin from ${JSON.stringify(pathToFileURL(join(ROOT, 'engines/plugins/opencode-state.js')).href)};
if (typeof plugin.id !== 'string' || typeof plugin.server !== 'function')
  throw new Error('invalid plugin export');
const hooks = await plugin.server();
if (typeof hooks.event !== 'function') throw new Error('missing event hook');
for (const event of ${JSON.stringify(events)}) {
  const before = fs.readdirSync(process.env.M623_REPORTS).filter((f) => f.startsWith('report-')).length;
  await hooks.event({ event });
  const start = performance.now();
  while (fs.readdirSync(process.env.M623_REPORTS).filter((f) => f.startsWith('report-')).length === before && performance.now() - start < 150) {
    await new Promise((r) => setTimeout(r, 5));
  }
}
const end = performance.now() + 8000;
while (fs.readdirSync(process.env.M623_REPORTS).filter((f) => f.startsWith('report-')).length < ${expected}) {
  if (performance.now() >= end) throw new Error('missing plugin reports');
  await new Promise(r => setTimeout(r, 20));
}
await new Promise(r => setTimeout(r, ${expected === 0 ? 750 : 200}));
`);
  const env = {
    ...process.env,
    TROOP_NODE: process.execPath,
    TROOP_EVENT_JS: recorder,
    TROOP_SESSION_ID: 'synthetic-root-session',
    M623_REPORTS: output,
  } as Record<string, string | undefined>;
  if (missing) delete env[missing];
  const child = spawn(process.execPath, [runner], {
    cwd: folder,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk) => { stdout += chunk; });
  child.stderr!.on('data', (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill(), 12_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 0, stderr || stdout);
    const reports = readdirSync(output)
      .filter((file) => file.startsWith('report-'))
      .sort()
      .map((file) => JSON.parse(readFileSync(join(output, file), 'utf8')) as Report);
    assert.equal(reports.length, expected);
    return reports;
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
}

test('M6-23e the plugin maps captured root events and only child asks and answers', async () => {
  // protects=plugin event mapping child filtering and seq fails_when=bus events report wrong state or session no_claim=opencode loading the plugin
  const h = await memoryDb();
  try {
    const root = 'native-root';
    const child = 'native-child';
    const events: BusEvent[] = [
      { type: 'session.status', properties: { sessionID: root, status: { type: 'busy' } } },
      { type: 'session.status', properties: { sessionID: root, status: { type: 'retry' } } },
      { type: 'session.status', properties: { sessionID: root, status: { type: 'running' } } },
      { type: 'permission.asked', properties: { sessionID: root } },
      { type: 'permission.replied', properties: { sessionID: root } },
      { type: 'question.asked', properties: { sessionID: root } },
      { type: 'question.replied', properties: { sessionID: root } },
      { type: 'question.rejected', properties: { sessionID: root } },
      { type: 'tool.execute.before', properties: { sessionID: root } },
      { type: 'tool.execute.after', properties: { sessionID: root } },
      { type: 'session.error', properties: { sessionID: root } },
      { type: 'session.status', properties: { sessionID: root, status: { type: 'idle' } } },
      { type: 'session.created', properties: { info: { id: child, parentID: root } } },
      { type: 'session.status', properties: { sessionID: child, status: { type: 'busy' } } },
      { type: 'session.idle', properties: { sessionID: child } },
      { type: 'session.error', properties: { sessionID: child } },
      { type: 'tool.execute.before', properties: { sessionID: child } },
      { type: 'tool.execute.after', properties: { sessionID: child } },
      { type: 'permission.asked', properties: { sessionID: child } },
      { type: 'permission.replied', properties: { sessionID: child } },
      { type: 'question.asked', properties: { sessionID: child } },
      { type: 'question.replied', properties: { sessionID: child } },
      { type: 'question.rejected', properties: { sessionID: child } },
      { type: 'session.idle', properties: { sessionID: root } },
    ];
    const reports = await pluginReports(h.home, events, 17);
    assert.deepEqual(reports.map((r) => ({
      state: r.payload.state,
      ...(r.payload.why === undefined ? {} : { why: r.payload.why }),
    })), [
      { state: 'working' },
      { state: 'working' },
      { state: 'working' },
      { state: 'waiting', why: 'permission' },
      { state: 'working' },
      { state: 'waiting' },
      { state: 'working' },
      { state: 'working' },
      { state: 'working' },
      { state: 'working' },
      { state: 'waiting', why: 'error' },
      { state: 'waiting', why: 'permission' },
      { state: 'working' },
      { state: 'waiting' },
      { state: 'working' },
      { state: 'working' },
      { state: 'done' },
    ]);
    for (let i = 0; i < reports.length; i++) {
      assert.deepEqual(reports[i].argv, [
        'opencode.state', '--session', 'synthetic-root-session',
      ]);
      assert.ok(Number.isSafeInteger(reports[i].payload.seq));
      assert.equal(reports[i].payload.session_id, 'native-root');
      if (i > 0) assert.ok(reports[i].payload.seq > reports[i - 1].payload.seq);
      assert.deepEqual(Object.keys(reports[i].payload).sort(),
        reports[i].payload.why === undefined
          ? ['seq', 'session_id', 'state']
          : ['seq', 'session_id', 'state', 'why']);
    }
  } finally {
    await h.close();
  }
});

test('M6-23e plugin handles overlapping asks across child and root sessions', async () => {
  // protects=overlapping ask queue and work suppression fails_when=premature working report or work event reports during open ask no_claim=opencode bus delivery order
  const h = await memoryDb();
  try {
    const root = 'root-overlapping';
    const child = 'child-overlapping';
    const events: BusEvent[] = [
      { type: 'session.created', properties: { info: { id: child, parentID: root } } },
      { type: 'permission.asked', properties: { sessionID: child, id: 'child-perm' } },
      { type: 'question.asked', properties: { sessionID: root, id: 'root-quest' } },
      { type: 'session.status', properties: { sessionID: root, status: { type: 'busy' } } },
      { type: 'tool.execute.before', properties: { sessionID: root } },
      { type: 'tool.execute.after', properties: { sessionID: root } },
      { type: 'permission.replied', properties: { sessionID: child, permissionID: 'child-perm' } },
      { type: 'question.replied', properties: { sessionID: root, requestID: 'root-quest' } },
    ];
    const reports = await pluginReports(h.home, events, 4);
    assert.deepEqual(reports.map((r) => ({
      state: r.payload.state,
      ...(r.payload.why === undefined ? {} : { why: r.payload.why }),
      session_id: r.payload.session_id,
    })), [
      { state: 'waiting', why: 'permission', session_id: root },
      { state: 'waiting', why: 'permission', session_id: root },
      { state: 'waiting', session_id: root },
      { state: 'working', session_id: root },
    ]);
  } finally {
    await h.close();
  }
});

for (const missing of ['TROOP_NODE', 'TROOP_EVENT_JS', 'TROOP_SESSION_ID']) {
  test(`M6-23e the plugin spawns nothing without ${missing}`, async () => {
    // protects=plugin environment prerequisites fails_when=incomplete environment launches a reporter no_claim=engine launch setup
    const h = await memoryDb();
    try {
      const reports = await pluginReports(h.home, [
        { type: 'session.status', properties: { sessionID: 'native-root', status: { type: 'busy' } } },
        { type: 'permission.asked', properties: { sessionID: 'native-root' } },
        { type: 'session.idle', properties: { sessionID: 'native-root' } },
      ], 0, missing);
      assert.deepEqual(reports, []);
    } finally {
      await h.close();
    }
  });
}

test('M6-23e plugin reports alone move opencode while its real terminal title stays fixed', async () => {
  // protects=plugin driven state and stale seq guard fails_when=unchanged title blocks reports or stale seq changes state no_claim=live opencode execution
  const engine = fixtureEngine('opencode', {
    state_plugin: 'plugins/opencode-state.js',
    state_titles: { working: '^BUSY ', idle: '^IDLE ' },
  });
  const h = await terminalFixture(engine.id, [engine]);
  try {
    await h.emit({ title: 'synthetic fixed title' });
    const reports = await pluginReports(h.home, [
      { type: 'session.status', properties: { sessionID: 'native-root', status: { type: 'busy' } } },
      { type: 'session.idle', properties: { sessionID: 'native-root' } },
    ], 2);
    assert.equal(h.send('opencode.state', reports[0].payload), 'working');
    assert.equal(h.send('opencode.state', reports[1].payload), 'done');
    const stateAt = h.row().state_at;
    assert.equal(h.send('opencode.state', {
      state: 'working', seq: reports[0].payload.seq,
    }), 'done');
    assert.equal(h.send('opencode.state', {
      state: 'waiting', why: 'permission', seq: reports[1].payload.seq,
    }), 'done');
    assert.equal(h.row().state_at, stateAt);
    assert.equal(h.row().wait_reason, null);
    assert.equal(h.send('core.title-state', { state: 'working' }), 'done');
    assert.equal(h.send('core.title-state', { state: 'waiting' }), 'done');
    assert.equal(liveText()[h.id]?.title, 'synthetic fixed title');
    assert.equal(h.count('core.title-state'), 2);
    assert.deepEqual(h.notices('done'), ['opencode finished']);
  } finally {
    await h.close();
  }
});

test('M6-23 opencode title states work before the first plugin report and stop afterwards', async () => {
  // protects=plugin precedence over raw titles fails_when=title states override a reported opencode state no_claim=opencode title capture
  const engine = fixtureEngine('opencode', {
    state_plugin: 'plugins/opencode-state.js',
    state_titles: { working: '^BUSY ', waiting: '^WAIT ', idle: '^IDLE ' },
  });
  const h = await terminalFixture(engine.id, [engine]);
  try {
    await h.emit({ title: 'BUSY synthetic' });
    processEvents(h.db);
    assert.equal(h.row().state, 'working');
    h.send('opencode.state', { state: 'done', seq: 10 });
    await h.emit({ title: 'WAIT synthetic' });
    processEvents(h.db);
    assert.equal(h.row().state, 'done');
    await h.emit({ title: 'BUSY synthetic' });
    processEvents(h.db);
    assert.equal(h.row().state, 'done');
    assert.equal(h.count('core.title-state'), 3);
  } finally {
    await h.close();
  }
});

test('M6-23 opencode.state for a claude session changes nothing', async () => {
  // protects=forged opencode report rejection on non plugin engines fails_when=opencode state moves a claude session no_claim=process impersonation
  const h = await memoryDb('claude');
  try {
    assert.equal(h.send('claude.UserPromptSubmit'), 'working');
    assert.equal(h.row().state, 'working');
    assert.equal(h.send('opencode.state', { state: 'done', seq: 1 }), 'working');
    assert.equal(h.send('opencode.state', { state: 'waiting', why: 'permission', seq: 2 }), 'working');
    assert.equal(h.db.prepare('SELECT native_id FROM session WHERE id = ?').get(h.id)!.native_id, 'conv');
    // Forged opencode working report leaves session state and native id unchanged
    assert.equal(h.send('opencode.state', { state: 'working', seq: 3, session_id: 'foreign-root' }), 'working');
    assert.equal(h.row().state, 'working');
    assert.equal(h.db.prepare('SELECT native_id FROM session WHERE id = ?').get(h.id)!.native_id, 'conv');
    assert.equal(h.row().wait_reason, null);
    assert.deepEqual(h.notices('done'), []);
  } finally {
    await h.close();
  }
});

test('M6-23 unrelated root idle is ignored and unrelated root working relinks', async () => {
  // protects=opencode root session filtering and relinking fails_when=unrelated root idle finishes session or working fails to relink no_claim=multi-root UI routing
  const engine = fixtureEngine('opencode', { state_plugin: 'plugins/opencode-state.js' });
  const h = await memoryDb('opencode', [engine]);
  try {
    assert.equal(h.send('opencode.state', { state: 'working', seq: 1, session_id: 'root-1' }), 'working');
    assert.equal(h.db.prepare('SELECT native_id FROM session WHERE id = ?').get(h.id)!.native_id, 'root-1');

    assert.equal(h.send('opencode.state', { state: 'done', seq: 2, session_id: 'root-2' }), 'working');
    assert.equal(h.row().state, 'working');
    assert.deepEqual(h.notices('done'), []);
    assert.equal(h.db.prepare('SELECT native_id FROM session WHERE id = ?').get(h.id)!.native_id, 'root-1');

    assert.equal(h.send('opencode.state', { state: 'working', seq: 3, session_id: 'root-2' }), 'working');
    assert.equal(h.row().state, 'working');
    assert.equal(h.db.prepare('SELECT native_id FROM session WHERE id = ?').get(h.id)!.native_id, 'root-2');

    assert.equal(h.send('opencode.state', { state: 'done', seq: 4, session_id: 'root-2' }), 'done');
    assert.equal(h.row().state, 'done');
    assert.deepEqual(h.notices('done'), ['opencode finished']);
  } finally {
    await h.close();
  }
});

test('M6-23f Stop redaction keeps only bounded plain type and status pairs', async () => {
  // protects=Stop payload allowlist and storage fails_when=private fields invalid entries or excess tasks survive no_claim=all event kinds
  const h = await memoryDb();
  try {
    const raw = {
      session_id: 'conv',
      stop_hook_active: false,
      background_tasks: [
        { ...CAPTURED_STOP.background_tasks[0], description: MARKER, command: MARKER },
        CAPTURED_STOP.background_tasks[1],
        { type: '', status: 'running' },
        { type: 'Subagent', status: 'running' },
        { type: 'subagent', status: 'Rate Limit!' },
        { type: 'subagent', status: 'x'.repeat(41) },
        { type: 'x'.repeat(41), status: 'running' },
        { type: 'subagent', status: 1 },
        null,
        [MARKER],
      ],
      session_crons: [{ description: MARKER }],
      prompt: MARKER,
    };
    const expected = {
      session_id: 'conv',
      stop_hook_active: false,
      background_tasks: [
        { type: 'subagent', status: 'running' },
        { type: 'shell', status: 'running' },
      ],
    };
    assert.deepEqual(buildPayload('claude.Stop', raw), expected);
    assert.deepEqual(rebuildPayload('claude.Stop', raw), expected);
    for (const sanitize of [buildPayload, rebuildPayload]) {
      const capped = sanitize('claude.Stop', {
        background_tasks: Array.from({ length: 51 }, () => ({
          type: 'subagent', status: 'running', description: MARKER,
        })),
      }).background_tasks as Array<Record<string, unknown>>;
      assert.equal(capped.length, 50);
      for (const pair of capped) {
        assert.deepEqual(pair, { type: 'subagent', status: 'running' });
      }
      assert.deepEqual(sanitize('claude.Stop', {
        background_tasks: [{ type: 'a'.repeat(40), status: 'b'.repeat(40) }],
      }).background_tasks, [{ type: 'a'.repeat(40), status: 'b'.repeat(40) }]);
    }
    h.send('claude.UserPromptSubmit');
    h.send('claude.Stop', raw);
    const payload = h.db.prepare(
      "SELECT payload FROM event WHERE session_id = ? AND kind = 'claude.Stop'",
    ).get(h.id)!.payload;
    assert.deepEqual(JSON.parse(String(payload)), expected);
    assert.ok(!String(payload).includes(MARKER));
    assert.ok(!String(payload).includes('a050558653950c70b'));
    assert.ok(!String(payload).includes('sleep 45'));
    assert.ok(!String(payload).includes('session_crons'));
  } finally {
    await h.close();
  }
});

test('M6-23 opencode payloads retain only valid state why and integer seq', () => {
  // protects=opencode payload allowlist fails_when=private text or malformed fields pass no_claim=event transport
  for (const sanitize of [buildPayload, rebuildPayload]) {
    assert.deepEqual(sanitize('opencode.state', {
      state: 'waiting', why: 'permission', seq: 12,
      message: MARKER, properties: { prompt: MARKER },
    }), { state: 'waiting', why: 'permission', seq: 12 });
    assert.deepEqual(sanitize('opencode.state', {
      state: 'working', seq: 13,
    }), { state: 'working', seq: 13 });
    assert.deepEqual(sanitize('opencode.state', {
      state: 'done', seq: 14,
    }), { state: 'done', seq: 14 });
    assert.deepEqual(sanitize('opencode.state', {
      state: 'working', seq: 15, session_id: 'root-123',
    }), { state: 'working', seq: 15, session_id: 'root-123' });
    assert.deepEqual(sanitize('opencode.state', {
      state: 'busy', why: MARKER, seq: 1.5,
    }), {});
    assert.deepEqual(sanitize('opencode.state', {
      state: { message: MARKER }, why: ['error'], seq: '12',
    }), {});
  }
});

test('M6-23 malformed and two days ahead opencode reports are stored as empty and do not block valid reports', async () => {
  // protects=malformed and future seq opencode payload rejection fails_when=invalid seq is stored or blocks subsequent reports no_claim=clock drift tolerance
  const invalidState = { state: 'invalid', seq: 12345 };
  assert.deepEqual(buildPayload('opencode.state', invalidState), {});
  assert.deepEqual(rebuildPayload('opencode.state', invalidState), {});

  const twoDaysAhead = { state: 'working', seq: (Date.now() + 172_800_000) * 1000 };
  assert.deepEqual(buildPayload('opencode.state', twoDaysAhead), {});
  assert.deepEqual(rebuildPayload('opencode.state', twoDaysAhead), {});

  const engine = fixtureEngine('opencode', { state_plugin: 'plugins/opencode-state.js' });
  const h = await memoryDb('opencode', [engine]);
  try {
    h.send('opencode.state', { state: 'invalid', seq: 9_999_999_999 });
    assert.equal(h.row().state, 'starting');

    h.send('opencode.state', { state: 'working', seq: (Date.now() + 172_800_000) * 1000 });
    assert.equal(h.row().state, 'starting');

    assert.equal(h.send('opencode.state', { state: 'working', seq: 10 }), 'working');
    assert.equal(h.row().state, 'working');
  } finally {
    await h.close();
  }
});

test('M6-23g a bad idle regex loads, warns once and cannot arm an interrupt', async () => {
  // protects=invalid pattern recovery fails_when=engine is rejected warnings repeat or Escape arms no_claim=valid regex semantics
  const engine = fixtureEngine(`bad-title-${randomUUID().slice(0, 8)}`, {
    state_titles: { idle: '(' },
  });
  const folder = mkdtempSync(join(tmpdir(), 'troop-m623-engines-'));
  const warnings: string[] = [];
  const previousWarn = console.warn;
  let h: Awaited<ReturnType<typeof terminalFixture>> | undefined;
  try {
    writeFileSync(join(folder, 'synthetic.json'), JSON.stringify(engine));
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    const loaded = dataEngines(folder);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, engine.id);
    assert.equal(titlePatterns(loaded[0]).idle, undefined);
    assert.equal(titlePatterns(loaded[0]).idle, undefined);
    assert.equal(dataEngines(folder).length, 1);
    h = await terminalFixture(engine.id, loaded);
    h.send('claude.UserPromptSubmit');
    await h.emit({ title: WORKING_TITLE });
    assert.equal(term.write(h.id, '\x1b'), true);
    await h.emit({ title: IDLE_TITLE });
    processEvents(h.db);
    assert.equal(h.count('core.interrupted'), 0);
    assert.equal(h.count('core.title-state'), 0);
    assert.equal(h.row().state, 'working');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(engine.id));
    assert.ok(warnings[0].includes('state_titles.idle'));
    assert.equal(warnings[0].split('\n').length, 1);
  } finally {
    console.warn = previousWarn;
    if (h) await h.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('M6-23 an engine with no idle pattern never arms interrupt detection', async () => {
  // protects=optional idle pattern fails_when=Escape interrupts an engine without an idle rule no_claim=title based completion
  const engine = fixtureEngine('no-idle-fixture', { state_source: 'hooks' });
  const h = await terminalFixture(engine.id, [engine]);
  try {
    h.send('claude.UserPromptSubmit');
    await h.emit({ title: WORKING_TITLE });
    term.write(h.id, '\x1b');
    await h.emit({ title: IDLE_TITLE });
    processEvents(h.db);
    assert.equal(h.count('core.interrupted'), 0);
    assert.equal(h.row().state, 'working');
  } finally {
    await h.close();
  }
});

test('M6-23 launch supplies plugin environment and opencode config without any MCP server', async () => {
  // protects=state plugin launch configuration fails_when=reporter env or plugin-only config is absent no_claim=live engine plugin loading
  const h = await memoryDb();
  try {
    const engine = JSON.parse(readFileSync(join(ROOT, 'engines/opencode.json'), 'utf8')) as EngineSpec;
    assert.equal(engine.state_source, 'process');
    assert.equal(engine.state_plugin, 'plugins/opencode-state.js');
    assert.deepEqual(statePluginEnv(engine), {
      TROOP_NODE: process.execPath,
      TROOP_EVENT_JS: join(ROOT, 'core/event.js'),
    });
    assert.deepEqual(statePluginEnv(fixtureEngine('no-plugin-fixture')), {});
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM plugin').get()!.n, 0);
    const env = mcpAttachEnv(h.db, engine, h.id);
    assert.deepEqual(Object.keys(env), ['OPENCODE_CONFIG_CONTENT']);
    assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT), {
      mcp: {},
      plugin: [pathToFileURL(join(ROOT, 'engines/plugins/opencode-state.js')).href],
    });
    assert.deepEqual(mcpAttachEnv(h.db, {
      ...engine, state_plugin: undefined,
    }, h.id), {});
    assert.equal(existsSync(join(h.home, '.config/opencode/opencode.json')), false);
  } finally {
    await h.close();
  }
});

test('M6-23 the manifest bounds title sources and fixed fatal patterns', () => {
  // protects=engine manifest bounds fails_when=oversized or malformed engine fields validate no_claim=regex compilation
  const valid = fixtureEngine('schema-fixture', {
    state_titles: { working: 'busy', waiting: 'wait', idle: '(' },
    fatal_patterns: ['Invalid API key'],
    state_plugin: 'plugins/opencode-state.js',
  });
  assert.deepEqual(engineSchemaErrors(valid), []);
  for (const change of [
    { state_titles: { idle: 'x'.repeat(201) } },
    { state_titles: { idle: 3 } },
    { state_titles: { other: 'idle' } },
    { fatal_patterns: [] },
    { fatal_patterns: ['ab'] },
    { fatal_patterns: ['x'.repeat(201)] },
    { fatal_patterns: Array.from({ length: 21 }, () => 'fatal') },
  ]) {
    assert.notDeepEqual(engineSchemaErrors({ ...valid, ...change }), []);
  }
  assert.deepEqual(engineSchemaErrors({
    ...valid,
    state_titles: { idle: 'x'.repeat(200) },
    fatal_patterns: Array.from({ length: 20 }, () => 'x'.repeat(200)),
  }), []);
});
