import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseChat } from '../src/sessions/chat.ts';
import { buildMethods } from '../src/methods.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { GENERATED, block } from '../gen-methods.ts';

const line = (type: string, content: unknown) => JSON.stringify({ type, message: { content } });

test('chat labels cover tool families and only edits carry a file', () => {
  const cases: [string, object, string, string?][] = [
    ...['Edit', 'Write', 'MultiEdit'].map((name): [string, object, string, string] => [name, { file_path: 'src/a.ts' }, 'Edited src/a.ts', 'src/a.ts']),
    ['NotebookEdit', { notebook_path: 'a.ipynb' }, 'Edited a.ipynb', 'a.ipynb'],
    ['Read', { file_path: 'src/a.ts' }, 'Read src/a.ts'],
    ['Bash', { command: 'a'.repeat(100) + '\nignored' }, 'Ran ' + 'a'.repeat(80)],
    ['PowerShell', { command: 'Get-Date\r\nignored' }, 'Ran Get-Date'],
    ['Grep', { pattern: 'needle' }, 'Searched for needle'],
    ['Glob', { pattern: '*.ts' }, 'Listed *.ts'],
    ['WebFetch', { url: 'https://example.com/a' }, 'Fetched example.com'],
    ['WebSearch', { query: 'docs' }, 'Searched the web for docs'],
    ['Task', { description: 'review' }, 'Started a helper: review'],
    ['Agent', { description: 'review' }, 'Started a helper: review'],
    ...['TodoWrite', 'TaskCreate', 'TaskUpdate'].map((name): [string, object, string] => [name, {}, 'Updated the plan']),
    ['Other', {}, 'Used Other'],
  ];
  for (const [name, input, label, file] of cases) {
    const { items } = parseChat([line('assistant', [{ type: 'tool_use', id: 't', name, input }])], 'working');
    assert.deepEqual(items, [{ kind: 'tool', id: 't', name, label, status: 'running', ...(file ? { file } : {}), ...(['Edit', 'Write', 'MultiEdit'].includes(name) ? { preview: { added: 0, removed: 0, more: 0, lines: [] } } : {}) }]);
  }
});

test('chat tolerates malformed lines and blocks and only waits on the final unanswered tool', () => {
  const { items, waiting } = parseChat([
    'bad json', 'null', '[]', line('assistant', [null, {}, { type: 'text', text: '  ' }]),
    ...['<command-name>clear', '<local-command-output>ok', 'Caveat: local'].map((s) => line('user', s)),
    line('user', [{ type: 'text', text: 'hello' }]),
    line('assistant', [{ type: 'tool_use', id: 't', name: 'Other' }]),
    line('assistant', [{ type: 'text', text: '  done  ' }]),
    line('user', [{ type: 'tool_result', tool_use_id: 'unknown', is_error: true }]),
  ], 'waiting_for_you');
  assert.equal(waiting, false);
  assert.deepEqual(items, [{ kind: 'user', text: 'hello' }, { kind: 'tool', id: 't', name: 'Other', label: 'Used Other', status: 'running' }, { kind: 'text', text: 'done' }]);
  const completed = parseChat([
    line('assistant', [{ type: 'tool_use', id: 't', name: 'Other' }]),
    line('user', [{ type: 'tool_result', tool_use_id: 't' }]),
  ], 'waiting_for_you');
  assert.equal(completed.waiting, false);
  const last = completed.items.at(-1);
  assert.equal(last?.kind === 'tool' && last.status, 'ok');
});

test('session.chat bounds reads, skips the initial partial line and uses the newest stored path', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chat-tail-'));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE session (id TEXT, state TEXT, engine_id TEXT, cwd TEXT); CREATE TABLE event (seq INTEGER PRIMARY KEY, session_id TEXT, payload TEXT); CREATE TABLE approval (id TEXT, status TEXT); INSERT INTO session VALUES ('s', 'working', 'claude', NULL)");
    const file = join(home, 'tail.JSONL');
    const partial = line('user', 'partial');
    const last = line('assistant', [{ type: 'text', text: 'last' }]) + '\n';
    const tail = partial + '\n' + ' '.repeat(2 * 1024 * 1024 - partial.length - last.length - 2) + '\n' + last;
    writeFileSync(file, 'x'.repeat(20) + tail);
    const point = (path: string) => db.prepare('INSERT INTO event (session_id, payload) VALUES (?, ?)').run('s', JSON.stringify({ transcript_path: path }));
    point(join(home, 'gone.jsonl'));
    point(file);
    const runner = new CommandRunner(db, buildMethods(db, {} as never));
    const handler = (params: Record<string, unknown>) => runner.call({ id: 'r', method: 'session.chat', params, origin: 'test' }, { ui: false, origin: 'test' });
    const result = await handler({ session_id: 's', transcript_path: join(home, 'gone.jsonl') }) as { source: string; items: unknown[] };
    assert.equal(result.source, 'transcript');
    assert.deepEqual(result.items, [{ kind: 'text', text: 'last' }]);
    for (const limit of [null, '1', 1.5, -1, 501, NaN]) await assert.rejects(async () => handler({ session_id: 's', limit }), (e: any) => e.code === -32602);
    point(join(home, 'notes.txt'));
    assert.equal((await handler({ session_id: 's' }) as { source: string }).source, 'none');
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test('chat public method documentation matches generated blocks', () => {
  for (const entry of GENERATED) assert.equal(block(readFileSync(entry.file, 'utf8')), entry.body());
});
