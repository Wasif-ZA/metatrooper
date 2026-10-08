import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bs } from './helpers.ts';
import { canonicalPath, projectId, isAcuPath } from '../src/project.ts';
import { redactToolInput, buildPayload } from '../src/redact.ts';
import { nextState } from '../src/events/state.ts';
import { encode, createDecoder } from '../src/pipe/framing.ts';
import { cronMatches } from '../src/schedules.ts';
import { scrubParams } from '../src/pipe/commands.ts';

test('canonicalPath normalizes separators, drive case, and trailing slash', () => {
  const windows = `C:${bs}Proj${bs}`;
  assert.equal(canonicalPath(windows), 'c:/Proj');
  assert.equal(canonicalPath('c:/Proj/'), 'c:/Proj');
  assert.equal(canonicalPath(`D:${bs}Users${bs}A${bs}file`), 'd:/Users/A/file');
  assert.equal(canonicalPath('c:/Proj'), canonicalPath(windows));
  assert.equal(projectId(canonicalPath(windows)), createHash('sha1').update('c:/Proj').digest('hex'));
});

test('isAcuPath detects either separator and any case', () => {
  for (const path of ['C:/work/ACU/repo', `C:${bs}WORK${bs}acu${bs}repo`, 'work/acu']) assert.equal(isAcuPath(path), true, path);
  for (const path of ['C:/work/other/repo', 'C:/work/ACUish/repo', 'C:/workspace/acu/repo']) assert.equal(isAcuPath(path), false, path);
});

test('redaction retains only the first command word and length for shells', () => {
  for (const tool of ['Bash', 'PowerShell']) {
    const command = 'echo PRIVATE_MARKER and arguments';
    const output = redactToolInput(tool, { command, extra: 'PRIVATE_MARKER' });
    assert.equal(JSON.stringify(output).includes('PRIVATE_MARKER'), false);
    assert.deepEqual(Object.values(output).sort(), ['echo', command.length].sort());
  }
});

test('redaction retains only file_path for file tools', () => {
  for (const tool of ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    assert.deepEqual(redactToolInput(tool, { file_path: '/safe/file', content: 'PRIVATE_MARKER', old_string: 'PRIVATE_MARKER' }), { file_path: '/safe/file' });
  }
});

test('redaction retains only path for search tools', () => {
  for (const tool of ['Grep', 'Glob']) assert.deepEqual(redactToolInput(tool, { path: '/safe', pattern: 'PRIVATE_MARKER' }), { path: '/safe' });
});

test('WebFetch stores the URL host only', () => {
  const output = redactToolInput('WebFetch', { url: 'https://example.test/private/PRIVATE_MARKER?q=secret', prompt: 'PRIVATE_MARKER' });
  assert.deepEqual(Object.values(output), ['example.test']);
});

test('unknown and MCP tools store key names and value lengths only', () => {
  for (const tool of ['UnknownTool', 'mcp__server__run']) {
    const output = redactToolInput(tool, { query: 'PRIVATE_MARKER', count: '1234' });
    assert.deepEqual(output, { query: 14, count: 4 });
  }
});

test('buildPayload drops unknown fields for every specified event kind', () => {
  const cases = [
    ['launch', { session_id: 's', pid: 42, cwd: '/p', engine: 'fake', started_at: 'now' }, ['session_id', 'pid', 'cwd', 'engine', 'started_at']],
    ['claude.PreToolUse', { session_id: 'native', transcript_path: '/t', cwd: '/p', tool_name: 'Read', tool_use_id: 'u', tool_input: { file_path: '/safe', content: 'PRIVATE_MARKER' } }, ['session_id', 'transcript_path', 'cwd', 'tool_name', 'tool_use_id', 'tool_input']],
    ['claude.PostToolUse', { session_id: 'native', transcript_path: '/t', cwd: '/p', tool_name: 'Read', tool_use_id: 'u', tool_input: { file_path: '/safe' }, tool_response: 'PRIVATE_MARKER', response_length: 14 }, ['session_id', 'transcript_path', 'cwd', 'tool_name', 'tool_use_id', 'tool_input', 'response_length']],
    ['claude.UserPromptSubmit', { session_id: 'native', cwd: '/p', prompt: 'PRIVATE_MARKER', prompt_length: 14 }, ['session_id', 'cwd', 'prompt_length']],
    ['claude.Notification', { session_id: 'native', cwd: '/p', class: 'permission', message: 'PRIVATE_MARKER', message_length: 14 }, ['session_id', 'cwd', 'class', 'message_length']],
    ['claude.Stop', { session_id: 'native', cwd: '/p', stop_hook_active: false }, ['session_id', 'cwd', 'stop_hook_active']],
    ['claude.SessionEnd', { session_id: 'native', cwd: '/p', reason: 'logout' }, ['session_id', 'cwd', 'reason']],
    ['codex.turn', { type: 'agent-turn-complete', 'thread-id': 't', 'turn-id': 'u', cwd: '/p', input_length: 2, reply_length: 3 }, ['type', 'thread-id', 'turn-id', 'cwd', 'input_length', 'reply_length']],
    ['core.activity', { state: 'working' }, ['state']],
    ['core.process-gone', { pid: 42 }, ['pid']],
    ['core.seen', {}, []]
  ];
  for (const [kind, fields, allowed] of cases) {
    const result = buildPayload(kind, { ...fields, future_field: 'PRIVATE_MARKER', terminal_output: 'PRIVATE_MARKER' });
    assert.deepEqual(Object.keys(result).sort(), allowed.sort(), kind);
    assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false, kind);
  }
});

