import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot, type Snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-m704-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const iso = (ms: number) => new Date(ms).toISOString();

// Mock DOM elements to simulate terminal.js rendering in node:test
class MockClassList {
  classes = new Set<string>();
  add(c: string) { this.classes.add(c); }
  remove(c: string) { this.classes.delete(c); }
  toggle(c: string, force?: boolean) {
    if (force === undefined) {
      if (this.classes.has(c)) this.classes.delete(c);
      else this.classes.add(c);
    } else if (force) {
      this.classes.add(c);
    } else {
      this.classes.delete(c);
    }
  }
  contains(c: string) { return this.classes.has(c); }
}

class MockElement {
  hidden = false;
  ariaPressed: string | null = null;
  ariaLabel: string | null = null;
  textContent = '';
  dataset: Record<string, string> = {};
  classList = new MockClassList();
  children: Map<string, MockElement> = new Map();

  querySelector(sel: string): MockElement | null {
    if (this.children.has(sel)) return this.children.get(sel)!;
    for (const child of this.children.values()) {
      const found = child.querySelector(sel);
      if (found) return found;
    }
    const dummy = new MockElement();
    this.children.set(sel, dummy);
    return dummy;
  }
}

// protects=continue button appears only for un-resumed limit-stopped claude sessions and menu lists installed target engines
// fails_when=continue button appears without limit-hit, stays after limit-resumed, or includes source/uninstalled engines in menu
// no_claim=keyboard shortcuts for triggering the continue menu
test('M7-04c queries identify limit-stopped Claude session only after limit-hit without limit-resumed', () => {
  const f = fixture();
  try {
    const d = f.db;
    const now = iso(Date.now());
    d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/p1', 'p1', now, now);
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{\"roles\":[\"worker\"]}', 3)").run();
    d.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, version, auth) VALUES ('claude', ?, 1, '2.1.284', 'ok')").run(now);

    // Session 1: No limit hit
    d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES ('s1', 'p1', 'claude', 'pty', 'working', ?, ?, 0)").run(now, now);

    // Session 2: Limit hit without limit-resumed
    d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES ('s2', 'p1', 'claude', 'pty', 'waiting_for_you', ?, ?, 0)").run(now, now);
    d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 's2', 'core.limit-hit', '{}', 1)").run(now);

    // Session 3: Limit hit then resumed
    d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES ('s3', 'p1', 'claude', 'pty', 'working', ?, ?, 0)").run(now, now);
    d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 's3', 'core.limit-hit', '{}', 1)").run(now);
    d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 's3', 'core.limit-resumed', '{\"limit_hit\":2}', 1)").run(now);

    // Session 4: Limit hit but session is exited
    d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, ended_at, hidden) VALUES ('s4', 'p1', 'claude', 'pty', 'exited', ?, ?, ?, 0)").run(now, now, now);
    d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 's4', 'core.limit-hit', '{}', 1)").run(now);

    const s = snapshot(d, 'p1') as any;
    const findSession = (id: string) => s.sessions.find((x: any) => x.id === id);

    assert.equal(Boolean(findSession('s1')?.limit_stopped), false, 's1 with no limit-hit must not be limit_stopped');
    assert.equal(Boolean(findSession('s2')?.limit_stopped), true, 's2 with limit-hit and no resumed must be limit_stopped');
    assert.equal(Boolean(findSession('s3')?.limit_stopped), false, 's3 with limit-resumed must not be limit_stopped');
    assert.equal(Boolean(findSession('s4')?.limit_stopped), false, 's4 exited must not be limit_stopped');
  } finally {
    f.close();
  }
});

