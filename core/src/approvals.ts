import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { looksLikeCredential, redactCredentials } from './redact.ts';
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
/** The reason for a risky control; the name is matched whole and shortened only here, for display. */
const risky = (c: Control) => `risky control: ${(c.name || c.automation_id).slice(0, 200)}`;

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

export function summaryOf(p: CheckParams): string {
  const what = p.control ? (p.control.name || p.control.automation_id || p.control.role) : '';
  let where = p.target;
  try { where = new URL(p.target).host || p.target; } catch {}
  const verb = p.action === 'type' ? 'type into' : p.action === 'key' ? `press ${typeof p.args.keys === 'string' ? p.args.keys : ''} on` : p.action;
  return redactCredentials(`${verb} ${what || 'the page'} in ${where}`.replace(/\s+/g, ' ').trim()).slice(0, 300);
}

export class Approvals {
  private db: DatabaseSync;
  private timeoutMs: number;
  private waiters = new Map<string, (d: 'approved' | 'rejected' | 'expired') => void>();

  constructor(db: DatabaseSync, timeoutMs = APPROVAL_TIMEOUT_MS) {
    this.db = db;
    this.timeoutMs = timeoutMs;
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
    const reason = riskReason(p);
    if (!reason) return { decision: 'allow' };
    const control = p.control ? redactCredentials(canonicalJson(p.control)) : null;
    if (!ALWAYS.has(reason.split(':')[0])) {
      const covered = this.db.prepare(
        "SELECT 1 FROM approval WHERE session_id = ? AND surface = ? AND target = ? AND action = ? AND control IS ? AND status = 'approved' AND scope = 'session' LIMIT 1",
      ).get(p.session_id, p.surface, p.target, p.action, control);
      if (covered) return { decision: 'allow' };
    }
    const id = `ap_${ulid()}`;
    const now = nowIso();
    const summary = summaryOf(p);
    this.db.prepare(
      "INSERT INTO approval (id, session_id, surface, target, control, action, action_hash, summary, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)",
    ).run(id, p.session_id, p.surface, p.target, control, p.action, hash, summary, redactCredentials(reason), now);
    this.db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'approval', ?, ?)").run(ulid(), now, id, summary);
    const status = await new Promise<'approved' | 'rejected' | 'expired'>((resolve) => {
      const timer = setTimeout(() => this.finish(id, 'expired'), this.timeoutMs);
      this.waiters.set(id, (s) => { clearTimeout(timer); resolve(s); });
    });
    return { decision: status, approval_id: id };
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
