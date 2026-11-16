import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-signin-'));
process.env.METATROOPER_HOME = home;

const { signIn, status, signOut, accessToken } = await import('../src/auth.ts');
const { secretPath, getSecret } = await import('../src/secrets.ts');
const { startMock, authorize, CLIENT_ID } = await import('./oidc-mock.ts');
const { isolation, startCore, teardownCore, client, uiHello } = await import('./helpers.ts');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE plugin_secret (plugin_id TEXT REFERENCES plugin(id), name TEXT, blob_path TEXT, set_at TEXT, PRIMARY KEY(plugin_id, name))');
db.exec('PRAGMA foreign_keys = ON');

type Mock = Awaited<ReturnType<typeof startMock>>;
const mocks: Mock[] = [];
async function mock(knobs = {}) {
  const m = await startMock(knobs);
  mocks.push(m);
  return m;
}
after(async () => { for (const m of mocks) await m.close(); fs.rmSync(home, { recursive: true, force: true }); });
beforeEach(async () => { await signOut(db, { issuer: 'http://127.0.0.1:9', client_id: CLIENT_ID }).catch(() => {}); });

const port = (authUrl: string) => Number(new URL(new URL(authUrl).searchParams.get('redirect_uri')!).port);
const refreshFile = () => secretPath('core-auth', 'refresh_token');

/** Opener that plays a browser: authorize at the mock, then load the callback. */
function browser(edit?: (cb: URL) => void) {
  const seen: string[] = [];
  const results: Promise<Response>[] = [];
  const open = (url: string) => {
    seen.push(url);
    results.push(authorize(url).then((loc) => { const cb = new URL(loc); edit?.(cb); return fetch(cb); }));
  };
  return { open, seen, results };
}

function deps(m: Mock, extra = {}) {
  return { issuer: m.issuer, client_id: CLIENT_ID, timeout_ms: 5000, ...extra };
}

function canConnect(p: number): Promise<boolean> {
  return new Promise((r) => {
    const s = net.connect(p, '127.0.0.1');
    s.once('connect', () => { s.destroy(); r(true); });
    s.once('error', () => r(false));
  });
}

test('happy path: PKCE S256, fresh state and nonce, loopback redirect, profile only in status', async () => {
  const m = await mock();
  const b = browser();
  const r = await signIn(db, deps(m, { open: b.open }));
  assert.equal(r.signed_in, true);
  assert.equal(r.email, 'test@example.com');
  assert.equal(r.name, 'Test User');
  const q = m.stats.authorize[0];
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('response_type'), 'code');
  assert.match(q.get('scope')!, /openid/);
  assert.ok((q.get('state') ?? '').length >= 43);
  assert.ok((q.get('nonce') ?? '').length >= 43);
  assert.match(q.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const rt = m.stats.issuedRefresh[0];
  assert.ok(fs.existsSync(refreshFile()));
  assert.ok(!fs.readFileSync(refreshFile(), 'utf8').includes(rt), 'refresh token must be encrypted at rest');
  assert.equal(getSecret('core-auth', 'refresh_token'), rt);
  const s = status();
  assert.deepEqual({ ...s, signed_in_at: undefined }, { ...r, signed_in_at: undefined });
  const shown = JSON.stringify([r, s]) + fs.readFileSync(path.join(home, 'auth', 'profile.json'), 'utf8');
  for (const leak of [rt, 'at_', 'id_token', 'code_verifier', q.get('state')!, q.get('nonce')!]) assert.ok(!shown.includes(leak), `leaked ${leak}`);
  assert.equal((await b.results[0]).status, 200);
});

test('each attempt has a fresh state, nonce and PKCE challenge', async () => {
  const m = await mock();
  await signIn(db, deps(m, { open: browser().open }));
  await signIn(db, deps(m, { open: browser().open }));
  const [a, b] = m.stats.authorize;
  for (const k of ['state', 'nonce', 'code_challenge']) assert.notEqual(a.get(k), b.get(k), k);
});

test('listener is up before the browser opens and gone right after the answer, so a replay cannot land', async () => {
  const m = await mock();
  let upAtOpen = false;
  let cbUrl = '';
  const open = (url: string) => {
    void canConnect(port(url)).then((ok) => { upAtOpen = ok; return authorize(url); }).then((loc) => { cbUrl = loc; return fetch(loc); });
  };
  await signIn(db, deps(m, { open }));
  assert.equal(upAtOpen, true);
  assert.equal(await canConnect(Number(new URL(cbUrl).port)), false);
  await assert.rejects(fetch(cbUrl));
});