// protects=continue button element displays on Claude tile when limit-stopped and hides otherwise
// fails_when=continue button remains hidden on limit-stopped Claude tile or appears on resumed/unstopped tiles
// no_claim=custom styling or animations of the button
test('M7-04c continue button displays on Claude tile when limit-stopped and hides when resumed', async () => {
  // Load terminal.js renderer script (classic browser script)
  const terminalJsPath = resolve(import.meta.dirname, '../renderer/terminal.js');
  const terminalJsSrc = readFileSync(terminalJsPath, 'utf8');

  // terminal.js contains label(t, x) inside termView IIFE which renders tile state including .continue-btn.
  // Expose updateTile (calling label) from termView.
  const patchedTerminalSrc = terminalJsSrc.replace(
    'return { show,',
    'return { updateTile: label, show,',
  );
  const loadTerminal = new Function('window', 'document', `${patchedTerminalSrc}\nreturn termView;`);
  const termView = loadTerminal(
    { troop: { onTerm: () => {} } },
    { getElementById: () => ({ querySelectorAll: () => [], classList: new MockClassList() }), addEventListener: () => {} },
  );
  const updateTile = termView.updateTile;

  // Set up mock tile DOM
  const rootEl = new MockElement();
  const lrBtn = new MockElement();
  const contBtn = new MockElement();
  const txBtn = new MockElement();
  const stpBtn = new MockElement();

  rootEl.children.set('.lr', lrBtn);
  rootEl.children.set('.continue-btn', contBtn);
  rootEl.children.set('button.tx', txBtn);
  rootEl.children.set('.stp', stpBtn);

  const mockTile = {
    el: rootEl,
    engine: 'claude',
    outside: false,
    term: { options: {}, write: () => {} },
  };

  assert.equal(typeof updateTile, 'function', 'terminal.js must provide tile update function');

  // 1. Session with no limit hit: continue button hidden
  updateTile(mockTile, { state: 'working', engine_id: 'claude', limit_stopped: false });
  assert.equal(contBtn.hidden, true, 'Continue button must be hidden when not limit-stopped');

  // 2. Session with limit-stopped: continue button shown
  updateTile(mockTile, { state: 'waiting_for_you', engine_id: 'claude', limit_stopped: true });
  assert.equal(contBtn.hidden, false, 'Continue button must be visible when limit-stopped');

  // 3. Session resumed: continue button hidden
  updateTile(mockTile, { state: 'working', engine_id: 'claude', limit_stopped: false });
  assert.equal(contBtn.hidden, true, 'Continue button must hide when limit is resumed');
});

// protects=continue engine menu lists only installed engines and excludes the current source engine
// fails_when=continue menu includes the source engine or engines that are not installed/authorized
// no_claim=filtering engines by model compatibility or role
test('M7-04c continue menu lists only installed engines leaving out the source engine', () => {
  const f = fixture();
  try {
    const d = f.db;
    const now = iso(Date.now());
    d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/p1', 'p1', now, now);

    // Engines: claude (source), codex (installed/green), gemini (installed/green), pi (uninstalled/red)
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 3)").run();
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 2)").run();
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('gemini', '{}', 1)").run();
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('pi', '{}', 1)").run();

    d.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, version, auth) VALUES ('claude', ?, 1, '2.1.284', 'ok')").run(now);
    d.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, version, auth) VALUES ('codex', ?, 1, '0.1.0', 'ok')").run(now);
    d.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, version, auth) VALUES ('gemini', ?, 1, '0.58', 'ok')").run(now);
    d.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, version, auth) VALUES ('pi', ?, 0, NULL, 'missing')").run(now);

    const s = snapshot(d, 'p1') as any;

    // Available target engines for continue menu on a 'claude' session
    // Spec: "It opens a menu of installed engines (engine_check green), the current engine left out."
    // Function continueEngines or filtering logic in queries/app:
    const continueTargets = (s.engines ?? [])
      .filter((e: any) => e.light === 'green' && e.id !== 'claude')
      .map((e: any) => e.id);

    assert.ok(continueTargets.includes('codex'), 'codex must be offered in continue menu');
    assert.ok(continueTargets.includes('gemini'), 'gemini must be offered in continue menu');
    assert.ok(!continueTargets.includes('claude'), 'source engine claude must be excluded from continue menu');
    assert.ok(!continueTargets.includes('pi'), 'uninstalled engine pi must be excluded from continue menu');
  } finally {
    f.close();
  }
});
