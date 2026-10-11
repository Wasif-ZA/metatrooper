import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
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

test('statusline wrapper keeps the last Claude reading when a tick has no rate_limits', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-sl-'));
  const run = (d: object) => spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'statusline.js')], { input: JSON.stringify(d), env: { ...process.env, METATROOPER_HOME: home } });
  const file = path.join(home, 'claude-limits.json');
  run({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1 } } });
  run({ model: { display_name: 'x' } });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).rate_limits.five_hour.used_percentage, 12);
});

test('statusline wrapper records context fill and delegates to user statusline', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-sl-ctx-'));
  const script = path.join(import.meta.dirname, '..', 'statusline.js');
  const run = (d: object, args: string[] = [], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      input: JSON.stringify(d),
      encoding: 'utf8',
      env: { ...process.env, METATROOPER_HOME: home, ...env },
    });

  run({ session_id: 's_abc-123', context_window: { used_percentage: 73 } });
  const f1 = path.join(home, 'claude-context', 's_abc-123.json');
  assert.ok(fs.existsSync(f1));
  assert.equal(JSON.parse(fs.readFileSync(f1, 'utf8')).used_percentage, 73);

  run({ session_id: 'sub/id', context_window: { used_percentage: 50 } });
  run({ session_id: '..', context_window: { used_percentage: 50 } });
  run({ session_id: '../escape', context_window: { used_percentage: 50 } });
  run({ session_id: 'dots..id', context_window: { used_percentage: 50 } });
  assert.deepEqual(fs.readdirSync(path.join(home, 'claude-context')), ['s_abc-123.json']);

  const settingsFile = path.join(home, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { command: 'node -e "console.log(\'MARKER_OUTPUT\')"' } }));
  const rUser = run({}, ['--user-statusline'], { METATROOPER_CLAUDE_SETTINGS: settingsFile });
  assert.ok(rUser.stdout.includes('MARKER_OUTPUT'));

  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { command: 'node -e "console.log(\'MARKER_RECURSE\')" statusline.js' } }));
  const rRecurse = run({ model: { display_name: 'Claude Test' }, context_window: { used_percentage: 42 } }, ['--user-statusline'], { METATROOPER_CLAUDE_SETTINGS: settingsFile });
  assert.ok(!rRecurse.stdout.includes('MARKER_RECURSE'));
  assert.ok(rRecurse.stdout.includes('Claude Test'));
  assert.ok(rRecurse.stdout.includes('ctx 42%'));
});

test('window names follow the minutes', () => {
  assert.deepEqual([300, 1440, 10080, 90].map(windowName), ['5h', 'daily', 'weekly', '90m']);
});
