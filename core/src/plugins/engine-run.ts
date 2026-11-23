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

export interface EngineResult { status: 'ok' | 'failed'; outputs?: Record<string, unknown>; error?: string; bound?: string; run: string }

/** `ouros_engine` (M8-12): runs one action of an installed, enabled plugin in the calling session's project; with `surface`, the action's `binds` fill that surface's data so the agent need not resend it. An external action is refused until cc draws a real gate for it. */
export async function runEngine(db: DatabaseSync, p: Record<string, unknown>): Promise<EngineResult> {
  const sessionId = typeof p.session_id === 'string' ? p.session_id : '';
  const row = sessionId ? db.prepare('SELECT p.path FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?').get(sessionId) as { path: string } | undefined : undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'session not found; ouros_engine can only be called from a cc session');
  const plugin = typeof p.engine === 'string' ? loadPlugin(db, p.engine) : null;
  if (!plugin) throw new RpcError(E.NOT_FOUND, `no installed, enabled plugin called ${String(p.engine)}`);
  const blocked = plugin.source === 'builtin' ? null : blockReason(plugin.id, plugin.version);
  if (blocked) throw new RpcError(E.VALIDATION, `${plugin.id} ${plugin.version} is on cc's block list: ${blocked}`);
  const action = (plugin.manifest.actions ?? []).find((a) => a.id === p.action);
  if (!action) throw new RpcError(E.NOT_FOUND, `${plugin.id} has no action ${String(p.action)}`);
  if (action.external) throw new RpcError(E.VALIDATION, `${plugin.id} ${action.id} leaves this machine; cc has no gate for engine actions yet, so it does not run`);
  checkShippedFiles(db, plugin);
  const input = p.input && typeof p.input === 'object' && !Array.isArray(p.input) ? p.input as Record<string, unknown> : {};
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
