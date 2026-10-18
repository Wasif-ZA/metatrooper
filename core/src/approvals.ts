import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { looksLikeCredential, redactCredentials, redactSecretValues, scrub } from './redact.ts';
import { browserSecretOrigin, normalOrigin, SECRET_PLACEHOLDER } from './browser/secret-origin.ts';
import { nowIso, ulid } from './time.ts';

export const APPROVAL_TIMEOUT_MS = 120_000;
export const SURFACES = ['browser', 'desktop'] as const;
export const ACTIONS = ['click', 'type', 'key', 'select', 'scroll', 'navigate'] as const;

export interface Control { automation_id: string; name: string; role: string }

export interface CheckParams {
  session_id: string;
  surface: string;
  target: string;
  action: string;
  args: Record<string, unknown>;
  control: Control | null;
  password?: boolean;
  hidden?: boolean;
  file_dialog?: boolean;
  action_hash?: string;
}

export type Decision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'approved' | 'rejected' | 'expired'; approval_id: string };

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** JSON with keys sorted at every level and no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function normalControl(c: unknown): Control | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  return { automation_id: s('automation_id'), name: s('name'), role: s('role') };
}

/** sha256 hex of the canonical JSON of the action; typed text is replaced by its own sha256 first. */
export function actionHash(p: { action: string; args: Record<string, unknown>; control: Control | null; session_id: string; surface: string; target: string }): string {
  const args = { ...p.args };
  if (typeof args.text === 'string') args.text = sha256(args.text);
  return sha256(canonicalJson({ action: p.action, args, control: normalControl(p.control), session_id: p.session_id, surface: p.surface, target: p.target }));
}

const RISKY_NAME = /\b(send|submit|pay|buy|purchase|order|checkout|delete|remove|erase|publish|post|transfer|authori[sz]e|confirm)\b/i;
const CREDENTIAL_LABEL = /\b(password|passcode|token|secret|key|cvv|card)s?\b/i;
const ACTIVATING_KEY = /^(enter|return|space| )$/i;
const ALWAYS = new Set(['password field', 'credential text', 'credential field', 'file dialog', 'hidden control']);

const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ');
const riskyControl = (c: Control | null) => Boolean(c && (RISKY_NAME.test(words(c.name)) || RISKY_NAME.test(words(c.automation_id))));
/** The reason for a risky control; the name is matched whole, then redacted whole and shortened only here, for display. */
const risky = (c: Control) => `risky control: ${redactCredentials(c.name || c.automation_id).slice(0, 200)}`;

function isShortcut(keys: string): boolean {
  const parts = keys.split('+').map((k) => k.trim()).filter(Boolean);
  return parts.length > 1 && parts.slice(0, -1).some((m) => /^(control|ctrl|alt|meta|cmd|command|win)$/i.test(m));
}

/** The D61 rule that makes this action ask, or null. */
export function riskReason(p: CheckParams): string | null {
  const c = p.control;
  const label = c ? `${c.name} ${c.automation_id}` : '';
  if (p.file_dialog) return 'file dialog';
  if (p.action === 'type') {
    if (p.password) return 'password field';
    if (typeof p.args.text === 'string' && looksLikeCredential(p.args.text)) return 'credential text';
    if (CREDENTIAL_LABEL.test(words(label))) return 'credential field';
  }
  if (p.action === 'key') {
    const keys = typeof p.args.keys === 'string' ? p.args.keys : '';
    const last = keys.split('+').pop()?.trim() ?? '';
    if (!ACTIVATING_KEY.test(last) && !isShortcut(keys)) return null;
    if (p.hidden) return 'hidden control';
    if (riskyControl(c)) return risky(c!);
    return null;
  }
  if (!['click', 'select', 'type'].includes(p.action)) return null;
  if (p.hidden) return 'hidden control';
  if (riskyControl(c)) return risky(c!);
  return null;
}

export function summaryOf(p: CheckParams, secrets: string[] = []): string {
  const what = p.control ? (p.control.name || p.control.automation_id || p.control.role) : '';
  let where = p.target;
  try { where = new URL(p.target).host || p.target; } catch {}
  const verb = p.action === 'type' ? 'type into' : p.action === 'key' ? `press ${typeof p.args.keys === 'string' ? p.args.keys : ''} on` : p.action;
  return scrub(`${verb} ${what || 'the page'} in ${where}`.replace(/\s+/g, ' ').trim(), secrets).slice(0, 300);
}