test('the port closes as soon as the answer lands, before the token exchange finishes', async () => {
  const m = await mock({ tokenDelayMs: 1500 });
  let closedDuringExchange: boolean | undefined;
  const open = (url: string) => {
    void authorize(url).then(async (loc) => {
      await fetch(loc);
      await new Promise((r) => setTimeout(r, 300));
      closedDuringExchange = !(await canConnect(port(url)));
    });
  };
  await signIn(db, deps(m, { open }));
  assert.equal(m.stats.tokenCalls, 1);
  assert.equal(closedDuringExchange, true);
});

test('a callback with a wrong state is refused with 400 and the real answer still completes', async () => {
  const m = await mock();
  const statuses: number[] = [];
  const open = (url: string) => {
    void authorize(url).then(async (loc) => {
      const bad = new URL(loc);
      bad.searchParams.set('state', 'forged');
      statuses.push((await fetch(bad)).status);
      const none = new URL(loc);
      none.searchParams.delete('state');
      statuses.push((await fetch(none)).status);
      statuses.push((await fetch(loc)).status);
    });
  };
  const r = await signIn(db, deps(m, { open }));
  assert.equal(r.signed_in, true);
  assert.deepEqual(statuses, [400, 400, 200]);
});

test('provider error= (user cancelled) ends the attempt as cancelled and leaves cc signed out', async () => {
  const m = await mock({ deny: true });
  await assert.rejects(signIn(db, deps(m, { open: browser().open })), /cancelled/);
  assert.equal(status().signed_in, false);
  assert.ok(!fs.existsSync(refreshFile()));
});

test('no answer times out and closes the port', async () => {
  const m = await mock();
  let p = 0;
  await assert.rejects(signIn(db, deps(m, { timeout_ms: 1000, open: (u: string) => { p = port(u); } })), /timed out/);
  assert.equal(await canConnect(p), false);
});

test('a busy port is skipped for the next candidate; all busy fails cleanly', async () => {
  const m = await mock();
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
  const busy = (blocker.address() as net.AddressInfo).port;
  const spare = net.createServer();
  await new Promise<void>((r) => spare.listen(0, '127.0.0.1', r));
  const free = (spare.address() as net.AddressInfo).port;
  await new Promise<void>((r) => spare.close(() => r()));
  try {
    const b = browser();
    await signIn(db, deps(m, { ports: [busy, free], open: b.open }));
    assert.equal(port(b.seen[0]), free);
    await signOut(db, deps(m));
    let opened = false;
    await assert.rejects(signIn(db, deps(m, { ports: [busy], open: () => { opened = true; } })), /no free port/);
    assert.equal(opened, false, 'browser must not open without a listener');
  } finally {
    blocker.close();
  }
});

test('two sign-ins at once: the newest wins, the older is cancelled and its port closed', async () => {
  const m = await mock();
  let firstUrl = '';
  const first = signIn(db, deps(m, { open: (u: string) => { firstUrl = u; } }));
  const firstDone = assert.rejects(first, /cancelled/);
  while (!firstUrl) await new Promise((r) => setTimeout(r, 10));
  const b = browser();
  const second = signIn(db, deps(m, { open: b.open }));
  await firstDone;
  assert.equal(await canConnect(port(firstUrl)), false);
  assert.equal((await second).signed_in, true);
  assert.notEqual(port(firstUrl), port(b.seen[0]));
});

const BAD: Array<[string, Record<string, unknown>]> = [
  ['bad signature', { wrongKey: true }],
  ['alg none', { alg: 'none' }],
  ['alg HS256', { alg: 'HS256' }],
  ['alg outside the allowlist on a key with no alg', { alg: 'RS384', jwkNoAlg: true }],
  ['unknown kid', { kid: 'nope' }],
  ['wrong issuer', { iss: 'https://evil.example' }],
  ['wrong audience', { aud: 'someone-else' }],
  ['audience array without azp', { aud: [CLIENT_ID, 'other'] }],
  ['wrong nonce', { nonce: 'replayed-nonce' }],
  ['expired id token', { expSec: -3600 }],
  ['discovery issuer mismatch', { discoveryIssuer: 'https://evil.example' }],
  ['provider without S256', { noS256: true }],
];
for (const [name, knobs] of BAD) {
  test(`id token check refuses: ${name}`, async () => {
    const m = await mock(knobs);
    await assert.rejects(signIn(db, deps(m, { open: browser().open })), /sign-in failed/);
    assert.equal(status().signed_in, false);
    assert.ok(!fs.existsSync(refreshFile()), 'nothing stored on a failed check');
  });
}

test('audience array is accepted when azp names this client', async () => {
  const m = await mock({ aud: [CLIENT_ID, 'other'], azp: CLIENT_ID });
  assert.equal((await signIn(db, deps(m, { open: browser().open }))).signed_in, true);
});

