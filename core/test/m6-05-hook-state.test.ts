import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const GEMINI_EVENTS = ['SessionStart', 'BeforeAgent', 'AfterTool', 'Notification', 'AfterAgent'];
const CODEX_EVENTS = ['SessionStart', 'PermissionRequest', 'Stop', 'Interrupt'];

/** A core whose only engine runs `engine.js` from the test home: it records its argv and the Gemini settings variable, then lives until `stop` exists. */
async function hookHarness(spec: Record<string, unknown>) {
  const isolated = isolation();
  const script = join(isolated.home, 'engine.js');
  writeFileSync(script, `const fs = require('node:fs'), path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'seen.json'), JSON.stringify({ argv: process.argv.slice(2), settings: process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? null }));
setInterval(() => { if (fs.existsSync(path.join(__dirname, 'stop'))) process.exit(0); }, 100);
setTimeout(() => process.exit(0), 30000);
`);
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'hooked', command: process.execPath, args: [script], state_source: 'hooks', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'], ...spec }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const project = join(isolated.home, 'proj');
  mkdirSync(project, { recursive: true });
  const pipe = await client(isolated.prefix);
  let sessionId: string;
  try {
    const opened = await pipe.request('project.open', { path: project });
    const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'hooked' });
    assert.ok(launched.result?.session_id, JSON.stringify(launched));
    sessionId = launched.result.session_id;
  } finally { pipe.close(); }
  const store = new DatabaseSync(join(isolated.home, 'troop.db'));
  store.exec('PRAGMA busy_timeout = 2000');
  await until(() => existsSync(join(isolated.home, 'seen.json')), 10000);
  const seen = JSON.parse(readFileSync(join(isolated.home, 'seen.json'), 'utf8')) as { argv: string[]; settings: string | null };
  const row = () => store.prepare('SELECT state, native_id FROM session WHERE id = ?').get(sessionId) as { state: string; native_id: string | null };
  /** Runs a hook command the way the engine would, through the shell, with the hook input on stdin. */
  const fire = (command: string, input: object) => new Promise<void>((resolve, reject) => {
    const child = exec(command, { cwd: project, env, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    child.stdin!.end(JSON.stringify({ cwd: project, ...input }));
  });
  /** Fires the hook, then requires the session to reach `state` within 2 s of the hook starting. */
  const expectWithin2s = async (command: string, input: object, state: string) => {
    const started = Date.now();
    await fire(command, input);
    await until(() => row().state === state, Math.max(1, 2000 - (Date.now() - started)));
  };
  return {
    ...isolated, env, sessionId, store, seen, row, fire, expectWithin2s,
    stop: () => writeFileSync(join(isolated.home, 'stop'), ''),
    async teardown() { store.close(); await teardownCore(core, isolated); },
  };
}

test('M6-05b a Gemini session gets its native_id, waiting_for_you and done from its hooks; ~/.gemini/settings.json is untouched and the per-session file is gone after exit', async () => {
  const g =await hookHarness({ hooks: { kind: 'gemini-system-settings', events: GEMINI_EVENTS } });
  try {
    const userSettings = join(g.home, '.gemini', 'settings.json');
    mkdirSync(join(g.home, '.gemini'), { recursive: true });
    const original = '{\n  "theme": "Default",\n  "hooks": { "AfterAgent": [] }\n}\n';
    writeFileSync(userSettings, original);
    assert.equal(g.seen.settings, join(g.home, 'engines', 'gemini', `${g.sessionId}.json`));
    const file = JSON.parse(readFileSync(g.seen.settings!, 'utf8'));
    assert.deepEqual(Object.keys(file), ['hooks']);
    assert.deepEqual(Object.keys(file.hooks), GEMINI_EVENTS);
    const command = (ev: string) => file.hooks[ev][0].hooks[0].command as string;
    assert.match(command('AfterAgent'), new RegExp(`gemini\\.AfterAgent --session ${g.sessionId}$`));

    await g.expectWithin2s(command('SessionStart'), { session_id: 'gem-native-1', hook_event_name: 'SessionStart', source: 'startup' }, 'idle');
    assert.equal(g.row().native_id, 'gem-native-1');
    await g.expectWithin2s(command('BeforeAgent'), { session_id: 'gem-native-1', prompt: 'do it' }, 'working');
    await g.expectWithin2s(command('Notification'), { session_id: 'gem-native-1', notification_type: 'ToolPermission', message: 'allow?' }, 'waiting_for_you');
    await g.expectWithin2s(command('AfterTool'), { session_id: 'gem-native-1', tool_name: 'run_shell_command', tool_input: { command: 'secret words' } }, 'working');
    await g.expectWithin2s(command('AfterAgent'), { session_id: 'gem-native-1', prompt: 'do it', prompt_response: 'reply text' }, 'done');

    const stored = (g.store.prepare("SELECT payload FROM event WHERE session_id = ? AND kind LIKE 'gemini.%'").all(g.sessionId) as Array<{ payload: string }>).map((r) => r.payload).join('\n');
    for (const secret of ['do it', 'reply text', 'secret words', 'allow?']) assert.ok(!stored.includes(secret), `stored ${secret}`);

    g.stop();
    await until(() => g.row().state === 'exited', 15000);
    await until(() => !existsSync(g.seen.settings!), 2000);
    assert.equal(readFileSync(userSettings, 'utf8'), original);
  } finally { await g.teardown(); }
});

test('M6-05a a Codex session with -c hooks shows waiting_for_you within 2 s of PermissionRequest, never done while the approval is open, and done within 2 s of Stop', async () => {
  const c = await hookHarness({ hooks: { kind: 'codex-config', events: CODEX_EVENTS } });
  try {
    const commands: Record<string, string> = {};
    for (let i = 0; i < c.seen.argv.length; i++) {
      const m = c.seen.argv[i - 1] === '-c' ? /^hooks\.(\w+)=\[\{hooks=\[\{type="command",command=(".*")\}\]\}\]$/.exec(c.seen.argv[i]) : null;
      if (m) commands[m[1]] = JSON.parse(m[2]);
    }
    assert.deepEqual(Object.keys(commands), CODEX_EVENTS);
    const thread = '0199cccc-1111-2222-3333-444455556666';
    await c.expectWithin2s(commands.SessionStart, { session_id: thread, hook_event_name: 'SessionStart', source: 'startup' }, 'idle');
    assert.equal(c.row().native_id, thread);
    const { appendEvent } = await import('../src/events/append.ts');
    appendEvent('core.activity', c.sessionId, { state: 'working' }, c.store);
    await until(() => c.row().state === 'working', 2000);
    await c.expectWithin2s(commands.PermissionRequest, { session_id: thread, tool_name: 'shell', tool_input: { command: ['rm', '-rf', 'x'] } }, 'waiting_for_you');
    appendEvent('core.activity', c.sessionId, { state: 'quiet' }, c.store);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(c.row().state, 'waiting_for_you');
    appendEvent('core.activity', c.sessionId, { state: 'working' }, c.store);
    await until(() => c.row().state === 'working', 2000);
    await c.expectWithin2s(commands.Stop, { session_id: thread, last_assistant_message: 'bye' }, 'done');
    await c.expectWithin2s(commands.Interrupt, { session_id: thread }, 'idle');
  } finally { c.stop(); await c.teardown(); }
});

async function memoryDb() {
  const home = mkdtempSync(join(os.tmpdir(), 'troop-m605-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, METATROOPER_HOME: join(home, 'mt') });
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { appendEvent } = await import('../src/events/append.ts');
  const { processEvents } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  syncEngines(db, BUILT_IN);
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s', 'p', 'claude', 'pty', 'starting', 'x', ?)").run(new Date().toISOString());
  const state = () => (db.prepare("SELECT state FROM session WHERE id = 's'").get() as { state: string }).state;
  const send = (kind: string, payload: Record<string, unknown> = {}) => {
    appendEvent(kind, 's', { session_id: 'conv', cwd: home, ...payload }, db);
    processEvents(db);
    return state();
  };
  const done = () => {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  return { db, send, state, done };
}

test('M6-05c a Claude permission wait (Notification) holds through another call\'s PreToolUse and PostToolUse and ends on the waited call\'s PostToolUse', async () => {
  const t = await memoryDb();
  try {
    assert.equal(t.send('claude.UserPromptSubmit'), 'working');
    assert.equal(t.send('claude.PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' }), 'working');
    assert.equal(t.send('claude.Notification', { class: 'permission' }), 'waiting_for_you');
    assert.equal(t.send('claude.PreToolUse', { tool_name: 'Read', tool_use_id: 'toolu_B' }), 'waiting_for_you');
    assert.equal(t.send('claude.PostToolUse', { tool_name: 'Read', tool_use_id: 'toolu_B' }), 'waiting_for_you');
    assert.equal((t.db.prepare("SELECT last_tool FROM session WHERE id = 's'").get() as { last_tool: string }).last_tool, 'Bash');
    assert.equal(t.send('claude.PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' }), 'working');
    assert.equal(t.send('claude.PreToolUse', { tool_name: 'Read', tool_use_id: 'toolu_C' }), 'working');
  } finally { t.done(); }
});

test('M6-05c a PermissionRequest names the waited call itself; a new prompt also ends the wait', async () => {
  const t = await memoryDb();
  try {
    t.send('claude.UserPromptSubmit');
    t.send('claude.PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_B' });
    t.send('claude.PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' });
    assert.equal(t.send('claude.PermissionRequest', { tool_name: 'Bash', tool_use_id: 'toolu_B' }), 'waiting_for_you');
    assert.equal(t.send('claude.Notification', { class: 'permission' }), 'waiting_for_you');
    assert.equal(t.send('claude.PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' }), 'waiting_for_you');
    assert.equal(t.send('claude.PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'toolu_B' }), 'working');
    assert.equal(t.send('claude.PermissionRequest', { tool_name: 'Bash', tool_use_id: 'toolu_D' }), 'waiting_for_you');
    assert.equal(t.send('claude.UserPromptSubmit'), 'working');
  } finally { t.done(); }
});

test('M6-05c a side conversation\'s PermissionRequest under the same session does not hold the main conversation\'s wait', async () => {
  const t = await memoryDb();
  try {
    t.send('claude.UserPromptSubmit');
    t.send('claude.PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' });
    assert.equal(t.send('claude.PermissionRequest', { tool_name: 'Bash', tool_use_id: 'toolu_A' }), 'waiting_for_you');
    assert.equal(t.send('claude.PermissionRequest', { session_id: 'side', tool_name: 'Edit', tool_use_id: 'toolu_X' }), 'waiting_for_you');
    assert.equal(t.send('claude.PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' }), 'working');
  } finally { t.done(); }
});

