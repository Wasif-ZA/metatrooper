import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { issueSecret, useSecretStore } from '../src/sessions/secret.ts';

const secretUrl = pathToFileURL(join(import.meta.dirname, '../src/sessions/secret.ts')).href;
const methodsUrl = pathToFileURL(join(import.meta.dirname, '../src/methods.ts')).href;
const schema = readFileSync(join(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function makeDb(approval: string | null = 'edits') {
  const dir = mkdtempSync(join(tmpdir(), 'm8-12-secret-'));
  const file = join(dir, 'troop.db');
  const db = new DatabaseSync(file);
  db.exec(schema);
  db.exec("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', 'C:/p1', 'p1', 't', 't')");
  db.exec("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('e1', '{}', 1)");
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, approval) VALUES ('S', 'p1', 'e1', 'pty', 'working', 't', 't', ?)").run(approval);
  return { db, file, dir };
}

// runs `body` in a fresh node process with the same db file; body sees db, secret, and the secret module; prints one JSON line
function child(file: string, secret: string, body: string): any {
  const code = `
    import { DatabaseSync } from 'node:sqlite';
    const m = await import(${JSON.stringify(secretUrl)});
    const db = new DatabaseSync(process.env.DBFILE);
    m.useSecretStore(db);
    const secret = process.env.SECRET;
    const out = await (async () => { ${body} })();
    console.log(JSON.stringify(out ?? null));
    db.close();`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DBFILE: file, SECRET: secret }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

const proveBody = "return { proof: m.proveSecret(secret), approval: m.approvalOf('S'), wrong: m.proveSecret('not-the-secret') };";

function issued(approval: string | null = 'edits') {
  const t = makeDb(approval);
  useSecretStore(t.db);
  const secret = issueSecret('S', 'edits');
  return { ...t, secret };
}

test('a restarted core proves the secret and gives back the approval', () => {
  const { file, secret } = issued();
  const r = child(file, secret, proveBody);
  assert.deepEqual(r.proof, { session: 'S', approval: 'edits' });
  assert.equal(r.approval, 'edits');
  assert.equal(r.wrong, null);
});

test('a row without an approval proves as ask', () => {
  const { file, secret } = issued(null);
  assert.deepEqual(child(file, secret, proveBody).proof, { session: 'S', approval: 'ask' });
});

test('the db holds the hash, never the secret', () => {
  const { db, file, dir, secret } = issued();
  const row = db.prepare("SELECT * FROM session WHERE id = 'S'").get() as Record<string, unknown>;
  assert.equal(row.secret_hash, createHash('sha256').update(secret).digest('hex'));
  for (const v of Object.values(row)) assert.ok(!String(v).includes(secret));
  db.close();
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir, f)).includes(secret), f);
  assert.ok(file);
});

for (const [name, sql] of [['exited state', "UPDATE session SET state = 'exited' WHERE id = 'S'"], ['ended_at set', "UPDATE session SET ended_at = 't' WHERE id = 'S'"]]) {
  test(`after ${name} nothing proves in a fresh process`, () => {
    const { db, file, secret } = issued();
    db.exec(sql);
    const r = child(file, secret, proveBody);
    assert.equal(r.proof, null);
    assert.equal(r.approval, null);
  });
}

test('dropSecret clears the hash and a fresh process cannot prove it', async () => {
  const { db, file, secret } = issued();
  const { dropSecret } = await import('../src/sessions/secret.ts');
  dropSecret('S');
  assert.equal((db.prepare("SELECT secret_hash h FROM session WHERE id = 'S'").get() as any).h, null);
  assert.equal(child(file, secret, proveBody).proof, null);
});

test('a row launched before the change (no hash) has no approval and engine.run refuses it', () => {
  const { db, file } = makeDb();
  db.close();
  const body = `
    const { buildMethods } = await import(${JSON.stringify(methodsUrl)});
    const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' });
    let code = null;
    try { await methods.get('engine.run').handler({ session_id: 'S', engine: 'x', action: 'y' }, { ui: false, session: 'S' }); } catch (e) { code = e.code; }
    return { approval: m.approvalOf('S'), code };`;
  const r = child(file, 'none', body);
  assert.equal(r.approval, null);
  assert.equal(r.code, -32012);
});
