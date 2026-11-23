import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { buildMethods, METHODS } from '../src/methods.ts';

// M7-12a: session.history finds a session older than the newest 50 by title or prompt text.
async function withHistory(fn: (db: DatabaseSync, call: (p: Record<string, unknown>, ui?: boolean) => any) => void | Promise<void>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-m7-12-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    db = openCoreDb();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', ?, 'p1', '2026-01-01', '2026-01-01')").run(home);
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
    // 60 sessions, s00 oldest .. s59 newest.
    const ins = db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, title, prompt, hidden)
      VALUES (?, 'p1', 'claude', 'pty', 'exited', ?, ?, ?, ?, ?)`);
    for (let i = 0; i < 60; i++) {
      const id = `s${String(i).padStart(2, '0')}`;
      const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      let title: string | null = `task number ${i}`;
      let prompt = `prompt body ${i}`;
      if (i === 2) title = 'Refactor The Zebra Parser';
      if (i === 3) { title = null; prompt = 'zebra ' + 'x'.repeat(400); }
      if (i === 4) prompt = 'sale 50%_off! today';
      if (i === 5) prompt = 'fifty percent off';
      if (i === 6) prompt = 'fifty%percent';
      if (i === 7) prompt = 'underscore_free x';
      if (i === 8) prompt = 'underscoreXfree x';
      if (i === 1) title = 'hiddenwhale job';
      ins.run(id, at, at, title, prompt, i === 1 ? 1 : 0);
    }
    const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'test_key' });
    const call = (p: Record<string, unknown>, ui = true) => methods.get('session.history')!.handler(p, { ui, origin: 'test' });
    await fn(db, call);
  } finally {
    try { db?.close(); } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

const ids = (r: any) => r.sessions.map((s: any) => s.id);

test('M7-12a finds a session older than the newest 50 by title (any case) and by prompt', async () => {
  await withHistory(async (_db, call) => {
    assert.deepEqual(ids(await call({ query: '  ZEBRA ' })), ['s03', 's02']);
    const r = await call({ query: 'zebra parser' });
    assert.deepEqual(ids(r), ['s02']);
    assert.deepEqual(Object.keys(r.sessions[0]).sort(), ['engine_id', 'hidden', 'id', 'project_id', 'prompt', 'started_at', 'state', 'title']);
    assert.equal(r.sessions[0].title, 'Refactor The Zebra Parser');
    assert.equal(r.sessions[0].state, 'exited');
    assert.ok(r.sessions[0].started_at < '2026-01-01T00:50');
  });
});

test('M7-12a includes hidden sessions and flags them', async () => {
  await withHistory(async (_db, call) => {
    const r = await call({ query: 'hiddenwhale' });
    assert.equal(r.sessions.length, 1);
    assert.equal(r.sessions[0].hidden, true);
    assert.equal((await call({ query: 'zebra' })).sessions[0].hidden, false);
  });
});

test('M7-12a returns newest first, default limit 50, limit bounds the rows, empty query lists all', async () => {
  await withHistory(async (_db, call) => {
    const all = await call({});
    assert.equal(all.sessions.length, 50);
    assert.equal(all.sessions[0].id, 's59');
    const three = await call({ query: 'task number', limit: 3 });
    assert.deepEqual(ids(three), ['s59', 's58', 's57']);
    assert.equal((await call({ limit: 200 })).sessions.length, 60);
  });
});

test('M7-12a cuts the prompt at 200 characters', async () => {
  await withHistory(async (_db, call) => {
    const r = await call({ query: 'zebra x' });
    assert.deepEqual(ids(r), ['s03']);
    assert.equal(r.sessions[0].prompt.length, 200);
  });
});

test('M7-12a treats % _ and ! in the query as plain characters', async () => {
  await withHistory(async (_db, call) => {
    assert.deepEqual(ids(await call({ query: '50%_off!' })), ['s04']);
    assert.deepEqual(ids(await call({ query: '%' })), ['s06', 's04']);
    assert.deepEqual(ids(await call({ query: 'underscore_free' })), ['s07']);
    assert.deepEqual(ids(await call({ query: '!' })), ['s04']);
  });
});

test('M7-12a rejects bad params with INVALID_PARAMS', async () => {
  await withHistory(async (_db, call) => {
    const bad = (p: Record<string, unknown>) => assert.rejects(async () => call(p), (e: any) => e.code === -32602);
    for (const limit of [0, 201, -1, 1.5, '5', null]) await bad({ limit });
    for (const query of [5, null, 'x'.repeat(201)]) await bad({ query });
    assert.deepEqual(ids(await call({ query: 'y'.repeat(200) })), []);
  });
});

test('M7-12a session.history is declared and registered UI-only (the pipe refuses non-UI callers)', async () => {
  assert.equal(METHODS.find((m) => m.name === 'session.history')!.needsUi, true);
  await withHistory((db) => {
    assert.equal(buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('session.history')!.needsUi, true);
  });
});
