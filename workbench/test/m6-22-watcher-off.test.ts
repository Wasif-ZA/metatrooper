import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const termSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../renderer/wall.css', import.meta.url), 'utf8');

test('M6-22b: with the helper blocked, every session holding a live grant is listed as watcher off; none once the watcher runs or the grant ends', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-m6-22-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    db.exec(schema);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
    for (const id of ['s1', 's2', 's3']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?)").run(id, now, now);
    const grant = db.prepare("INSERT INTO grant (id, session_id, hwnd, pid, process_start, exe, title, created_at, ended_at) VALUES (?, ?, ?, 1, 't', 'notepad.exe', 'Notepad', ?, ?)");
    grant.run('gr_1', 's1', 1, now, null);
    grant.run('gr_2', 's1', 2, now, null);
    grant.run('gr_3', 's2', 3, now, null);
    grant.run('gr_4', 's3', 4, now, now);
    const meta = (v: string) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('input_watcher', ?)").run(v);

    assert.deepEqual(snapshot(db, 'p1').watcher_off, [], 'no watcher state yet');
    meta('off');
    assert.deepEqual(snapshot(db, 'p1').watcher_off, ['s1', 's2']);
    meta('on');
    assert.deepEqual(snapshot(db, 'p1').watcher_off, []);
    meta('off');
    db.prepare('UPDATE grant SET ended_at = ?').run(now);
    assert.deepEqual(snapshot(db, 'p1').watcher_off, []);
    db.exec('DROP TABLE grant');
    assert.deepEqual(snapshot(db, 'p1').watcher_off, [], 'a database from before the grant table');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M6-22b: a tile listed as watcher off shows "input watcher off" in orange; shells never do', () => {
  const line = appSource.match(/^ {2}for \(const x of shown\) x\.watchOff = .*$/m)![0];
  const shown = [{ id: 's1' }, { id: 's2' }, { id: 'sh1', shell: true }] as any[];
  new Function('shown', 'ui', line)(shown, { snap: { watcher_off: ['s1', 'sh1'] } });
  assert.deepEqual(shown.map((x) => x.watchOff), [true, false, false]);
  new Function('shown', 'ui', line)(shown, { snap: {} });
  assert.deepEqual(shown.map((x) => x.watchOff), [false, false, false]);

  assert.match(termSource, /<span class="tile-watch" hidden>input watcher off<\/span>/);
  assert.match(termSource, /t\.el\.querySelector\('\.tile-watch'\)\.hidden = !x\.watchOff;/);
  assert.match(css, /\.ph \.tile-watch \{ color: var\(--wait\);/);
  assert.match(css, /--wait: #ff7a1a;/, 'orange');
});