test('nextState follows every event row in the state mapping', () => {
  const cases = [
    ['launch', {}, 'starting'],
    ['claude.UserPromptSubmit', {}, 'working'],
    ['claude.PreToolUse', {}, null],
    ['claude.PostToolUse', {}, 'working'],
    ['claude.Notification', { class: 'permission' }, 'waiting_for_you'],
    ['claude.Notification', { class: 'input' }, 'waiting_for_you'],
    ['claude.Notification', { class: 'other' }, null],
    ['claude.Stop', {}, 'done'],
    ['claude.SessionEnd', {}, null],
    ['codex.turn', {}, 'done'],
    ['core.activity', { state: 'working' }, 'working'],
    ['core.process-gone', { pid: 42 }, 'exited'],
  ];
  for (const [kind, payload, expected] of cases) assert.equal(nextState('idle', { kind, payload }), expected, kind);
  assert.equal(nextState('working', { kind: 'claude.Notification', payload: { class: 'other' } }), null);
  assert.equal(nextState('starting', { kind: 'claude.Notification', payload: { class: 'idle' } }), 'idle');
  assert.equal(nextState('done', { kind: 'claude.Notification', payload: { class: 'idle' } }), null);
  assert.equal(nextState('done', { kind: 'claude.PreToolUse', payload: {} }), null);
  assert.equal(nextState('done', { kind: 'claude.PostToolUse', payload: {} }), 'working');
  for (const current of ['starting', 'waiting_for_you', 'unknown']) assert.equal(nextState(current, { kind: 'claude.PreToolUse', payload: {} }), 'working', current);
  assert.equal(nextState('idle', { kind: 'claude.SessionEnd', payload: {} }), null);
  assert.equal(nextState('working', { kind: 'claude.SessionEnd', payload: {} }), 'idle');
  for (const current of ['starting', 'working', 'waiting_for_you', 'done', 'idle', 'unknown']) {
    assert.equal(nextState(current, { kind: 'core.activity', payload: { state: 'working' } }), 'working', current);
    assert.equal(nextState(current, { kind: 'core.process-gone', payload: { pid: 42 } }), 'exited', current);
  }
  assert.equal(nextState('working', { kind: 'core.activity', payload: { state: 'quiet' } }), 'done');
  for (const current of ['starting', 'waiting_for_you', 'done', 'idle', 'unknown']) {
    assert.equal(nextState(current, { kind: 'core.activity', payload: { state: 'quiet' } }), null, current);
  }
  for (const current of ['starting', 'working', 'waiting_for_you', 'idle', 'unknown']) {
    assert.equal(nextState(current, { kind: 'core.seen', payload: {} }), null, current);
  }
  assert.equal(nextState('done', { kind: 'core.seen', payload: {} }), 'idle');
  for (const kind of ['core.checkpoint', 'core.recovered', 'core.missed-schedule']) {
    for (const current of ['starting', 'working', 'waiting_for_you', 'done', 'idle', 'unknown']) {
      assert.equal(nextState(current, { kind, payload: {} }), null, `${kind} from ${current}`);
    }
  }
  for (const [kind, payload] of [...cases, ['core.activity', { state: 'quiet' }], ['core.seen', {}], ['core.checkpoint', {}], ['core.recovered', {}], ['core.missed-schedule', {}]]) {
    assert.equal(nextState('exited', { kind, payload }), null, kind);
  }
});

