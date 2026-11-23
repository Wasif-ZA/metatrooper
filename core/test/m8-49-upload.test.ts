import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Approvals, uploadProblem } from '../src/approvals.ts';
import { PRESETS } from '../src/browser/grants.ts';
import { TOOLS } from '../src/hook/browser-tools.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm849-'));
  const project = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(project);
  mkdirSync(join(project, 'dir'));
  mkdirSync(outside);
  const a = join(project, 'a.txt');
  const b = join(project, 'b.txt');
  const out = join(outside, 'secret.txt');
  writeFileSync(a, 'a'.repeat(3000));
  writeFileSync(b, 'b'.repeat(5000));
  writeFileSync(out, 'secret');
  return { root, project, outside, a, b, out };
}

test('upload paths must be files inside the project', () => {
  const f = fixture();
  try {
    assert.equal(uploadProblem([f.a, f.b], f.project), null);
    assert.match(uploadProblem([f.out], f.project) ?? '', /outside the project folder/);
    assert.match(uploadProblem([f.a, f.out], f.project) ?? '', /outside the project folder/);
    assert.match(uploadProblem(['a.txt'], f.project) ?? '', /not an absolute path/);
    assert.match(uploadProblem([join(f.project, 'dir')], f.project) ?? '', /not a file/);
    assert.match(uploadProblem([join(f.project, 'missing.txt')], f.project) ?? '', /does not exist/);
    assert.match(uploadProblem(Array.from({ length: 11 }, () => f.a), f.project) ?? '', /1 to 10/);
    assert.match(uploadProblem([], f.project) ?? '', /1 to 10/);
    assert.match(uploadProblem([f.a], join(f.root, 'nope')) ?? '', /project folder is missing/);
    try {
      symlinkSync(f.outside, join(f.project, 'link'), 'junction');
      assert.match(uploadProblem([join(f.project, 'link', 'secret.txt')], f.project) ?? '', /outside the project folder/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('an upload always asks, names each file and its size, and is denied for paths outside the project', async () => {
  const f = fixture();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, ended_at TEXT, project_id TEXT);
      CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, surface TEXT, target TEXT, control TEXT, action TEXT, action_hash TEXT, summary TEXT, reason TEXT, status TEXT, scope TEXT, created_at TEXT, decided_at TEXT);
      CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT, kind TEXT, ref TEXT, text TEXT, resolved_at TEXT);
    `);
    db.prepare('INSERT INTO project (id, path) VALUES (?, ?)').run('p1', f.project);
    db.prepare('INSERT INTO session (id, project_id) VALUES (?, ?)').run('s1', 'p1');
    const approvals = new Approvals(db);
    const up = (paths: string[]) => ({ session_id: 's1', surface: 'browser', target: 'http://127.0.0.1:8080', action: 'upload', args: { ref: 'e1', paths }, control: { automation_id: '', name: 'Choose file', role: 'button' } });
    const waiting = () => db.prepare("SELECT id, summary, reason FROM approval WHERE status = 'waiting'").all() as Array<{ id: string; summary: string; reason: string }>;
    const settle = async () => { for (let i = 0; i < 100 && !waiting().length; i++) await new Promise((r) => setTimeout(r, 10)); return waiting()[0]; };

    const first = approvals.check(up([f.a, f.b]));
    const row = await settle();
    assert.equal(row.reason, 'file upload');
    assert.match(row.summary, /a\.txt \(3 KB\)/);
    assert.match(row.summary, /b\.txt \(5 KB\)/);
    approvals.resolve({ approval_id: row.id, decision: 'approve', scope: 'session' });
    assert.equal((await first).decision, 'approved');

    const second = approvals.check(up([f.a, f.b]));
    const again = await settle();
    assert.ok(again && again.id !== row.id, 'a session approval must not cover the next upload');
    approvals.resolve({ approval_id: again.id, decision: 'reject' });
    assert.equal((await second).decision, 'rejected');

    const before = (db.prepare('SELECT COUNT(*) AS n FROM approval').get() as { n: number }).n;
    const denied = await approvals.check(up([f.out]));
    assert.equal(denied.decision, 'deny');
    assert.match((denied as { reason: string }).reason, /outside the project folder/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM approval').get() as { n: number }).n, before);
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

function upDb(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, ended_at TEXT, project_id TEXT);
    CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, surface TEXT, target TEXT, control TEXT, action TEXT, action_hash TEXT, summary TEXT, reason TEXT, status TEXT, scope TEXT, created_at TEXT, decided_at TEXT);
    CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT, kind TEXT, ref TEXT, text TEXT, resolved_at TEXT);
  `);
  db.prepare('INSERT INTO project (id, path) VALUES (?, ?)').run('p1', f.project);
  db.prepare('INSERT INTO session (id, project_id) VALUES (?, ?)').run('s1', 'p1');
  const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM approval').get() as { n: number }).n;
  const up = (paths: string[], control: unknown = { automation_id: '', name: 'Choose file', role: 'button' }, hidden?: boolean) =>
    ({ session_id: 's1', surface: 'browser', target: 'http://127.0.0.1:8080', action: 'upload', args: { ref: 'e1', paths }, control, ...(hidden ? { hidden } : {}) }) as any;
  return { db, approvals: new Approvals(db), rows, up };
}

test('the card names the host first, the control, and every file by project path, none cut off', async () => {
  const f = fixture();
  const { db, approvals, up } = upDb(f);
  try {
    const names = Array.from({ length: 9 }, (_, i) => `quarterly-report-final-version-${i + 1}-reviewed.env`);
    const paths = names.map((n) => { const p = join(f.project, n); writeFileSync(p, 'x'); return p; });
    mkdirSync(join(f.project, 'secrets'));
    const sub = join(f.project, 'secrets', 'prod.env');
    writeFileSync(sub, 'x');
    paths.push(sub);
    const first = approvals.check(up(paths));
    let row: { id: string; summary: string } | undefined;
    for (let i = 0; i < 100 && !row; i++) { row = db.prepare("SELECT id, summary FROM approval WHERE status = 'waiting'").get() as typeof row; if (!row) await new Promise((r) => setTimeout(r, 10)); }
    assert.ok(row);
    const s = row.summary;
    assert.ok(s.startsWith("upload to 127.0.0.1:8080 with 'Choose file': "), s);
    assert.ok(s.includes('secrets/prod.env'), s);
    for (const n of names) assert.ok(s.includes(n) || (s.includes(n.slice(0, 20)) && s.includes('â€¦') && s.includes(n.slice(-20))), `${n} is not in: ${s}`);
    approvals.resolve({ approval_id: row.id, decision: 'reject' });
    await first;
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('an upload with a risky, hidden or missing control is denied and writes no approval', async () => {
  const f = fixture();
  const { db, approvals, rows, up } = upDb(f);
  try {
    const cases: Array<[unknown, boolean, RegExp]> = [
      [{ automation_id: '', name: 'Pay now', role: 'button' }, false, /risky control/],
      [{ automation_id: '', name: 'Choose file', role: 'button' }, true, /hidden/],
      [null, false, /needs a control/],
    ];
    for (const [control, hidden, want] of cases) {
      const r = await approvals.check(up([f.a], control, hidden));
      assert.equal(r.decision, 'deny');
      assert.match((r as { reason: string }).reason, want);
    }
    assert.equal(rows(), 0);
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a hard link inside the project to a file outside is refused', (t) => {
  const f = fixture();
  try {
    const link = join(f.project, 'innocent.txt');
    try { linkSync(f.out, link); } catch { t.skip('hard links are not available here'); return; }
    assert.match(uploadProblem([link], f.project) ?? '', /is a hard link/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the project folder itself is not a file', () => {
  const f = fixture();
  try {
    assert.match(uploadProblem([f.project], f.project) ?? '', /is the project folder/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('upload is in the act preset and is a checked tool', () => {
  assert.ok(PRESETS.act.includes('upload'));
  assert.ok(PRESETS.debug.includes('upload'));
  assert.ok(!PRESETS.look.includes('upload'));
  const tool = TOOLS.find((t) => t.name === 'upload');
  assert.ok(tool);
  assert.deepEqual((tool.inputSchema as { required: string[] }).required, ['ref', 'paths']);
});

test('the workbench re-checks upload paths before sending', () => {
  const src = readFileSync(new URL('../../workbench/src/browser/server.ts', import.meta.url), 'utf8');
  const start = src.indexOf("if (tool === 'upload') {");
  assert.ok(start >= 0);
  const block = src.slice(start, src.indexOf('spendUpload(ap)', start) + 'spendUpload(ap)'.length);
  const row = block.indexOf('-32030');
  const check = block.indexOf('uploadProblem(params.paths');
  assert.ok(row >= 0 && check > row && block.endsWith('spendUpload(ap)'), 'uploadProblem after the approval row check, before spendUpload');
  const shim = readFileSync(new URL('../src/hook/mcp-shim.ts', import.meta.url), 'utf8');
  assert.match(shim, /engine\.run[^\n]*waitMs: 2_147_483_647/);
});
