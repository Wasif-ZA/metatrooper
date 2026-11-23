import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { getSecret } from '../src/secrets.ts';
import { importLogins, listLogins, loginOrigin, parseLoginCsv, previewLogins, removeLogin, type LoginRow } from '../src/browser/login-import.ts';
import { METHODS } from '../src/methods.ts';
import { NOT_QUEUED, isQueueable } from '../src/pipe/commands.ts';
import { Approvals } from '../src/approvals.ts';
import { isUsernameSecret } from '../src/browser/secret-origin.ts';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'troop-logins-'));
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

// protects=parseLoginCsv accepts Chrome, Edge and Firefox exports and refuses anything else
// fails_when=quoted fields are split wrongly, a file without a password column parses, or a file over 5 MB is read
// no_claim=encodings other than UTF-8
test('a Chrome, Edge or Firefox password export parses, and other files are refused', () => {
  const chrome = 'name,url,username,password,note\r\n"a, b",https://a.example/login,"al""ice",pw-one-1234,"line1\nline2"\r\n';
  assert.deepEqual(parseLoginCsv(chrome), [{ url: 'https://a.example/login', username: 'al"ice', password: 'pw-one-1234' }]);
  const ff = 'url,username,password,httpRealm,formActionOrigin,guid\nhttps://b.example,bob,"p,w;two",,,{x}\n';
  assert.deepEqual(parseLoginCsv(ff), [{ url: 'https://b.example', username: 'bob', password: 'p,w;two' }]);
  assert.throws(() => parseLoginCsv('name,url,username\nx,https://a.example,bob\n'), /not a password export/);
  assert.throws(() => parseLoginCsv('url,username,password\n' + 'x'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});

// protects=only https and loopback http logins are importable and each skip carries a reason
// fails_when=loginOrigin accepts http on a public host, ftp or an IP, or a short password is kept, or the preview carries a password
// no_claim=IPv6 loopback
test('only https and loopback http logins are kept and every skip says why', () => {
  const f = fixture();
  try {
    const rows = [
      row('http://example.com', 'alice', 'secret-pass-1'),
      row('ftp://files.example.com', 'alice', 'secret-pass-2'),
      row('https://1.2.3.4', 'alice', 'secret-pass-3'),
      row('https://c.example', 'alice', 'abc'),
      row('https://a.example', 'alice', 'secret-pass-4'),
      row('http://localhost:3000', 'alice', 'secret-pass-5'),
    ];
    assert.equal(loginOrigin('http://example.com'), null);
    const p = previewLogins(rows);
    assert.deepEqual(p.map((x) => x.skip !== null), [true, true, true, true, false, false]);
    for (const x of p.slice(0, 4)) assert.ok(x.skip && x.skip.length > 5);
    assert.match(p[3].skip!, /shorter/);
    assert.equal(p[4].origin, 'https://a.example');
    assert.equal(p[5].origin, 'http://localhost:3000');
    const json = JSON.stringify(p);
    for (const r of rows) assert.ok(!json.includes(r.password), r.password);
  } finally { f.close(); }
});

// protects=imports save origin-bound secrets and never overwrite a saved login unless replace is ticked
// fails_when=import replaces a saved login without replace, drops the origin file, or merges two accounts on one host
// no_claim=DPAPI itself (the fake store is used off Windows)
test('ticked logins save origin-bound secrets and a saved one is kept unless replace is ticked', () => {
  const f = fixture();
  try {
    const rows = [row('https://a.example/x', 'alice', 'first-pass-1'), row('https://a.example/y', 'bobby', 'other-pass-2')];
    const out = importLogins(f.db, rows, [{ i: 0 }, { i: 1 }]);
    assert.equal(out.imported, 2);
    assert.equal(getSecret('core-browser', 'login_a_example'), 'first-pass-1');
    assert.equal(getSecret('core-browser', 'loginuser_a_example'), 'alice');
    assert.equal(getSecret('core-browser', 'login_a_example_2'), 'other-pass-2');
    assert.equal(readFileSync(join(f.store, 'login_a_example.origin'), 'utf8').trim(), 'https://a.example');
    assert.deepEqual(listLogins().map((l) => l.name), ['login_a_example', 'login_a_example_2']);

    const changed = [row('https://a.example/x', 'alice', 'changed-pass-9')];
    const keep = importLogins(f.db, changed, [{ i: 0 }]);
    assert.equal(keep.imported, 0);
    assert.ok(keep.skipped.some((s) => /kept the saved login/.test(s.why)));
    assert.equal(getSecret('core-browser', 'login_a_example'), 'first-pass-1');

    const again = importLogins(f.db, changed, [{ i: 0, replace: true }]);
    assert.equal(again.imported, 1);
    assert.equal(getSecret('core-browser', 'login_a_example'), 'changed-pass-9');
  } finally { f.close(); }
});

// protects=the 500 browser secret cap holds across imports
// fails_when=an import writes past 500 browser secrets
// no_claim=the cap on secrets saved by other means
test('imports stop at 500 browser secrets', () => {
  const f = fixture();
  try {
    mkdirSync(f.store, { recursive: true });
    for (let i = 0; i < 499; i++) writeFileSync(join(f.store, `pre${i}.dpapi`), '');
    const out = importLogins(f.db, [row('https://a.example', 'alice', 'first-pass-1'), row('https://b.example', 'bobby', 'other-pass-2')], [{ i: 0 }, { i: 1 }]);
    assert.equal(out.imported, 0);
    assert.equal(out.skipped.length, 2);
    assert.ok(out.skipped.every((s) => /at most 500/.test(s.why)));
    assert.ok(!existsSync(join(f.store, 'login_a_example.dpapi')));
  } finally { f.close(); }
});

// protects=logs/logins.log holds the count and origins, never a credential
// fails_when=the log line carries a username or a password
// no_claim=log rotation
test('the import is logged with count and origins only', () => {
  const f = fixture();
  try {
    importLogins(f.db, [row('https://a.example', 'alice-the-user', 'first-pass-1')], [{ i: 0 }]);
    const lines = readFileSync(join(f.home, 'mt', 'logs', 'logins.log'), 'utf8').trim().split('\n');
    const last = lines[lines.length - 1];
    const j = JSON.parse(last);
    assert.equal(j.imported, 1);
    assert.deepEqual(j.origins, ['https://a.example']);
    assert.ok(!last.includes('alice-the-user') && !last.includes('first-pass-1'));
  } finally { f.close(); }
});

// protects=removeLogin only touches imported logins
// fails_when=a name outside login_, a _user name or a path is accepted, or the origin file stays behind
// no_claim=removal of secrets saved by other means
test('removeLogin removes both secrets and refuses other names', () => {
  const f = fixture();
  try {
    importLogins(f.db, [row('https://a.example', 'alice', 'first-pass-1')], [{ i: 0 }]);
    for (const bad of ['other_secret', 'loginuser_a_example', '../x', 'login_../x', 'login_a/b']) assert.throws(() => removeLogin(bad), /not an imported login/, bad);
    removeLogin('login_a_example');
    assert.equal(getSecret('core-browser', 'login_a_example'), null);
    assert.equal(getSecret('core-browser', 'loginuser_a_example'), null);
    assert.ok(!existsSync(join(f.store, 'login_a_example.origin')));
    assert.deepEqual(listLogins(), []);
  } finally { f.close(); }
});

// protects=the login methods need the window and the two that carry CSV text are never queued
// fails_when=a login method loses needsUi or preview/import drop out of NOT_QUEUED
// no_claim=the pipe transport
test('the login methods need a UI connection and are never queued', () => {
  for (const n of ['preview', 'import', 'list', 'remove']) {
    const m = METHODS.find((x) => x.name === `browser.logins.${n}`);
    assert.ok(m, n);
    assert.equal(m.needsUi, true, n);
  }
  assert.ok(NOT_QUEUED.has('browser.logins.preview'));
  assert.ok(NOT_QUEUED.has('browser.logins.import'));
  assert.equal(isQueueable('browser.logins.import'), false);
});

// protects=an imported username goes only to its own origin, and a password never goes outside a password field
// fails_when=the password check also lets loginuser_ names through for passwords, or the username check is dropped, or origins are not compared
// no_claim=the typing itself
test('an imported username may be typed only into its own origin and a password never outside a password field', async () => {
  const f = fixture();
  try {
    importLogins(f.db, [row('https://a.example/x', 'alice', 'first-pass-1')], [{ i: 0 }]);
    const at = new Date().toISOString();
    const proj = join(f.home, 'proj');
    mkdirSync(proj);
    f.db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', proj, 'p', at, at);
    f.db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
    f.db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p1', 'e1', 'pty', 'working', ?, ?)").run(at, at);
    const approvals = new Approvals(f.db, 50);
    const type = (name: string, target: string, password: boolean) =>
      approvals.check({ session_id: 's1', surface: 'browser', target, action: 'type', args: { ref: 'e1', text: `{{secret:${name}}}` }, control: { automation_id: 'u', name: 'User', role: 'textbox' }, password });
    const user = await type('loginuser_a_example', 'https://a.example', false);
    assert.ok(user.decision !== 'deny' || !/goes only into a password field/.test(user.reason), 'username into a plain field');
    const pw = await type('login_a_example', 'https://a.example', false);
    assert.deepEqual(pw, { decision: 'deny', reason: 'secret login_a_example goes only into a password field' });
    const other = await type('loginuser_a_example', 'https://b.example', false);
    assert.deepEqual(other, { decision: 'deny', reason: 'secret loginuser_a_example is saved for another origin' });
    assert.equal(isUsernameSecret('login_foo_user'), false);
    assert.equal(isUsernameSecret('loginuser_foo'), true);
  } finally { f.close(); }
});
