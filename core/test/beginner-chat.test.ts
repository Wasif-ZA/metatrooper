import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines } from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { buildMethods } from '../src/methods.ts';

type Handler = (p: Record<string, unknown>) => unknown;

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'troop-chat-'));
  const vars = { HOME: home, USERPROFILE: home, METATROOPER_HOME: join(home, 'mt'), METATROOPER_FAKE_DPAPI: '1' };
  const previous = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  const db = openCoreDb();
  syncEngines(db, BUILT_IN);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'todo-app', now, now);
  const session = (engine = 'claude', state = 'working') => {
    const id = `s_${randomUUID().replace(/-/g, '')}`;
    db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id) VALUES (?, 'p1', ?, 'pty', ?, ?, ?, 'conv')`).run(id, engine, state, now, now);
    return id;
  };
  const methods = buildMethods(db, { uiKey: 'test', approvalTimeoutMs: 1000, engines: () => [] } as never) as Map<string, { handler: Handler }>;
  const chat = (p: Record<string, unknown>) => Promise.resolve(methods.get('session.chat')!.handler(p)) as Promise<Record<string, any>>;
  const transcript = (lines: object[]) => {
    const file = join(home, `${randomUUID()}.jsonl`);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return file;
  };
  const close = () => {
    db.close();
    rmSync(home, { recursive: true, force: true });
    for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  return { db, home, session, chat, transcript, close };
}

const user = (content: unknown, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown[], extra = {}) => ({ type: 'assistant', message: { role: 'assistant', content }, ...extra });
const point = (db: DatabaseSync, id: string, file: string) => appendEvent('claude.Stop', id, { session_id: 'native', transcript_path: file, cwd: '.' }, db);

test('session.chat turns a Claude transcript into messages, tool rows and edit cards', async () => {
  const f = fixture();
  try {
    const id = f.session();
    point(f.db, id, f.transcript([
      user('Add a delete button to each todo'),
      assistant([{ type: 'text', text: 'I will add the route first.' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'routes/todos.js', old_string: 'a', new_string: 'b' } }]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      assistant([{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }]),
      user([{ type: 'tool_result', tool_use_id: 't2', content: '1 failing', is_error: true }]),
      assistant([{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: 'views/list.html' } }]),
      user([{ type: 'tool_result', tool_use_id: 't3', content: '<ul>' }]),
      assistant([{ type: 'text', text: 'Done. The delete button removes the todo.' }]),
    ]));
    const r = await f.chat({ session_id: id });
    assert.equal(r.source, 'transcript');
    assert.deepEqual(r.items.map((i: any) => [i.kind, i.text ?? i.label]), [
      ['user', 'Add a delete button to each todo'],
      ['text', 'I will add the route first.'],
      ['tool', 'Edited routes/todos.js'],
      ['tool', 'Ran npm test'],
      ['tool', 'Read views/list.html'],
      ['text', 'Done. The delete button removes the todo.'],
    ]);
    const [, , edit, run, read] = r.items;
    assert.equal(edit.status, 'ok');
    assert.equal(edit.file, 'routes/todos.js');
    assert.equal(run.status, 'error');
    assert.equal(run.file, undefined);
    assert.equal(read.file, undefined);
  } finally { f.close(); }
});

test('session.chat marks the unanswered last tool as waiting while the session waits for you', async () => {
  const f = fixture();
  try {
    const id = f.session('claude', 'waiting_for_you');
    point(f.db, id, f.transcript([
      user('Run the tests'),
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]),
    ]));
    const r = await f.chat({ session_id: id });
    const last = r.items.at(-1);
    assert.equal(last.kind, 'tool');
    assert.equal(last.status, 'waiting');
    assert.equal(r.waiting, true);
  } finally { f.close(); }
});

test('session.chat leaves an unanswered tool running when the session is working', async () => {
  const f = fixture();
  try {
    const id = f.session('claude', 'working');
    point(f.db, id, f.transcript([assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }])]));
    const r = await f.chat({ session_id: id });
    assert.equal(r.items[0].status, 'running');
    assert.equal(r.waiting, false);
  } finally { f.close(); }
});

test('session.chat skips sidechain, meta and slash-command noise, and keeps only the last items', async () => {
  const f = fixture();
  try {
    const id = f.session();
    const many = Array.from({ length: 30 }, (_, i) => assistant([{ type: 'text', text: `step ${i}` }]));
    point(f.db, id, f.transcript([
      user('<command-name>/clear</command-name>'),
      user('caveat', { isMeta: true }),
      assistant([{ type: 'text', text: 'from a subagent' }], { isSidechain: true }),
      assistant([{ type: 'thinking', thinking: 'hidden' }]),
      ...many,
    ]));
    const r = await f.chat({ session_id: id, limit: 5 });
    assert.deepEqual(r.items.map((i: any) => i.text), ['step 25', 'step 26', 'step 27', 'step 28', 'step 29']);
  } finally { f.close(); }
});

test('session.chat says none for a session with no transcript, and errors on an unknown one', async () => {
  const f = fixture();
  try {
    const id = f.session('codex');
    const r = await f.chat({ session_id: id });
    assert.equal(r.source, 'none');
    assert.deepEqual(r.items, []);
    await assert.rejects(f.chat({ session_id: 's_missing' }), (e: any) => e.code === -32002);
    await assert.rejects(f.chat({ session_id: id, limit: 0 }), (e: any) => e.code === -32602);
  } finally { f.close(); }
});

test('session.chat ignores a transcript path that is not a .jsonl file and survives a missing file', async () => {
  const f = fixture();
  try {
    const a = f.session();
    const secret = join(f.home, 'notes.txt');
    writeFileSync(secret, JSON.stringify(user('should not be read')) + '\n');
    point(f.db, a, secret);
    assert.equal((await f.chat({ session_id: a })).source, 'none');
    const b = f.session();
    point(f.db, b, join(f.home, 'gone.jsonl'));
    assert.deepEqual((await f.chat({ session_id: b })).items, []);
  } finally { f.close(); }
});
