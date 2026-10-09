import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { notifyText } from './redact.ts';
import { deleteSecret, getSecret, setSecret } from './secrets.ts';
import { nowIso, ulid } from './time.ts';

export const NOTIFY_PLUGIN = 'core-notify';
export const SINK_KINDS = ['ntfy', 'slack-webhook', 'discord-webhook', 'teams-workflow', 'webhook', 'command'] as const;
const NEEDS_YOU_KINDS = ['gate', 'interrupted-command', 'missed-schedule', 'run-failed', 'missing-secret', 'handoff', 'budget', 'done', 'failed', 'spool-too-large', 'other'];
const DEFAULT_KINDS = ['gate', 'handoff', 'run-failed', 'budget', 'missing-secret'];
const RETRY_MS = [10_000, 60_000, 300_000];
const STALE_MS = 24 * 3600_000;
const FAILED_PREFIX = 'notify-failed';

interface SinkRow {
  id: string;
  kind: (typeof SINK_KINDS)[number];
  name: string;
  dest_hash: string;
  kinds: string;
  enabled: number;
  approved_at: string;
}

interface Item {
  id: string;
  at: string;
  kind: string;
  text: string;
}

const secretName = (sinkId: string) => `SINK_${sinkId}`;
const sinkKinds = (s: SinkRow): string[] => JSON.parse(s.kinds) as string[];

function loopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function checkDest(kind: string, dest: string): void {
  if (kind === 'command') {
    let argv: unknown;
    try { argv = JSON.parse(dest); } catch {}
    if (!Array.isArray(argv) || !argv.length || !argv.every((a) => typeof a === 'string' && a)) throw new RpcError(E.VALIDATION, 'a command sink needs a JSON array of strings');
    return;
  }
  let u: URL;
  try { u = new URL(dest); } catch { throw new RpcError(E.VALIDATION, 'the destination must be a URL'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback(u.hostname))) throw new RpcError(E.VALIDATION, 'the destination must be https (http only for localhost)');
}

function request(kind: SinkRow['kind'], item: Item, text: string, link: string): { headers: Record<string, string>; body: string } {
  const json = { 'Content-Type': 'application/json' };
  switch (kind) {
    case 'ntfy':
      return { headers: { Title: `MetaTrooper: ${item.kind}`, Priority: item.kind === 'gate' || item.kind === 'handoff' ? 'high' : 'default', Click: link }, body: text };
    case 'slack-webhook':
      return { headers: json, body: JSON.stringify({ text: `${text}\n${link}` }) };
    case 'discord-webhook':
      return { headers: json, body: JSON.stringify({ content: `${text}\n${link}` }) };
    case 'teams-workflow':
      return {
        headers: json,
        body: JSON.stringify({
          type: 'message',
          attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text, wrap: true }, { type: 'TextBlock', text: link, wrap: true }] },
          }],
        }),
      };
    default:
      return { headers: json, body: JSON.stringify({ schema: 1, kind: item.kind, id: item.id, text, at: item.at, link }) };
  }
}

function runCommand(argv: string[], message: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { shell: false, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), 15_000);
    child.once('error', () => { clearTimeout(timer); resolve('command could not start'); });
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0 ? null : `command exited ${code}`); });
    child.stdin.on('error', () => {});
    child.stdin.end(message);
  });
}

