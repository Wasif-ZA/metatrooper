import fs from 'node:fs';
import { settings } from './settings.ts';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import type { MethodSpec } from './pipe/commands.ts';
import { canonicalPath, projectId, resolveProjectPath } from './project.ts';
import { nowIso, ulid } from './time.ts';
import { getEngine, type EngineSpec } from './engines/registry.ts';
import { checkAll } from './engines/health.ts';
import { launchSession, writePrompt } from './sessions/launch.ts';
import * as term from './terminal/index.ts';
import { availableShells } from './terminal/shells.ts';
import { appendEvent } from './events/append.ts';
import { processEvents } from './events/processor.ts';
import { installClaude, installCodex, installEngineSettings, lineDiff, uninstallClaude, uninstallCodex, uninstallEngineSettings } from './hooks/install.ts';
import { cronMatches } from './schedules.ts';
import { homeDir } from './paths.ts';
import { installPlugin, previewPlugin, removePlugin, raiseMissingSecret, setPluginSecret } from './plugins/store.ts';
import { resolveMcpServer } from './plugins/mcp.ts';
import type { Runner } from './pipelines/runner.ts';
import { syncPipelines, validationContext } from './pipelines/store.ts';
import { validatePipeline } from './pipelines/validate.ts';
import { browserCall } from './browser/client.ts';
import { writeClipboard } from './clipboard.ts';
import { trustFolder } from './trust.ts';
import { setBoardFlag } from './board.ts';
import { setItemStatus } from './pipelines/panes.ts';
import { sandboxRefusal } from './sandbox/checks.ts';

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
  uiKey: string;
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
      const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
      return { ok: true, pid: process.pid, schema_version: v.user_version };
    },
  });

  m.set('core.stop', { needsUi: true, handler: () => { setTimeout(ctl.stop, 10); return {}; } });

  m.set('project.open', {
    handler: (p) => {
      const input = str(p, 'path');
      let canonical: string;
      try {
        canonical = resolveProjectPath(input);
      } catch {
        throw new RpcError(E.NOT_FOUND, `folder not found: ${input}`);
      }
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
      const requested = str(p, 'approval', false);
      const host = str(p, 'host', false) || (requested === 'isolated' ? 'sandbox' : 'pty');
      if (host !== 'pty' && host !== 'sandbox') throw new RpcError(E.ENGINE_UNAVAILABLE, `host ${host} is not installed`);
      if ((requested === 'isolated') !== (host === 'sandbox')) throw new RpcError(E.VALIDATION, 'isolated runs only on the sandbox host, and the sandbox host only runs isolated');
      const engine = getEngine(db, str(p, 'engine_id'));
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      const check = db
        .prepare('SELECT installed FROM engine_check WHERE engine_id = ? ORDER BY checked_at DESC LIMIT 1')
        .get(engine.id) as { installed: number } | undefined;
      if (check && !check.installed) throw new RpcError(E.ENGINE_UNAVAILABLE, `${engine.id} is not installed`);
      const worktreesRoot = canonicalPath(path.join(homeDir(), 'worktrees')).toLowerCase() + '/';
      const fallback = project.path.toLowerCase().startsWith(worktreesRoot) ? 'contained' : settings().sessions.approval;
      const approval = requested || (fallback !== 'isolated' && (fallback === 'ask' || engine.approval_profiles?.[fallback]) ? fallback : 'ask');
      if (approval !== 'ask' && !engine.approval_profiles?.[approval]) {
        throw new RpcError(E.INVALID_PARAMS, `${engine.id} has no approval profile ${approval}`);
      }
      if (host === 'sandbox') {
        const refusal = sandboxRefusal(engine, project.path);
        if (refusal) throw new RpcError(E.VALIDATION, refusal);
        throw new RpcError(E.ENGINE_UNAVAILABLE, 'the sandbox launch path is not built yet');
      }
      return launchSession(db, {
        approval,
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        engine,
        prompt: str(p, 'prompt', false) || undefined,
        browser: p.browser === true,
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

  m.set('project.clear', {
    handler: (p) => {
      const id = str(p, 'project_id');
      db.prepare("UPDATE session SET hidden = 1 WHERE project_id = ? AND state NOT IN ('starting', 'working', 'waiting_for_you')").run(id);
      db.prepare("UPDATE run SET hidden = 1 WHERE project_id = ? AND status NOT IN ('running', 'paused')").run(id);
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
      markSeen(id);
      db.prepare("UPDATE needs_you SET read_at = ? WHERE ref = ? AND kind IN ('done', 'failed') AND read_at IS NULL").run(nowIso(), id);
      db.prepare("INSERT INTO ui_selection (window_id, session_id, at) VALUES ('main', ?, ?) ON CONFLICT (window_id) DO UPDATE SET session_id = excluded.session_id, at = excluded.at").run(id, nowIso());
      return { focused: true };
    },
  });

  m.set('session.clear-status', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const s = db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined;
      if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (s.state === 'exited') throw new RpcError(E.INVALID_PARAMS, 'the session has exited');
      appendEvent('core.status-cleared', id, {}, db);
      db.prepare("UPDATE session SET state = 'idle', state_at = ? WHERE id = ?").run(nowIso(), id);
      db.prepare('UPDATE needs_you SET read_at = ? WHERE ref = ? AND read_at IS NULL AND resolved_at IS NULL').run(nowIso(), id);
      return {};
    },
  });

  for (const [name, value] of [['needs_you.mark-read', 'now'], ['needs_you.mark-unread', null]] as const) {
    m.set(name, {
      handler: (p) => {
        const r = db.prepare('UPDATE needs_you SET read_at = ? WHERE id = ?').run(value ? nowIso() : null, str(p, 'id'));
        if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'item not found');
        return {};
      },
    });
  }

  const resumedAs = new Map<string, string>();
  m.set('session.resume', {
    handler: (p) => {
      const oldId = str(p, 'session_id');
      const prior = resumedAs.get(oldId);
      const live = prior && db.prepare("SELECT 1 FROM session WHERE id = ? AND state != 'exited'").get(prior);
      if (live) return { session_id: prior, resumed: false, existing: true, notice: 'Already started again; showing that session.' };
      const old = db.prepare('SELECT s.engine_id, s.native_id, s.cwd, s.state, p.id AS project_id, p.path, p.name FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?')
        .get(oldId) as { engine_id: string; native_id: string | null; cwd: string | null; state: string; project_id: string; path: string; name: string } | undefined;
      if (!old) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (old.state !== 'exited') throw new RpcError(E.INVALID_PARAMS, 'the session is still running');
      const engine = getEngine(db, old.engine_id);
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      const resumed = Boolean(engine.resume_args && old.native_id);
      const extraArgs = resumed ? engine.resume_args!.map((a) => a.split('{native_id}').join(old.native_id!)) : [];
      const r = launchSession(db, { projectId: old.project_id, projectPath: old.path, projectName: old.name, engine, cwd: old.cwd ?? old.path, extraArgs });
      resumedAs.set(oldId, r.session_id);
      return { ...r, resumed, ...(resumed ? {} : { notice: 'No saved conversation, starting fresh.' }) };
    },
  });

  m.set('shell.list', { handler: () => ({ shells: availableShells() }) });

  m.set('shell.open', {
    handler: (p) => {
      const kind = str(p, 'kind');
      const shell = availableShells().find((x) => x.kind === kind);
      if (!shell) throw new RpcError(E.ENGINE_UNAVAILABLE, `${kind} is not available on this machine`);
      const project = db.prepare('SELECT path FROM project WHERE id = ?').get(str(p, 'project_id')) as { path: string } | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const id = `sh_${ulid()}`;
      term.open(id, shell.argv, project.path, process.env);
      return { shell_id: id, label: shell.label, cwd: project.path };
    },
  });

  m.set('shell.close', {
    handler: (p) => {
      const id = str(p, 'shell_id');
      if (!id.startsWith('sh_')) throw new RpcError(E.INVALID_PARAMS, 'not a shell tab');
      term.kill(id);
      return {};
    },
  });

  m.set('session.paste-prompt', {
    handler: (p) => {
      const id = str(p, 'session_id');
      if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'session not found');
      return writePrompt(db, id);
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
      if (fs.existsSync(path.join(dir, '.git'))) {
        const trusted = trustFolder(fs.realpathSync.native(dir), ctl.engines());
        return { path: dir.split(String.fromCharCode(92)).join('/'), branch, trusted, existing: true };
      }
      try {
        execFileSync('git', ['-C', project.path, 'worktree', 'add', dir, '-b', branch, base], { stdio: 'pipe', timeout: 60_000 });
      } catch (e) {
        throw new RpcError(E.VALIDATION, `git worktree add failed: ${String((e as { stderr?: Buffer }).stderr ?? e).trim()}`);
      }
      const trusted = trustFolder(fs.realpathSync.native(dir), ctl.engines());
      return { path: dir.split(String.fromCharCode(92)).join('/'), branch, trusted };
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
      const settings = installEngineSettings(ctl.engines());
      return {
        diff: [lineDiff(claude.before, claude.after), codex ? lineDiff(codex.before, codex.after) : '', ...settings.map((s) => lineDiff(s.before, s.after))]
          .filter(Boolean)
          .join('\n'),
      };
    },
  });

  m.set('hooks.uninstall', {
    needsUi: true,
    handler: (p) => {
      const claude = uninstallClaude();
      const codex = p.codex ? uninstallCodex() : null;
      uninstallEngineSettings();
      return { diff: [claude ? lineDiff(claude.before, claude.after) : '', codex ? lineDiff(codex.before, codex.after) : ''].filter(Boolean).join('\n') };
    },
  });

  m.set('gate.resolve', {
    needsUi: true,
    handler: (p) => {
      const gate = db.prepare('SELECT id, run_id, step_id, kind, action_hash, status FROM gate WHERE id = ?').get(str(p, 'gate_id')) as
        | { id: string; run_id: string; step_id: string; kind: string; action_hash: string | null; status: string }
        | undefined;
      if (!gate) throw new RpcError(E.NOT_FOUND, 'gate not found');
      if (gate.status !== 'waiting') throw new RpcError(E.GATE_STALE, `gate is ${gate.status}`);
      if (gate.action_hash && gate.action_hash !== p.action_hash) throw new RpcError(E.GATE_STALE, 'gate is stale: the action changed since approval');
      const decision = str(p, 'decision');
      if (decision !== 'approve' && decision !== 'reject') throw new RpcError(E.INVALID_PARAMS, 'decision must be approve or reject');
      if (decision === 'approve' && gate.kind === 'handoff') ctl.runner.checkContinue(gate.run_id, gate.step_id);
      db.prepare('UPDATE gate SET status = ?, decided_at = ?, note = ? WHERE id = ?')
        .run(decision === 'approve' ? 'approved' : 'rejected', nowIso(), typeof p.note === 'string' ? p.note : null, gate.id);
      db.prepare("UPDATE needs_you SET resolved_at = ? WHERE kind IN ('gate', 'handoff') AND ref = ? AND resolved_at IS NULL").run(nowIso(), gate.id);
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

  m.set('run.item-set', {
    handler: (p) => {
      try {
        setItemStatus(db, str(p, 'run_id'), str(p, 'step_id'), str(p, 'id'), str(p, 'status'));
      } catch (e) {
        throw new RpcError(E.INVALID_PARAMS, (e as Error).message);
      }
      return {};
    },
  });

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

  m.set('pane.open', {
    needsUi: true,
    handler: (p) => {
      const projectId = str(p, 'project_id');
      if (!db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) throw new RpcError(E.NOT_FOUND, 'project not found');
      const sessionId = str(p, 'session_id', false) || null;
      if (sessionId && !db.prepare('SELECT 1 FROM session WHERE id = ? AND project_id = ?').get(sessionId, projectId)) throw new RpcError(E.NOT_FOUND, 'session not found in this project');
      if (p.agent === true && !sessionId) throw new RpcError(E.INVALID_PARAMS, 'agent panes need a session_id');
      const id = p.agent === true ? `bp_agent_${ulid()}` : `bp_${ulid()}`;
      db.prepare('INSERT INTO browser_pane (id, project_id, session_id, url, open) VALUES (?, ?, ?, ?, 1)').run(id, projectId, sessionId, str(p, 'url', false) || null);
      return { pane_id: id };
    },
  });

  m.set('pane.close', {
    needsUi: true,
    handler: (p) => {
      const r = db.prepare('UPDATE browser_pane SET open = 0 WHERE id = ?').run(str(p, 'pane_id'));
      if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'pane not found');
      return {};
    },
  });

  m.set('pane.url', {
    needsUi: true,
    handler: (p) => {
      db.prepare('UPDATE browser_pane SET url = ? WHERE id = ?').run(str(p, 'url'), str(p, 'pane_id'));
      return {};
    },
  });

  m.set('pane.assign', {
    needsUi: true,
    handler: (p) => {
      const pane = db.prepare('SELECT project_id FROM browser_pane WHERE id = ?').get(str(p, 'pane_id')) as { project_id: string } | undefined;
      if (!pane) throw new RpcError(E.NOT_FOUND, 'pane not found');
      const sessionId = str(p, 'session_id', false) || null;
      if (sessionId && !db.prepare('SELECT 1 FROM session WHERE id = ? AND project_id = ?').get(sessionId, pane.project_id)) throw new RpcError(E.NOT_FOUND, 'session not found in this project');
      db.prepare('UPDATE browser_pane SET session_id = ? WHERE id = ?').run(sessionId, str(p, 'pane_id'));
      return {};
    },
  });

  m.set('pane.capture', {
    needsUi: true,
    handler: async (p) => {
      const label = str(p, 'label');
      if (!['before', 'after', 'reference', 'comment'].includes(label)) throw new RpcError(E.INVALID_PARAMS, 'label must be before, after, reference or comment');
      const paneId = str(p, 'pane_id');
      const shot = (await browserCall(ctl.uiKey, 'browser.capture', { pane_id: paneId, label })) as { url: string; w390_path: string; w1280_path: string };
      const id = ulid();
      db.prepare('INSERT INTO snapshot (id, pane_id, label, url, taken_at, w390_path, w1280_path) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, paneId, label, shot.url, nowIso(), shot.w390_path, shot.w1280_path);
      return { snapshot_id: id };
    },
  });

  m.set('board.pin', {
    needsUi: true,
    handler: (p) => {
      setBoardFlag(db, str(p, 'item_id'), 'pinned', p.pinned !== false);
      return {};
    },
  });

  m.set('board.remove', {
    needsUi: true,
    handler: (p) => {
      setBoardFlag(db, str(p, 'item_id'), 'removed', p.removed !== false);
      return {};
    },
  });

  m.set('comment.deliver', {
    handler: (p) => {
      const c = db.prepare('SELECT c.id, c.body, c.session_id, s.engine_id FROM comment c JOIN session s ON s.id = c.session_id WHERE c.id = ?').get(str(p, 'comment_id')) as
        | { id: string; body: string; session_id: string; engine_id: string }
        | undefined;
      if (!c) throw new RpcError(E.NOT_FOUND, 'comment not found');
      const at = writeClipboard(c.body) ? nowIso() : null;
      if (at) db.prepare('UPDATE comment SET clipboard_at = ? WHERE id = ?').run(at, c.id);
      // engines with hooks get the comment from the UserPromptSubmit hook instead
      const typed = getEngine(db, c.engine_id)?.state_source !== 'hooks' && term.paste(c.session_id, c.body);
      return { clipboard_at: at, typed: Boolean(typed) };
    },
  });

  m.set('variant.combine', {
    handler: (p) => {
      const indices = Array.isArray(p.indices) ? p.indices : [];
      if (!indices.length || indices.some((i) => !Number.isInteger(i) || (i as number) < 0)) {
        throw new RpcError(E.INVALID_PARAMS, 'indices must be a list of variant indices');
      }
      return ctl.runner.combine(str(p, 'run_id'), indices as number[], typeof p.note === 'string' ? p.note : '');
    },
  });

  return m;
}