test('framing round trips chunked and multiple lines and rejects over 1 MiB', () => {
  const messages = [];
  const decode = createDecoder(message => messages.push(message));
  const first = { jsonrpc: '2.0', id: 'one', result: { text: 'x\ny' } };
  const second = { jsonrpc: '2.0', id: 'two', result: {} };
  const wire = encode(first) + encode(second);
  assert.equal(wire, JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n');
  decode(wire.slice(0, 7));
  decode(Buffer.from(wire.slice(7)));
  assert.deepEqual(messages, [first, second]);
  const oversized = createDecoder(() => assert.fail('oversized line was decoded'));
  assert.throws(() => oversized('x'.repeat(1024 * 1024 + 1) + '\n'), { name: 'LineTooLong' });
});

test('shell redaction drops env-assignment prefixes and values', () => {
  const bash = redactToolInput('Bash', { command: 'GITHUB_TOKEN=PRIVATE_MARKER A=1 gh pr list' });
  assert.equal(bash.first_word, 'gh');
  const ps = redactToolInput('PowerShell', { command: "$env:KEY='PRIVATE_MARKER'; foo" });
  assert.equal(JSON.stringify(ps).includes('PRIVATE_MARKER'), false);
});

test('cron rejects out-of-range and malformed fields and reads n/step as n-max/step', () => {
  for (const bad of ['60 * * * *', 'x * * * *', '* 24 * * *', '*/0 * * * *', '5-1 * * * *', '* * * * 8']) {
    assert.throws(() => cronMatches(bad, new Date()), /bad cron field/, bad);
  }
  assert.equal(cronMatches('5/15 * * * *', new Date(2026, 0, 1, 0, 20)), true);
  assert.equal(cronMatches('5/15 * * * *', new Date(2026, 0, 1, 0, 21)), false);
  assert.equal(cronMatches('0 9 * * 7', new Date(2026, 8, 27, 9, 0)), true);
  assert.equal(cronMatches('0 9 * * 1-5', new Date(2026, 8, 28, 9, 0)), true);
});

test('decoder reports a bad line and still delivers the lines after it', () => {
  const got: unknown[] = [];
  const errors: Error[] = [];
  const decode = createDecoder((m) => got.push(m), (e) => errors.push(e));
  decode('{bad}\n{"ok":1}\n');
  assert.equal(errors.length, 1);
  assert.deepEqual(got, [{ ok: 1 }]);
});

test('core.stalled moves only a starting session to waiting_for_you', () => {
  assert.equal(nextState('starting', { kind: 'core.stalled', payload: {} }), 'waiting_for_you');
  for (const current of ['working', 'done', 'idle', 'waiting_for_you', 'exited']) {
    assert.equal(nextState(current, { kind: 'core.stalled', payload: {} }), null, current);
  }
});

test('agy activity_waiting matches an unanswered tool call and not a finished reply', async () => {
  const { BUILT_IN } = await import('../src/engines/registry.ts');
  const re = new RegExp(BUILT_IN.find((e) => e.id === 'agy')!.activity_waiting!.last_line_regex);
  assert.equal(re.test('{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{"name":"run_command","args":{}}]}'), true);
  assert.equal(re.test('{"step_index":4,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"fixed"}'), false);
  assert.equal(nextState('working', { kind: 'core.activity', payload: { state: 'blocked' } }), 'waiting_for_you');
  assert.equal(nextState('waiting_for_you', { kind: 'core.activity', payload: { state: 'working' } }), 'working');
});

test('trustFolder writes each declared store once and keeps existing content', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { trustFolder } = await import('../src/trust.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-trust-'));
  const json = path.join(dir, 'state.json');
  const list = path.join(dir, 'settings.json');
  const toml = path.join(dir, 'config.toml');
  fs.writeFileSync(json, JSON.stringify({ oauth: 'keep', projects: { 'c:/other': { hasTrustDialogAccepted: true } } }));
  fs.writeFileSync(list, JSON.stringify({ permissions: {}, trustedWorkspaces: [`c:${bs}other`] }));
  fs.writeFileSync(toml, 'model = "x"\n');
  const engines = [
    { id: 'a', trust: { kind: 'json-map', file: json, at: ['projects'], set: { hasTrustDialogAccepted: true }, path_style: 'posix' } },
    { id: 'b', trust: { kind: 'json-list', file: list, at: ['trustedWorkspaces'], path_style: 'windows' } },
    { id: 'c', trust: { kind: 'toml-table', file: toml, at: ['projects'], set: { trust_level: 'trusted' }, path_style: 'windows-lower' } },
    { id: 'd' },
  ] as any[];
  const wt = `C:${bs}Work${bs}Tree`;
  for (let i = 0; i < 2; i++) assert.deepEqual(trustFolder(wt, engines), ['a', 'b', 'c']);
  const j = JSON.parse(fs.readFileSync(json, 'utf8'));
  assert.equal(j.oauth, 'keep');
  assert.deepEqual(j.projects['c:/Work/Tree'], { hasTrustDialogAccepted: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(list, 'utf8')).trustedWorkspaces, [`c:${bs}other`, `c:${bs}Work${bs}Tree`]);
  const t = fs.readFileSync(toml, 'utf8');
  assert.equal(t.startsWith('model = "x"\n'), true);
  assert.equal(t.split(`[projects.'c:${bs}work${bs}tree']`).length - 1, 1);
  assert.match(t, /trust_level = "trusted"/);
});

