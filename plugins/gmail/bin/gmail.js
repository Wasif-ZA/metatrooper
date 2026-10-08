import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';
const BODY_CAP = 4000;

export class ApiError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

/** Gmail and token URLs; TROOP_GMAIL_API swaps both for a fake server, and only a loopback one. */
export function endpoints(env = process.env) {
  const base = env.TROOP_GMAIL_API?.replace(/\/+$/, '');
  if (!base) return { api: API, token: 'https://oauth2.googleapis.com/token' };
  const host = new URL(base).hostname.replace(/^\[|\]$/g, '');
  if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && host !== '::1') throw new ApiError(`TROOP_GMAIL_API must be a loopback address, not ${host}`, false);
  return { api: `${base}/gmail/v1/users/me`, token: `${base}/token` };
}

async function accessToken(env, url) {
  for (const k of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
    if (!env[k]) throw new ApiError(`${k} is not set: run troop plugin secret gmail ${k}`, false);
  }
  const r = await fetch(url, {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(`Google refused the refresh token: ${j.error_description || j.error || r.status}`, false);
  return j.access_token;
}

export function realApi(env = process.env) {
  const urls = endpoints(env);
  let token = null;
  return async (method, route, body) => {
    token ??= await accessToken(env, urls.token);
    let r;
    try {
      r = await fetch(`${urls.api}/${route}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new ApiError(`Gmail could not be reached: ${e.message}`, true);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(`Gmail ${method} ${route.split('?')[0]} failed: ${j.error?.message || r.status}`, r.status === 429 || r.status >= 500);
    return j;
  };
}

export function header(payload, name) {
  return (payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function partOf(payload, type) {
  if (!payload) return null;
  if (payload.mimeType === type && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  for (const p of payload.parts || []) {
    const t = partOf(p, type);
    if (t) return t;
  }
  return null;
}

export function textOf(payload) {
  return partOf(payload, 'text/plain') ?? partOf(payload, 'text/html')?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

export function searchQuery(input, now = new Date()) {
  const q = [input.query || 'is:unread'];
  // ponytail: last-run means the last day; a stored per-pipeline cursor if runs are further apart.
  if (input.since === 'last-run') q.push('newer_than:1d');
  else if (/^\d{4}-\d{2}-\d{2}$/.test(input.since || '')) q.push(`after:${input.since.replaceAll('-', '/')}`);
  return q.join(' ');
}

function messageRow(m) {
  const p = m.payload;
  return {
    id: m.id, thread: m.threadId, from: header(p, 'From'), to: header(p, 'To'), subject: header(p, 'Subject'), date: header(p, 'Date'),
    message_id: header(p, 'Message-ID'), snippet: m.snippet || '', body: textOf(p).slice(0, BODY_CAP), labels: m.labelIds || [],
  };
}

export function addressOf(value) {
  return String(value).replace(/^.*<([^>]+)>\s*$/, '$1').trim().toLowerCase();
}

export function unanswered(thread, me) {
  const last = thread.messages?.at(-1);
  if (!last || addressOf(header(last.payload, 'From')) !== addressOf(me)) return null;
  return { thread: thread.id, to: header(last.payload, 'To'), subject: header(last.payload, 'Subject'), date: header(last.payload, 'Date') };
}

export async function read(input, api, runDir = process.env.TROOP_RUN_DIR || '.') {
  const max = input.max ?? 50;
  const list = await api('GET', `messages?maxResults=${max}&q=${encodeURIComponent(searchQuery(input))}`);
  const messages = [];
  for (const { id } of list.messages || []) messages.push(messageRow(await api('GET', `messages/${id}?format=full`)));
  const followups = [];
  if (input.unanswered_sent_days) {
    const n = input.unanswered_sent_days;
    const me = (await api('GET', 'profile')).emailAddress;
    const sent = await api('GET', `threads?maxResults=50&q=${encodeURIComponent(`in:sent older_than:${n}d newer_than:${n + 14}d`)}`);
    for (const { id } of sent.threads || []) {
      const t = await api('GET', `threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const f = unanswered(t, me);
      if (f) followups.push(f);
    }
  }
  const out = path.resolve(runDir, input.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ query: searchQuery(input), messages, followups }, null, 2));
  return { count: messages.length, followups: followups.length, path: out };
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function refusal(d) {
  if (!d || typeof d !== 'object') return 'not an object';
  if (!EMAIL.test(String(d.to || '').replace(/^.*<([^>]+)>\s*$/, '$1'))) return `bad recipient ${JSON.stringify(d.to ?? '')}`;
  if (/[\r\n]/.test(`${d.to}${d.subject}`)) return 'line break in recipient or subject';
  if (!String(d.subject || '').trim()) return 'empty subject';
  if (!String(d.body || '').trim()) return 'empty body';
  if (/\{\{|\}\}|\[(first ?name|name|company)\]/i.test(`${d.subject}${d.body}`)) return 'unfilled template text';
  return null;
}

function encodeSubject(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

export function rawMessage(d, parent) {
  const lines = [`To: ${d.to}`, `Subject: ${encodeSubject(d.subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'];
  if (parent?.message_id) lines.push(`In-Reply-To: ${parent.message_id}`, `References: ${[parent.references, parent.message_id].filter(Boolean).join(' ')}`);
  const body = Buffer.from(d.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

export async function draft(input, api, runDir = process.env.TROOP_RUN_DIR || '.') {
  const file = path.resolve(runDir, input.drafts);
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new ApiError(`${input.drafts} is not a JSON list`, false);
  const refused = list.map((d, i) => [d?.id ?? `#${i}`, refusal(d)]).filter(([, why]) => why);
  if (refused.length) throw new ApiError(`refused, no drafts saved: ${refused.map(([id, why]) => `${id}: ${why}`).join('; ')}`, false);
  const ledgerFile = `${file}.saved.json`;
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {};
  const saved = [];
  let skipped = 0;
  for (const d of list) {
    const key = createHash('sha256').update(JSON.stringify([Boolean(input.reply), d.id, d.to, d.subject, d.body, d.thread ?? null])).digest('hex');
    if (ledger[key]) {
      saved.push({ id: d.id, draft_id: ledger[key] });
      skipped++;
      process.stderr.write(`draft for ${d.id} already saved in this run\n`);
      continue;
    }
    let parent = null;
    if (input.reply) {
      const m = await api('GET', `messages/${encodeURIComponent(d.id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
      parent = { thread: m.threadId, message_id: header(m.payload, 'Message-ID'), references: header(m.payload, 'References') };
    }
    const message = { raw: rawMessage(d, parent) };
    const thread = parent?.thread || d.thread;
    if (thread) message.threadId = thread;
    const r = await api('POST', 'drafts', { message });
    saved.push({ id: d.id, draft_id: r.id });
    ledger[key] = r.id ?? true;
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
    process.stderr.write(`saved draft for ${d.id}\n`);
  }
  return { count: saved.length, skipped, drafts: saved };
}

async function auth() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in this shell first (your Desktop OAuth client)');
  const server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent' })}`;
  console.log(`Opening the Google consent page. If it does not open, paste this into a browser:\n${url}\n`);
  spawn('cmd', ['/c', 'start', '', url.replaceAll('&', '^&')], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  const code = await new Promise((ok, fail) => server.on('request', (req, res) => {
    const q = new URL(req.url, redirect).searchParams;
    res.end(q.get('code') ? 'Done. You can close this tab.' : `Failed: ${q.get('error')}`);
    server.close();
    q.get('code') ? ok(q.get('code')) : fail(new Error(q.get('error') || 'no code'));
  }));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, code, redirect_uri: redirect, grant_type: 'authorization_code' }) });
  const j = await r.json();
  if (!j.refresh_token) throw new Error(`no refresh token: ${j.error_description || j.error || r.status}`);
  console.log(`Refresh token:\n${j.refresh_token}\n\nStore it with: troop plugin secret gmail GMAIL_REFRESH_TOKEN`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action === 'auth') {
    auth().catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    try {
      const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
      const run = action === 'read' ? read : action === 'draft' ? draft : null;
      if (!run) throw new ApiError(`unknown action ${action}`, false);
      const outputs = await run(req.input || {}, realApi(), req.run?.dir || process.env.TROOP_RUN_DIR || '.');
      process.stdout.write(JSON.stringify({ ok: true, outputs }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: { message: e.message, retryable: Boolean(e.retryable) } }));
      process.exitCode = 1;
    }
  }
}