test('M6-05c a PermissionRequest for an earlier call names that call\'s tool, and its wait keeps it after the other call finishes', async () => {
  const t = await memoryDb();
  const lastTool = () => (t.db.prepare("SELECT last_tool FROM session WHERE id = 's'").get() as { last_tool: string | null }).last_tool;
  try {
    t.send('claude.UserPromptSubmit');
    t.send('claude.PreToolUse', { tool_name: 'Edit', tool_use_id: 'toolu_B' });
    t.send('claude.PreToolUse', { tool_name: 'Read', tool_use_id: 'toolu_A' });
    t.send('claude.PermissionRequest', { tool_name: 'Edit', tool_use_id: 'toolu_B' });
    assert.equal(lastTool(), 'Edit');
    t.send('claude.PostToolUse', { tool_name: 'Read', tool_use_id: 'toolu_A' });
    assert.equal(lastTool(), 'Edit');
    assert.equal(t.send('claude.PostToolUse', { tool_name: 'Edit', tool_use_id: 'toolu_B' }), 'working');
    assert.equal(lastTool(), null);
  } finally { t.done(); }
});

test('M6-05c a wait that did not come from a permission prompt is not held by an old finished one', async () => {
  const t = await memoryDb();
  try {
    t.send('claude.UserPromptSubmit');
    t.send('claude.PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' });
    t.send('claude.Notification', { class: 'permission' });
    t.send('claude.PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_A' });
    assert.equal(t.send('term.bell', {}), 'waiting_for_you');
    assert.equal(t.send('claude.PreToolUse', { tool_name: 'Read', tool_use_id: 'toolu_B' }), 'working');
  } finally { t.done(); }
});

