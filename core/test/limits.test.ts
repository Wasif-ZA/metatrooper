import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readLimits, windowName } from '../src/limits.ts';
import { nowIso } from '../src/time.ts';

const schema = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'contracts', 'schema.sql'), 'utf8');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-limits-'));
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const rows = () => db.prepare('SELECT provider, account, window, used_pct, resets_at, status FROM limit_reading ORDER BY provider, window').all().map((r) => ({ ...r }));
  return { home, db, rows };
}

function rollout(home: string, day: string, name: string, lines: object[]) {
  const dir = path.join(home, '.codex', 'sessions', ...day.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const limits = (primary: number, secondary: number) => ({
  timestamp: '2026-10-02T06:00:00.000Z',
  type: 'event_msg',
  payload: { type: 'token_count', rate_limits: { plan_type: 'pro', primary: { used_percent: primary, window_minutes: 300, resets_at: 1790000000 }, secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1790500000 } } },
});

test('M2-05 Codex windows come from the last rate_limits in the newest session file; Claude shows unavailable', () => {
  const t = setup();
  rollout(t.home, '2026/09/30', 'rollout-old.jsonl', [limits(99, 99)]);
  rollout(t.home, '2026/10/02', 'rollout-new.jsonl', [limits(10, 5), { type: 'event_msg', payload: { type: 'agent_message' } }, limits(42.5, 18)]);
  readLimits(t.db, t.home, t.home);
  assert.deepEqual(t.rows(), [
    { provider: 'claude', account: 'default', window: '5h', used_pct: null, resets_at: null, status: 'unavailable' },
    { provider: 'codex', account: 'pro', window: '5h', used_pct: 42.5, resets_at: nowIso(new Date(1790000000 * 1000)), status: 'ok' },
    { provider: 'codex', account: 'pro', window: 'weekly', used_pct: 18, resets_at: nowIso(new Date(1790500000 * 1000)), status: 'ok' },
  ]);
});

test('M2-05 with no Codex session files the Codex row says unavailable, never a number', () => {
  const t = setup();
  readLimits(t.db, t.home, t.home);
  const codex = t.rows().filter((r) => r.provider === 'codex');
  assert.deepEqual(codex, [{ provider: 'codex', account: 'default', window: '5h', used_pct: null, resets_at: null, status: 'unavailable' }]);
});

test('M2-05 Claude windows come from the statusline wrapper file; a file without rate_limits stays unavailable', () => {
  const t = setup();
  fs.writeFileSync(path.join(t.home, 'claude-limits.json'), JSON.stringify({ at: '2026-10-02T06:47:25.864Z', rate_limits: { five_hour: { used_percentage: 18, resets_at: 1790928600 }, seven_day: { used_percentage: 39, resets_at: 1791090000 } } }));
  readLimits(t.db, t.home, t.home);
  assert.deepEqual(t.rows().filter((r) => r.provider === 'claude'), [
    { provider: 'claude', account: 'default', window: '5h', used_pct: 18, resets_at: nowIso(new Date(1790928600 * 1000)), status: 'ok' },
    { provider: 'claude', account: 'default', window: 'weekly', used_pct: 39, resets_at: nowIso(new Date(1791090000 * 1000)), status: 'ok' },
  ]);
  fs.writeFileSync(path.join(t.home, 'claude-limits.json'), JSON.stringify({ at: 'x', rate_limits: null }));
  readLimits(t.db, t.home, t.home);
  assert.deepEqual(t.rows().filter((r) => r.provider === 'claude').map((r) => [r.window, r.used_pct, r.status]), [['5h', null, 'unavailable']]);
});

test('window names follow the minutes', () => {
  assert.deepEqual([300, 1440, 10080, 90].map(windowName), ['5h', 'daily', 'weekly', '90m']);
});
