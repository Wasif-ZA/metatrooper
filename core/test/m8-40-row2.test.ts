import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Approvals } from '../src/approvals.ts';
import { screenResult } from '../src/hook/screen-data.ts';

const NOW = '2026-11-08T00:00:00.000Z';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(NOW, NOW);
  for (const s of ['s1', 's2']) {
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at) VALUES (?, 'p1', 'fake', 'pty', 'working', ?, 0, ?)").run(s, NOW, NOW);
  }
  return { db, approvals: new Approvals(db, 5000) };
}

// A risky click (the control is named Send, Submit or Delete), so the rule asks and the row waits.
function ask(sessionId: string, name: string) {
  return { session_id: sessionId, surface: 'browser', target: 'http://127.0.0.1:8080', action: 'click', args: {}, control: { automation_id: name.toLowerCase(), name, role: 'button' } };
}

function idOf(db: DatabaseSync, name: string): string {
  return (db.prepare("SELECT id FROM approval WHERE status = 'waiting' AND summary LIKE ?").get(`click ${name} in%`) as { id: string }).id;
}

function statusOf(db: DatabaseSync, id: string): string {
  return (db.prepare('SELECT status FROM approval WHERE id = ?').get(id) as { status: string }).status;
}

function codeOf(fn: () => unknown): number | undefined {
  try { fn(); } catch (e) { return (e as { code?: number }).code; }
  return undefined;
}

test('M8-40b: reject with an instruction makes approval.check return rejected with that instruction', async () => {
  const { db, approvals } = setup();
  const pending = approvals.check(ask('s1', 'Send'));
  const id = idOf(db, 'Send');
  assert.deepEqual(approvals.resolve({ approval_id: id, decision: 'reject', instruction: 'Do not send this' }), { status: 'rejected', scope: 'once' });
  assert.deepEqual(await pending, { decision: 'rejected', approval_id: id, instruction: 'Do not send this' });
});

test('M8-40b: instruction with approve is refused with -32602 and changes nothing', async () => {
  const { db, approvals } = setup();
  const pending = approvals.check(ask('s1', 'Send'));
  const id = idOf(db, 'Send');
  assert.equal(codeOf(() => approvals.resolve({ approval_id: id, decision: 'approve', instruction: 'Go ahead' })), -32602);
  assert.equal(statusOf(db, id), 'waiting');
  approvals.resolve({ approval_id: id, decision: 'approve' });
  assert.deepEqual(await pending, { decision: 'approved', approval_id: id });
});

test('M8-40b: a non-string instruction is refused with -32602 and the row stays waiting', async () => {
  const { db, approvals } = setup();
  const pending = approvals.check(ask('s1', 'Send'));
  const id = idOf(db, 'Send');
  for (const instruction of [42, null, ['Stop'], { text: 'Stop' }, true]) {
    assert.equal(codeOf(() => approvals.resolve({ approval_id: id, decision: 'reject', instruction })), -32602, JSON.stringify(instruction));
    assert.equal(statusOf(db, id), 'waiting');
  }
  approvals.resolve({ approval_id: id, decision: 'reject' });
  await pending;
});

test('M8-40b: an instruction over 500 code points is refused, not cut; 500 code points is accepted', async () => {
  const { db, approvals } = setup();
  const pending = approvals.check(ask('s1', 'Send'));
  const id = idOf(db, 'Send');
  assert.equal(codeOf(() => approvals.resolve({ approval_id: id, decision: 'reject', instruction: 'a'.repeat(501) })), -32602);
  assert.equal(codeOf(() => approvals.resolve({ approval_id: id, decision: 'reject', instruction: '\u{1F600}'.repeat(501) })), -32602);
  assert.equal(statusOf(db, id), 'waiting');
  const exact = '\u{1F600}'.repeat(500);
  approvals.resolve({ approval_id: id, decision: 'reject', instruction: exact });
  assert.deepEqual(await pending, { decision: 'rejected', approval_id: id, instruction: exact });
});

