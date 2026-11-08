import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function fixture(engine: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-honest-prices-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const db = openCoreDb();
  const close = () => {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(home, { recursive: true, force: true });
  };
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s', 'p', ?, 'pty', 'working', 'x', '2026-11-09T00:00:00Z')").run(engine);
    return { home, db, close };
  } catch (e) {
    close();
    throw e;
  }
}

test('M7-23a every model price has a source URL and date or is explicitly estimated', () => {
  const { models } = JSON.parse(fs.readFileSync(new URL('../prices.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(models).length > 0);
  for (const [model, price] of Object.entries(models) as Array<[string, { source?: string; as_of?: string; estimated?: boolean }]>) {
    if (price.estimated === true) continue;
    assert.equal(typeof price.source, 'string', model);
    const source = new URL(price.source!);
    assert.ok(source.protocol === 'https:' || source.protocol === 'http:', model);
    assert.match(price.as_of ?? '', /^\d{4}-\d{2}-\d{2}$/, model);
  }
});

test('M7-23c an unknown gpt model uses the fallback price and Codex persists the estimated flag', async () => {
  const f = await fixture('codex');
  try {
    const { usdFor, usdEstimated, readCodexSession } = await import('../src/meter.ts');
    const { snapshot } = await import('../../workbench/src/queries.ts');
    const { models } = JSON.parse(fs.readFileSync(new URL('../prices.json', import.meta.url), 'utf8'));
    const model = 'gpt-9-test';
    assert.equal(models[model], undefined);
    const price = models['gpt-*'];
    const expected = (800 * price.in + 100 * price.out + 200 * price.cache_read + 50 * price.cache_write) / 1e6;
    assert.ok(expected > 0);
    assert.equal(usdFor(model, 800, 100, 200, 50), expected);
    assert.equal(usdEstimated(model), true);
    const file = path.join(f.home, 'rollout.jsonl');
    const line = (type: string, payload: object) => JSON.stringify({ timestamp: '2026-11-09T00:00:01Z', type, payload }) + '\n';
    fs.writeFileSync(file, line('turn_context', { model })
      + line('event_msg', { type: 'task_started', turn_id: 't1' })
      + line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 200, cache_write_input_tokens: 50, output_tokens: 100 } } }));
    assert.equal(readCodexSession(f.db, 's', file), 1);
    const rows = f.db.prepare("SELECT model, usd, usd_estimated, source FROM usage WHERE session_id = 's'").all();
    assert.deepEqual(rows.map(r => ({ ...r })), [{ model, usd: expected, usd_estimated: 1, source: 'codex-session' }]);
    const session = snapshot(f.db, 'p').sessions.find(s => s.id === 's')!;
    assert.equal(session.usd, expected);
    assert.equal(session.usd_estimated, 1);
  } finally {
    f.close();
  }
});

test('M7-23c a published Claude price is not estimated and a reread clears an estimated usage flag', async () => {
  const f = await fixture('claude');
  try {
    const { usdFor, usdEstimated, readClaudeTranscript } = await import('../src/meter.ts');
    const { snapshot } = await import('../../workbench/src/queries.ts');
    const model = 'claude-sonnet-5-5';
    assert.equal(usdEstimated(model), false);
    const file = path.join(f.home, 'claude.jsonl');
    const rec = (model: string) => JSON.stringify({ message: { id: 'm1', model, usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 } } }) + '\n';
    fs.writeFileSync(file, rec('gpt-9-test'));
    assert.equal(readClaudeTranscript(f.db, 's', file), 1);
    assert.equal((f.db.prepare("SELECT usd_estimated FROM usage WHERE dedupe_key = 'm1'").get() as { usd_estimated: number }).usd_estimated, 1);
    fs.appendFileSync(file, rec(model));
    assert.equal(readClaudeTranscript(f.db, 's', file), 1);
    const expected = usdFor(model, 1000, 100, 200, 50);
    assert.ok(expected! > 0);
    const rows = f.db.prepare("SELECT model, usd, usd_estimated FROM usage WHERE session_id = 's'").all();
    assert.deepEqual(rows.map(r => ({ ...r })), [{ model, usd: expected, usd_estimated: 0 }]);
    const session = snapshot(f.db, 'p').sessions.find(s => s.id === 's')!;
    assert.equal(session.usd, expected);
    assert.equal(session.usd_estimated, 0);
  } finally {
    f.close();
  }
});

test('M7-23b agy usage stays unpriced through the snapshot and its chip says no price, never $0', async () => {
  const f = await fixture('agy');
  try {
    const { readAgyTranscript } = await import('../src/meter.ts');
    const { snapshot } = await import('../../workbench/src/queries.ts');
    const file = path.join(f.home, 'agy.jsonl');
    fs.writeFileSync(file, JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 100, cache_read_tokens: 10, output_tokens: 20 }) + '\n');
    assert.equal(readAgyTranscript(f.db, 's', file), 1);
    const rows = f.db.prepare("SELECT usd, usd_estimated FROM usage WHERE session_id = 's'").all();
    assert.deepEqual(rows.map(r => ({ ...r })), [{ usd: null, usd_estimated: 0 }]);
    const session = snapshot(f.db, 'p').sessions.find(s => s.id === 's')!;
    assert.equal(session.tokens, 120);
    assert.equal(session.usd, null);
    assert.equal(session.usd_estimated, 0);
    const appSource = fs.readFileSync(new URL('../../workbench/renderer/app.js', import.meta.url), 'utf8');
    const source = appSource.match(/^function costChip\([^]*?\r?\n}\r?\n/m)![0];
    const costChip = new Function(source + '; return costChip;')();
    const chip = costChip(session);
    assert.match(chip, /no price/);
    assert.ok(!chip.includes('$0'));
    assert.equal(chip, '120 tok · no price');
  } finally {
    f.close();
  }
});

test('M7-23 upgrading a db without usd_estimated backfills priced gpt rows once and leaves claude rows at 0', async () => {
  const f = await fixture('codex');
  try {
    f.db.exec('ALTER TABLE usage DROP COLUMN usd_estimated');
    const ins = f.db.prepare("INSERT INTO usage (at, session_id, engine_id, provider, model, tokens_in, tokens_out, usd, source, dedupe_key) VALUES ('x', 's', 'codex', 'local-cli', ?, 1, 1, ?, 'transcript', ?)");
    ins.run('gpt-9-test', 0.5, 'g1');
    ins.run('gpt-9-test', null, 'g2');
    ins.run('claude-sonnet-5-5', 0.5, 'c1');
    const { openCoreDb } = await import('../src/store/db.ts');
    const db = openCoreDb();
    const flag = (k: string) => (db.prepare('SELECT usd_estimated FROM usage WHERE dedupe_key = ?').get(k) as { usd_estimated: number }).usd_estimated;
    assert.deepEqual([flag('g1'), flag('g2'), flag('c1')], [1, 0, 0]);
    db.exec("UPDATE usage SET usd_estimated = 0 WHERE dedupe_key = 'g1'");
    db.close();
    const again = openCoreDb();
    assert.equal((again.prepare("SELECT usd_estimated FROM usage WHERE dedupe_key = 'g1'").get() as { usd_estimated: number }).usd_estimated, 0);
    again.close();
  } finally {
    f.close();
  }
});
