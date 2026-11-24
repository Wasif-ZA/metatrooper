import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Approvals } from '../src/approvals.ts';
import { openCoreDb } from '../src/store/db.ts';
import { getSecret, scrubSecretValues, setBrowserSecret } from '../src/secrets.ts';
import { importLogins, listLogins, loginOrigin, parseLoginCsv, previewLogins, removeLogin, type LoginRow } from '../src/browser/login-import.ts';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'troop-logins-fix-'));
  const vars = { HOME: home, USERPROFILE: home, METATROOPER_HOME: join(home, 'mt'), METATROOPER_FAKE_DPAPI: '1' };
  const previous = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  const db = openCoreDb();
  const store = join(home, 'mt', 'secrets', 'core-browser');
  const close = () => {
    db.close();
    rmSync(home, { recursive: true, force: true });
    for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  return { db, home, store, close };
}

const row = (url: string, username: string, password: string): LoginRow => ({ url, username, password });

// protects=a CSV with a stray, trailing or unclosed quote is refused, not guessed at
// fails_when=a quote mid-cell or after a closing quote is kept as text, an unclosed quote at the end is accepted, or a clean quoted cell stops parsing
// no_claim=every malformed CSV shape
test('stray, trailing and unclosed quotes refuse the file; a clean quoted cell parses', () => {
  const head = 'url,username,password\n';
  assert.throws(() => parseLoginCsv(`${head}https://a.example,al"ice,secret-pass\n`), /stray quote/);
  assert.throws(() => parseLoginCsv(`${head}https://a.example,"alice"x,secret-pass\n`), /text after a closing quote/);
  assert.throws(() => parseLoginCsv(`${head}https://a.example,"alice,secret-pass\n`), /ends inside a quoted cell/);
  assert.throws(() => parseLoginCsv(`${head}https://a.example,alice,"secret-pass`), /ends inside a quoted cell/);
  assert.deepEqual(parseLoginCsv(`${head}https://a.example,"al,i""ce",secret-pass\n`), [{ url: 'https://a.example', username: 'al,i"ce', password: 'secret-pass' }]);
});

// protects=loopback http is never an importable login origin
// fails_when=loginOrigin or the preview accepts http on 127.0.0.1 or localhost
// no_claim=IPv6 loopback
test('http loopback logins are skipped and have no origin', () => {
  for (const u of ['http://127.0.0.1:8080', 'http://localhost', 'http://localhost:3000/x']) assert.equal(loginOrigin(u), null, u);
  const p = previewLogins([row('http://127.0.0.1:8080', 'alice', 'secret-pass-1'), row('http://localhost', 'alice', 'secret-pass-2')], new Map());
  for (const x of p) { assert.equal(x.skip, 'not an https site'); assert.equal(x.name, null); }
});

// protects=list and remove go by the record of imported names, not the login_ prefix
// fails_when=a hand-set login_x is listed or removable, or an imported name stays in the record after removal
// no_claim=who writes the record
test('a hand-set login_ secret is not listed or removable; an imported one is, and leaves the record', () => {
  const f = fixture();
  try {
    setBrowserSecret(f.db, 'login_x', 'https://x.example', 'hand-set-pass-1');
    importLogins(f.db, [row('https://a.example', 'alice', 'first-pass-1')], [{ i: 0 }]);
    assert.deepEqual(listLogins().map((l) => l.name), ['login_a_example']);
    assert.throws(() => removeLogin('login_x'), /not an imported login/);
    assert.ok(existsSync(join(f.store, 'login_x.dpapi')));
    assert.equal(getSecret('core-browser', 'login_x'), 'hand-set-pass-1');
    removeLogin('login_a_example');
    assert.deepEqual(listLogins(), []);
    assert.deepEqual(JSON.parse(readFileSync(join(f.store, 'imported-logins.json'), 'utf8')), []);
    assert.ok(existsSync(join(f.store, 'login_x.dpapi')));
  } finally { f.close(); }
});

// protects=a saved login is replaced only by a row for the same origin
// fails_when=another site whose host maps to the same name is marked as existing or takes the saved name
// no_claim=more than two colliding sites
test('previewing another origin with the same name gets the next name and does not exist', () => {
  const f = fixture();
  try {
    importLogins(f.db, [row('https://a.example.com', 'alice', 'first-pass-1')], [{ i: 0 }]);
    const [other] = previewLogins([row('https://a-example.com', 'alice', 'other-pass-2')]);
    assert.equal(other.name, 'login_a_example_com_2');
    assert.equal(other.exists, false);
    const [same] = previewLogins([row('https://a.example.com', 'alice', 'changed-pass-3')]);
    assert.equal(same.name, 'login_a_example_com');
    assert.equal(same.exists, true);
  } finally { f.close(); }
});

