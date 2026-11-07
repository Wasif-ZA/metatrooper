import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Approvals } from '../src/approvals.ts';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, ended_at TEXT);
    CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, surface TEXT, target TEXT, control TEXT, action TEXT, action_hash TEXT, summary TEXT, reason TEXT, status TEXT, scope TEXT, created_at TEXT, decided_at TEXT);
    CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT, kind TEXT, ref TEXT, text TEXT, resolved_at TEXT);
    INSERT INTO session (id) VALUES ('s1');
  `);
  return db;
}

const action = {
  session_id: 's1', surface: 'browser', target: 'https://example.com',
  action: 'click', args: {}, control: { name: 'Send', automation_id: 'send', role: 'button' },
};

for (const timeout of [0, undefined]) {
  test('approval timeout ' + (timeout === undefined ? 'default' : '0') + ' has no timer and waits for the user', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const timer = t.mock.method(globalThis, 'setTimeout');
    const db = database();
    try {
      const approvals = timeout === undefined ? new Approvals(db) : new Approvals(db, timeout);
      let settled = false;
      const pending = approvals.check(action).then(result => { settled = true; return result; });
      const row = db.prepare('SELECT id, status FROM approval').get() as { id: string; status: string };
      assert.equal(row.status, 'waiting');
      assert.equal(timer.mock.callCount(), 0);
      t.mock.timers.tick(7 * 24 * 60 * 60 * 1000);
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(timer.mock.callCount(), 0);
      assert.equal(db.prepare('SELECT status FROM approval').get()!.status, 'waiting');
      assert.equal(db.prepare('SELECT resolved_at FROM needs_you').get()!.resolved_at, null);
      approvals.resolve({ approval_id: row.id, decision: 'reject' });
      assert.deepEqual(await pending, { decision: 'rejected', approval_id: row.id });
      assert.ok(db.prepare('SELECT resolved_at FROM needs_you').get()!.resolved_at);
    } finally {
      db.close();
    }
  });
}

test('a positive approval timeout expires at its deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = database();
  try {
    const approvals = new Approvals(db, 50);
    let settled = false;
    const pending = approvals.check(action).then(result => { settled = true; return result; });
    const row = db.prepare('SELECT id FROM approval').get() as { id: string };
    t.mock.timers.tick(49);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(db.prepare('SELECT status FROM approval').get()!.status, 'waiting');
    t.mock.timers.tick(1);
    assert.deepEqual(await pending, { decision: 'expired', approval_id: row.id });
    assert.equal(db.prepare('SELECT status FROM approval').get()!.status, 'expired');
    assert.ok(db.prepare('SELECT resolved_at FROM needs_you').get()!.resolved_at);
  } finally {
    db.close();
  }
});