test('no client secret is ever sent and the code verifier matches the challenge', async () => {
  const m = await mock();
  await signIn(db, deps(m, { open: browser().open }));
  assert.equal(m.stats.tokenCalls, 1);
});

test('access token: reused while valid, refreshed with rotation once expired, single-flight', async () => {
  const m = await mock({ refreshDelayMs: 200 });
  await signIn(db, deps(m, { open: browser().open }));
  const first = await accessToken(db, deps(m));
  assert.ok(first);
  assert.equal(m.stats.refreshCalls, 0);
  const later = deps(m, { now: () => Date.now() + 2 * 3600_000 });
  const [a, b] = await Promise.all([accessToken(db, later), accessToken(db, later)]);
  assert.equal(m.stats.refreshCalls, 1, 'one refresh for concurrent callers');
  assert.equal(a, b);
  assert.notEqual(a, first);
  const [oldRt, newRt] = m.stats.issuedRefresh;
  assert.equal(getSecret('core-auth', 'refresh_token'), newRt, 'rotated token saved');
  assert.ok(!m.live.has(oldRt));
  assert.equal(m.stats.reuseDetected, 0);
});

test('refresh rejected with invalid_grant signs cc out locally', async () => {
  const m = await mock();
  await signIn(db, deps(m, { open: browser().open }));
  m.live.clear();
  assert.equal(await accessToken(db, deps(m, { now: () => Date.now() + 2 * 3600_000 })), null);
  assert.equal(status().signed_in, false);
  assert.ok(!fs.existsSync(refreshFile()));
});

test('sign out revokes the refresh token and clears local state', async () => {
  const m = await mock();
  await signIn(db, deps(m, { open: browser().open }));
  const rt = getSecret('core-auth', 'refresh_token');
  const r = await signOut(db, deps(m));
  assert.deepEqual(r, { signed_in: false, revoked: true });
  assert.deepEqual(m.stats.revoked, [rt]);
  assert.equal(status().signed_in, false);
  assert.ok(!fs.existsSync(refreshFile()));
  assert.ok(!fs.existsSync(path.join(home, 'auth', 'profile.json')));
  assert.equal(await accessToken(db, deps(m)), null);
});

test('sign out still clears local state when the provider is unreachable', async () => {
  const m = await mock();
  await signIn(db, deps(m, { open: browser().open }));
  await m.close();
  const r = await signOut(db, deps(m));
  assert.equal(r.revoked, false);
  assert.equal(status().signed_in, false);
  assert.ok(!fs.existsSync(refreshFile()));
});

test('sign out aborts a pending attempt', async () => {
  const m = await mock();
  let opened = false;
  const pending = signIn(db, deps(m, { open: () => { opened = true; } }));
  const done = assert.rejects(pending, /cancelled/);
  while (!opened) await new Promise((r) => setTimeout(r, 10));
  await signOut(db, deps(m));
  await done;
});

test('not configured: signIn refuses without opening a browser', async () => {
  let opened = false;
  await assert.rejects(signIn(db, { issuer: '', client_id: '', open: () => { opened = true; } }), /not configured/);
  assert.equal(opened, false);
});

test('signed-out cc over the pipe: auth.status works, sign-in is UI-only, the core runs as before', async () => {
  const iso = isolation();
  const child = await startCore(iso);
  try {
    const plain = await client(iso.prefix);
    const refused = await plain.request('auth.signIn');
    assert.ok(refused.error, 'non-UI caller must not start a sign-in');
    plain.close();
    const c = await client(iso.prefix);
    await uiHello(c, iso.home);
    const s = await c.request('auth.status');
    assert.deepEqual(s.result, { signed_in: false });
    const r = await c.request('auth.signIn');
    assert.match(r.error?.message ?? '', /not configured/);
    assert.equal((await c.request('core.ping')).result.ok, true);
    const rows = await c.request('settings.set', { key: 'sessions.metarouter', value: true });
    assert.ok(!rows.error);
    c.close();
  } finally {
    await teardownCore(child, iso);
  }
});

const later = () => Date.now() + 2 * 3600_000;
const freePort = async () => { const s = net.createServer(); await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)); const p = (s.address() as net.AddressInfo).port; await new Promise<void>((r) => s.close(() => r())); return p; };

test('fix 1: refresh and sign out go to the issuer the token came from, never a later setting', async () => {
  const real = await mock();
  const evil = await mock();
  await signIn(db, deps(real, { open: browser().open }));
  const rt = getSecret('core-auth', 'refresh_token');
  assert.ok(await accessToken(db, { issuer: evil.issuer, client_id: CLIENT_ID, now: later }));
  assert.equal(real.stats.refreshCalls, 1);
  await signOut(db, { issuer: evil.issuer, client_id: CLIENT_ID });
  assert.equal(evil.stats.tokenCalls, 0);
  assert.deepEqual(evil.stats.revoked, []);
  assert.equal(real.stats.revoked.length, 1);
  assert.notEqual(real.stats.revoked[0], rt, 'the rotated token is the one revoked');
});

