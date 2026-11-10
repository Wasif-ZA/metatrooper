import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { buildMethods } from '../src/methods.ts';

function fixture() {
  const previous = process.env.METATROOPER_HOME;
  const home = mkdtempSync(join(tmpdir(), 'agent-panes-core-'));
  process.env.METATROOPER_HOME = home;
  const db = openCoreDb();
  db.exec(`INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('A','/synthetic/a','A','x','x'),('B','/synthetic/b','B','x','x');
    INSERT INTO engine (id,spec_json,cost_rank) VALUES ('codex','{}',1);
    INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at) VALUES ('sA','A','codex','external','idle','x','x'),('sA2','A','codex','external','idle','x','x'),('sB','B','codex','external','idle','x','x');`);
  const methods = buildMethods(db, {} as never);
  const call = (name: string, params: Record<string, unknown>) => methods.get(name)!.handler(params, { ui: true, origin: 'test' }) as any;
  return {
    home,
    db,
    methods,
    call,
    close() {
      db.close();
      rmSync(home, { recursive: true, force: true });
      if (previous === undefined) delete process.env.METATROOPER_HOME;
      else process.env.METATROOPER_HOME = previous;
    },
  };
}

const code = (expected: number) => (error: any) => {
  assert.equal(error.code, expected);
  return true;
};

// Tests core pane.open requires agent true when session id is present, creates bp_agent_ prefix, and allows user panes without session.
test('core pane.open: session without agent fails with -32602, agent:true creates bp_agent_, and omitting session creates user pane', () => {
  const h = fixture();
  try {
    assert.throws(() => h.call('pane.open', { project_id: 'A', session_id: 'sA' }), code(-32602));
    const agentRes = h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true });
    assert.equal(typeof agentRes.pane_id, 'string');
    assert.equal(agentRes.pane_id.startsWith('bp_agent_'), true);
    const agentRow = h.db.prepare('SELECT open, session_id, lent FROM browser_pane WHERE id = ?').get(agentRes.pane_id) as any;
    assert.deepEqual({ ...agentRow }, { open: 1, session_id: 'sA', lent: 0 });

    const userRes = h.call('pane.open', { project_id: 'A' });
    assert.equal(typeof userRes.pane_id, 'string');
    assert.equal(userRes.pane_id.startsWith('bp_'), true);
    assert.equal(userRes.pane_id.startsWith('bp_agent_'), false);
    const userRow = h.db.prepare('SELECT open, session_id, lent FROM browser_pane WHERE id = ?').get(userRes.pane_id) as any;
    assert.deepEqual({ ...userRow }, { open: 1, session_id: null, lent: 0 });
  } finally {
    h.close();
  }
});

// Tests core pane.assign forbids assigning user panes to sessions, allows clearing session, and allows assigning agent panes.
test('core pane.assign: bp_ pane with session fails with -32602, session null succeeds, and bp_agent_ pane with session succeeds', () => {
  const h = fixture();
  try {
    const userPaneId = h.call('pane.open', { project_id: 'A' }).pane_id;
    assert.throws(() => h.call('pane.assign', { pane_id: userPaneId, session_id: 'sA' }), code(-32602));
    assert.deepEqual(h.call('pane.assign', { pane_id: userPaneId, session_id: null }), {});
    const userRow = h.db.prepare('SELECT session_id FROM browser_pane WHERE id = ?').get(userPaneId) as any;
    assert.equal(userRow.session_id, null);

    const agentPaneId = h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true }).pane_id;
    assert.deepEqual(h.call('pane.assign', { pane_id: agentPaneId, session_id: 'sA2' }), {});
    const agentRow1 = h.db.prepare('SELECT session_id FROM browser_pane WHERE id = ?').get(agentPaneId) as any;
    assert.equal(agentRow1.session_id, 'sA2');

    assert.deepEqual(h.call('pane.assign', { pane_id: agentPaneId, session_id: null }), {});
    const agentRow2 = h.db.prepare('SELECT session_id FROM browser_pane WHERE id = ?').get(agentPaneId) as any;
    assert.equal(agentRow2.session_id, null);
  } finally {
    h.close();
  }
});

// Tests core pane.note rejects unknown panes, creates needs_you rows, deduplicates open notes, and handles resolved notes.
test('core pane.note: unknown pane fails -32002, known pane creates needs_you row, deduplicates while open, and new note after resolve creates second row', () => {
  const h = fixture();
  try {
    assert.throws(() => h.call('pane.note', { pane_id: 'bp_missing', text: 'unknown note' }), code(-32002));
    assert.equal((h.db.prepare('SELECT count(*) AS n FROM needs_you').get() as any).n, 0);

    const pane1 = h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true }).pane_id;
    assert.deepEqual(h.call('pane.note', { pane_id: pane1, text: 'reload needed' }), {});

    const rows1 = () =>
      h.db
        .prepare('SELECT kind, ref, text, resolved_at FROM needs_you WHERE ref = ? ORDER BY rowid')
        .all(pane1)
        .map((r: any) => ({ ...r }));
    assert.deepEqual(rows1(), [{ kind: 'other', ref: pane1, text: 'reload needed', resolved_at: null }]);

    assert.deepEqual(h.call('pane.note', { pane_id: pane1, text: 'second duplicate note' }), {});
    assert.deepEqual(rows1(), [{ kind: 'other', ref: pane1, text: 'reload needed', resolved_at: null }]);

    h.db.prepare("UPDATE needs_you SET resolved_at = '2026-11-10T00:00:00Z' WHERE ref = ?").run(pane1);
    assert.deepEqual(h.call('pane.note', { pane_id: pane1, text: 'third note after resolved' }), {});
    assert.deepEqual(rows1(), [
      { kind: 'other', ref: pane1, text: 'reload needed', resolved_at: '2026-11-10T00:00:00Z' },
      { kind: 'other', ref: pane1, text: 'third note after resolved', resolved_at: null },
    ]);

    const pane2 = h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true }).pane_id;
    assert.deepEqual(h.call('pane.note', { pane_id: pane2, text: 'note for second pane' }), {});
    const rows2 = h.db
      .prepare('SELECT kind, ref, text, resolved_at FROM needs_you WHERE ref = ?')
      .all(pane2)
      .map((r: any) => ({ ...r }));
    assert.deepEqual(rows2, [{ kind: 'other', ref: pane2, text: 'note for second pane', resolved_at: null }]);
  } finally {
    h.close();
  }
});
