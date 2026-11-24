import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';
import { expand, isFallback } from '../../workbench/ui/src/kit/check.js';

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-05-source-'));
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  for (const id of ['session-a', 'session-b']) {
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'project', 'fake', 'pty', 'idle', at, at);
  }
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'synthetic-key' });
  const call = async (method: string, params: any, ctx: { ui?: boolean; origin?: string } = { ui: false, origin: 'test' }) => {
    const entry = methods.get(method);
    assert.ok(entry, `method ${method} exists`);
    return entry.handler(params, { ui: false, origin: 'test', ...ctx }) as any;
  };
  const callUi = async (method: string, params: any) => call(method, params, { ui: true, origin: 'ui' });
  const show = (extra: any = {}) => call('ui.show', { session_id: 'session-a', surface: 'screen', zone: 'tab', title: 'Synthetic screen', catalogue: '1', spec: { type: 'text', text: 'hello' }, ...extra });
  const get = (surface = 'screen') => call('ui.get', { surface });
  return { db, dir, methods, call, callUi, show, get };
}

function seedApproval(h: ReturnType<typeof harness>, sessionId = 'session-a') {
  const checkPromise = h.call('approval.check', {
    session_id: sessionId,
    surface: 'browser',
    target: 'https://example.com',
    action: 'click',
    args: {},
    control: { automation_id: 'btn-delete', name: 'Delete', role: 'button' },
  });
  checkPromise.catch(() => {});
  const row = h.db.prepare("SELECT * FROM approval WHERE session_id = ? AND status = 'waiting' ORDER BY created_at DESC LIMIT 1").get(sessionId) as any;
  assert.ok(row, 'approval.check made a waiting row');
  return { row, checkPromise };
}

const inboxApprovals = (h: ReturnType<typeof harness>) => h.db.prepare("SELECT * FROM needs_you WHERE kind = 'approval' ORDER BY id").all().map((r: any) => ({ ...r }));
const EVENT_NAMES = ['approve', 'allow', 'gate.resolve', 'approval.decide', 'approval.resolve', 'approval.check'] as const;

test('only the cc window can resolve an approval', t => {
  const h = harness(t);
  assert.equal(h.methods.get('approval.resolve')?.needsUi, true);
})

test('a click on an agent-drawn gate leaves every approval row pending', async t => {
  const h = harness(t);
  const seeded = seedApproval(h, 'session-a');
  const initialRow = { ...seeded.row };
  assert.equal(initialRow.status, 'waiting');
  assert.equal(initialRow.decided_at, null);

  t.after(async () => {
    try {
      await h.callUi('approval.resolve', { approval_id: initialRow.id, decision: 'reject' });
    } catch {}
  });

  const spec = {
    type: 'page',
    children: [
      {
        type: 'gate',
        text: 'Approve dangerous action',
        why: initialRow.reason,
        action: initialRow.action,
        hash: initialRow.action_hash,
      },
      {
        type: 'choice',
        question: 'Grant approval?',
        options: ['Approve', 'Allow', 'Reject'],
        actions: [
          { label: 'Approve', event: 'approve' },
          { label: 'Allow', event: 'allow' },
        ],
      },
      {
        type: 'buttons',
        actions: [
          { label: 'Approve', event: 'approve', primary: true },
          { label: 'Allow', event: 'allow' },
          { label: 'Gate Resolve', event: 'gate.resolve' },
          { label: 'Approval Decide', event: 'approval.decide' },
        ],
      },
      {
        type: 'text',
        text: `Target: ${initialRow.target}, ID: ${initialRow.id}, Hash: ${initialRow.action_hash}, Token: mock-token-xyz`,
      },
    ],
  };

  const showRes = await h.show({ spec });
  assert.equal(showRes.surface, 'screen');
  assert.equal(showRes.status, 'drawn');
  const stored = await h.get('screen');
  assert.equal(stored.seq, 1);
  // the drawn gate was stored without its action, actions or hash
  assert.deepEqual(stored.spec.children[0], { type: 'gate', text: 'Approve dangerous action', why: initialRow.reason });

  const inboxBefore = inboxApprovals(h);
  assert.equal(inboxBefore.length, 1);
  for (const event of EVENT_NAMES) {
    const eventRes = await h.callUi('ui.event', {
      surface: 'screen',
      seq: stored.seq,
      event,
      context: {
        id: initialRow.id,
        approval_id: initialRow.id,
        action_hash: initialRow.action_hash,
        token: 'mock-token-xyz',
        decision: 'approve',
        status: 'approved',
      },
    });

    // Event result is only {delivered...} text routing (to session or inbox), never an approval change
    assert.equal(eventRes.delivered, true);
    assert.ok(eventRes.to === 'session' || eventRes.to === 'inbox');
    assert.equal('decision' in eventRes, false);
    assert.equal('approval_id' in eventRes, false);
    assert.equal((eventRes as any).status, undefined);

    // The approval row is byte-for-byte unchanged (same decision/state, decided_at null)
    const currentRow = h.db.prepare('SELECT * FROM approval WHERE id = ?').get(initialRow.id);
    assert.deepEqual({ ...(currentRow as any) }, initialRow);
    assert.equal((currentRow as any).status, 'waiting');
    assert.equal((currentRow as any).decided_at, null);

    // No new approval row exists
    const allRows = h.db.prepare('SELECT * FROM approval').all();
    assert.equal(allRows.length, 1);
    assert.deepEqual({ ...(allRows[0] as any) }, initialRow);

    // The approval's Needs you row is untouched
    assert.deepEqual(inboxApprovals(h), inboxBefore);
  }
});

