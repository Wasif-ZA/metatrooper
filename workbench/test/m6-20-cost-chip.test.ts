import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

const fn = (name: string, src = appSource) =>
  src.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\r?\\n}\\r?\\n`, 'm'))![0];

function evaluateRenderer(src = appSource, ui: any = { snap: { git: {} } }, DEMO = false) {
  return new Function(
    'ui',
    'DEMO',
    `${fn('costChip', src)}\n${fn('tileMeta', src)}; return { costChip, tileMeta };`,
  )(ui, DEMO);
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-cost-chip-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('M6-20a Claude tile cost chip equals session tokens in usage; engine with no usage shows usage unknown', () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    f.db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/path/p1', 'p1', now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1), ('codex', '{}', 2)").run();

    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_claude', 'p1', 'claude', 'pty', 'working', now, now, 0);
    insertSession.run('s_missing_usd', 'p1', 'claude', 'pty', 'working', now, now, 0);
    insertSession.run('s_no_usage', 'p1', 'codex', 'pty', 'working', now, now, 0);

    const claudeUsage = [
      { tokens_in: 1250, tokens_out: 340, cache_read: 520, cache_write: 110, usd: 0.12 },
      { tokens_in: 2100, tokens_out: 480, cache_read: 830, cache_write: 210, usd: 0.35 },
      { tokens_in: 950, tokens_out: 180, cache_read: 310, cache_write: 70, usd: 0.28 },
    ];
    const missingUsdUsage = [
      { tokens_in: 800, tokens_out: 220, cache_read: 310, cache_write: 90, usd: 0.05 },
      { tokens_in: 500, tokens_out: 140, cache_read: 180, cache_write: 60, usd: null },
    ];

    const insertUsage = f.db.prepare(
      'INSERT INTO usage (at, session_id, engine_id, provider, tokens_in, tokens_out, cache_read, cache_write, usd, source, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let seq = 0;
    for (const u of claudeUsage) {
      insertUsage.run(now, 's_claude', 'claude', 'local-cli', u.tokens_in, u.tokens_out, u.cache_read, u.cache_write, u.usd, 'transcript', `k-${++seq}`);
    }
    for (const u of missingUsdUsage) {
      insertUsage.run(now, 's_missing_usd', 'claude', 'local-cli', u.tokens_in, u.tokens_out, u.cache_read, u.cache_write, u.usd, 'transcript', `k-${++seq}`);
    }

    const snap = snapshot(f.db, 'p1');
    const claudeSession = snap.sessions.find((s) => s.id === 's_claude')!;
    const missingUsdSession = snap.sessions.find((s) => s.id === 's_missing_usd')!;
    const noUsageSession = snap.sessions.find((s) => s.id === 's_no_usage')!;

    const ui: any = { snap: { git: {} } };
    const { costChip, tileMeta } = evaluateRenderer(appSource, ui, false);

    const expectedClaudeTokens = claudeUsage.reduce(
      (sum, r) => sum + (r.tokens_in ?? 0) + (r.tokens_out ?? 0) + (r.cache_read ?? 0) + (r.cache_write ?? 0),
      0,
    );
    const expectedClaudeUsd = claudeUsage.reduce((sum, r) => sum + (r.usd ?? 0), 0);
    const expectedClaudeChip = `${expectedClaudeTokens.toLocaleString('en-US')} tok · $${expectedClaudeUsd.toFixed(2)}`;

    assert.equal(costChip(claudeSession), expectedClaudeChip);
    assert.equal(tileMeta(claudeSession), expectedClaudeChip);

    const expectedMissingTokens = missingUsdUsage.reduce(
      (sum, r) => sum + (r.tokens_in ?? 0) + (r.tokens_out ?? 0) + (r.cache_read ?? 0) + (r.cache_write ?? 0),
      0,
    );
    const expectedMissingChip = `${expectedMissingTokens.toLocaleString('en-US')} tok`;

    assert.equal(costChip(missingUsdSession), expectedMissingChip);
    assert.equal(tileMeta(missingUsdSession), expectedMissingChip);
    assert.ok(!costChip(missingUsdSession).includes('$'));

    assert.equal(costChip(noUsageSession), 'usage unknown');
    assert.equal(tileMeta(noUsageSession), 'usage unknown');

    const demoRenderer = evaluateRenderer(appSource, ui, true);
    for (const s of [claudeSession, missingUsdSession, noUsageSession]) {
      const meta = demoRenderer.tileMeta(s);
      assert.ok(!meta.includes('tok'));
      assert.ok(!meta.includes('usage unknown'));
    }

    const uiWithGit: any = { snap: { git: { [claudeSession.id]: { branch: 'main', added: 4, deleted: 1 } } } };
    const demoGitRenderer = evaluateRenderer(appSource, uiWithGit, true);
    const gitMeta = demoGitRenderer.tileMeta(claudeSession);
    assert.equal(gitMeta, 'main +4 -1');
    assert.ok(!gitMeta.includes('tok'));
    assert.ok(!gitMeta.includes('usage unknown'));

  } finally {
    f.close();
  }
});
