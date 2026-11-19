import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from './paths.ts';
import { settings } from './settings.ts';
import { deleteSecret, getSecret, setSecret } from './secrets.ts';
import { E, RpcError } from './pipe/errors.ts';

export interface AuthDeps {
  open?: (url: string) => void;
  now?: () => number;
  ports?: number[];
  issuer?: string;
  client_id?: string;
  timeout_ms?: number;
}

export interface AuthStatus {
  signed_in: boolean;
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  signed_in_at?: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

interface Config {
  issuer: string;
  client_id: string;
}

let pending: AbortController | null = null;
let generation = 0;
let memory: { home: string; token: string; expires: number; config: Config; discovery: Discovery } | null = null;
let refreshing: { generation: number; home: string; promise: Promise<string | null> } | null = null;

function failed(check: string): RpcError {
  return new RpcError(E.VALIDATION, `sign-in failed: ${check}`);
}

function config(deps: AuthDeps): Config {
  const s = settings().auth;
  const issuer = deps.issuer ?? s.issuer;
  const client_id = deps.client_id ?? s.client_id;
  if (!issuer || !client_id) throw new RpcError(E.VALIDATION, 'not configured: auth.issuer and auth.client_id are required');
  endpoint(issuer);
  return { issuer, client_id };
}

function endpoint(value: unknown): string {
  if (typeof value !== 'string') throw failed('endpoint');
  let url: URL;
  try { url = new URL(value); } catch { throw failed('endpoint'); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw failed('endpoint scheme');
  return value;
}

async function discover(c: Config, signal?: AbortSignal): Promise<Discovery> {
  const r = await fetch(`${c.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal });
  if (!r.ok) throw failed('discovery');
  const d = await r.json() as Discovery & { code_challenge_methods_supported?: unknown };
  if (d.issuer !== c.issuer) throw failed('issuer discovery');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) endpoint(d[key]);
  if (d.revocation_endpoint !== undefined) endpoint(d.revocation_endpoint);
  if (d.code_challenge_methods_supported !== undefined && (!Array.isArray(d.code_challenge_methods_supported) || !d.code_challenge_methods_supported.includes('S256'))) throw failed('PKCE S256');
  return d;
}

function same(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function profileFile(): string {
  return path.join(homeDir(), 'auth', 'profile.json');
}

/** Reads the saved public profile without contacting the provider. */
export function status(): AuthStatus {
  try {
    const p = JSON.parse(fs.readFileSync(profileFile(), 'utf8'));
    if (typeof p.sub !== 'string' || typeof p.signed_in_at !== 'string') return { signed_in: false };
    const out: AuthStatus = { signed_in: true, sub: p.sub, signed_in_at: p.signed_in_at };
    for (const key of ['name', 'email', 'picture'] as const) if (typeof p[key] === 'string') out[key] = p[key];
    return out;
  } catch { return { signed_in: false }; }
}

function storedConfig(): Config | null {
  try {
    const p = JSON.parse(fs.readFileSync(profileFile(), 'utf8'));
    if (typeof p.issuer !== 'string' || !p.issuer || typeof p.client_id !== 'string' || !p.client_id) return null;
    return { issuer: endpoint(p.issuer), client_id: p.client_id };
  } catch { return null; }
}

function saveProfile(p: AuthStatus, c: Config): void {
  const file = profileFile();
  const tmp = `${file}.${process.pid}.tmp`;
  const { signed_in, ...profile } = p;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...profile, ...c }), { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function clear(): void {
  memory = null;
  refreshing = null;
  try { deleteSecret('core-auth', 'refresh_token'); }
  finally { fs.rmSync(profileFile(), { force: true }); }
}

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, windowsHide: true, stdio: 'ignore', shell: false });
  child.on('error', () => {});
  child.unref();
}

function close(server: Server): void {
  server.close();
  server.closeAllConnections();
}

async function listen(server: Server, ports: number[], signal: AbortSignal): Promise<number> {
  for (const port of ports) {
    signal.throwIfAborted();
    try {
      await new Promise<void>((resolve, reject) => {
        const error = (e: Error) => { server.off('listening', ready); reject(e); };
        const ready = () => { server.off('error', error); resolve(); };
        server.once('error', error);
        server.once('listening', ready);
        server.listen(port, '127.0.0.1');
      });
      if (signal.aborted) { close(server); signal.throwIfAborted(); }
      return (server.address() as { port: number }).port;
    } catch (e) {
      if (!['EADDRINUSE', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
    }
  }
  throw failed(`no free port (tried ${ports.join(', ')})`);
}

async function claims(token: unknown, d: Discovery, c: Config, nonce: string, now: number, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (typeof token !== 'string') throw failed('id_token');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) throw failed('JWS compact');
  let header: { alg?: string; kid?: string }, p: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw failed('JWS JSON'); }
  if (!header || !['RS256', 'ES256'].includes(header.alg ?? '')) throw failed('alg');
  if (typeof header.kid !== 'string') throw failed('kid');
  let jwk: Record<string, any> | undefined;
  for (let n = 0; n < 2 && !jwk; n++) {
    const r = await fetch(d.jwks_uri, { signal });
    if (!r.ok) throw failed('JWKS');
    const keys = (await r.json() as { keys?: Record<string, any>[] }).keys;
    if (!Array.isArray(keys)) throw failed('JWKS');
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw failed('kid');
  if ((header.alg === 'RS256' && jwk.kty !== 'RSA') || (header.alg === 'ES256' && (jwk.kty !== 'EC' || jwk.crv !== 'P-256')) || (jwk.alg && jwk.alg !== header.alg) || (jwk.use && jwk.use !== 'sig')) throw failed('signing key');
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const options = header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' as const } : key;
    if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), options, Buffer.from(parts[2], 'base64url'))) throw failed('signature');
  } catch { throw failed('signature'); }
  if (!p || p.iss !== c.issuer) throw failed('iss');
  const aud = typeof p.aud === 'string' ? [p.aud] : p.aud;
  if (!Array.isArray(aud) || !aud.every((a) => typeof a === 'string') || !aud.includes(c.client_id)) throw failed('aud');
  if (aud.length > 1 && p.azp !== c.client_id) throw failed('azp');
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp) || p.exp * 1000 <= now - 60_000) throw failed('exp');
  if (typeof p.iat !== 'number' || !Number.isFinite(p.iat)) throw failed('iat');
  if (!same(p.nonce, nonce)) throw failed('nonce');
  if (typeof p.sub !== 'string' || !p.sub) throw failed('sub');
  return p;
}

async function tokens(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<{ response: Response; value: Record<string, unknown> }> {
  const response = await fetch(url, { method: 'POST', body: new URLSearchParams(body), signal });
  let value: Record<string, unknown>;
  try { value = await response.json() as Record<string, unknown>; } catch { throw failed('token response'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failed('token response');
  return { response, value };
}

function access(value: Record<string, unknown>, now: number): { token: string; expires: number } {
  if (typeof value.access_token !== 'string' || !value.access_token || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw failed('access token');
  if (value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || !value.refresh_token)) throw failed('refresh token');
  return { token: value.access_token, expires: now + value.expires_in * 1000 };
}

async function revoke(token: string, c: Config, d?: Discovery, signal?: AbortSignal): Promise<boolean> {
  try {
    d ??= await discover(c, signal ?? AbortSignal.timeout(15_000));
    if (!d.revocation_endpoint) return false;
    const r = await fetch(d.revocation_endpoint, { method: 'POST', body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: c.client_id }), signal: signal ?? AbortSignal.timeout(15_000) });
    return r.ok;
  } catch { return false; }
}

/** Signs in with the system browser and a one-use loopback callback. */
export async function signIn(db: DatabaseSync, deps: AuthDeps = {}): Promise<AuthStatus> {
  pending?.abort(new RpcError(E.INTERRUPTED, 'cancelled: newer sign-in'));
  const controller = new AbortController();
  const signal = controller.signal;
  pending = controller;
  const epoch = ++generation;
  const timeout = deps.timeout_ms ?? 300_000;
  let server: Server | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 600_000) throw new RpcError(E.INVALID_PARAMS, 'timeout_ms must be 1000..600000');
    const c = config(deps);
    const candidates = deps.ports ?? settings().auth.ports;
    if (!Array.isArray(candidates) || !candidates.every((p) => Number.isInteger(p) && p >= 0 && p <= 65535)) throw failed('ports');
    timer = setTimeout(() => controller.abort(new RpcError(E.VALIDATION, 'timed out')), timeout);
    const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    const flow = async () => {
      const d = await discover(c, signal);
      signal.throwIfAborted();
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      let accept: (code: string) => void;
      const callback = new Promise<string>((resolve) => { accept = resolve; });
      let used = false;
      server = createServer((req, res) => {
        let url: URL;
        try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); }
        catch { res.writeHead(400).end(); return; }
        if (req.method !== 'GET' || url.pathname !== '/callback' || used) { res.writeHead(404).end(); return; }
        if (!same(url.searchParams.get('state'), state)) { res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid state'); return; }
        if (url.searchParams.has('error')) {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('You can close this tab');
          controller.abort(new RpcError(E.INTERRUPTED, 'cancelled: provider declined'));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) { res.writeHead(400).end('Missing code'); return; }
        used = true;
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('You can close this tab');
        close(server!);
        accept(code);
      });
      const port = await listen(server, candidates.length ? candidates : [0], signal);
      signal.throwIfAborted();
      const redirect_uri = `http://127.0.0.1:${port}/callback`;
      const url = new URL(d.authorization_endpoint);
      const params = { response_type: 'code', client_id: c.client_id, redirect_uri, scope: 'openid profile email offline_access', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      (deps.open ?? openBrowser)(url.href);
      const code = await Promise.race([callback, aborted]);
      const { response, value } = await tokens(d.token_endpoint, { grant_type: 'authorization_code', code, redirect_uri, client_id: c.client_id, code_verifier: verifier }, signal);
      if (!response.ok) throw failed('token exchange');
      if (typeof value.refresh_token !== 'string' || !value.refresh_token) throw failed('no refresh token');
      const now = (deps.now ?? Date.now)();
      const p = await claims(value.id_token, d, c, nonce, now, signal);
      const a = access(value, now);
      signal.throwIfAborted();
      if (epoch !== generation) throw new RpcError(E.INTERRUPTED, 'cancelled');
      const profile: AuthStatus = { signed_in: true, sub: p.sub as string, signed_in_at: new Date(now).toISOString() };
      for (const key of ['name', 'email', 'picture'] as const) if (typeof p[key] === 'string') profile[key] = p[key];
      const oldToken = getSecret('core-auth', 'refresh_token');
      const oldConfig = storedConfig();
      setSecret(db, 'core-auth', 'refresh_token', value.refresh_token);
      try { saveProfile(profile, c); } catch { clear(); throw failed('profile storage'); }
      memory = { home: homeDir(), ...a, config: c, discovery: d };
      if (oldToken && oldConfig) void revoke(oldToken, oldConfig, undefined, AbortSignal.timeout(10_000));
      return status();
    };
    return await Promise.race([flow(), aborted]);
  } catch (e) {
    if (signal.aborted) throw signal.reason;
    if (e instanceof RpcError) throw e;
    throw failed('request or storage');
  } finally {
    if (timer) clearTimeout(timer);
    if (server) close(server);
    if (pending === controller) pending = null;
  }
}

/** Returns the access token, sharing an expired token's refresh request. */
export async function accessToken(db: DatabaseSync, deps: AuthDeps = {}): Promise<string | null> {
  const c = storedConfig();
  if (!c) { clear(); return null; }
  if (!status().signed_in) return null;
  const home = homeDir();
  const now = (deps.now ?? Date.now)();
  if (memory?.home === home && memory.config.issuer === c.issuer && memory.config.client_id === c.client_id && memory.expires > now + 60_000) return memory.token;
  if (refreshing?.home === home && refreshing.generation === generation) return refreshing.promise;
  const epoch = generation;
  const refresh = async () => {
    const token = getSecret('core-auth', 'refresh_token');
    if (!token) return null;
    const d = memory?.home === home && memory.config.issuer === c.issuer && memory.config.client_id === c.client_id ? memory.discovery : await discover(c, AbortSignal.timeout(15_000));
    const { response, value } = await tokens(d.token_endpoint, { grant_type: 'refresh_token', refresh_token: token, client_id: c.client_id }, AbortSignal.timeout(15_000));
    if (epoch !== generation || home !== homeDir() || !status().signed_in || getSecret('core-auth', 'refresh_token') !== token) {
      if (typeof value.refresh_token === 'string' && value.refresh_token) await revoke(value.refresh_token, c, d);
      return null;
    }
    if (value.error === 'invalid_grant') { clear(); return null; }
    if (!response.ok) throw failed('refresh');
    const a = access(value, (deps.now ?? Date.now)());
    if (typeof value.refresh_token === 'string') setSecret(db, 'core-auth', 'refresh_token', value.refresh_token);
    memory = { home, ...a, config: c, discovery: d };
    return a.token;
  };
  const flight = { generation: epoch, home, promise: refresh() };
  refreshing = flight;
  try { return await flight.promise; }
  finally { if (refreshing === flight) refreshing = null; }
}

/** Revokes the refresh token when supported and clears local sign-in state. */
export async function signOut(_db: DatabaseSync, _deps: AuthDeps = {}): Promise<{ signed_in: false; revoked: boolean }> {
  pending?.abort(new RpcError(E.INTERRUPTED, 'cancelled: signed out'));
  ++generation;
  let token: string | null = null;
  let c: Config | null = null;
  try {
    token = getSecret('core-auth', 'refresh_token');
    c = storedConfig();
  } catch {} finally { clear(); }
  const revoked = token && c ? await revoke(token, c) : false;
  return { signed_in: false, revoked };
}