/** Sends one item to one sink; null on success, else a short reason that never holds the destination. */
async function deliver(sink: SinkRow, item: Item): Promise<string | null> {
  const dest = getSecret(NOTIFY_PLUGIN, secretName(sink.id));
  if (dest === null) return 'destination secret missing';
  const link = `metatrooper://needs-you/${item.id}`;
  const text = notifyText(item.kind, item.text);
  if (sink.kind === 'command') return runCommand(JSON.parse(dest) as string[], `${text}\n${link}\n`);
  const { headers, body } = request(sink.kind, item, text, link);
  try {
    const res = await fetch(dest, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch {
    return 'network error';
  }
}

function raiseFailed(db: DatabaseSync, sink: SinkRow): void {
  const last = db.prepare('SELECT at FROM needs_you WHERE kind = ? AND ref = ? AND text LIKE ? ORDER BY rowid DESC LIMIT 1').get('other', sink.id, `${FAILED_PREFIX}%`) as { at: string } | undefined;
  if (last && Date.now() - Date.parse(last.at) < 3600_000) return;
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'other', ?, ?)").run(ulid(), nowIso(), sink.id, `${FAILED_PREFIX}: could not send to ${sink.name}`);
}

interface Delivery {
  state: 'pending' | 'done' | 'failed';
  tries: number;
  next_at: number;
}

let busy = false;

/** Every 2 s: sends each new needs-you row once to every enabled sink that wants its kind. */
export async function notifyTick(db: DatabaseSync): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const sinks = db.prepare('SELECT * FROM notify_sink WHERE enabled = 1').all() as unknown as SinkRow[];
    if (!sinks.length) return;
    const now = Date.now();
    const rows = db.prepare(`SELECT id, at, kind, text FROM needs_you n WHERE notified_at IS NULL AND resolved_at IS NULL
      AND NOT (kind = 'other' AND text LIKE ?)
      AND NOT EXISTS (SELECT 1 FROM notify_delivery d WHERE d.needs_you_id = n.id AND d.state = 'pending' AND d.next_at > ?)
      ORDER BY rowid LIMIT 50`).all(`${FAILED_PREFIX}%`, now) as unknown as Item[];
    const mark = db.prepare('UPDATE needs_you SET notified_at = ? WHERE id = ?');
    const get = db.prepare('SELECT state, tries, next_at FROM notify_delivery WHERE needs_you_id = ? AND sink_id = ?');
    const put = db.prepare('INSERT OR REPLACE INTO notify_delivery (needs_you_id, sink_id, state, tries, next_at) VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) {
      if (now - Date.parse(row.at) > STALE_MS) { mark.run(`${nowIso()} skipped`, row.id); continue; }
      const targets = sinks.filter((s) => sinkKinds(s).includes(row.kind));
      if (!targets.length) { mark.run(`${nowIso()} no-sink`, row.id); continue; }
      const states = await Promise.all(targets.map(async (sink) => {
        const d = (get.get(row.id, sink.id) as Delivery | undefined) ?? { state: 'pending', tries: 0, next_at: 0 };
        if (d.state !== 'pending' || Date.now() < d.next_at) return d.state;
        if ((await deliver(sink, row)) === null) { put.run(row.id, sink.id, 'done', d.tries + 1, 0); return 'done'; }
        const tries = d.tries + 1;
        if (tries > RETRY_MS.length) { put.run(row.id, sink.id, 'failed', tries, 0); raiseFailed(db, sink); return 'failed'; }
        put.run(row.id, sink.id, 'pending', tries, Date.now() + RETRY_MS[tries - 1]);
        return 'pending';
      }));
      if (states.includes('pending')) continue;
      mark.run(states.includes('failed') ? `${nowIso()} failed` : nowIso(), row.id);
    }
  } finally {
    busy = false;
  }
}

function str(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  if (typeof v !== 'string' || !v) throw new RpcError(E.INVALID_PARAMS, `${key} is required`);
  return v;
}

function find(db: DatabaseSync, id: string): SinkRow {
  const row = db.prepare('SELECT * FROM notify_sink WHERE id = ?').get(id) as unknown as SinkRow | undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'sink not found');
  return row;
}

/** Adds or replaces a sink; the destination goes to the secret store and only its hash stays in the database. */
export function setSink(db: DatabaseSync, p: Record<string, unknown>): { id: string } {
  const kind = str(p, 'kind');
  if (!(SINK_KINDS as readonly string[]).includes(kind)) throw new RpcError(E.VALIDATION, `kind must be one of ${SINK_KINDS.join(', ')}`);
  const dest = str(p, 'dest');
  checkDest(kind, dest);
  const id = typeof p.id === 'string' && p.id ? p.id : ulid();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new RpcError(E.VALIDATION, 'id must be letters, digits, _ or -');
  const kinds = Array.isArray(p.kinds) ? p.kinds : DEFAULT_KINDS;
  if (!kinds.every((k) => typeof k === 'string' && NEEDS_YOU_KINDS.includes(k))) throw new RpcError(E.VALIDATION, 'kinds holds an unknown needs-you kind');
  const hash = crypto.createHash('sha256').update(dest).digest('hex');
  setSecret(db, NOTIFY_PLUGIN, secretName(id), dest);
  db.prepare('INSERT OR REPLACE INTO notify_sink (id, kind, name, dest_hash, kinds, enabled, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, kind, typeof p.name === 'string' && p.name ? p.name : kind, hash, JSON.stringify(kinds), p.enabled === false ? 0 : 1, nowIso());
  return { id };
}

export function listSinks(db: DatabaseSync): { sinks: Array<Record<string, unknown>> } {
  const rows = db.prepare('SELECT * FROM notify_sink ORDER BY rowid').all() as unknown as SinkRow[];
  return { sinks: rows.map((s) => ({ id: s.id, kind: s.kind, name: s.name, kinds: sinkKinds(s), enabled: s.enabled === 1, dest_hash: s.dest_hash.slice(0, 12), approved_at: s.approved_at })) };
}

export async function testSink(db: DatabaseSync, id: string): Promise<{ ok: boolean; error?: string }> {
  const error = await deliver(find(db, id), { id: 'test', at: nowIso(), kind: 'other', text: 'Test message from MetaTrooper' });
  return error === null ? { ok: true } : { ok: false, error };
}

export function removeSink(db: DatabaseSync, id: string): Record<string, never> {
  find(db, id);
  db.prepare('DELETE FROM notify_sink WHERE id = ?').run(id);
  deleteSecret(NOTIFY_PLUGIN, secretName(id));
  return {};
}