test('codex.turn from another thread does not mark the session done', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-thread-'));
  try {
    const { openCoreDb } = await import('../src/store/db.ts');
    const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
    const { appendEvent } = await import('../src/events/append.ts');
    const { processEvents } = await import('../src/events/processor.ts');
    const db = openCoreDb();
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', 'c:/p', 'p', 'x', 'x')").run();
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id) VALUES ('s', 'p', 'codex', 'pty', 'working', 'x', 'x', 'main')").run();
    const state = () => (db.prepare("SELECT state FROM session WHERE id = 's'").get() as { state: string }).state;
    appendEvent('codex.turn', 's', { 'thread-id': 'side' }, db);
    processEvents(db);
    assert.equal(state(), 'working');
    appendEvent('codex.turn', 's', { 'thread-id': 'main' }, db);
    processEvents(db);
    assert.equal(state(), 'done');
    db.close();
  } finally {
    if (prev === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = prev;
  }
});

test('resolveSpentNotices clears notices for exited, missing and re-working sessions only', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-spent-'));
  try {
    const { openCoreDb } = await import('../src/store/db.ts');
    const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
    const { resolveSpentNotices } = await import('../src/events/processor.ts');
    const db = openCoreDb();
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', 'c:/p', 'p', 'x', 'x')").run();
    const session = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, ended_at) VALUES (?, 'p', 'claude', 'pty', ?, 'x', 'x', ?)");
    session.run('exited', 'exited', 'x');
    session.run('live', 'done', null);
    session.run('again', 'working', null);
    const note = db.prepare("INSERT INTO needs_you (id, at, kind, ref, text, read_at) VALUES (?, 'x', ?, ?, 't', ?)");
    note.run('exited-done', 'done', 'exited', null);
    note.run('gone-done', 'done', 'gone', null);
    note.run('exited-failed-unread', 'failed', 'exited', null);
    note.run('exited-failed-read', 'failed', 'exited', 'x');
    note.run('live-done', 'done', 'live', null);
    note.run('again-done', 'done', 'again', null);
    note.run('gate', 'gate', 'exited', null);
    resolveSpentNotices(db);
    const open = (db.prepare('SELECT id FROM needs_you WHERE resolved_at IS NULL ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
    assert.deepEqual(open, ['exited-failed-unread', 'gate', 'live-done']);
    db.close();
  } finally {
    if (prev === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = prev;
  }
});

test('scrubParams keeps ids and replaces prompt and body text with lengths', () => {
  assert.deepEqual(scrubParams({ project_id: 'p', engine_id: 'claude', prompt: 'PRIVATE_MARKER' }), { project_id: 'p', engine_id: 'claude', prompt_length: 14 });
  assert.deepEqual(scrubParams({ body: 'abc', session_id: 's' }), { body_length: 3, session_id: 's' });
});

test('planArgs inserts the approval profile args before the prompt', async () => {
  const { planArgs } = await import('../src/sessions/launch.ts');
  const { BUILT_IN } = await import('../src/engines/registry.ts');
  const engine = (id: string) => BUILT_IN.find((e) => e.id === id)!;
  assert.deepEqual(planArgs(engine('claude'), 'task', 'contained').argv, ['claude', '--permission-mode', 'auto', 'task']);
  assert.deepEqual(planArgs(engine('codex'), 'task', 'edits').argv, ['codex', '--sandbox', 'workspace-write', 'task']);
  assert.deepEqual(planArgs(engine('agy'), 'task', 'contained').argv, ['agy', '--mode', 'accept-edits', '--sandbox', '--prompt-interactive', 'task']);
  assert.deepEqual(planArgs(engine('claude'), 'task').argv, ['claude', 'task']);
  for (const e of BUILT_IN) {
    for (const args of Object.values(e.approval_profiles ?? {})) {
      assert.equal(args.some((a) => /dangerous|bypass/i.test(a)), false, `${e.id} profile must not bypass all checks`);
    }
  }
});

test('engine settings install records old values and uninstall restores them', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const prev = process.env.METATROOPER_HOME;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-settings-'));
  process.env.METATROOPER_HOME = dir;
  try {
    const { installEngineSettings, uninstallEngineSettings } = await import('../src/hooks/install.ts');
    const file = path.join(dir, 'settings.json');
    const original = JSON.stringify({ permissions: { allow: ['read_file(*)'] }, toolPermission: 'ask' }, null, 2);
    fs.writeFileSync(file, original);
    const engines = [{ id: 'x', settings: { file, set: { toolPermission: 'proceed-in-sandbox', extra: true } } }] as any[];
    installEngineSettings(engines);
    installEngineSettings(engines);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(doc.toolPermission, 'proceed-in-sandbox');
    assert.equal(doc.extra, true);
    uninstallEngineSettings();
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally {
    if (prev === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = prev;
  }
});