export class Approvals {
  private db: DatabaseSync;
  private timeoutMs: number;
  private waiters = new Map<string, (d: 'approved' | 'rejected' | 'expired') => void>();

  private secrets: () => string[];

  constructor(db: DatabaseSync, timeoutMs = APPROVAL_TIMEOUT_MS, secrets: () => string[] = () => []) {
    this.db = db;
    this.timeoutMs = timeoutMs;
    this.secrets = secrets;
    for (const r of db.prepare("SELECT id FROM approval WHERE status = 'waiting'").all() as Array<{ id: string }>) this.finish(r.id, 'expired');
  }

  private finish(id: string, status: 'approved' | 'rejected' | 'expired', scope?: 'once' | 'session'): boolean {
    const now = nowIso();
    const r = this.db.prepare("UPDATE approval SET status = ?, scope = ?, decided_at = ? WHERE id = ? AND status = 'waiting'").run(status, scope ?? null, now, id);
    if (Number(r.changes) === 0) return false;
    this.db.prepare("UPDATE needs_you SET resolved_at = ? WHERE kind = 'approval' AND ref = ? AND resolved_at IS NULL").run(now, id);
    this.waiters.get(id)?.(status);
    this.waiters.delete(id);
    return true;
  }

  async check(raw: Record<string, unknown>): Promise<Decision> {
    const p = parseCheck(raw);
    const hash = actionHash(p);
    if (p.action_hash !== undefined && p.action_hash !== hash) throw new RpcError(E.INVALID_PARAMS, 'action_hash does not match the action');
    if (!this.db.prepare('SELECT 1 FROM session WHERE id = ? AND ended_at IS NULL').get(p.session_id)) return { decision: 'deny', reason: 'unknown or ended session' };
    const text = p.surface === 'browser' && p.action === 'type' && typeof p.args.text === 'string' ? p.args.text : '';
    if (text.includes('{{secret:')) {
      const name = SECRET_PLACEHOLDER.exec(text)?.[1];
      if (!name) return { decision: 'deny', reason: 'a {{secret:NAME}} placeholder must be the whole text' };
      const saved = browserSecretOrigin(name);
      if (!saved) return { decision: 'deny', reason: `there is no browser secret named ${name}` };
      if (saved !== normalOrigin(p.target)) return { decision: 'deny', reason: `secret ${name} is saved for another origin` };
      if (!p.password) return { decision: 'deny', reason: `secret ${name} goes only into a password field` };
    }
    const reason = riskReason(p) ?? (this.newOrigin(p) ? 'new origin' : null);
    if (!reason) return { decision: 'allow' };
    let secrets: string[];
    try {
      secrets = this.secrets();
    } catch {
      return { decision: 'deny', reason: 'a saved browser secret could not be read, so this action cannot be recorded safely' };
    }
    // every stored field is scrubbed of known secret values: a page can copy a filled secret into a control's name or id
    const clean = (s: string) => redactCredentials(redactSecretValues(s, secrets));
    const control = p.control ? clean(canonicalJson(Object.fromEntries(Object.entries(p.control).map(([k, v]) => [k, redactCredentials(redactSecretValues(v, secrets)).slice(0, 200)])))) : null;
    if (!ALWAYS.has(reason.split(':')[0])) {
      // a session approval covers only the rule it was given for: a `new origin` row never covers a risky action
      const covered = this.db.prepare(
        "SELECT 1 FROM approval WHERE session_id = ? AND surface = ? AND target = ? AND action = ? AND control IS ? AND reason = ? AND status = 'approved' AND scope = 'session' LIMIT 1",
      ).get(p.session_id, p.surface, p.target, p.action, control, clean(reason));
      if (covered) return { decision: 'allow' };
    }
    const id = `ap_${ulid()}`;
    const now = nowIso();
    const summary = summaryOf(p, secrets);
    this.db.prepare(
      "INSERT INTO approval (id, session_id, surface, target, control, action, action_hash, summary, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)",
    ).run(id, p.session_id, p.surface, p.target, control, p.action, hash, summary, clean(reason), now);
    this.db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'approval', ?, ?)").run(ulid(), now, id, summary);
    const status = await new Promise<'approved' | 'rejected' | 'expired'>((resolve) => {
      const timer = setTimeout(() => this.finish(id, 'expired'), this.timeoutMs);
      this.waiters.set(id, (s) => { clearTimeout(timer); resolve(s); });
    });
    return { decision: status, approval_id: id };
  }

  /** A browser input on an http(s) origin that this session has no session-scope `new origin` approval for and the project's `.troop/config.json` does not list in `allow_origins`. */
  private newOrigin(p: CheckParams): boolean {
    const origin = p.surface === 'browser' && INPUTS.has(p.action) ? normalOrigin(p.target) : null;
    if (!origin) return false;
    if (allowedOrigins(this.db, p.session_id).has(origin)) return false;
    return !this.db.prepare(
      "SELECT 1 FROM approval WHERE session_id = ? AND surface = 'browser' AND target = ? AND reason = 'new origin' AND status = 'approved' AND scope = 'session' LIMIT 1",
    ).get(p.session_id, p.target);
  }

  resolve(raw: Record<string, unknown>): { status: string; scope: string } {
    const id = typeof raw.approval_id === 'string' ? raw.approval_id : '';
    const decision = raw.decision;
    if (decision !== 'approve' && decision !== 'reject') throw new RpcError(E.INVALID_PARAMS, 'decision must be approve or reject');
    const asked = raw.scope ?? 'once';
    if (asked !== 'once' && asked !== 'session') throw new RpcError(E.INVALID_PARAMS, 'scope must be once or session');
    const row = this.db.prepare('SELECT status, reason FROM approval WHERE id = ?').get(id) as { status: string; reason: string } | undefined;
    if (!row) throw new RpcError(E.NOT_FOUND, 'approval not found');
    if (row.status !== 'waiting') throw new RpcError(E.GATE_STALE, `approval is ${row.status}, not waiting`);
    const scope = ALWAYS.has(row.reason.split(':')[0]) ? 'once' : asked;
    if (!this.finish(id, decision === 'approve' ? 'approved' : 'rejected', scope)) throw new RpcError(E.GATE_STALE, 'approval is no longer waiting');
    return { status: decision === 'approve' ? 'approved' : 'rejected', scope };
  }
}

