import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { changeWorkspace, checkWorkspace } from '../src/workspace.ts';
import { WORKSPACE_TOOL } from '../src/hook/ouros-tools.ts';
import { schemaFile } from '../src/paths.ts';

// The seven approved layouts (n01..n09) load through ouros_workspace, which calls workspace.change -> changeWorkspace(op set).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/workspaces/${name}.json`, import.meta.url), 'utf8'));

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-11-approved-'));
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
  // the tool's args, exactly as mcp-core passes them on to workspace.change
  const tool = (args: { op?: string; workspace?: unknown; name?: string }) => changeWorkspace(db, { session_id: 'session-abcdef', op: args.op, workspace: args.workspace, name: args.name });
  return { db, tool };
}

for (const name of ['n01-home-anyone', 'n02-start-dev', 'n03-needs-wall', 'n04-turn-reviewer', 'n05-diff-comment', 'n06-job-anyone', 'n09-browser']) {
  test(`${name}: the workspace loads through ouros_workspace with no refusal`, t => {
    const h = harness(t);
    const ws = fixture(name);
    assert.deepEqual(checkWorkspace(ws, () => false), [], 'checkWorkspace finds nothing to refuse');
    assert.equal(WORKSPACE_TOOL.name, 'ouros_workspace');
    const r = h.tool({ op: 'set', workspace: ws });
    assert.equal(r.last?.applied, true, `refused: ${r.last?.reasons}`);
    assert.deepEqual(r.last?.reasons, []);
    assert.equal(r.current?.name, ws.name);
    assert.deepEqual(r.current, ws);
    assert.equal(r.usual, false);
  });
}

test('a layout naming a kit view is refused, so the check above can fail', () => {
  const ws = { name: 'x', rail: [], layout: { view: 'kit' } };
  assert.ok(checkWorkspace(ws, () => false).length > 0);
});
