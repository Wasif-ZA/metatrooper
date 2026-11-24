import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines } from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents, turnJobsIdle } from '../src/events/processor.ts';
import { buildPayload } from '../src/redact.ts';
import { snapshot } from '../../workbench/src/queries.ts';

const START = Date.parse('2026-10-14T10:00:00+11:00');

async function memoryDb(engineId = 'claude') {
  const home = mkdtempSync(join(tmpdir(), 'troop-m8pr-'));
  const vars = { HOME: home, USERPROFILE: home, METATROOPER_HOME: join(home, 'mt'), METATROOPER_FAKE_DPAPI: '1' };
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const db = openCoreDb();
  const id = `m8pr-${randomUUID()}`;
  syncEngines(db, [...BUILT_IN]);
  const t = new Date(START).toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', home, 'synthetic', t, t);
  db.prepare(
    `INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id)
     VALUES (?, 'p', ?, 'pty', 'starting', ?, ?, 'conv')`,
  ).run(id, engineId, t, t);
  const row = () => db.prepare('SELECT state, wait_reason FROM session WHERE id = ?').get(id) as { state: string; wait_reason: string | null };
  const send = (kind: string, raw: Record<string, unknown> = {}) => {
    const payload = kind.startsWith('claude.') ? buildPayload(kind, { session_id: 'conv', ...raw }) : raw;
    appendEvent(kind, id, payload, db);
    processEvents(db);
    return row().state;
  };
  const close = async () => {
    await turnJobsIdle();
    db.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return { db, id, row, send, close };
}

async function reasonOf(events: Array<[string, Record<string, unknown>]>, engine = 'claude') {
  const h = await memoryDb(engine);
  try {
    if (engine === 'claude') h.send('claude.UserPromptSubmit');
    for (const [kind, raw] of events) h.send(kind, raw);
    assert.equal(h.row().state, 'waiting_for_you');
    return { reason: h.row().wait_reason, snap: snapshot(h.db, 'p').sessions.find((s) => s.id === h.id)?.reason };
  } finally {
    await h.close();
  }
}

test('M8 a Claude PermissionRequest without tool_use_id stores permission and the snapshot exposes it', async () => {
  const r = await reasonOf([['claude.PermissionRequest', { tool_name: 'Bash' }]]);
  assert.equal(r.reason, 'permission');
  assert.equal(r.snap, 'permission');
});

test('M8 a Claude permission notification stores permission', async () => {
  const r = await reasonOf([['claude.Notification', { notification_type: 'permission_prompt' }]]);
  assert.equal(r.reason, 'permission');
});

test('M8 only an agent_needs_input notification stores question; an elicitation form stores null', async () => {
  assert.equal((await reasonOf([['claude.Notification', { notification_type: 'agent_needs_input' }]])).reason, 'question');
  assert.equal((await reasonOf([['claude.Notification', { notification_type: 'agent_needs_input' }]])).snap, 'question');
  assert.equal((await reasonOf([['claude.Notification', { notification_type: 'elicitation_dialog' }]])).reason, null);
});

test('M8 a question after a permission request in the same wait never replaces permission', async () => {
  const r = await reasonOf([
    ['claude.PermissionRequest', { tool_name: 'Bash', tool_use_id: 't1' }],
    ['claude.Notification', { notification_type: 'agent_needs_input' }],
  ]);
  assert.equal(r.reason, 'permission');
});

test('M8 a codex PermissionRequest stores permission', async () => {
  const r = await reasonOf([['codex.PermissionRequest', {}]], 'codex');
  assert.equal(r.reason, 'permission');
});
