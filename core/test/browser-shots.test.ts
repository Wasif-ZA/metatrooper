import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { listShots, saveShot, shotFile } from '../src/browser/shots.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'shots-'));
  const db = new DatabaseSync(join(home, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = OFF');
  const runDir = join(home, 'project', '.troop', 'runs', 'r1');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', join(home, 'project'), 'P', now, now);
  db.prepare('INSERT INTO pipeline (id, source, path, version, valid) VALUES (?, ?, ?, ?, ?)').run('website-build', 'builtin', join(home, 'w.json'), 1, 1);
  db.prepare('INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('r1', 'website-build', 'p1', '{}', runDir, 'running', 'manual', 0, 0, 0, now);
  db.prepare("INSERT INTO run_step (run_id, step_id, iteration, status, session_id) VALUES ('r1', 'critique', 0, 'done', 's1')").run();
  db.prepare("INSERT INTO run_step (run_id, step_id, iteration, status, session_id) VALUES ('r1', 'critique', 1, 'running', 's2')").run();
  return { home, db, runDir, close: () => { db.close(); rmSync(home, { recursive: true, force: true }); } };
}

test('shotFile names a step shot by step, round and label inside the run folder, and refuses anything else', () => {
  const f = fixture();
  try {
    assert.equal(shotFile(f.db, 's1', '1280'), join(f.runDir, 'shots', 'critique-1-1280.png'));
    assert.equal(shotFile(f.db, 's2', '390'), join(f.runDir, 'shots', 'critique-2-390.png'));
    for (const bad of ['../x', '1280.png', 'A', '', 'a/b', 'x'.repeat(33), 7]) assert.throws(() => shotFile(f.db, 's1', bad), /save_as must be/);
    assert.throws(() => shotFile(f.db, null, '1280'), /only in a pipeline step/);
    assert.throws(() => shotFile(f.db, 'nobody', '1280'), /only in a pipeline step/);
  } finally {
    f.close();
  }
});

test('saveShot writes the PNG and listShots returns shots oldest round first, ignoring other files', () => {
  const f = fixture();
  try {
    assert.deepEqual(listShots(f.runDir), []);
    for (const n of ['critique-2-390.png', 'critique-1-1280.png', 'critique-10-1280.png', 'critique-2-1280.png']) saveShot(join(f.runDir, 'shots', n), PNG);
    writeFileSync(join(f.runDir, 'shots', 'notes.txt'), 'x');
    assert.deepEqual(readFileSync(join(f.runDir, 'shots', 'critique-1-1280.png')), Buffer.from(PNG, 'base64'));
    assert.deepEqual(listShots(f.runDir), ['critique-1-1280.png', 'critique-2-1280.png', 'critique-2-390.png', 'critique-10-1280.png']);
  } finally {
    f.close();
  }
});

test('the browser MCP server refuses save_as outside a pipeline step and saves nothing', async () => {
  const f = fixture();
  try {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../src/hook/browser-mcp.ts')], { env: { ...process.env, METATROOPER_HOME: f.home }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    const ask = (id: number, args: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'screenshot', arguments: args } })}\n`);
    ask(1, { save_as: '1280' });
    ask(2, { save_as: '../evil' });
    const deadline = Date.now() + 10_000;
    while (out.split('\n').filter(Boolean).length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    const replies = Object.fromEntries(out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.result]));
    assert.equal(replies[1].isError, true);
    assert.match(replies[1].content[0].text, /only in a pipeline step/);
    assert.match(replies[2].content[0].text, /save_as must be/);
    assert.equal(existsSync(join(f.runDir, 'shots')), false);
  } finally {
    f.close();
  }
});
