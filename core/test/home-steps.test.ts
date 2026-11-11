import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../src/events/append.ts';
import { processEvents } from '../src/events/processor.ts';
import { buildPayload, rebuildPayload } from '../src/redact.ts';

const AT = '2026-11-11T00:00:00.000Z';
const SHIM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hook', 'mcp-shim.ts');

async function fixture(run: (db: DatabaseSync, home: string) => Promise<void> | void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-home-steps-'));
  const prev = { METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    db = openCoreDb();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/fixture/p1', 'p1', ?, ?)").run(AT, AT);
    for (const e of ['claude', 'codex']) db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES (?, '{}', 1)").run(e);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at) VALUES ('s1', 'p1', 'claude', 'pty', '/fixture/p1', 'working', ?, ?)").run(AT, AT);
    await run(db, process.env.METATROOPER_HOME);
  } finally {
    try { db?.close(); } finally {
      if (prev.METATROOPER_HOME === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prev.METATROOPER_HOME;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

const steps = (db: DatabaseSync) => db.prepare("SELECT idx, text, done FROM session_step WHERE session_id = 's1' ORDER BY idx").all().map((r) => ({ ...r }));

function hook(db: DatabaseSync, kind: string, tool_name: string, tool_input: object) {
  appendEvent(kind, 's1', buildPayload(kind, { session_id: 'conv1', tool_name, tool_use_id: `t${Math.random()}`, tool_input, tool_response: { ok: true } }), db);
  processEvents(db);
}

test('migration 018 creates session_step and records itself', async () => {
  await fixture((db) => {
    assert.ok(db.prepare("SELECT 1 FROM schema_migration WHERE id = 18").get());
    assert.deepEqual(db.prepare('PRAGMA table_info(session_step)').all().map((c) => (c as { name: string }).name), ['session_id', 'idx', 'text', 'done']);
  });
});

test('steps_set over MCP replaces the session list through a core.steps event', async () => {
  await fixture(async (db, home) => {
    const child = spawn(process.execPath, [SHIM, 'steps'], { env: { ...process.env, METATROOPER_HOME: home, TROOP_SESSION_ID: 's1' }, stdio: ['pipe', 'pipe', 'inherit'] });
    const replies: Array<{ id: number; result: Record<string, unknown> }> = [];
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { buf += c; for (let i; (i = buf.indexOf('\n')) >= 0;) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const ask = (id: number, method: string, params: object) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise<Record<string, unknown>>((resolve) => { const t = setInterval(() => { const r = replies.find((x) => x.id === id); if (r) { clearInterval(t); resolve(r.result); } }, 20); });
    };
    try {
      await ask(1, 'initialize', {});
      const list = (await ask(2, 'tools/list', {})) as { tools: Array<{ name: string; description: string }> };
      assert.deepEqual(list.tools.map((t) => t.name), ['steps_set']);
      assert.match(list.tools[0].description, /plan/);
      const items = [{ text: 'read the spec', done: true }, { text: 'x'.repeat(300), done: false, secret: 'nope' }];
      const out = (await ask(3, 'tools/call', { name: 'steps_set', arguments: { items } })) as { isError?: boolean };
      assert.equal(out.isError, undefined);
      await ask(4, 'tools/call', { name: 'steps_set', arguments: { items: [items[0], { text: 'write the tests', done: false }] } });
    } finally {
      child.kill();
    }
    processEvents(db);
    assert.deepEqual(steps(db), [{ idx: 0, text: 'read the spec', done: 1 }, { idx: 1, text: 'write the tests', done: 0 }]);
    const stored = db.prepare("SELECT payload FROM event WHERE kind = 'core.steps' ORDER BY seq").all() as Array<{ payload: string }>;
    assert.equal(JSON.parse(stored[0].payload).items[1].text.length, 200);
    assert.ok(!stored[0].payload.includes('nope'));
  });
});

test('TodoWrite replaces the list on PreToolUse and PostToolUse', async () => {
  await fixture((db) => {
    hook(db, 'claude.PreToolUse', 'TodoWrite', { todos: [{ content: 'a', status: 'completed', activeForm: 'doing a' }, { content: 'b', status: 'in_progress', activeForm: 'doing b' }] });
    assert.deepEqual(steps(db), [{ idx: 0, text: 'a', done: 1 }, { idx: 1, text: 'b', done: 0 }]);
    hook(db, 'claude.PostToolUse', 'TodoWrite', { todos: [{ content: 'c', status: 'pending', activeForm: 'doing c' }] });
    assert.deepEqual(steps(db), [{ idx: 0, text: 'c', done: 0 }]);
  });
});

test('TaskCreate adds and TaskUpdate marks or drops one row, only once finished', async () => {
  await fixture((db) => {
    hook(db, 'claude.PreToolUse', 'TaskCreate', { subject: 'ignored before it runs', description: 'd' });
    assert.deepEqual(steps(db), []);
    hook(db, 'claude.PostToolUse', 'TaskCreate', { subject: 'first', description: 'long private detail', activeForm: 'x' });
    hook(db, 'claude.PostToolUse', 'TaskCreate', { subject: 'second', description: 'd' });
    hook(db, 'claude.PostToolUse', 'TaskCreate', { subject: 'third', description: 'd' });
    hook(db, 'claude.PostToolUse', 'TaskUpdate', { taskId: '1', status: 'completed' });
    hook(db, 'claude.PostToolUse', 'TaskUpdate', { taskId: '2', status: 'deleted' });
    hook(db, 'claude.PostToolUse', 'TaskUpdate', { taskId: '3', subject: 'third, renamed' });
    assert.deepEqual(steps(db), [{ idx: 0, text: 'first', done: 1 }, { idx: 2, text: 'third, renamed', done: 0 }]);
  });
});

test('a hook event for the steps_set tool itself leaves the list alone', async () => {
  await fixture((db) => {
    hook(db, 'claude.PostToolUse', 'TodoWrite', { todos: [{ content: 'kept', status: 'pending' }] });
    hook(db, 'codex.PostToolUse', 'steps_set', { items: [{ text: 'x', done: true }] });
    hook(db, 'claude.PostToolUse', 'mcp__ouros-steps__steps_set', { items: [] });
    assert.deepEqual(steps(db), [{ idx: 0, text: 'kept', done: 0 }]);
  });
});

test('Codex update_plan replaces the list', async () => {
  await fixture((db) => {
    hook(db, 'codex.PostToolUse', 'update_plan', { explanation: 'why it matters', plan: [{ step: 'scan', status: 'completed' }, { step: 'fix', status: 'in_progress' }] });
    assert.deepEqual(steps(db), [{ idx: 0, text: 'scan', done: 1 }, { idx: 1, text: 'fix', done: 0 }]);
  });
});

test('plan tool redaction keeps only step text and status, capped, and survives the sandbox re-check', () => {
  const todos = Array.from({ length: 40 }, (_, i) => ({ content: `step ${i} ${'y'.repeat(300)}`, status: 'pending', activeForm: 'secret form', id: 'x' }));
  todos[0].content = 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789 here';
  const built = buildPayload('claude.PostToolUse', { session_id: 'c', tool_name: 'TodoWrite', tool_input: { todos, extra: 'drop me' }, tool_response: 'r' });
  const items = (built.tool_input as { items: Array<Record<string, unknown>> }).items;
  assert.deepEqual(Object.keys(built.tool_input as object), ['items']);
  assert.equal(items.length, 30);
  assert.ok(items.every((t) => Object.keys(t).join() === 'text,status' && (t.text as string).length <= 200));
  assert.equal(items[0].text, 'use [secret] here');
  assert.deepEqual(rebuildPayload('claude.PostToolUse', built), built);

  const update = buildPayload('claude.PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '12', status: 'completed', description: 'private', owner: 'me', metadata: { a: 1 } } });
  assert.deepEqual(update.tool_input, { taskId: '12', status: 'completed' });
  assert.deepEqual(buildPayload('claude.PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '../x', status: 'weird' } }).tool_input, {});
  assert.deepEqual(buildPayload('codex.PostToolUse', { tool_name: 'update_plan', tool_input: { explanation: 'private', plan: [{ step: 's', status: 'completed' }] } }).tool_input, { items: [{ text: 's', status: 'completed' }] });
  assert.deepEqual(buildPayload('claude.PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf /secret' } }).tool_input, { first_word: 'rm', length: 14 });
  assert.deepEqual(buildPayload('claude.PreToolUse', { tool_name: 'Other', tool_input: { todos: 'abc' } }).tool_input, { todos: 3 });
});
