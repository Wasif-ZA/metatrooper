import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { RpcError } from '../src/pipe/errors.ts';

// Creates an ISO timestamp at local noon with day offset.
function localNoonIso(offsetDays = 0, hour = 12, minute = 0, second = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, hour, minute, second).toISOString();
}

// Formats a local calendar date string as YYYY-MM-DD.
function localDayString(offsetDays = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Inserts a test session into the database.
function insertSession(db: DatabaseSync, {
  id,
  projectId = 'p1',
  engineId = 'claude',
  state = 'working',
  startedAt,
  endedAt,
  hidden = 0,
}: {
  id: string;
  projectId?: string;
  engineId?: string;
  state?: string;
  startedAt?: string;
  endedAt?: string;
  hidden?: number;
}) {
  const at = startedAt ?? localNoonIso(0);
  db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, ended_at, hidden)
    VALUES (?, ?, ?, 'pty', ?, ?, ?, ?, ?)`).run(id, projectId, engineId, state, at, at, endedAt ?? null, hidden);
}

// Inserts a test usage record into the database.
function insertUsage(db: DatabaseSync, {
  id,
  sessionId,
  engineId = 'claude',
  model,
  tokensIn = 0,
  tokensOut = 0,
  cacheRead = 0,
  cacheWrite = 0,
  usd = null,
  usdEstimated = 0,
  at,
}: {
  id: string;
  sessionId: string;
  engineId?: string;
  model: string | null;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  usd?: number | null;
  usdEstimated?: number;
  at?: string;
}) {
  const time = at ?? localNoonIso(0);
  db.prepare(`INSERT INTO usage (at, session_id, engine_id, provider, model, tokens_in, tokens_out, cache_read, cache_write, usd, usd_estimated, source, dedupe_key)
    VALUES (?, ?, ?, 'local-cli', ?, ?, ?, ?, ?, ?, ?, 'transcript', ?)`).run(
    time, sessionId, engineId, model, tokensIn, tokensOut, cacheRead, cacheWrite, usd, usdEstimated, id,
  );
}

// Inserts a test done_proof record into the database.
function insertDoneProof(db: DatabaseSync, {
  id,
  sessionId,
  at,
  exitCode,
  command = 'npm test',
}: {
  id: string;
  sessionId: string;
  at: string;
  exitCode: number | null;
  command?: string;
}) {
  db.prepare(`INSERT INTO done_proof (id, session_id, at, command, environment, exit_code)
    VALUES (?, ?, ?, ?, 'local', ?)`).run(id, sessionId, at, command, exitCode);
}

// Runs a test block inside a temporary METATROOPER_HOME environment.
async function withFixture(fn: (db: DatabaseSync, callMethod: (name: string, params: Record<string, unknown>) => any) => void | Promise<void>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-night-stats-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    db = openCoreDb();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', ?, 'p1', '2026-01-01', '2026-01-01')").run(home);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p2', ?, 'p2', '2026-01-01', '2026-01-01')").run(path.join(home, 'p2'));
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();
    const ctl = { engines: () => [], stop: () => {}, uiKey: 'test_key' };
    const methods = buildMethods(db, ctl);
    const callMethod = (name: string, params: Record<string, unknown>) => {
      const spec = methods.get(name);
      assert.ok(spec, `missing method ${name}`);
      return spec.handler(params, { ui: true, origin: 'test' });
    };
    await fn(db, callMethod);
  } finally {
    try { db?.close(); } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

test('usage.session sums totals across several rows and sorts by_model by usd then tokens', async () => {
  await withFixture((db, callMethod) => {
    insertSession(db, { id: 's1', projectId: 'p1', engineId: 'claude' });
    // Model A: usd 1.0, tokens_in 200, tokens_out 100, cache_read 0, cache_write 0 (total tokens 300).
    insertUsage(db, { id: 'u1', sessionId: 's1', model: 'model-a', tokensIn: 200, tokensOut: 100, cacheRead: 0, cacheWrite: 0, usd: 1.0, usdEstimated: 0 });
    // Model B: usd 2.0, tokens_in 100, tokens_out 50, cache_read 10, cache_write 5 (total tokens 165).
    insertUsage(db, { id: 'u2', sessionId: 's1', model: 'model-b', tokensIn: 100, tokensOut: 50, cacheRead: 10, cacheWrite: 5, usd: 2.0, usdEstimated: 0 });
    // Model B second row: usd 1.5, tokens_in 50, tokens_out 25, cache_read 0, cache_write 0 (total tokens 75).
    insertUsage(db, { id: 'u3', sessionId: 's1', model: 'model-b', tokensIn: 50, tokensOut: 25, cacheRead: 0, cacheWrite: 0, usd: 1.5, usdEstimated: 1 });
    // Model C: usd 1.0, tokens_in 50, tokens_out 20, cache_read 0, cache_write 0 (total tokens 70).
    insertUsage(db, { id: 'u4', sessionId: 's1', model: 'model-c', tokensIn: 50, tokensOut: 20, cacheRead: 0, cacheWrite: 0, usd: 1.0, usdEstimated: 0 });
    // Model D: unpriced row with null usd and estimated flag 0.
    insertUsage(db, { id: 'u5', sessionId: 's1', model: 'model-d', tokensIn: 30, tokensOut: 10, cacheRead: 5, cacheWrite: 5, usd: null, usdEstimated: 0 });

    const res = callMethod('usage.session', { session_id: 's1' });
    assert.deepEqual(JSON.parse(JSON.stringify(res)), {
      session_id: 's1',
      engine_id: 'claude',
      tokens_in: 430,
      tokens_out: 205,
      cache_read: 15,
      cache_write: 10,
      usd: 5.5,
      usd_estimated: true,
      unpriced: 1,
      by_model: [
        { model: 'model-b', tokens_in: 150, tokens_out: 75, usd: 3.5 },
        { model: 'model-a', tokens_in: 200, tokens_out: 100, usd: 1.0 },
        { model: 'model-c', tokens_in: 50, tokens_out: 20, usd: 1.0 },
        { model: 'model-d', tokens_in: 30, tokens_out: 10, usd: 0 },
      ],
    });
  });
});

test('usage.session handles unpriced rows and usd_estimated from priced rows only', async () => {
  await withFixture((db, callMethod) => {
    insertSession(db, { id: 's2', projectId: 'p1', engineId: 'claude' });
    // Priced row without estimation flag.
    insertUsage(db, { id: 'u20', sessionId: 's2', model: 'm1', tokensIn: 10, tokensOut: 10, usd: 2.0, usdEstimated: 0 });
    // Unpriced row with estimated flag set to 1.
    insertUsage(db, { id: 'u21', sessionId: 's2', model: 'm2', tokensIn: 20, tokensOut: 20, usd: null, usdEstimated: 1 });
    // Second unpriced row with estimated flag 0.
    insertUsage(db, { id: 'u22', sessionId: 's2', model: 'm3', tokensIn: 30, tokensOut: 30, usd: null, usdEstimated: 0 });

    const res = callMethod('usage.session', { session_id: 's2' });
    assert.equal(res.usd, 2.0);
    assert.equal(res.usd_estimated, false);
    assert.equal(res.unpriced, 2);
  });
});

test('usage.session returns zeros and empty by_model for a session with no usage rows', async () => {
  await withFixture((db, callMethod) => {
    insertSession(db, { id: 's_empty', projectId: 'p1', engineId: 'claude' });
    const res = callMethod('usage.session', { session_id: 's_empty' });
    assert.deepEqual(JSON.parse(JSON.stringify(res)), {
      session_id: 's_empty',
      engine_id: 'claude',
      tokens_in: 0,
      tokens_out: 0,
      cache_read: 0,
      cache_write: 0,
      usd: 0,
      usd_estimated: false,
      unpriced: 0,
      by_model: [],
    });
  });
});

test('usage.session errors on unknown session with -32002 and missing session_id with -32602', async () => {
  await withFixture((_db, callMethod) => {
    assert.throws(
      () => callMethod('usage.session', { session_id: 'unknown_id' }),
      (err: any) => err instanceof RpcError && err.code === -32002,
    );
    assert.throws(
      () => callMethod('usage.session', {}),
      (err: any) => err instanceof RpcError && err.code === -32602,
    );
    assert.throws(
      () => callMethod('usage.session', { session_id: 123 }),
      (err: any) => err instanceof RpcError && err.code === -32602,
    );
    assert.throws(
      () => callMethod('usage.session', { session_id: '' }),
      (err: any) => err instanceof RpcError && err.code === -32602,
    );
  });
});

test('stats.sessions validates days bounds and non-string project_id', async () => {
  await withFixture((_db, callMethod) => {
    // Default days length is 14.
    const def = callMethod('stats.sessions', {});
    assert.equal(def.days.length, 14);

    // Days=1 returns exactly today.
    const one = callMethod('stats.sessions', { days: 1 });
    assert.equal(one.days.length, 1);
    assert.equal(one.days[0].day, localDayString(0));

    // Days=90 is allowed.
    const ninety = callMethod('stats.sessions', { days: 90 });
    assert.equal(ninety.days.length, 90);

    // Invalid days bounds throw -32602.
    for (const bad of [0, 91, 1.5, '7']) {
      assert.throws(
        () => callMethod('stats.sessions', { days: bad }),
        (err: any) => err instanceof RpcError && err.code === -32602,
      );
    }

    // Non-string project_id throws -32602.
    for (const bad of [123, true, {}]) {
      assert.throws(
        () => callMethod('stats.sessions', { project_id: bad }),
        (err: any) => err instanceof RpcError && err.code === -32602,
      );
    }
  });
});

test('stats.sessions orders days oldest first and last is today', async () => {
  await withFixture((_db, callMethod) => {
    const res = callMethod('stats.sessions', { days: 14 });
    assert.equal(res.days.length, 14);
    assert.equal(res.days[13].day, localDayString(0));
    assert.equal(res.days[12].day, localDayString(-1));
    for (let i = 0; i < res.days.length - 1; i++) {
      assert.ok(res.days[i].day < res.days[i + 1].day);
    }
  });
});

test('stats.sessions buckets outcomes by latest proof, counts starts by state, and filters by project', async () => {
  await withFixture((db, callMethod) => {
    const todayNoon = localNoonIso(0, 12, 0);
    const today10 = localNoonIso(0, 10, 0);
    const today11 = localNoonIso(0, 11, 0);
    const yesterdayNoon = localNoonIso(-1, 12, 0);
    const yesterday10 = localNoonIso(-1, 10, 0);

    // Session 1: older pass and newer fail resolves to failed.
    insertSession(db, { id: 's_fail', projectId: 'p1', state: 'working', startedAt: today10, endedAt: todayNoon });
    insertDoneProof(db, { id: 'dp1', sessionId: 's_fail', at: today10, exitCode: 0 });
    insertDoneProof(db, { id: 'dp2', sessionId: 's_fail', at: today11, exitCode: 1 });

    // Session 2: older fail and newer pass resolves to succeeded.
    insertSession(db, { id: 's_succ', projectId: 'p1', state: 'starting', startedAt: today10, endedAt: todayNoon });
    insertDoneProof(db, { id: 'dp3', sessionId: 's_succ', at: today10, exitCode: 1 });
    insertDoneProof(db, { id: 'dp4', sessionId: 's_succ', at: today11, exitCode: 0 });

    // Session 3: null exit code resolves to failed.
    insertSession(db, { id: 's_null', projectId: 'p1', state: 'waiting_for_you', startedAt: today10, endedAt: todayNoon });
    insertDoneProof(db, { id: 'dp5', sessionId: 's_null', at: today11, exitCode: null });

    // Session 4: no proof resolves to unchecked.
    insertSession(db, { id: 's_uncheck', projectId: 'p1', state: 'done', startedAt: today10, endedAt: todayNoon });

    // Session 5: hidden session is counted.
    insertSession(db, { id: 's_hidden', projectId: 'p1', state: 'idle', startedAt: today10, endedAt: todayNoon, hidden: 1 });
    insertDoneProof(db, { id: 'dp6', sessionId: 's_hidden', at: today11, exitCode: 0 });

    // Session 6: other project session.
    insertSession(db, { id: 's_p2', projectId: 'p2', state: 'working', startedAt: today10, endedAt: todayNoon });
    insertDoneProof(db, { id: 'dp7', sessionId: 's_p2', at: today11, exitCode: 0 });

    // Session 7: session ended yesterday lands in second last bucket.
    insertSession(db, { id: 's_yest', projectId: 'p1', state: 'exited', startedAt: yesterday10, endedAt: yesterdayNoon });
    insertDoneProof(db, { id: 'dp8', sessionId: 's_yest', at: yesterday10, exitCode: 0 });

    // Query filtered to project p1.
    const resP1 = callMethod('stats.sessions', { project_id: 'p1', days: 14 });
    const todayP1 = resP1.days[13];
    assert.equal(todayP1.succeeded, 2);
    assert.equal(todayP1.failed, 2);
    assert.equal(todayP1.unchecked, 1);
    assert.equal(todayP1.started.starting, 1);
    assert.equal(todayP1.started.working, 1);
    assert.equal(todayP1.started.waiting_for_you, 1);
    assert.equal(todayP1.started.done, 1);
    assert.equal(todayP1.started.idle, 1);
    assert.equal(todayP1.started.unknown, 0);
    assert.equal(todayP1.started.exited, 0);

    // Second last bucket contains yesterday session.
    const yestP1 = resP1.days[12];
    assert.equal(yestP1.succeeded, 1);
    assert.equal(yestP1.failed, 0);
    assert.equal(yestP1.unchecked, 0);
    assert.equal(yestP1.started.exited, 1);

    // Query across all projects includes project p2.
    const resAll = callMethod('stats.sessions', { days: 14 });
    const todayAll = resAll.days[13];
    assert.equal(todayAll.succeeded, 3);
    assert.equal(todayAll.started.working, 2);
  });
});

test('stats.sessions outcome resolves to latest proof rather than earliest proof', async () => {
  await withFixture((db, callMethod) => {
    const todayNoon = localNoonIso(0, 12, 0);
    const today10 = localNoonIso(0, 10, 0);
    const today11 = localNoonIso(0, 11, 0);

    // Session ended today with older pass and newer fail.
    insertSession(db, { id: 's_latest', projectId: 'p1', state: 'done', startedAt: today10, endedAt: todayNoon });
    insertDoneProof(db, { id: 'dp_old', sessionId: 's_latest', at: today10, exitCode: 0 });
    insertDoneProof(db, { id: 'dp_new', sessionId: 's_latest', at: today11, exitCode: 1 });

    const res = callMethod('stats.sessions', { project_id: 'p1', days: 14 });
    const today = res.days[13];
    assert.equal(today.succeeded, 0);
    assert.equal(today.failed, 1);
    assert.equal(today.unchecked, 0);
  });
});

test('stats.checks validates days bounds and non-string project_id', async () => {
  await withFixture((_db, callMethod) => {
    // Default days length is 14.
    const def = callMethod('stats.checks', {});
    assert.equal(def.days.length, 14);

    // Days=1 returns exactly today.
    const one = callMethod('stats.checks', { days: 1 });
    assert.equal(one.days.length, 1);
    assert.equal(one.days[0].day, localDayString(0));

    // Days=90 is allowed.
    const ninety = callMethod('stats.checks', { days: 90 });
    assert.equal(ninety.days.length, 90);

    // Invalid days bounds throw -32602.
    for (const bad of [0, 91, 1.5, '7']) {
      assert.throws(
        () => callMethod('stats.checks', { days: bad }),
        (err: any) => err instanceof RpcError && err.code === -32602,
      );
    }

    // Non-string project_id throws -32602.
    for (const bad of [123, true, {}]) {
      assert.throws(
        () => callMethod('stats.checks', { project_id: bad }),
        (err: any) => err instanceof RpcError && err.code === -32602,
      );
    }
  });
});

test('stats.checks computes runs, passed, and rate per day with window and project filter', async () => {
  await withFixture((db, callMethod) => {
    const todayNoon = localNoonIso(0, 12, 0);
    const outsideWindow = localNoonIso(-15, 12, 0);

    insertSession(db, { id: 's_chk_1', projectId: 'p1' });
    insertSession(db, { id: 's_chk_2', projectId: 'p2' });

    // Project p1 checks on today: 2 passed, 2 failed.
    insertDoneProof(db, { id: 'cp1', sessionId: 's_chk_1', at: todayNoon, exitCode: 0 });
    insertDoneProof(db, { id: 'cp2', sessionId: 's_chk_1', at: todayNoon, exitCode: 1 });
    insertDoneProof(db, { id: 'cp3', sessionId: 's_chk_1', at: todayNoon, exitCode: null });
    insertDoneProof(db, { id: 'cp4', sessionId: 's_chk_1', at: todayNoon, exitCode: 0 });

    // Project p2 check on today: 1 passed.
    insertDoneProof(db, { id: 'cp5', sessionId: 's_chk_2', at: todayNoon, exitCode: 0 });

    // Check outside 14-day window.
    insertDoneProof(db, { id: 'cp6', sessionId: 's_chk_1', at: outsideWindow, exitCode: 0 });

    // Query for project p1 with 14 days.
    const resP1 = callMethod('stats.checks', { project_id: 'p1', days: 14 });
    const todayP1 = resP1.days[13];
    assert.equal(todayP1.runs, 4);
    assert.equal(todayP1.passed, 2);
    assert.equal(todayP1.rate, 0.5);

    // Empty day has rate null and runs 0.
    const emptyDay = resP1.days[12];
    assert.equal(emptyDay.runs, 0);
    assert.equal(emptyDay.passed, 0);
    assert.equal(emptyDay.rate, null);

    // Total runs in 14-day window excludes proof from 15 days ago.
    const totalRuns = resP1.days.reduce((acc: number, d: any) => acc + d.runs, 0);
    assert.equal(totalRuns, 4);

    // Query without project filter includes project p2.
    const resAll = callMethod('stats.checks', { days: 14 });
    const todayAll = resAll.days[13];
    assert.equal(todayAll.runs, 5);
    assert.equal(todayAll.passed, 3);
    assert.equal(todayAll.rate, 0.6);
  });
});
