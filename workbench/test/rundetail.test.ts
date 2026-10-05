import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runDetail } from '../src/rundetail.ts';
import { paneFile } from '../../core/src/pipelines/panes.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rundetail-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  const project = join(dir, 'project');
  const runDir = join(project, '.troop', 'runs', 'run-1');
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project-1', project, 'Project', now, now);
  db.prepare('INSERT INTO pipeline (id, source, path, version, valid) VALUES (?, ?, ?, ?, ?)').run('pipeline-1', 'project', join(dir, 'pipeline.json'), 1, 1);
  db.prepare('INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run-1', 'pipeline-1', 'project-1', JSON.stringify({ fromRun: true }), runDir, 'done', 'manual', 0, 0, 0, now);
  const close = () => { db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, project, runDir, db, close };
}

function step(db: DatabaseSync, stepId: string, iteration: number, fanout: number, outputs: string) {
  db.prepare('INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status, outputs) VALUES (?, ?, ?, ?, ?, ?)').run('run-1', stepId, iteration, fanout, 'done', outputs);
}

test('runDetail returns an error for an unknown run id', () => {
  const f = fixture();
  try { assert.deepEqual(runDetail(f.db, 'missing'), { error: 'no run missing' }); } finally { f.close(); }
});

test('runDetail parses inputs from the run row', () => {
  const f = fixture();
  try { assert.deepEqual(runDetail(f.db, 'run-1').inputs, { fromRun: true }); } finally { f.close(); }
});

test('runDetail selects each step output from the highest iteration and lowest fanout index', () => {
  const f = fixture();
  try {
    step(f.db, 'step-a', 0, 0, '{"value":"old"}');
    step(f.db, 'step-a', 2, 1, '{"value":"later fanout"}');
    step(f.db, 'step-a', 2, 0, '{"value":"winner"}');
    step(f.db, 'step-b', 1, 0, '{"ok":true}');
    assert.deepEqual(runDetail(f.db, 'run-1').outputs, { 'step-a': { value: 'winner' }, 'step-b': { ok: true } });
  } finally { f.close(); }
});

test('runDetail reads spec.md from the run directory and returns null when absent', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.runDir, 'spec.md'), 'run spec');
    assert.equal(runDetail(f.db, 'run-1').docs.spec, 'run spec');
    rmSync(join(f.runDir, 'spec.md'));
    assert.equal(runDetail(f.db, 'run-1').docs.spec, null);
  } finally { f.close(); }
});

test('runDetail caps spec.md at 200 KiB', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.runDir, 'spec.md'), 'a'.repeat(200 * 1024 + 1));
    assert.equal(Buffer.byteLength(runDetail(f.db, 'run-1').docs.spec!), 200 * 1024);
  } finally { f.close(); }
});

test('runDetail does not read a spec.md symlink outside the run directory', (t) => {
  const f = fixture();
  const outside = join(f.dir, 'outside.md');
  try {
    writeFileSync(outside, 'outside spec');
    try { symlinkSync(outside, join(f.runDir, 'spec.md')); }
    catch (error) {
      if (process.platform === 'win32') { t.skip(`symlink creation unavailable: ${String(error)}`); return; }
      throw error;
    }
    assert.equal(runDetail(f.db, 'run-1').docs.spec, null);
  } finally { f.close(); }
});

test('runDetail extracts a pull request URL from step outputs', () => {
  const f = fixture();
  try {
    step(f.db, 'review', 0, 0, JSON.stringify({ url: 'https://github.com/o/r/pull/42' }));
    assert.deepEqual(runDetail(f.db, 'run-1').pr, { number: 42, url: 'https://github.com/o/r/pull/42' });
  } finally { f.close(); }
});

test('runDetail returns null PR when no step output has a pull request URL', () => {
  const f = fixture();
  try {
    step(f.db, 'review', 0, 0, JSON.stringify({ url: 'https://github.com/o/r/issues/42' }));
    assert.equal(runDetail(f.db, 'run-1').pr, null);
  } finally { f.close(); }
});

test('runDetail turns malformed step output JSON into an empty object', () => {
  const f = fixture();
  try {
    step(f.db, 'broken', 0, 0, '{bad json');
    assert.deepEqual(runDetail(f.db, 'run-1').outputs, { broken: {} });
  } finally { f.close(); }
});

test('paneFile rejects files reached through a directory junction outside the project', () => {
  const f = fixture();
  const outsideDir = join(f.dir, 'outside');
  try {
    mkdirSync(outsideDir);
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret');
    writeFileSync(join(f.runDir, 'inside.txt'), 'inside');
    symlinkSync(outsideDir, join(f.runDir, 'linked'), 'junction');
    assert.equal(paneFile({ runDir: f.runDir, projectDir: f.project }, 'linked/secret.txt'), null);
    assert.equal(paneFile({ runDir: f.runDir, projectDir: f.project }, 'inside.txt'), join(f.runDir, 'inside.txt'));
  } finally { f.close(); }
});
