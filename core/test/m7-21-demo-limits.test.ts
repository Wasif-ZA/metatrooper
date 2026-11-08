import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { lastCodexLimits, readLimits } from '../src/limits.ts';

const schema = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'contracts', 'schema.sql'), 'utf8');

function setup(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-m7-21-'));
  const ownerHome = path.join(dir, 'owner');
  const instanceHome = path.join(dir, 'instance');
  const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, METATROOPER_HOME: process.env.METATROOPER_HOME };
  t.after(() => {
    // Restore the environment and remove the temporary homes.
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Seed the owner's Codex session and leave the instance without .codex.
  const sessions = path.join(ownerHome, '.codex', 'sessions', '2026', '10', '02');
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(instanceHome);
  const reading = {
    timestamp: '2026-10-02T06:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: { plan_type: 'pro', primary: { used_percent: 42.5, window_minutes: 300, resets_at: 1790000000 }, secondary: { used_percent: 18, window_minutes: 10080, resets_at: 1790500000 } } },
  };
  fs.writeFileSync(path.join(sessions, 'rollout-owner.jsonl'), JSON.stringify(reading) + '\n');
  process.env.USERPROFILE = ownerHome;
  process.env.HOME = ownerHome;
  process.env.METATROOPER_HOME = instanceHome;
  return {
    ownerHome,
    expected: { at: reading.timestamp, plan: 'pro', windows: [reading.payload.rate_limits.primary, reading.payload.rate_limits.secondary] },
  };
}

test('M7-21b lastCodexLimits defaults to the demo home and ignores owner Codex sessions', (t) => {
  const { ownerHome, expected } = setup(t);
  assert.deepEqual(lastCodexLimits(ownerHome), expected);
  assert.equal(lastCodexLimits(), null);
});

test('M7-21b readLimits defaults to the demo home and records no owner Codex reading', (t) => {
  setup(t);
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema);

  readLimits(db);

  const codex = db.prepare("SELECT provider, account, window, used_pct, resets_at, status FROM limit_reading WHERE provider = 'codex'").all().map((row) => ({ ...row }));
  assert.deepEqual(codex, [
    { provider: 'codex', account: 'default', window: '5h', used_pct: null, resets_at: null, status: 'unavailable' },
  ]);
});

test('M7-21b without METATROOPER_HOME lastCodexLimits reads the owner home', (t) => {
  const { ownerHome, expected } = setup(t);
  delete process.env.METATROOPER_HOME;
  if (process.platform === 'win32' && os.homedir() !== ownerHome) {
    t.skip('This Node does not honor USERPROFILE in os.homedir(); the owner-home positive control cannot redirect the home.');
    return;
  }
  assert.equal(os.homedir(), ownerHome);
  assert.deepEqual(lastCodexLimits(), expected);
});
