import http from 'node:http';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export const CLIENT_ID = 'cc-desktop-test';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface Knobs {
  deny?: boolean;
  discoveryIssuer?: string;
  noS256?: boolean;
  noRevoke?: boolean;
  alg?: 'RS256' | 'none' | 'HS256' | 'RS384';
  wrongKey?: boolean;
  kid?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  nonce?: string;
  expSec?: number;
  accessTtlSec?: number;
  refreshDelayMs?: number;
  tokenDelayMs?: number;
  jwkNoAlg?: boolean;
  ec?: boolean;
  noRefresh?: boolean;
  revokeDelayMs?: number;
}

/** A local OIDC provider: discovery, authorize, token (PKCE S256, single-use codes, refresh rotation with reuse detection), jwks, revoke. */
export async function startMock(knobs: Knobs = {}) {
  const key = knobs.ec ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map<string, { challenge: string; method: string; redirect: string; nonce: string; used: boolean }>();
  const live = new Map<string, string>();
  const spent = new Map<string, string>();
  const stats = { authorize: [] as URLSearchParams[], tokenCalls: 0, refreshCalls: 0, revoked: [] as string[], issuedRefresh: [] as string[], reuseDetected: 0 };
  let issuer = '';

  function idToken(nonce: string): string {
    const now = Math.floor(Date.now() / 1000);
    const alg = knobs.alg ?? (knobs.ec ? 'ES256' : 'RS256');
    const header = { alg, typ: 'JWT', kid: knobs.kid ?? 'k1' };
    const claims: Record<string, unknown> = {
      iss: knobs.iss ?? issuer, aud: knobs.aud ?? CLIENT_ID, sub: 'user_123', name: 'Test User', email: 'test@example.com',
      picture: 'https://example.com/p.png', nonce: knobs.nonce ?? nonce, iat: now, exp: now + (knobs.expSec ?? 600),
    };
    if (knobs.azp) claims.azp = knobs.azp;
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    if (alg === 'none') return `${input}.`;
    if (alg === 'HS256') return `${input}.${b64u(createHmac('sha256', CLIENT_ID).update(input).digest())}`;
    const signer: KeyObject = knobs.wrongKey ? attacker.privateKey : key.privateKey;
    return `${input}.${b64u(sign('sha256', Buffer.from(input), knobs.ec ? { key: signer, dsaEncoding: 'ieee-p1363' } : signer))}`;
  }

  function issueRefresh(family: string): string {
    const t = `rt_${randomBytes(16).toString('hex')}`;
    live.set(t, family);
    stats.issuedRefresh.push(t);
    return t;
  }

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(res, 200, {
        issuer: knobs.discoveryIssuer ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        ...(knobs.noRevoke ? {} : { revocation_endpoint: `${issuer}/revoke` }),
        code_challenge_methods_supported: knobs.noS256 ? ['plain'] : ['S256'],
        response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (url.pathname === '/jwks') {
      return json(res, 200, { keys: [{ ...key.publicKey.export({ format: 'jwk' }), kid: 'k1', ...(knobs.jwkNoAlg ? {} : { alg: knobs.ec ? 'ES256' : 'RS256' }), use: 'sig' }] });
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      stats.authorize.push(q);
      const redirect = q.get('redirect_uri') ?? '';
      if (q.get('client_id') !== CLIENT_ID || q.get('response_type') !== 'code' || !redirect.startsWith('http://127.0.0.1:')) return json(res, 400, { error: 'invalid_request' });
      const back = new URL(redirect);
      if (knobs.deny) back.searchParams.set('error', 'access_denied');
      else {
        const code = randomBytes(16).toString('hex');
        codes.set(code, { challenge: q.get('code_challenge') ?? '', method: q.get('code_challenge_method') ?? '', redirect, nonce: q.get('nonce') ?? '', used: false });
        back.searchParams.set('code', code);
      }
      back.searchParams.set('state', q.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      stats.tokenCalls++;
      if (form.get('client_secret')) return json(res, 400, { error: 'invalid_client', error_description: 'public client must not send a secret' });
      if (form.get('client_id') !== CLIENT_ID) return json(res, 400, { error: 'invalid_client' });
      const grant = form.get('grant_type');
      if (grant === 'authorization_code') {
        if (knobs.tokenDelayMs) await new Promise((r) => setTimeout(r, knobs.tokenDelayMs));
        const c = codes.get(form.get('code') ?? '');
        if (!c || c.used) return json(res, 400, { error: 'invalid_grant', error_description: 'code unknown or already used' });
        c.used = true;
        const verifier = form.get('code_verifier') ?? '';
        if (c.method !== 'S256' || b64u(createHash('sha256').update(verifier).digest()) !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE check failed' });
        if (form.get('redirect_uri') !== c.redirect) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        return json(res, 200, { access_token: `at_${randomBytes(8).toString('hex')}`, token_type: 'Bearer', expires_in: knobs.accessTtlSec ?? 3600, ...(knobs.noRefresh ? {} : { refresh_token: issueRefresh(randomBytes(4).toString('hex')) }), id_token: idToken(c.nonce) });
      }
      if (grant === 'refresh_token') {
        stats.refreshCalls++;
        const t = form.get('refresh_token') ?? '';
        const family = live.get(t);
        if (!family) {
          const f = spent.get(t);
          if (f) {
            stats.reuseDetected++;
            for (const [k, v] of live) if (v === f) live.delete(k);
          }
          return json(res, 400, { error: 'invalid_grant' });
        }
        live.delete(t);
        spent.set(t, family);
        const next = issueRefresh(family);
        if (knobs.refreshDelayMs) await new Promise((r) => setTimeout(r, knobs.refreshDelayMs));
        return json(res, 200, { access_token: `at_${randomBytes(8).toString('hex')}`, token_type: 'Bearer', expires_in: knobs.accessTtlSec ?? 3600, refresh_token: next });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/revoke' && req.method === 'POST') {
      if (knobs.revokeDelayMs) await new Promise((r) => setTimeout(r, knobs.revokeDelayMs));
      const t = form.get('token') ?? '';
      stats.revoked.push(t);
      live.delete(t);
      res.writeHead(200);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer, knobs, stats, live,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** A browser stand-in: loads the authorize URL and returns where the provider redirected, without following it. */
export async function authorize(url: string): Promise<string> {
  const r = await fetch(url, { redirect: 'manual' });
  const loc = r.headers.get('location');
  if (!loc) throw new Error(`authorize returned ${r.status}`);
  return loc;
}