const INPUTS = new Set(['click', 'type', 'select', 'key']);

/** The origins the session's project lists under `allow_origins` in `.troop/config.json`. */
function allowedOrigins(db: DatabaseSync, sessionId: string): Set<string> {
  const row = db.prepare('SELECT p.path FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?').get(sessionId) as { path: string } | undefined;
  const out = new Set<string>();
  if (!row) return out;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(row.path, '.troop', 'config.json'), 'utf8')) as { allow_origins?: unknown };
    if (Array.isArray(cfg.allow_origins)) for (const o of cfg.allow_origins) if (typeof o === 'string' && normalOrigin(o)) out.add(normalOrigin(o)!);
  } catch {}
  return out;
}

function parseCheck(raw: Record<string, unknown>): CheckParams {
  const s = (k: string) => {
    const v = raw[k];
    if (typeof v !== 'string' || !v) throw new RpcError(E.INVALID_PARAMS, `${k} is required`);
    return v;
  };
  const surface = s('surface');
  if (!(SURFACES as readonly string[]).includes(surface)) throw new RpcError(E.INVALID_PARAMS, 'surface must be browser or desktop');
  const action = s('action');
  if (!(ACTIONS as readonly string[]).includes(action)) throw new RpcError(E.INVALID_PARAMS, `action must be one of ${ACTIONS.join(', ')}`);
  const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? (raw.args as Record<string, unknown>) : {};
  return {
    session_id: s('session_id'),
    surface,
    target: s('target'),
    action,
    args,
    control: normalControl(raw.control),
    password: raw.password === true,
    hidden: raw.hidden === true,
    file_dialog: raw.file_dialog === true,
    action_hash: typeof raw.action_hash === 'string' ? raw.action_hash : undefined,
  };
}
