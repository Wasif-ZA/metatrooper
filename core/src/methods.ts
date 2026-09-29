import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import type { MethodSpec } from './pipe/commands.ts';
import { isAcuPath, projectId, resolveProjectPath } from './project.ts';
import { nowIso, ulid } from './time.ts';
import { getEngine, type EngineSpec } from './engines/registry.ts';
import { checkAll } from './engines/health.ts';
import { focusSession, launchSession } from './sessions/launch.ts';
import { appendEvent } from './events/append.ts';
import { processEvents } from './events/processor.ts';
import { installClaude, installCodex, lineDiff, uninstallClaude, uninstallCodex } from './hooks/install.ts';
import { cronMatches } from './schedules.ts';
import { homeDir } from './paths.ts';
import { installPlugin, previewPlugin, removePlugin, raiseMissingSecret, setPluginSecret } from './plugins/store.ts';
import { resolveMcpServer } from './plugins/mcp.ts';
import type { Runner } from './pipelines/runner.ts';
import { syncPipelines, validationContext } from './pipelines/store.ts';
import { validatePipeline } from './pipelines/validate.ts';

function str(p: Record<string, unknown>, key: string, required = true): string {
  const v = p[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (!required) return '';
  throw new RpcError(E.INVALID_PARAMS, `${key} is required`);
}

export interface CoreControl {
  engines: () => EngineSpec[];
  stop: () => void;
  runner: Runner;
}

function int(p: Record<string, unknown>, key: string): number {
  const v = p[key];
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  throw new RpcError(E.INVALID_PARAMS, `${key} must be a whole number`);
}

export function buildMethods(db: DatabaseSync, ctl: CoreControl): Map<string, MethodSpec> {
  const m = new Map<string, MethodSpec>();

  m.set('core.ping', {
    handler: () => {
      const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
      return { ok: true, pid: process.pid, schema_version: Number(v?.value ?? 1) };
    },
  });

  m.set('core.stop', { needsUi: true, handler: () => { setTimeout(ctl.stop, 10); return {}; } });

  m.set('project.open', {
    handler: (p) => {
      const input = str(p, 'path');
      if (isAcuPath(input)) throw new RpcError(E.ACU_REFUSED, 'ACU projects are not opened in Metatrooper');
      let canonical: string;
      try {
        canonical = resolveProjectPath(input);
      } catch {
        throw new RpcError(E.NOT_FOUND, `folder not found: ${input}`);
      }
      if (isAcuPath(canonical)) throw new RpcError(E.ACU_REFUSED, 'ACU projects are not opened in Metatrooper');
      const id = projectId(canonical);
      const now = nowIso();
      db.prepare(
        `INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_opened = excluded.last_opened`,
      ).run(id, canonical, path.posix.basename(canonical), now, now);
      return { project_id: id };
    },
  });

  m.set('session.launch', {
    handler: (p) => {
      const project = db.prepare('SELECT id, path, name FROM project WHERE id = ?').get(str(p, 'project_id')) as
        | { id: string; path: string; name: string }
        | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const host = str(p, 'host', false) || 'wt';
      if (host !== 'wt') throw new RpcError(E.ENGINE_UNAVAILABLE, `host ${host} is not installed`);
      const engine = getEngine(db, str(p, 'engine_id'));
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      const check = db
        .prepare('SELECT installed FROM engine_check WHERE engine_id = ? ORDER BY checked_at DESC LIMIT 1')
        .get(engine.id) as { installed: number } | undefined;
      if (check && !check.installed) throw new RpcError(E.ENGINE_UNAVAILABLE, `${engine.id} is not installed`);
      return launchSession(db, {
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        engine,
        prompt: str(p, 'prompt', false) || undefined,
      });
    },
  });

  m.set('session.hide', {
    handler: (p) => {
      const r = db.prepare('UPDATE session SET hidden = 1 WHERE id = ?').run(str(p, 'session_id'));
      if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'session not found');
      return {};
    },
  });

  const markSeen = (id: string) => {
    const s = db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined;
    if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
    if (s.state === 'done') {
      appendEvent('core.seen', id, {}, db);
      processEvents(db);
    }
  };

  m.set('session.seen', { handler: (p) => { markSeen(str(p, 'session_id')); return {}; } });

  m.set('session.focus', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const s = db.prepare('SELECT window_name FROM session WHERE id = ?').get(id) as { window_name: string | null } | undefined;
      if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
      markSeen(id);
      return { focused: s.window_name ? focusSession(s.window_name) : false };
    },
  });

  m.set('engines.check', { handler: () => { void checkAll(db, ctl.engines()); return {}; } });

  m.set('worktree.create', {
    handler: (p) => {
      const project = db.prepare('SELECT id, path FROM project WHERE id = ?').get(str(p, 'project_id')) as
        | { id: string; path: string }
        | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const branch = str(p, 'branch', false) || `troop/${ulid().toLowerCase()}`;
      const base = str(p, 'base', false) || 'HEAD';
      const dir = path.join(homeDir(), 'worktrees', project.id, branch.replace(/[\/]/g, '-'));
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      try {
        execFileSync('git', ['-C', project.path, 'worktree', 'add', dir, '-b', branch, base], { stdio: 'pipe', timeout: 60_000 });
      } catch (e) {
        throw new RpcError(E.VALIDATION, `git worktree add failed: ${String((e as { stderr?: Buffer }).stderr ?? e).trim()}`);
      }
      return { path: dir.split(String.fromCharCode(92)).join('/'), branch };
    },
  });

  m.set('schedule.set', {
    handler: (p) => {
      const cron = str(p, 'cron');
      try {
        cronMatches(cron, new Date());
      } catch (e) {
        throw new RpcError(E.VALIDATION, (e as Error).message);
      }
      const id = str(p, 'schedule_id', false) || ulid();
      db.prepare(
        `INSERT INTO schedule (id, pipeline_id, project_id, cron, inputs, enabled) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cron = excluded.cron, inputs = excluded.inputs, enabled = excluded.enabled`,
      ).run(id, str(p, 'pipeline_id'), str(p, 'project_id'), cron, JSON.stringify(p.inputs ?? {}), p.enabled === false ? 0 : 1);
      return { schedule_id: id };
    },
  });

  m.set('hooks.install', {
    needsUi: true,
    handler: (p) => {
      const claude = installClaude();
      const codex = p.codex ? installCodex() : null;
      return { diff: [lineDiff(claude.before, claude.after), codex ? lineDiff(codex.before, codex.after) : ''].filter(Boolean).join('\n') };
    },
  });

  m.set('hooks.uninstall', {
    needsUi: true,
    handler: (p) => {
      const claude = uninstallClaude();
      const codex = p.codex ? uninstallCodex() : null;
      return { diff: [claude ? lineDiff(claude.before, claude.after) : '', codex ? lineDiff(codex.before, codex.after) : ''].filter(Boolean).join('\n') };
    },
  });

  m.set('gate.resolve', {
    needsUi: true,
    handler: (p) => {
      const gate = db.prepare('SELECT id, action_hash, status FROM gate WHERE id = ?').get(str(p, 'gate_id')) as
        | { id: string; action_hash: string | null; status: string }
        | undefined;
      if (!gate) throw new RpcError(E.NOT_FOUND, 'gate not found');
      if (gate.status !== 'waiting') throw new RpcError(E.GATE_STALE, `gate is ${gate.status}`);
      if (gate.action_hash && gate.action_hash !== p.action_hash) throw new RpcError(E.GATE_STALE, 'gate is stale: the action changed since approval');
      const decision = str(p, 'decision');
      if (decision !== 'approve' && decision !== 'reject') throw new RpcError(E.INVALID_PARAMS, 'decision must be approve or reject');
      db.prepare('UPDATE gate SET status = ?, decided_at = ?, note = ? WHERE id = ?')
        .run(decision === 'approve' ? 'approved' : 'rejected', nowIso(), typeof p.note === 'string' ? p.note : null, gate.id);
      db.prepare("UPDATE needs_you SET resolved_at = ? WHERE kind = 'gate' AND ref = ? AND resolved_at IS NULL").run(nowIso(), gate.id);
      return {};
    },
  });

  m.set('plugin.preview', { handler: (p) => previewPlugin(db, str(p, 'source')) });

  m.set('plugin.install', {
    needsUi: true,
    handler: (p) => {
      const approved = p.approved_permissions;
      if (!Array.isArray(approved) || approved.some((x) => typeof x !== 'string')) throw new RpcError(E.INVALID_PARAMS, 'approved_permissions must be an array of strings');
      const secrets = p.secrets ?? {};
      if (typeof secrets !== 'object' || Array.isArray(secrets) || Object.values(secrets).some((v) => typeof v !== 'string')) {
        throw new RpcError(E.INVALID_PARAMS, 'secrets must map names to strings');
      }
      const r = installPlugin(db, {
        source: str(p, 'source'),
        approved_permissions: approved as string[],
        manifest_hash: str(p, 'manifest_hash', false) || undefined,
        secrets: secrets as Record<string, string>,
      });
      void checkAll(db, ctl.engines()).catch(() => {});
      return r;
    },
  });

  m.set('plugin.remove', { needsUi: true, handler: (p) => { removePlugin(db, str(p, 'plugin_id')); return {}; } });

  m.set('plugin.secret.set', {
    needsUi: true,
    handler: (p) => {
      if (typeof p.value !== 'string') throw new RpcError(E.INVALID_PARAMS, 'value is required');
      setPluginSecret(db, str(p, 'plugin_id'), str(p, 'name'), p.value);
      return {};
    },
  });

  m.set('mcp.resolve', { handler: (p) => resolveMcpServer(db, str(p, 'plugin_id'), str(p, 'server_id')) });

  m.set('mcp.missing', {
    handler: (p) => {
      const pluginId = str(p, 'plugin_id');
      const names = Array.isArray(p.names) ? p.names.filter((n): n is string => typeof n === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(n)) : [];
      if (!db.prepare('SELECT 1 FROM plugin WHERE id = ?').get(pluginId)) throw new RpcError(E.NOT_FOUND, 'plugin not found');
      for (const n of names) raiseMissingSecret(db, pluginId, n);
      return {};
    },
  });

  m.set('pipeline.validate', {
    handler: (p) => {
      let json: unknown = p.json;
      if (typeof json === 'string') {
        try {
          json = JSON.parse(json);
        } catch (e) {
          return { valid: false, errors: [`not valid JSON: ${(e as Error).message}`] };
        }
      }
      const errors = validatePipeline(json, validationContext(db, syncPipelines(db), null));
      return { valid: errors.length === 0, errors };
    },
  });

  m.set('run.start', {
    handler: (p) => {
      const trigger = str(p, 'trigger', false) || 'manual';
      if (!['manual', 'schedule', 'cli'].includes(trigger)) throw new RpcError(E.INVALID_PARAMS, 'trigger must be manual, schedule or cli');
      const inputs = p.inputs ?? {};
      if (typeof inputs !== 'object' || Array.isArray(inputs)) throw new RpcError(E.INVALID_PARAMS, 'inputs must be an object');
      const run_id = ctl.runner.start({
        pipeline_id: str(p, 'pipeline_id'), project_id: str(p, 'project_id'), inputs: inputs as Record<string, unknown>, trigger: trigger as 'manual' | 'schedule' | 'cli',
      });
      return { run_id };
    },
  });

  m.set('run.cancel', { handler: (p) => { ctl.runner.cancel(str(p, 'run_id')); return {}; } });

  m.set('run.resume', {
    handler: (p) => {
      const raise: Record<string, number> = {};
      for (const k of ['max_tokens', 'max_usd', 'max_minutes']) if (typeof p[k] === 'number') raise[k] = p[k] as number;
      ctl.runner.resume(str(p, 'run_id'), raise);
      return {};
    },
  });

  m.set('variant.pick', { handler: (p) => { ctl.runner.pick(str(p, 'run_id'), int(p, 'idx')); return {}; } });
  m.set('variant.discard', { handler: (p) => { ctl.runner.discard(str(p, 'run_id'), int(p, 'idx')); return {}; } });

  m.set('needs.dismiss', {
    needsUi: true,
    handler: (p) => {
      const r = db.prepare('UPDATE needs_you SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').run(nowIso(), str(p, 'id'));
      if (Number(r.changes) === 0 && !db.prepare('SELECT 1 FROM needs_you WHERE id = ?').get(str(p, 'id'))) throw new RpcError(E.NOT_FOUND, 'item not found');
      return {};
    },
  });

  for (const name of ['comment.deliver', 'variant.combine']) {
    m.set(name, { handler: () => { throw new RpcError(E.METHOD_NOT_FOUND, `${name} arrives with a later child issue`); } });
  }

  return m;
}
