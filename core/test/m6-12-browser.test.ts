import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { isolation } from './helpers.ts';
import { scrub, scrubDeep } from '../src/redact.ts';

const iso = isolation();
const prior = { ...process.env };
let db: DatabaseSync;
let approvals: import('../src/approvals.ts').Approvals;
let ap: typeof import('../src/approvals.ts');
const project = join(iso.home, 'project');

before(async () => {
  process.env.METATROOPER_HOME = iso.home;
  process.env.METATROOPER_PIPE_PREFIX = iso.prefix;
  const { openCoreDb } = await import('../src/store/db.ts');
  ap = await import('../src/approvals.ts');
  db = openCoreDb();
  mkdirSync(project, { recursive: true });
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', project, 'p', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
  for (const id of ['s1', 's2']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'e1', 'pty', 'working', ?, ?)").run(id, at, at);
  approvals = new ap.Approvals(db, 60_000);
});

after(() => {
  db?.close();
  rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
  Object.assign(process.env, prior);
});

const control = { automation_id: 'go', name: 'Go', role: 'button' };
const check = (over: Record<string, unknown>) => ({ session_id: 's1', surface: 'browser', target: 'https://a.test', action: 'click', args: { ref: 'e1' }, control, ...over });

/** Starts a check, waits for its row, decides it and returns the decision and the row's reason. */
async function decide(params: Record<string, unknown>, decision: 'approve' | 'reject', scope: 'once' | 'session' = 'once'): Promise<{ decision: string; reason: string }> {
  const pending = approvals.check(params);
  let row: { id: string; reason: string } | undefined;
  for (let i = 0; i < 100 && !row; i++) {
    row = db.prepare("SELECT id, reason FROM approval WHERE status = 'waiting' ORDER BY created_at DESC LIMIT 1").get() as typeof row;
    if (!row) await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(row, 'an approval row is waiting');
  approvals.resolve({ approval_id: row.id, decision, scope });
  return { decision: (await pending).decision, reason: row.reason };
}

test('M6-12 scrub removes bearer tokens, cookies, URL credentials, token query values and known secret values, and leaves plain text', () => {
  assert.equal(scrub('Authorization: Bearer abcdefghij123'), 'Authorization: Bearer [secret]');
  assert.equal(scrub('cookie: sid=abc; theme=dark'), 'cookie: [secret]');
  assert.equal(scrub('Set-Cookie: a=1'), 'Set-Cookie: [secret]');
  assert.equal(scrub('GET https://bob:hunter2@example.com/x'), 'GET https://[secret]@example.com/x');
  assert.equal(scrub('https://x.test/cb?code=4/0Abc&state=ok&access_token=zzz'), 'https://x.test/cb?code=[secret]&state=ok&access_token=[secret]');
  assert.equal(scrub('pw is CorrectHorse!', ['CorrectHorse!']), 'pw is [secret]');
  assert.equal(scrub('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), '[secret]');
  assert.equal(scrub('Sign in to continue. Page 2 of 3, ?page=2'), 'Sign in to continue. Page 2 of 3, ?page=2');
  assert.deepEqual(scrubDeep({ text: 'v=CorrectHorse!', n: 3, data_base64: 'CorrectHorse!' }, ['CorrectHorse!'], new Set(['data_base64'])), { text: 'v=[secret]', n: 3, data_base64: 'CorrectHorse!' });
});

test('M6-12 the first input on a new origin asks; Approve for this session covers that origin, once does not, another origin asks again', async () => {
  const first = await decide(check({}), 'approve', 'once');
  assert.deepEqual(first, { decision: 'approved', reason: 'new origin' });
  const again = await decide(check({ action: 'type', args: { ref: 'e2', text: 'hello' }, control: { automation_id: 'q', name: 'Search', role: 'textbox' } }), 'approve', 'session');
  assert.deepEqual(again, { decision: 'approved', reason: 'new origin' });
  assert.equal((db.prepare("SELECT scope FROM approval WHERE reason = 'new origin' ORDER BY created_at DESC LIMIT 1").get() as { scope: string }).scope, 'session');
  // any input on the approved origin, any control, now goes through without a row
  const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM approval').get() as { n: number }).n;
  const before = rows();
  assert.deepEqual(await approvals.check(check({ action: 'key', args: { keys: 'Tab' }, control: null })), { decision: 'allow' });
  assert.deepEqual(await approvals.check(check({ args: { ref: 'e9' }, control: { automation_id: 'x', name: 'Other', role: 'link' } })), { decision: 'allow' });
  assert.equal(rows(), before);
  // risky rules still ask on an approved origin
  assert.equal((await decide(check({ control: { automation_id: 'send', name: 'Send', role: 'button' } }), 'reject')).reason, 'risky control: Send');
  // another origin, and the same origin in another session, ask again
  assert.equal((await decide(check({ target: 'https://b.test' }), 'reject')).reason, 'new origin');
  assert.equal((await decide(check({ session_id: 's2' }), 'reject')).reason, 'new origin');
  // non-web targets never ask for their origin
  assert.deepEqual(await approvals.check(check({ target: 'about:blank' })), { decision: 'allow' });
});

test('M6-12 an origin listed in .troop/config.json allow_origins never asks for being new', async () => {
  mkdirSync(join(project, '.troop'), { recursive: true });
  writeFileSync(join(project, '.troop', 'config.json'), JSON.stringify({ allow_origins: ['https://c.test/'] }));
  try {
    assert.deepEqual(await approvals.check(check({ target: 'https://c.test' })), { decision: 'allow' });
    assert.equal((await decide(check({ target: 'https://c.test:8443' }), 'reject')).reason, 'new origin');
  } finally {
    rmSync(join(project, '.troop'), { recursive: true, force: true });
  }
});

test('M6-12 {{secret:NAME}} is denied off its saved origin, into a plain field, for an unknown name or inside other text; into a password field on its origin it asks as a password field', async () => {
  const { originFile } = await import('../src/browser/secret-origin.ts');
  mkdirSync(join(iso.home, 'secrets', 'core-browser'), { recursive: true });
  writeFileSync(originFile('BANK_PW'), 'https://bank.test');
  const pw = { action: 'type', target: 'https://bank.test', args: { ref: 'e3', text: '{{secret:BANK_PW}}' }, control: { automation_id: 'pw', name: 'Password', role: 'textbox' }, password: true };
  assert.deepEqual(await approvals.check(check({ ...pw, target: 'https://evil.test' })), { decision: 'deny', reason: 'secret BANK_PW is saved for another origin' });
  assert.deepEqual(await approvals.check(check({ ...pw, password: false, control: { automation_id: 'user', name: 'User', role: 'textbox' } })), { decision: 'deny', reason: 'secret BANK_PW goes only into a password field' });
  assert.deepEqual(await approvals.check(check({ ...pw, args: { ref: 'e3', text: '{{secret:NOPE}}' } })), { decision: 'deny', reason: 'there is no browser secret named NOPE' });
  assert.deepEqual(await approvals.check(check({ ...pw, args: { ref: 'e3', text: 'x {{secret:BANK_PW}}' } })), { decision: 'deny', reason: 'a {{secret:NAME}} placeholder must be the whole text' });
  const asked = await decide(check(pw), 'approve', 'session');
  assert.deepEqual(asked, { decision: 'approved', reason: 'password field' });
  // the action hash an MCP server sends for the placeholder is accepted
  const p = check(pw) as Parameters<typeof ap.actionHash>[0] & Record<string, unknown>;
  assert.equal(ap.actionHash(p), ap.actionHash({ ...p }));
});

test('M6-12 browser.secret.set keeps the value out of every table and file, saves the origin beside it, and the audit prune keeps 30 days', async () => {
  const { buildMethods } = await import('../src/methods.ts');
  const { getSecret, knownSecretValues } = await import('../src/secrets.ts');
  const { browserSecretOrigin } = await import('../src/browser/secret-origin.ts');
  const { pruneBrowserAudit } = await import('../src/events/append.ts');
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' });
  const marker = `PRIVATE_${randomUUID().replaceAll('-', '')}`;
  await methods.get('browser.secret.set')!.handler({ name: 'MARKED', origin: 'https://login.test/path?q=1', value: marker });
  assert.equal(browserSecretOrigin('MARKED'), 'https://login.test');
  assert.equal(getSecret('core-browser', 'MARKED'), marker);
  assert.ok(knownSecretValues().includes(marker));
  assert.throws(() => methods.get('browser.secret.set')!.handler({ name: 'BAD', origin: 'file:///c:/x', value: 'v' }), /origin must be an http or https URL/);
  assert.equal(ap.summaryOf(check({ action: 'type', control: { automation_id: '', name: marker, role: 'textbox' } }) as never, knownSecretValues()), 'type into [secret] in a.test');

  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const add = db.prepare('INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, ?, ?, ?, ?, 1)');
  add.run(at(31), 'core', 's1', 'browser.tool', '{"tool":"click"}');
  add.run(at(29), 'core', 's1', 'browser.tool', '{"tool":"type"}');
  add.run(at(40), 'core', 's1', 'core.activity', '{}');
  assert.equal(pruneBrowserAudit(db), 1);
  assert.deepEqual(db.prepare("SELECT kind, payload FROM event WHERE at < ? ORDER BY seq").all(at(1)).map((r) => ({ ...r })), [{ kind: 'browser.tool', payload: '{"tool":"type"}' }, { kind: 'core.activity', payload: '{}' }]);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  const hits = tables.filter(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()).includes(marker)).map(({ name }) => name);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const files = readdirSync(iso.home, { recursive: true }).map((f) => join(iso.home, String(f))).filter((f) => statSync(f).isFile());
  hits.push(...files.filter((f) => readFileSync(f).includes(marker)));
  assert.deepEqual(hits, []);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM plugin_secret WHERE plugin_id = 'core-browser'").get() as { n: number }).n, 0);
});

test('M6-12 a browser secret decrypted only in another process is scrubbed from the approval row control, reason, summary and Needs you text', async () => {
  const { buildMethods } = await import('../src/methods.ts');
  // lower case and digits only, so only the known-secret-value redaction can catch it
  const marker = `lowmark${randomUUID().replaceAll('-', '')}`;
  const src = (f: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'src', f)).href);
  const saved = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { openCoreDb } = await import(${src('store/db.ts')});
    const { setBrowserSecret } = await import(${src('secrets.ts')});
    const db = openCoreDb();
    setBrowserSecret(db, 'OTHER_PW', 'https://other.test', process.env.M612_LOW);
    db.close();
  `], { encoding: 'utf8', env: { ...process.env, M612_LOW: marker } });
  assert.equal(saved.status, 0, saved.stderr);
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' });
  const pending = methods.get('approval.check')!.handler(check({ target: 'https://d.test', control: { automation_id: `id-${marker}`, name: `Send ${marker}`, role: 'button' } })) as Promise<{ decision: string }>;
  let row: Record<string, unknown> | undefined;
  for (let i = 0; i < 300 && !row; i++) {
    row = db.prepare("SELECT * FROM approval WHERE status = 'waiting' AND target = 'https://d.test'").get() as typeof row;
    if (!row) await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(row, 'an approval row is waiting');
  methods.get('approval.resolve')!.handler({ approval_id: row.id, decision: 'reject' });
  assert.equal((await pending).decision, 'rejected');
  assert.deepEqual({ control: row.control, reason: row.reason, summary: row.summary }, {
    control: '{"automation_id":"id-[secret]","name":"Send [secret]","role":"button"}', reason: 'risky control: Send [secret]', summary: 'click Send [secret] in d.test',
  });
  const needs = db.prepare("SELECT text FROM needs_you WHERE kind = 'approval' AND ref = ?").get(row.id) as { text: string };
  assert.ok(!needs.text.includes(marker));
});
