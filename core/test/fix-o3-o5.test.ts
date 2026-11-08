import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, harness, pipePath, sleep } from './helpers.ts';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';
import { RpcError } from '../src/pipe/errors.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents, turnJobsIdle } from '../src/events/processor.ts';

function seedSession(db: DatabaseSync, dir: string) {
  const sessionId = 'ses_' + randomUUID();
  const projectId = 'prj_' + randomUUID();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, dir, 'test', at, at);
  db.prepare('INSERT OR IGNORE INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)')
    .run('codex', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sessionId, projectId, 'codex', 'pty', 'working', at, at, 0);
  return sessionId;
}

function waitFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaFile, 'utf8'));
  const sessionId = seedSession(db, process.cwd());
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'test_key' });
  const ctx = { ui: true, origin: 'test' };
  return { db, sessionId, methods, ctx };
}

// Apply an event through the processor so state watchers are notified.
function changeState(db: DatabaseSync, sessionId: string, state: 'done' | 'working') {
  appendEvent(state === 'done' ? 'codex.turn' : 'core.activity', sessionId, state === 'done' ? {} : { state }, db);
  processEvents(db);
  assert.equal((db.prepare('SELECT state FROM session WHERE id = ?').get(sessionId) as { state: string }).state, state);
}

type RawReply = {
  jsonrpc: string;
  id: unknown;
  error?: { code: number; message: string };
};

// Send one raw request line and read its first reply without matching ids.
async function rawRequest(prefix: string, request: object): Promise<RawReply> {
  const socket = connect(pipePath(prefix));
  socket.setEncoding('utf8');
  try {
    return await new Promise<RawReply>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('raw pipe request timed out')), 3000);
      const finish = (error?: Error, reply?: RawReply) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(reply!);
      };
      socket.once('error', error => finish(error));
      socket.once('end', () => finish(new Error('pipe ended before a reply')));
      socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
      socket.on('data', chunk => {
        buffer += chunk;
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        try { finish(undefined, JSON.parse(buffer.slice(0, end))); }
        catch (error) { finish(error as Error); }
      });
    });
  } finally {
    socket.destroy();
  }
}

for (const [label, id] of [['O3a', 1], ['O3a2', '']] as const) {
  test(label + ': core.ping rejects id ' + JSON.stringify(id) + ' with a null reply id', async () => {
    const h = await harness();
    try {
      const reply = await rawRequest(h.prefix, { jsonrpc: '2.0', id, method: 'core.ping' });
      assert.equal(reply.error?.code, -32600);
      assert.equal(reply.error?.message, 'id must be a non-empty string');
      assert.equal(reply.id, null);
    } finally {
      await h.teardown();
    }
  });
}

test('O3b: an invalid JSON-RPC version preserves a valid string id', async () => {
  const h = await harness();
  try {
    const reply = await rawRequest(h.prefix, { jsonrpc: '1.0', id: 'abc123', method: 'core.ping' });
    assert.equal(reply.error?.code, -32600);
    assert.equal(reply.error?.message, 'invalid request');
    assert.equal(reply.id, 'abc123');
  } finally {
    await h.teardown();
  }
});

test('O5a: leaving done during settlement waits until the total deadline', async () => {
  const { db, sessionId, methods, ctx } = waitFixture();
  try {
    const wait = methods.get('session.wait')!.handler({ session_id: sessionId, states: ['done'], settle_ms: 5000, timeout_ms: 4000 }, ctx);
    changeState(db, sessionId, 'done');
    await sleep(2000);
    changeState(db, sessionId, 'working');
    assert.deepEqual(await wait, { state: 'working', timed_out: true, wait_reason: null, waiting_on_person: false });
  } finally {
    await turnJobsIdle();
    db.close();
  }
});

test('O5a2: done must stay in the target states for the settlement period', async () => {
  const { db, sessionId, methods, ctx } = waitFixture();
  try {
    const wait = methods.get('session.wait')!.handler({ session_id: sessionId, states: ['done'], settle_ms: 1000, timeout_ms: 5000 }, ctx);
    const start = performance.now();
    changeState(db, sessionId, 'done');
    assert.deepEqual(await wait, { state: 'done', timed_out: false, wait_reason: null, waiting_on_person: false });
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 900, 'elapsed was ' + elapsed + ' ms, expected at least 900 ms');
  } finally {
    await turnJobsIdle();
    db.close();
  }
});

test('O5a3: a leave and return between polls restarts the settle window', async () => {
  const { db, sessionId, methods, ctx } = waitFixture();
  try {
    const start = performance.now();
    const wait = methods.get('session.wait')!.handler({ session_id: sessionId, states: ['done'], settle_ms: 500, timeout_ms: 3000 }, ctx);
    changeState(db, sessionId, 'done');
    await sleep(300);
    changeState(db, sessionId, 'working');
    changeState(db, sessionId, 'done');
    assert.deepEqual(await wait, { state: 'done', timed_out: false, wait_reason: null, waiting_on_person: false });
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 750, 'elapsed was ' + elapsed + ' ms, expected at least 750 ms');
  } finally {
    await turnJobsIdle();
    db.close();
  }
});

test('O5b: omitting settle_ms returns done promptly over the real pipe', async () => {
  const h = await harness();
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    try {
      const sessionId = seedSession(db, h.home);
      const pipe = await client(h.prefix);
      try {
        const wait = pipe.request('session.wait', { session_id: sessionId, states: ['done'], timeout_ms: 5000 }, { timeout: 10000 });
        await sleep(100);
        const start = performance.now();
        changeState(db, sessionId, 'done');
        const reply = await wait;
        assert.equal(reply.error, undefined);
        assert.deepEqual(reply.result, { state: 'done', timed_out: false, wait_reason: null, waiting_on_person: false });
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 750, 'elapsed after state change was ' + elapsed + ' ms, expected under 750 ms');
      } finally {
        pipe.close();
      }
    } finally {
      await turnJobsIdle();
      db.close();
    }
  } finally {
    await h.teardown();
  }
});

for (const settle_ms of [-1, 60001, 1.5, '100']) {
  test('O5c: settle_ms ' + JSON.stringify(settle_ms) + ' rejects with RpcError -32602', async () => {
    const { db, sessionId, methods, ctx } = waitFixture();
    try {
      await assert.rejects(
        async () => methods.get('session.wait')!.handler({ session_id: sessionId, states: ['working'], settle_ms, timeout_ms: 50 }, ctx),
        (error: unknown) => error instanceof RpcError && error.code === -32602,
      );
    } finally {
      db.close();
    }
  });
}

for (const settle_ms of [0, 60000]) {
  test('O5c: settle_ms ' + settle_ms + ' is accepted', async () => {
    const { db, sessionId, methods, ctx } = waitFixture();
    try {
      const reply = await methods.get('session.wait')!.handler({ session_id: sessionId, states: ['done'], settle_ms, timeout_ms: 50 }, ctx);
      assert.deepEqual(reply, { state: 'working', timed_out: true, wait_reason: null, waiting_on_person: false });
    } finally {
      db.close();
    }
  });
}