test('Claude hook events follow the installed version: PermissionRequest from 2.0.45, StopFailure from 2.1.78, PostToolUseFailure from 2.1.119', async () => {
  const { claudeHookEvents } = await import('../src/hooks/install.ts');
  const base = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];
  assert.deepEqual(claudeHookEvents(null), base);
  assert.deepEqual(claudeHookEvents('2.0.45'), [...base, 'PermissionRequest']);
  assert.deepEqual(claudeHookEvents('2.1.78'), [...base, 'StopFailure', 'PermissionRequest']);
  assert.deepEqual(claudeHookEvents('2.1.296'), [...base, 'StopFailure', 'PermissionRequest', 'PostToolUseFailure']);
});

test('the Codex and Gemini hook payloads keep only the allowlisted fields', async () => {
  const { buildPayload } = await import('../src/redact.ts');
  const raw = { session_id: 'n', cwd: '/p', transcript_path: '/t', tool_name: 'shell', tool_input: { command: 'x' }, prompt: 'p', prompt_response: 'r', message: 'm', notification_type: 'ToolPermission', source: 'startup', last_assistant_message: 'a' };
  assert.deepEqual(buildPayload('gemini.Notification', raw), { session_id: 'n', transcript_path: '/t', cwd: '/p', tool_name: 'shell', notification_type: 'ToolPermission', source: 'startup' });
  assert.deepEqual(Object.keys(buildPayload('codex.Stop', raw)).sort(), ['cwd', 'notification_type', 'session_id', 'source', 'tool_name', 'transcript_path']);
  assert.deepEqual(buildPayload('claude.PermissionRequest', { ...raw, tool_name: 'Bash', tool_use_id: 'u', tool_input: { command: 'rm -rf /' } }).tool_input, { first_word: 'rm', length: 8 });
});

test('the shipped Codex and Gemini engines declare no hooks until their blockers in the M6-5 issue clear, and a hooks entry passes the engine schema', async () => {
  const { BUILT_IN, dataEngines } = await import('../src/engines/registry.ts');
  const { engineSchemaErrors } = await import('../src/plugins/manifest.ts');
  const { root } = await import('./helpers.ts');
  const codex = BUILT_IN.find((e) => e.id === 'codex')!;
  const gemini = dataEngines(join(root, 'engines')).find((e) => e.id === 'gemini')!;
  assert.equal(codex.hooks, undefined);
  assert.equal(gemini.hooks, undefined);
  assert.deepEqual(engineSchemaErrors({ ...gemini, hooks: { kind: 'gemini-system-settings', events: GEMINI_EVENTS } }), []);
  assert.notDeepEqual(engineSchemaErrors({ ...gemini, hooks: { kind: 'gemini-system-settings', events: ['After Agent; rm'] } }), []);
});