// protects=replacing a login with a row that has no username does not keep the old username
// fails_when=the loginuser_ secret or its origin file survives the replace
// no_claim=replace with a new username
test('a replace without a username removes the old username secret and its origin file', () => {
  const f = fixture();
  try {
    importLogins(f.db, [row('https://a.example', 'alice', 'first-pass-1')], [{ i: 0 }]);
    assert.equal(getSecret('core-browser', 'loginuser_a_example'), 'alice');
    const out = importLogins(f.db, [row('https://a.example', '', 'changed-pass-9')], [{ i: 0, replace: true }]);
    assert.equal(out.imported, 1);
    assert.equal(getSecret('core-browser', 'login_a_example'), 'changed-pass-9');
    assert.equal(getSecret('core-browser', 'loginuser_a_example'), null);
    assert.ok(!existsSync(join(f.store, 'loginuser_a_example.origin')));
    assert.ok(!existsSync(join(f.store, 'loginuser_a_example.dpapi')));
  } finally { f.close(); }
});

// protects=the log line is written, by ui, even when a save fails part way
// fails_when=the log write is skipped on a throw, or the logins saved before the failure are missing from it or from the list
// no_claim=the order of items beyond the first
test('the log line is written with by ui when a save fails part way', () => {
  const f = fixture();
  try {
    // a non-empty directory where the second login's temp origin file goes makes that save fail
    const blocker = join(f.store, `login_b_example.origin.${process.pid}.new`);
    mkdirSync(blocker, { recursive: true });
    writeFileSync(join(blocker, 'x'), '1');
    assert.throws(() => importLogins(f.db, [row('https://a.example', '', 'first-pass-1'), row('https://b.example', '', 'other-pass-2')], [{ i: 0 }, { i: 1 }]));
    const lines = readFileSync(join(f.home, 'mt', 'logs', 'logins.log'), 'utf8').trim().split('\n');
    const j = JSON.parse(lines[lines.length - 1]);
    assert.equal(j.by, 'ui');
    assert.equal(j.imported, 1);
    assert.deepEqual(j.origins, ['https://a.example']);
    assert.deepEqual(listLogins().map((l) => l.name), ['login_a_example']);
  } finally { f.close(); }
});

// protects=saving many logins costs one powershell encrypt and scrubbing many uncached names one decrypt
// fails_when=a save or a scrub spawns powershell once per secret
// no_claim=non-Windows (the fake store and keyring spawn no powershell); the spy counts powershell spawns through spawnSync
test('N logins save with one powershell call and N uncached names scrub with one', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  const spawns: string[] = [];
  const real = cp.spawnSync;
  mock.method(cp, 'spawnSync', (...a: Parameters<typeof cp.spawnSync>) => { spawns.push(String(a[0])); return real(...a); });
  syncBuiltinESMExports();
  const ps = () => spawns.filter((c) => c === 'powershell').length;
  try {
    const rows = [1, 2, 3, 4].map((n) => row(`https://s${n}.example`, `user-${n}-name`, `pass-${n}-value-x`));
    importLogins(f.db, rows, rows.map((_, i) => ({ i })));
    assert.equal(ps(), 1, 'one encrypt for 8 secrets');
    // copies of an encrypted blob under new names are not in the value cache
    const blob = join(f.store, 'login_s1_example.dpapi');
    for (let n = 0; n < 5; n++) copyFileSync(blob, join(f.store, `zz${n}.dpapi`));
    spawns.length = 0;
    scrubSecretValues();
    assert.equal(ps(), 1, 'one decrypt for the uncached names');
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    f.close();
  }
});

// protects=an imported login never gets an origin for localhost, *.localhost, a trailing-dot or single-label host, or an IP
// fails_when=loginOrigin accepts any of them, or previewLogins does not skip them; a normal https host stops working
// no_claim=punycode and IPv6 forms
test('loopback and single-label https hosts have no login origin and are skipped', () => {
  for (const u of ['https://localhost:3000', 'https://app.localhost', 'https://localhost.', 'https://LOCALHOST', 'https://intranet', 'https://127.0.0.1']) assert.equal(loginOrigin(u), null, u);
  assert.equal(loginOrigin('https://a.example.com'), 'https://a.example.com');
  const p = previewLogins([row('https://localhost:3000', 'alice', 'secret-pass-1'), row('https://app.localhost', 'alice', 'secret-pass-2'), row('https://intranet', 'alice', 'secret-pass-3')], new Map());
  for (const x of p) { assert.ok(x.skip, x.name ?? 'skipped'); assert.equal(x.name, null); }
});

// protects=a saved login for a loopback origin is never typed, even when the page really is at that origin
// fails_when=Approvals.check lets the login secret through to https://localhost:3000
// no_claim=logins saved from other names
test('a saved login for a loopback origin is refused for typing', async () => {
  const f = fixture();
  try {
    setBrowserSecret(f.db, 'login_old', 'https://localhost:3000', 'old-pass-1234');
    const at = new Date().toISOString();
    const proj = join(f.home, 'proj');
    mkdirSync(proj);
    f.db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', proj, 'p', at, at);
    f.db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
    f.db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p1', 'e1', 'pty', 'working', ?, ?)").run(at, at);
    const r = await new Approvals(f.db, 50).check({ session_id: 's1', surface: 'browser', target: 'https://localhost:3000', action: 'type', args: { ref: 'e1', text: '{{secret:login_old}}' }, control: { automation_id: 'p', name: 'Password', role: 'textbox' }, password: true });
    assert.equal(r.decision, 'deny');
    assert.match((r as { reason: string }).reason, /loopback/);
  } finally { f.close(); }
});