test('M8-40b: the instruction is trimmed before it is returned', async () => {
  const { db, approvals } = setup();
  const pending = approvals.check(ask('s1', 'Send'));
  const id = idOf(db, 'Send');
  approvals.resolve({ approval_id: id, decision: 'reject', instruction: '  \tStop here\n ' });
  assert.deepEqual(await pending, { decision: 'rejected', approval_id: id, instruction: 'Stop here' });
});

test('M8-40b: a reject with an instruction rejects the other waiting approvals of the same session, and no other session', async () => {
  const { db, approvals } = setup();
  const send = approvals.check(ask('s1', 'Send'));
  const sendId = idOf(db, 'Send');
  const submit = approvals.check(ask('s1', 'Submit'));
  const submitId = idOf(db, 'Submit');
  const del = approvals.check(ask('s1', 'Delete'));
  const delId = idOf(db, 'Delete');
  const other = approvals.check(ask('s2', 'Send'));
  const otherId = (db.prepare("SELECT id FROM approval WHERE session_id = 's2' AND status = 'waiting'").get() as { id: string }).id;

  approvals.resolve({ approval_id: sendId, decision: 'reject', instruction: 'Stop everything' });

  assert.deepEqual(await send, { decision: 'rejected', approval_id: sendId, instruction: 'Stop everything' });
  assert.deepEqual(await submit, { decision: 'rejected', approval_id: submitId, instruction: 'Stop everything' });
  assert.deepEqual(await del, { decision: 'rejected', approval_id: delId, instruction: 'Stop everything' });
  assert.equal(statusOf(db, otherId), 'waiting');

  approvals.resolve({ approval_id: otherId, decision: 'approve' });
  assert.deepEqual(await other, { decision: 'approved', approval_id: otherId });
});

test('M8-40b: a plain reject without text leaves the other waiting approvals of the session waiting', async () => {
  const { db, approvals } = setup();
  const send = approvals.check(ask('s1', 'Send'));
  const sendId = idOf(db, 'Send');
  const submit = approvals.check(ask('s1', 'Submit'));
  const submitId = idOf(db, 'Submit');

  approvals.resolve({ approval_id: sendId, decision: 'reject' });
  assert.deepEqual(await send, { decision: 'rejected', approval_id: sendId });
  assert.equal(statusOf(db, submitId), 'waiting');

  approvals.resolve({ approval_id: submitId, decision: 'reject' });
  await submit;
});

test('M8-40b: the instruction is not written to the database', async () => {
  const { db, approvals } = setup();
  const marker = 'MARKER_OVERNIGHT_INSTRUCTION_4471';
  const send = approvals.check(ask('s1', 'Send'));
  const sendId = idOf(db, 'Send');
  const submit = approvals.check(ask('s1', 'Submit'));
  approvals.resolve({ approval_id: sendId, decision: 'reject', instruction: marker });
  await send;
  await submit;

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
  const dump = JSON.stringify(Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all()])));
  assert.ok(dump.includes('Send'), 'the dump reads the approval rows');
  assert.equal(dump.includes(marker), false);
});

test('M8-40b: the shim keeps the not-approved text and adds the user block after the untrusted-data label', () => {
  const out = screenResult({
    content: [{ type: 'text', text: 'not approved: the user rejected this action' }],
    isError: true,
    userNote: 'Stop​, do not send it',
  }) as { isError: boolean; content: Array<{ type: string; text: string }> };

  assert.equal(out.isError, true);
  assert.equal(out.content.length, 3);
  assert.equal(out.content[0].text, 'not approved: the user rejected this action');
  assert.match(out.content[1].text, /untrusted screen data/);
  assert.equal(out.content[2].type, 'text');
  assert.equal(out.content[2].text, 'The user rejected this action and stopped the rest of this batch. Their instruction, from the user: Stop, do not send it');
});

test('M8-40b: a plain reject with no instruction adds no user block', () => {
  const out = screenResult({
    content: [{ type: 'text', text: 'not approved: the user rejected this action' }],
    isError: true,
  }) as { content: Array<{ text: string }> };
  assert.equal(out.content.length, 2);
  assert.match(out.content[1].text, /untrusted screen data/);
  assert.equal(out.content.some((b) => b.text.includes('Their instruction, from the user')), false);
});
