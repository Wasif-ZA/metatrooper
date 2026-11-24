import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { changeWorkspace, getWorkspace, undoWorkspace, usualWorkspace } from '../src/workspace.ts';
import { schemaFile } from '../src/paths.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/workspaces/${name}.json`, import.meta.url), 'utf8'));

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-11-workspace-'));
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = dir;
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => {
    db.close();
    if (prev === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('session-abcdef', 'project', 'fake', 'pty', 'idle', at, at);
  const set = (workspace: unknown) => changeWorkspace(db, { session_id: 'session-abcdef', op: 'set', workspace });
  const op = (o: string, name?: string) => changeWorkspace(db, { session_id: 'session-abcdef', op: o, name });
  return { set, op };
}

test('each of the five refusal cases keeps the old layout and names its reason', t => {
  const h = harness(t);
  const dev = fixture('dev');
  assert.equal(h.set(dev).last?.applied, true);
  const cases: Array<[string, string[]]> = [
    ['bad', ['at least 2', '"browser" is not a side bar button']],
    ['bad-no-name', ['no name']],
    ['bad-null-child', ['empty']],
    ['bad-one-pane-split', ['at least 2']],
    ['bad-too-deep', ['deeper than 4']],
  ];
  for (const [file, parts] of cases) {
    const r = h.set(fixture(file));
    assert.equal(r.last?.applied, false, file);
    assert.ok(r.last!.reasons.length > 0, file);
    for (const p of parts) assert.ok(r.last!.reasons.some(x => x.includes(p)), `${file} mentions ${p}: ${r.last!.reasons}`);
    assert.deepEqual(r.current, dev, `${file} keeps the old layout`);
    assert.equal(r.undo, 1, `${file} adds no history`);
  }
});

test('a valid layout applies, Undo restores the one before and My usual the default', t => {
  const h = harness(t);
  const dev = fixture('dev'), video = fixture('video');
  h.set(dev);
  const r = h.set(video);
  assert.equal(r.last?.applied, true);
  assert.deepEqual(r.current, video);
  assert.deepEqual(undoWorkspace('project').current, dev);
  const usual = usualWorkspace('project');
  assert.equal(usual.current, null);
  assert.equal(usual.usual, true);
  assert.deepEqual(undoWorkspace('project').current, dev);
  undoWorkspace('project');
  assert.equal(getWorkspace('project').undo, 0);
  assert.throws(() => undoWorkspace('project'), { code: -32003 });
});

test("the setter comes from the calling session, not the layout's by", t => {
  const h = harness(t);
  const r = h.set({ ...fixture('dev'), by: 'someone-else' });
  assert.equal(r.last?.applied, true);
  assert.ok(r.last!.setter.startsWith('fake'), r.last!.setter);
  assert.ok(!r.last!.setter.includes('someone-else'));
});

test('a saved layout is restored by name and an unknown name is refused', t => {
  const h = harness(t);
  const dev = fixture('dev');
  h.set(dev);
  assert.deepEqual(h.op('save', 'mine').saved, ['mine']);
  h.set(fixture('bakery'));
  const r = h.op('restore', 'mine');
  assert.equal(r.last?.applied, true);
  assert.equal(r.current?.name, 'mine');
  assert.deepEqual(r.current?.layout, dev.layout);
  assert.throws(() => h.op('restore', 'nope'), { code: -32002 });
});
