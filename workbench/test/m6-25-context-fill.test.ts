import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONTEXT_WINDOWS, contextWindow, snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const terminalSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');

const fn = (name: string, src = appSource) =>
  src.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\r?\\n}\\r?\\n`, 'm'))![0];

function evaluateRenderer(src = appSource) {
  return new Function(`${fn('ctxChip', src)}; return { ctxChip };`)();
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-context-fill-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('M6-25a Claude tile shows 85% context compacts soon in orange, engine with no usage shows no chip', () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    f.db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/path/p1', 'p1', now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1), ('codex', '{}', 2)").run();

    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_claude_85', 'p1', 'claude', 'pty', 'working', now, now, 0);
    insertSession.run('s_claude_50', 'p1', 'claude', 'pty', 'working', now, now, 0);
    insertSession.run('s_codex_no_usage', 'p1', 'codex', 'pty', 'working', now, now, 0);
    insertSession.run('s_unlisted', 'p1', 'claude', 'pty', 'working', now, now, 0);
    insertSession.run('s_over_100', 'p1', 'claude', 'pty', 'working', now, now, 0);

    const claudeWindow = contextWindow('claude-opus-5-5');
    assert.ok(claudeWindow !== null && claudeWindow > 0);
    const target85 = Math.round(claudeWindow * 0.85);
    const target50 = Math.round(claudeWindow * 0.50);

    const insertUsage = f.db.prepare(
      'INSERT INTO usage (at, session_id, engine_id, provider, model, tokens_in, tokens_out, cache_read, cache_write, usd, source, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let seq = 0;
    insertUsage.run(now, 's_claude_85', 'claude', 'local-cli', 'claude-opus-5-5', 1200, 300, 400, 100, 0.05, 'transcript', `k-${++seq}`);
    insertUsage.run(now, 's_claude_85', 'claude', 'local-cli', 'claude-opus-5-5', target85 - 15000, 40000, 10000, 5000, 0.85, 'transcript', `k-${++seq}`);

    insertUsage.run(now, 's_claude_50', 'claude', 'local-cli', 'claude-opus-5-5', target50 - 15000, 10000, 10000, 5000, 0.50, 'transcript', `k-${++seq}`);

    insertUsage.run(now, 's_unlisted', 'claude', 'local-cli', 'gpt-5', 2000, 500, 0, 0, 0.02, 'transcript', `k-${++seq}`);

    insertUsage.run(now, 's_over_100', 'claude', 'local-cli', 'claude-opus-5-5', claudeWindow + 10000, 5000, 0, 0, 1.20, 'transcript', `k-${++seq}`);

    const snap = snapshot(f.db, 'p1');
    const { ctxChip } = evaluateRenderer(appSource);

    const s85 = snap.sessions.find((s) => s.id === 's_claude_85')!;
    assert.equal(s85.ctx_used, target85);
    assert.equal(s85.ctx_window, claudeWindow);
    const chip85 = ctxChip(s85);
    assert.ok(chip85);
    assert.equal(chip85.warn, true);
    assert.ok(chip85.text.includes('85%'));
    assert.ok(chip85.text.includes('compacts soon'));

    const s50 = snap.sessions.find((s) => s.id === 's_claude_50')!;
    assert.equal(s50.ctx_used, target50);
    assert.equal(s50.ctx_window, claudeWindow);
    const chip50 = ctxChip(s50);
    assert.ok(chip50);
    assert.equal(chip50.warn, false);
    assert.ok(chip50.text.includes('50%'));
    assert.ok(!chip50.text.includes('compacts soon'));

    const sNoUsage = snap.sessions.find((s) => s.id === 's_codex_no_usage')!;
    assert.equal(sNoUsage.ctx_used, null);
    assert.equal(sNoUsage.ctx_window, null);
    assert.equal(ctxChip(sNoUsage), null);

    const sUnlisted = snap.sessions.find((s) => s.id === 's_unlisted')!;
    assert.equal(sUnlisted.ctx_model, 'gpt-5');
    assert.equal(sUnlisted.ctx_window, null);
    assert.equal(ctxChip(sUnlisted), null);

    const sOver = snap.sessions.find((s) => s.id === 's_over_100')!;
    assert.ok(sOver.ctx_used! > sOver.ctx_window!);
    assert.equal(ctxChip(sOver), null);

    assert.match(styleSource, /\.meta\.warn\b/);
    assert.match(terminalSource, /\.querySelector\(['"]\.tile-ctx['"]\)\.classList\.toggle\(['"]warn['"],/);

    const ctxMatch = terminalSource.match(
      /set\('\.tile-ctx',\s*x\.ctx\s*\?\s*x\.ctx\.text\s*:\s*''\);[\s\S]*?t\.el\.querySelector\('\.tile-ctx'\)\.classList\.toggle\('warn',\s*Boolean\(x\.ctx\s*&&\s*x\.ctx\.warn\)\);/,
    );
    assert.ok(ctxMatch);

    const fakeTile = () => {
      let text = '';
      const classes = new Set<string>();
      return {
        t: {
          el: {
            querySelector(sel: string) {
              if (sel === '.tile-ctx') {
                return {
                  get textContent() { return text; },
                  set textContent(v: string) { text = v; },
                  classList: {
                    toggle(cls: string, active: boolean) {
                      if (active) classes.add(cls);
                      else classes.delete(cls);
                    },
                  },
                };
              }
              return null;
            },
          },
        },
        get text() { return text; },
        hasWarn() { return classes.has('warn'); },
      };
    };

    const applyTileCtx = new Function(
      't',
      'x',
      `const set = (sel, text) => { const e = t.el.querySelector(sel); if (e.textContent !== text) e.textContent = text; };\n${ctxMatch[0]}`,
    );

    const tile85 = fakeTile();
    applyTileCtx(tile85.t, { ctx: chip85 });
    assert.equal(tile85.hasWarn(), true);
    assert.ok(tile85.text.includes('85%'));

    const tile50 = fakeTile();
    applyTileCtx(tile50.t, { ctx: chip50 });
    assert.equal(tile50.hasWarn(), false);
    assert.ok(tile50.text.includes('50%'));

    const tileNull = fakeTile();
    applyTileCtx(tileNull.t, { ctx: null });
    assert.equal(tileNull.hasWarn(), false);
    assert.equal(tileNull.text, '');
  } finally {
    f.close();
  }
});
