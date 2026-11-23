import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from '../pipe/errors.ts';
import { homeDir } from '../paths.ts';
import { getSecret } from '../secrets.ts';
import { atPointer } from '../../../workbench/ui/src/kit/check.js';
import { setSurfaceData } from '../surfaces.ts';
import { ulid } from '../time.ts';
import { runAction } from './actions.ts';
import { blockReason } from './blocklist.ts';
import { checkShippedFiles, loadPlugin } from './store.ts';
import { canonicalJson, type Approvals } from '../approvals.ts';
import crypto from 'node:crypto';

export interface EngineResult { status: 'ok' | 'failed'; outputs?: Record<string, unknown>; error?: string; bound?: string; run: string }

/** `ouros_engine` (M8-12): runs one action of an installed, enabled plugin in the calling session's project; with `surface`, the action's `binds` fill that surface's data so the agent need not resend it. An external action is refused until cc draws a real gate for it. */
export async function runEngine(db: DatabaseSync, p: Record<string, unknown>, approvals?: Pick<Approvals, 'check'>): Promise<EngineResult> {
  const sessionId = typeof p.session_id === 'string' ? p.session_id : '';
  const row = sessionId ? db.prepare('SELECT p.path FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?').get(sessionId) as { path: string } | undefined : undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'session not found; ouros_engine can only be called from a cc session');
  const plugin = typeof p.engine === 'string' ? loadPlugin(db, p.engine) : null;
  if (!plugin) throw new RpcError(E.NOT_FOUND, `no installed, enabled plugin called ${String(p.engine)}`);
  const blocked = plugin.source === 'builtin' ? null : blockReason(plugin.id, plugin.version);
  if (blocked) throw new RpcError(E.VALIDATION, `${plugin.id} ${plugin.version} is on cc's block list: ${blocked}`);
  const action = (plugin.manifest.actions ?? []).find((a) => a.id === p.action);
  if (!action) throw new RpcError(E.NOT_FOUND, `${plugin.id} has no action ${String(p.action)}`);
  checkShippedFiles(db, plugin);
  const input = p.input && typeof p.input === 'object' && !Array.isArray(p.input) ? p.input as Record<string, unknown> : {};
  if (action.external) {
    // M8-12b: a real gate the person answers; it names the destination and binds the plugin, action, input and the approved file hashes, and asks every time
    if (!approvals) throw new RpcError(E.VALIDATION, `${plugin.id} ${action.id} leaves this machine and no gate is available, so it does not run`);
    const files = (db.prepare('SELECT value FROM meta WHERE key = ?').get(`plugin_files:${plugin.id}`) as { value: string } | undefined)?.value ?? '';
    const destination = action.destination_field ? String(input[action.destination_field] ?? '').slice(0, 200) : '';
    const args = { action: action.id, input_sha256: crypto.createHash('sha256').update(canonicalJson(input)).digest('hex'), files_sha256: crypto.createHash('sha256').update(files).digest('hex'), destination };
    const v = await approvals.check({ session_id: sessionId, surface: 'engine', target: plugin.id, action: 'run', args, control: null });
    if (v.decision !== 'approved') throw new RpcError(E.VALIDATION, v.decision === 'deny' ? `not run: ${v.reason}` : v.decision === 'rejected' ? 'not run: the user rejected this action' : 'not run: not approved in time');
  }
  const run = { id: ulid(), dir: '' };
  run.dir = path.join(homeDir(), 'engine-runs', run.id);
  const r = await runAction({ plugin, actionId: action.id, input, projectDir: row.path, run, secret: (name) => getSecret(plugin.id, name) });
  if (!r.ok) return { status: 'failed', error: r.error.message, run: run.id };
  const out: EngineResult = { status: 'ok', outputs: r.outputs, run: run.id };
  if (typeof p.surface === 'string' && action.binds) {
    const value = atPointer(r.outputs, action.binds.from);
    if (value !== undefined) {
      setSurfaceData(db, { session_id: sessionId, surface: p.surface, path: action.binds.to, value });
      out.bound = action.binds.to;
    }
  }
  return out;
}
