import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot, withContext } from '../src/queries.ts';

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

test('M6-25 context fill chip from claude-context per session and terminal tile styling', () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    f.db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/path/p1', 'p1', now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1), ('codex', '{}', 2)").run();

    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden, native_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_claude_85', 'p1', 'claude', 'pty', 'working', now, now, 0, 'c_85');
    insertSession.run('s_claude_50', 'p1', 'claude', 'pty', 'working', now, now, 0, 'c_50');
    insertSession.run('s_codex', 'p1', 'codex', 'pty', 'working', now, now, 0, 'c_codex');
    insertSession.run('s_claude_nofile', 'p1', 'claude', 'pty', 'working', now, now, 0, 'c_nofile');
    insertSession.run('s_claude_dotdot', 'p1', 'claude', 'pty', 'working', now, now, 0, '..');
    insertSession.run('s_claude_slash', 'p1', 'claude', 'pty', 'working', now, now, 0, 'sub/id');

    const contextDir = join(f.dir, 'claude-context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, 'c_85.json'), JSON.stringify({ used_percentage: 85 }));
    writeFileSync(join(contextDir, 'c_50.json'), JSON.stringify({ used_percentage: 50 }));
    writeFileSync(join(contextDir, 'c_codex.json'), JSON.stringify({ used_percentage: 75 }));
    mkdirSync(join(contextDir, 'sub'), { recursive: true });
    writeFileSync(join(contextDir, 'sub', 'id.json'), JSON.stringify({ used_percentage: 60 }));
    writeFileSync(join(f.dir, '.json'), JSON.stringify({ used_percentage: 60 }));
    writeFileSync(join(contextDir, '...json'), JSON.stringify({ used_percentage: 60 }));

    const snap = withContext(snapshot(f.db, 'p1'), contextDir);
    const { ctxChip } = evaluateRenderer(appSource);

    const s85 = snap.sessions.find((s) => s.id === 's_claude_85')!;
    assert.equal(s85.ctx_pct, 85);
    const chip85 = ctxChip(s85);
    assert.ok(chip85);
    assert.equal(chip85.warn, true);
    assert.ok(chip85.text.includes('85%'));
    assert.ok(chip85.text.includes('compacts soon'));

    const s50 = snap.sessions.find((s) => s.id === 's_claude_50')!;
    assert.equal(s50.ctx_pct, 50);
    const chip50 = ctxChip(s50);
    assert.ok(chip50);
    assert.equal(chip50.warn, false);
    assert.ok(chip50.text.includes('50%'));
    assert.ok(!chip50.text.includes('compacts soon'));

    const sCodex = snap.sessions.find((s) => s.id === 's_codex')!;
    assert.equal(sCodex.ctx_pct, undefined);
    assert.equal(ctxChip(sCodex), null);

    const sNoFile = snap.sessions.find((s) => s.id === 's_claude_nofile')!;
    assert.equal(sNoFile.ctx_pct, undefined);
    assert.equal(ctxChip(sNoFile), null);

    const sDotDot = snap.sessions.find((s) => s.id === 's_claude_dotdot')!;
    assert.equal(sDotDot.ctx_pct, undefined);
    assert.equal(ctxChip(sDotDot), null);

    const sSlash = snap.sessions.find((s) => s.id === 's_claude_slash')!;
    assert.equal(sSlash.ctx_pct, undefined);
    assert.equal(ctxChip(sSlash), null);

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
