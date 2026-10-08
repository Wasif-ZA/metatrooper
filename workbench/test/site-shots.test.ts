import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { runDetail, runShot } from '../src/rundetail.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-shots-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  const runDir = join(dir, 'project', '.troop', 'runs', 'r1');
  mkdirSync(join(runDir, 'shots'), { recursive: true });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', join(dir, 'project'), 'P', now, now);
  db.prepare('INSERT INTO pipeline (id, source, path, version, valid) VALUES (?, ?, ?, ?, ?)').run('website-build', 'builtin', join(dir, 'w.json'), 1, 1);
  db.prepare('INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('r1', 'website-build', 'p1', '{}', runDir, 'running', 'manual', 0, 0, 0, now);
  writeFileSync(join(dir, 'secret.png'), 'secret');
  return { dir, db, runDir, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('runDetail lists the run folder shots and runShot reads only shot names inside it', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.runDir, 'shots', 'critique-2-390.png'), 'b');
    writeFileSync(join(f.runDir, 'shots', 'critique-1-1280.png'), 'a');
    writeFileSync(join(f.runDir, 'shots', 'other.png'), 'x');
    const d = runDetail(f.db, 'r1');
    assert.ok(!('error' in d));
    assert.deepEqual((d as any).shots, ['critique-1-1280.png', 'critique-2-390.png']);
    assert.equal(runShot(f.db, 'r1', 'critique-1-1280.png'), `data:image/png;base64,${Buffer.from('a').toString('base64')}`);
    for (const bad of ['other.png', '../../../secret.png', 'critique-1-..png', 'critique-9-1280.png']) assert.equal(runShot(f.db, 'r1', bad), null);
    assert.equal(runShot(f.db, 'missing', 'critique-1-1280.png'), null);
  } finally {
    f.close();
  }
});

test('preview-stage shows the latest round and before-after shows the first and latest rounds side by side', () => {
  const ctx: any = { runLayouts: {} };
  vm.createContext(ctx);
  for (const f of ['preview-stage.js', 'before-after.js']) vm.runInContext(readFileSync(new URL(`../renderer/layouts/${f}`, import.meta.url), 'utf8'), ctx);
  const runSrc = readFileSync(new URL('../renderer/layouts/run.js', import.meta.url), 'utf8');
  const rounds = new Function(`return ${runSrc.match(/rounds\(m\) \{[^]*?\n    \},/)![0].replace(/^rounds\(m\)/, 'function (m)').replace(/,$/, '')}`)();
  const esc = (s: unknown) => String(s ?? '');
  const h = {
    esc, rounds, label: (s: any) => s.status, glyph: () => '', gateCard: () => '', files: () => '', events: () => [], eventLine: () => '', detail: () => '',
    shotRow: (m: any, r: any) => r.shots.map((x: any) => `[${x.name}]`).join(''),
  };
  const shots = ['critique-1-1280.png', 'critique-1-390.png', 'critique-2-1280.png', 'critique-3-390.png', 'critique-3-1280.png'];
  const m = { run: { id: 'r1' }, list: [{ id: 'critique', title: 'Critique', status: 'running', def: { loop: {} } }, { id: 'preview', title: 'Preview', status: 'pending' }], detail: { outputs: {}, shots }, variants: [], findings: null, agent: null, log: [] };
  assert.deepEqual(rounds(m).map((r: any) => [r.round, r.shots.map((x: any) => x.label)]), [[1, ['1280', '390']], [2, ['1280']], [3, ['1280', '390']]]);
  const ps = ctx.runLayouts['preview-stage'].render(m, h);
  assert.match(ps, /Round 3<\/div>\[critique-3-1280\.png\]\[critique-3-390\.png\]/);
  assert.doesNotMatch(ps, /critique-1-/);
  const ba = ctx.runLayouts['before-after'].render(m, h);
  assert.match(ba, /Round 1<\/div>\[critique-1-1280\.png\]\[critique-1-390\.png\][^]*Round 3, latest<\/div>\[critique-3-1280\.png\]/);
  assert.doesNotMatch(ba, /critique-2-/);
  const none = { ...m, detail: { outputs: {}, shots: [] } };
  assert.doesNotMatch(ctx.runLayouts['preview-stage'].render(none, h), /class="pics"/);
  assert.doesNotMatch(ctx.runLayouts['before-after'].render(none, h), /Pictures/);
});
