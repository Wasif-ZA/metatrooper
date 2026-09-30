import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('M1-28 session tokens equal the sum over unique message.id, last streamed record wins, read incrementally', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-meter-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { readClaudeTranscript, sessionTokens } = await import('../src/meter.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p', 'claude', 'wt', 'working', 'x', 'x')").run();
    const file = path.join(home, 't.jsonl');
    const rec = (id: string, i: number, o: number, model = 'claude-sonnet-5-5') =>
      JSON.stringify({ type: 'assistant', timestamp: '2026-09-30T10:00:00.000+10:00', message: { id, model, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } }) + '\n';
    fs.writeFileSync(file, rec('m1', 100, 5) + rec('m1', 100, 50) + rec('m2', 200, 20) + 'not json\n');
    assert.equal(readClaudeTranscript(db, 's1', file), 3);
    assert.deepEqual(sessionTokens(db, 's1'), { in: 300, out: 70, cache_read: 20, cache_write: 0 });
    // partial trailing line is left for the next read; already-read bytes are not re-read
    fs.appendFileSync(file, rec('m3', 1, 1).slice(0, 40));
    assert.equal(readClaudeTranscript(db, 's1', file), 0);
    fs.appendFileSync(file, rec('m3', 1, 1).slice(40) + rec('m2', 200, 25, 'unknown-model'));
    assert.equal(readClaudeTranscript(db, 's1', file), 2);
    assert.deepEqual(sessionTokens(db, 's1'), { in: 301, out: 76, cache_read: 30, cache_write: 0 });
    const usd = db.prepare("SELECT usd FROM usage WHERE dedupe_key IN ('m2') ").get() as { usd: number | null };
    assert.equal(usd.usd, null);
    const known = db.prepare("SELECT usd FROM usage WHERE dedupe_key = 'm1'").get() as { usd: number };
    assert.ok(known.usd > 0);
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