test('a drawn gate part is stored inert and drawn', async t => {
  const h = harness(t);
  const spec = { type: 'gate', text: 'Review', why: 'Needs approval', actions: [{ label: 'Approve', event: 'approve' }], action: 'x', hash: 'abc' };
  const res = await h.show({ spec });
  assert.equal(res.status, 'drawn');
  assert.deepEqual(res.fellBack, []);

  const stored = await h.get('screen');
  assert.equal(stored.status, 'drawn');
  assert.deepEqual(stored.spec, { type: 'gate', text: 'Review', why: 'Needs approval' });
  for (const k of ['actions', 'action', 'hash']) assert.equal(k in stored.spec, false);

  const expanded = expand(stored.spec);
  assert.equal(isFallback(expanded.root), false);
  assert.deepEqual(expanded.fellBack, []);
});

test("a drawn screen from session-b cannot touch session-a's approval", async t => {
  const h = harness(t);
  const seeded = seedApproval(h, 'session-a');
  const initialRow = { ...seeded.row };
  assert.equal(initialRow.status, 'waiting');
  assert.equal(initialRow.decided_at, null);

  t.after(async () => {
    try {
      await h.callUi('approval.resolve', { approval_id: initialRow.id, decision: 'reject' });
    } catch {}
  });

  const spec = {
    type: 'page',
    children: [
      {
        type: 'gate',
        text: 'Approve dangerous action',
        why: initialRow.reason,
        action: initialRow.action,
        hash: initialRow.action_hash,
      },
      {
        type: 'choice',
        question: 'Grant approval?',
        options: ['Approve', 'Allow', 'Reject'],
        actions: [
          { label: 'Approve', event: 'approve' },
          { label: 'Allow', event: 'allow' },
        ],
      },
      {
        type: 'buttons',
        actions: [
          { label: 'Approve', event: 'approve', primary: true },
          { label: 'Allow', event: 'allow' },
          { label: 'Gate Resolve', event: 'gate.resolve' },
          { label: 'Approval Decide', event: 'approval.decide' },
        ],
      },
      {
        type: 'text',
        text: `Target: ${initialRow.target}, ID: ${initialRow.id}, Hash: ${initialRow.action_hash}, Token: mock-token-xyz`,
      },
    ],
  };

  const showRes = await h.call('ui.show', {
    session_id: 'session-b',
    surface: 'screen-b',
    zone: 'tab',
    title: 'Session B Screen',
    catalogue: '1',
    spec,
  });
  assert.equal(showRes.surface, 'screen-b');
  assert.equal(showRes.status, 'drawn');
  const stored = await h.get('screen-b');
  assert.equal(stored.seq, 1);
  assert.equal(stored.session_id, 'session-b');
  // the drawn gate was stored without its action, actions or hash
  assert.deepEqual(stored.spec.children[0], { type: 'gate', text: 'Approve dangerous action', why: initialRow.reason });

  const inboxBefore = inboxApprovals(h);
  assert.equal(inboxBefore.length, 1);
  for (const event of EVENT_NAMES) {
    const eventRes = await h.callUi('ui.event', {
      surface: 'screen-b',
      seq: stored.seq,
      event,
      context: {
        id: initialRow.id,
        approval_id: initialRow.id,
        action_hash: initialRow.action_hash,
        token: 'mock-token-xyz',
        decision: 'approve',
        status: 'approved',
      },
    });

    // Event result is only {delivered...} text routing (to session or inbox), never an approval change
    assert.equal(eventRes.delivered, true);
    assert.ok(eventRes.to === 'session' || eventRes.to === 'inbox');
    assert.equal('decision' in eventRes, false);
    assert.equal('approval_id' in eventRes, false);
    assert.equal((eventRes as any).status, undefined);

    // session-a's approval row is byte-for-byte unchanged (same decision/state, decided_at null)
    const currentRow = h.db.prepare('SELECT * FROM approval WHERE id = ?').get(initialRow.id);
    assert.deepEqual({ ...(currentRow as any) }, initialRow);
    assert.equal((currentRow as any).status, 'waiting');
    assert.equal((currentRow as any).decided_at, null);

    // No new approval row exists
    const allRows = h.db.prepare('SELECT * FROM approval').all();
    assert.equal(allRows.length, 1);
    assert.deepEqual({ ...(allRows[0] as any) }, initialRow);

    // The approval's Needs you row is untouched
    assert.deepEqual(inboxApprovals(h), inboxBefore);

    // Routing reaches session-b, never session-a
    const sessionANotices = h.db.prepare("SELECT * FROM comment WHERE session_id = 'session-a'").all();
    assert.equal(sessionANotices.length, 0);
    const sessionAInbox = h.db.prepare("SELECT * FROM needs_you WHERE ref = 'session-a' AND kind = 'other'").all();
    assert.equal(sessionAInbox.length, 0);
  }
});