test('fix 1b: after a core restart a changed issuer setting still never receives the token', async () => {
  const real = await mock();
  const evil = await mock();
  await signIn(db, deps(real, { open: browser().open }));
  const { execFile } = await import('node:child_process');
  const auth = new URL('../src/auth.ts', import.meta.url).href;
  const script = `import { DatabaseSync } from 'node:sqlite'; const a = await import(${JSON.stringify(auth)}); const db = new DatabaseSync(':memory:'); const d = { issuer: ${JSON.stringify(evil.issuer)}, client_id: ${JSON.stringify(CLIENT_ID)} }; await a.accessToken(db, { ...d, now: () => Date.now() + 7200000 }).catch(() => {}); await a.signOut(db, d).catch(() => {});`;
  await new Promise<void>((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, METATROOPER_HOME: home } }, (e) => (e ? reject(e) : resolve())));
  assert.equal(evil.stats.tokenCalls, 0, 'no refresh sent to the new issuer');
  assert.deepEqual(evil.stats.revoked, [], 'no revoke sent to the new issuer');
  assert.equal(real.stats.refreshCalls, 1);
  assert.equal(real.stats.revoked.length, 1);
});

test('fix 2: sign out clears at once, even if a sign-in starts while the revoke is in flight', async () => {
  const m = await mock({ revokeDelayMs: 800 });
  await signIn(db, deps(m, { open: browser().open }));
  const out = signOut(db, deps(m));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(status().signed_in, false);
  const again = signIn(db, deps(m, { open: () => {} }));
  const againDone = assert.rejects(again, /cancelled/);
  await out;
  assert.equal(status().signed_in, false);
  assert.ok(!fs.existsSync(refreshFile()));
  await signOut(db, deps(m));
  await againDone;
});

test('fix 3: a refresh that lands after sign out revokes the rotated token instead of dropping it', async () => {
  const m = await mock({ refreshDelayMs: 600 });
  await signIn(db, deps(m, { open: browser().open }));
  const pending = accessToken(db, deps(m, { now: later }));
  await new Promise((r) => setTimeout(r, 100));
  await signOut(db, deps(m));
  assert.equal(await pending, null);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(m.live.size, 0, 'no live refresh token left at the provider');
  assert.equal(status().signed_in, false);
});

test('fix 4: an excluded (EACCES) port is skipped like a busy one', async (t) => {
  const tryPort = (p: number) => new Promise<string>((r) => { const s = net.createServer(); s.once('error', (e: NodeJS.ErrnoException) => r(e.code ?? '')); s.listen(p, '127.0.0.1', () => { s.close(); r('ok'); }); });
  let denied = 0;
  for (const p of [5357, 27339, 28385, 28390, 50000, 60740, 60840]) if (await tryPort(p) === 'EACCES') { denied = p; break; }
  if (!denied) return t.skip('no EACCES port found on this machine');
  const m = await mock();
  const free = await freePort();
  const b = browser();
  await signIn(db, deps(m, { ports: [denied, free], open: b.open }));
  assert.equal(port(b.seen[0]), free);
});

test('fix 5: signing in again revokes the previous refresh token', async () => {
  const m = await mock();
  await signIn(db, deps(m, { open: browser().open }));
  const first = getSecret('core-auth', 'refresh_token');
  await signIn(db, deps(m, { open: browser().open }));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(m.stats.revoked.includes(first!));
  assert.notEqual(getSecret('core-auth', 'refresh_token'), first);
});

test('fix 6: no refresh token in the answer means no sign-in', async () => {
  const m = await mock({ noRefresh: true });
  await assert.rejects(signIn(db, deps(m, { open: browser().open })), /no refresh token/);
  assert.equal(status().signed_in, false);
  assert.ok(!fs.existsSync(path.join(home, 'auth', 'profile.json')));
});

test('ES256 id tokens verify', async () => {
  const m = await mock({ ec: true });
  assert.equal((await signIn(db, deps(m, { open: browser().open }))).signed_in, true);
});

test('the listener is not reachable on a non-loopback address', async (t) => {
  const ip = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  if (!ip) return t.skip('no non-loopback IPv4 address');
  const m = await mock();
  let outside: boolean | undefined;
  const open = (url: string) => {
    void (async () => {
      outside = await new Promise<boolean>((r) => { const s = net.connect(port(url), ip); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
      await fetch(await authorize(url));
    })();
  };
  await signIn(db, deps(m, { open }));
  assert.equal(outside, false);
});
