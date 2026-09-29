#!/usr/bin/env node
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import readline from 'node:readline/promises';
import { installClaude, installCodex, installEngineSettings, lineDiff, planClaudeInstall, uninstallClaude, uninstallCodex, uninstallEngineSettings } from './src/hooks/install.ts';
import { loadEngines } from './src/engines/registry.ts';
import { call, type CallOutcome } from './src/pipe/client.ts';
import { openReaderDb } from './src/store/db.ts';
import { isAcuPath, projectId, resolveProjectPath } from './src/project.ts';

process.removeAllListeners('warning');
process.on('warning', () => {});

const USAGE = `usage: troop <command> [--json]

  serve                         run the core service in this terminal
  ping                          check the core is up
  open [path]                   register a project folder (default: current folder)
  launch <engine> [--project <path>] [--worktree <branch>] [--prompt <text>]
                                open claude, codex or agy in a new Windows Terminal window,
                                optionally in a new (or existing) worktree of the project;
                                --approval ask|edits|contained (default: contained on a worktree, else ask)
  launch --jobs <jobs.json>     launch several: [{"engine","worktree","prompt"}, ...]
  sessions [--all]              list sessions (hidden ones with --all)
  focus|seen|hide <session>     act on a session by id or id prefix
  engines [--check]             show engine health (--check re-runs the checks)
  stop                          stop the core
  hooks install|uninstall [--codex] [--yes]
  plugin list                   installed plugins, their source and original file
  plugin install <source> [--yes]
                                show the install screen, then install on approval; <source> is a folder,
                                a git URL, or claude-import:<folder>, codex-import:<config.toml>,
                                agy-import:<mcp_config.json>
  plugin remove <id>            remove a plugin, its engines and its secrets
  plugin secret <id> <NAME>     set a secret the plugin was approved for (value read from the terminal)`;

interface Args {
  pos: string[];
  flags: Set<string>;
  opts: Map<string, string>;
}

const VALUED = new Set(['--project', '--prompt', '--worktree', '--jobs', '--approval']);

function parse(argv: string[]): Args {
  const a: Args = { pos: [], flags: new Set(), opts: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (VALUED.has(s)) a.opts.set(s, argv[++i] ?? '');
    else if (s.startsWith('--')) a.flags.add(s);
    else a.pos.push(s);
  }
  return a;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function hooks(action: string, flags: Set<string>): Promise<number> {
  const codex = flags.has('--codex');
  const yes = flags.has('--yes');
  if (action === 'install') {
    const plan = planClaudeInstall();
    console.log(`Changes to ${plan.file}:\n${lineDiff(plan.before, plan.after) || '(none)'}`);
    if (codex) console.log('The Codex notify setting will be wrapped; a backup is written next to config.toml.');
    for (const e of loadEngines()) if (e.settings) console.log(`${e.id}: sets ${Object.entries(e.settings.set).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')} in ${e.settings.file}`);
    if (!yes && !(await confirm('Apply?'))) {
      console.log('Nothing changed.');
      return 1;
    }
    installClaude();
    if (codex) installCodex();
    installEngineSettings(loadEngines());
    console.log('Hooks installed.');
    return 0;
  }
  if (action === 'uninstall') {
    if (!yes && !(await confirm('Remove the Metatrooper hooks?'))) {
      console.log('Nothing changed.');
      return 1;
    }
    uninstallClaude();
    if (codex) uninstallCodex();
    uninstallEngineSettings();
    console.log('Hooks removed.');
    return 0;
  }
  console.error('usage: troop hooks install|uninstall [--codex] [--yes]');
  return 2;
}

async function secretInput(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  process.stdout.write(question);
  const muted = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await rl.question('');
  rl.close();
  process.stdout.write('\n');
  return answer;
}

function printScreen(screen: Record<string, any>): void {
  const p = screen.plugin;
  console.log(`${p.name} ${p.version} (${p.id})${p.description ? `\n${p.description}` : ''}\n`);
  console.log('Permissions:');
  if (!screen.permissions.length) console.log('  (none)');
  for (const x of screen.permissions) console.log(`  ${x.new ? '[new] ' : ''}${x.permission}: ${x.text}`);
  const section = (title: string, rows: string[]) => {
    if (rows.length) console.log(`\n${title}:\n${rows.map((r) => `  ${r}`).join('\n')}`);
  };
  section('External actions (post, send, deploy or spend; each one stops at a gate)', screen.external_actions.map((a: any) => `${a.id}: ${a.title}, sends to the "${a.destination_field}" input`));
  section('Engines added', screen.engines.map((e: any) => `${e.id}: runs ${e.command}, roles ${e.roles.join(', ')}`));
  section('MCP servers added', screen.mcp_servers.map((m: any) => `${m.id}: ${m.command} (for ${m.engines.join(', ')})`));
  section('Secrets moved into the Windows secret store', screen.secrets_migrated);
  section('Skills referenced by path', screen.skills);
  section('Not imported', [...screen.hooks, ...screen.skipped]);
  console.log('');
  for (const w of screen.warnings) console.log(`Note: ${w}`);
}

async function plugin(a: Args, json: boolean): Promise<number> {
  const [action, target, name] = a.pos;
  if (action === 'list') {
    const rows = withDb((db) => db.prepare('SELECT id, version, source, enabled, path FROM plugin ORDER BY id').all() as Array<Record<string, unknown>>) ?? [];
    for (const r of rows) {
      try {
        const rec = JSON.parse(readFileSync(join(String(r.path), 'import.json'), 'utf8'));
        r.original = rec.original;
      } catch {
        r.original = '';
      }
    }
    if (json) console.log(JSON.stringify(rows));
    else table(rows.map((r) => ({ ...r, enabled: r.enabled ? 'yes' : 'no' })), ['id', 'version', 'source', 'enabled', 'original']);
    return 0;
  }
  if (action === 'install' && target) {
    const source = /^(claude|codex|agy)-import:/.test(target) || /^(https?|ssh|git):\/\/|^git@/.test(target) ? target : resolve(target);
    const pre = await rpc('plugin.preview', { source }, json);
    if (!pre.result) return pre.code;
    const preview = pre.result as Record<string, any>;
    if (!preview.valid) {
      if (json) console.log(JSON.stringify(preview));
      else console.error(`The plugin is invalid:\n${preview.errors.map((e: string) => `  ${e}`).join('\n')}`);
      return 1;
    }
    if (!json) printScreen(preview.screen);
    if (!process.stdin.isTTY) {
      console.error('Installing a plugin needs a person at an interactive terminal.');
      return 1;
    }
    if (!a.flags.has('--yes') && !(await confirm('Approve these permissions and install?'))) {
      console.log('Nothing installed.');
      return 1;
    }
    const secrets: Record<string, string> = {};
    const migrated = new Set<string>(preview.screen.secrets_migrated);
    for (const x of preview.screen.permissions as Array<{ permission: string }>) {
      if (!x.permission.startsWith('secrets:') || migrated.has(x.permission.slice(8))) continue;
      const value = await secretInput(`Value for ${x.permission.slice(8)} (Enter to skip): `);
      if (value) secrets[x.permission.slice(8)] = value;
    }
    const r = await rpc('plugin.install', {
      source,
      approved_permissions: preview.screen.permissions.map((x: { permission: string }) => x.permission),
      manifest_hash: preview.manifest_hash,
      secrets,
    }, json);
    if (r.result) {
      const missing = (r.result.missing_secrets as string[]) ?? [];
      emit(json, r.result, `installed ${r.result.plugin_id}${missing.length ? `; still to set: ${missing.join(', ')} (troop plugin secret ${r.result.plugin_id} <NAME>)` : ''}`);
    }
    return r.code;
  }
  if (action === 'remove' && target) {
    if (!a.flags.has('--yes') && !(await confirm(`Remove ${target}, its engines and its secrets?`))) {
      console.log('Nothing changed.');
      return 1;
    }
    const r = await rpc('plugin.remove', { plugin_id: target }, json);
    if (r.result) emit(json, r.result, `removed ${target}`);
    return r.code;
  }
  if (action === 'secret' && target && name) {
    const value = await secretInput(`Value for ${name}: `);
    if (value === null) {
      console.error('Setting a secret needs an interactive terminal.');
      return 1;
    }
    const r = await rpc('plugin.secret.set', { plugin_id: target, name, value }, json);
    if (r.result) emit(json, r.result, `set ${name} for ${target}`);
    return r.code;
  }
  console.error('usage: troop plugin list | install <source> [--yes] | remove <id> [--yes] | secret <id> <NAME>');
  return 2;
}

function emit(json: boolean, result: unknown, text: string): void {
  console.log(json ? JSON.stringify(result) : text);
}

async function rpc(method: string, params: Record<string, unknown>, json: boolean): Promise<{ code: number; result?: Record<string, unknown> }> {
  const out: CallOutcome = await call(method, params, {
    ui: Boolean(process.stdin.isTTY),
    onQueued: (id) => { if (!json) console.error(`queued (${id}); it runs when the core starts`); },
  });
  if (out.kind === 'offline') {
    if (json) console.log(JSON.stringify({ error: { code: -32099, message: 'core offline' } }));
    else console.error('core offline: start it with `troop serve`');
    return { code: 3 };
  }
  if (out.kind === 'queued') {
    if (json) console.log(JSON.stringify({ queued: out.id }));
    return { code: 0 };
  }
  const r = out.reply;
  if (r.error) {
    if (json) console.log(JSON.stringify({ error: r.error }));
    else console.error(`error ${r.error.code}: ${r.error.message}`);
    return { code: 1 };
  }
  return { code: 0, result: (r.result ?? {}) as Record<string, unknown> };
}

function withDb<T>(fn: (db: NonNullable<ReturnType<typeof openReaderDb>>) => T): T | null {
  const db = openReaderDb();
  if (!db) return null;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function resolveSession(prefix: string): string | null {
  const rows = withDb((db) => db.prepare('SELECT id FROM session WHERE id LIKE ? ORDER BY started_at DESC').all(`${prefix}%`) as Array<{ id: string }>) ?? [];
  if (rows.length === 1) return rows[0].id;
  console.error(rows.length ? `${prefix} matches ${rows.length} sessions; give more of the id` : `no session matches ${prefix}`);
  return null;
}

function table(rows: Array<Record<string, unknown>>, cols: string[]): void {
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i])).join('  ').trimEnd();
  console.log(line(cols));
  for (const r of rows) console.log(line(cols.map((c) => String(r[c] ?? ''))));
}

interface Job {
  engine: string;
  project?: string;
  worktree?: string;
  prompt?: string;
  approval?: string;
}

async function openProject(dir: string, json: boolean): Promise<{ code: number; id?: string }> {
  let canonical: string;
  try {
    canonical = resolveProjectPath(dir);
  } catch {
    canonical = '';
  }
  if (isAcuPath(dir) || isAcuPath(canonical)) {
    console.error('error -32001: ACU projects are not opened in Metatrooper');
    return { code: 1 };
  }
  if (!canonical) {
    console.error(`folder not found: ${dir}`);
    return { code: 1 };
  }
  const opened = await rpc('project.open', { path: dir }, json);
  if (opened.code) return { code: opened.code };
  return { code: 0, id: String(opened.result?.project_id ?? projectId(canonical)) };
}

async function launchOne(job: Job, json: boolean, emit: (result: unknown, text: string) => void): Promise<number> {
  const repo = await openProject(job.project ?? process.cwd(), json);
  if (repo.code) return repo.code;
  let target = repo.id!;
  if (job.worktree) {
    const wt = await rpc('worktree.create', { project_id: repo.id, branch: job.worktree }, json);
    if (wt.code) return wt.code;
    if (!wt.result) {
      console.error('--worktree needs the core running: start it with `troop serve`');
      return 3;
    }
    const opened = await openProject(String(wt.result.path), json);
    if (opened.code) return opened.code;
    target = opened.id!;
  }
  const params: Record<string, unknown> = { project_id: target, engine_id: job.engine };
  if (job.prompt) params.prompt = job.prompt;
  if (job.approval) params.approval = job.approval;
  const r = await rpc('session.launch', params, json);
  if (r.result) emit(r.result, `launched ${job.engine}${job.worktree ? ` on ${job.worktree}` : ''} (approval ${r.result.approval}): session ${r.result.session_id}`);
  return r.code;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parse(rest);
  const json = a.flags.has('--json');
  const emit = (result: unknown, text: string) => console.log(json ? JSON.stringify(result) : text);

  switch (cmd) {
    case 'serve':
      await import('./src/main.ts');
      return -1;

    case 'hooks':
      return hooks(a.pos[0] ?? '', a.flags);

    case 'plugin':
      return plugin(a, json);

    case 'ping': {
      const r = await rpc('core.ping', {}, json);
      if (r.result) emit(r.result, `core up, pid ${r.result.pid}, schema ${r.result.schema_version}`);
      return r.code;
    }

    case 'open': {
      const r = await rpc('project.open', { path: a.pos[0] ?? process.cwd() }, json);
      if (r.result) emit(r.result, String(r.result.project_id));
      return r.code;
    }

    case 'launch': {
      const jobsFile = a.opts.get('--jobs');
      const project = a.opts.get('--project') ?? process.cwd();
      if (jobsFile) {
        let jobs: Job[];
        try {
          jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
          if (!Array.isArray(jobs) || jobs.some((j) => typeof j?.engine !== 'string')) throw new Error('each job needs an engine');
        } catch (e) {
          console.error(`bad jobs file ${jobsFile}: ${(e as Error).message}`);
          return 2;
        }
        let worst = 0;
        for (const job of jobs) worst = Math.max(worst, await launchOne({ project, approval: a.opts.get('--approval'), ...job }, json, emit));
        return worst;
      }
      const engine = a.pos[0];
      if (!engine) {
        console.error('usage: troop launch <engine> [--project <path>] [--worktree <branch>] [--prompt <text>]\n       troop launch --jobs <jobs.json> [--project <path>]');
        return 2;
      }
      return launchOne({ engine, project, worktree: a.opts.get('--worktree'), prompt: a.opts.get('--prompt'), approval: a.opts.get('--approval') }, json, emit);
    }

    case 'sessions': {
      const rows = withDb((db) =>
        db.prepare(
          `SELECT s.id, s.engine_id AS engine, s.state, s.state_at, s.window_name AS window, p.name AS project
           FROM session s JOIN project p ON p.id = s.project_id
           WHERE (? = 1 OR s.hidden = 0) ORDER BY s.started_at DESC`,
        ).all(a.flags.has('--all') ? 1 : 0) as Array<Record<string, unknown>>,
      ) ?? [];
      if (json) console.log(JSON.stringify(rows));
      else table(rows.map((r) => ({ ...r, id: String(r.id).slice(0, 8) })), ['id', 'engine', 'state', 'project', 'window', 'state_at']);
      return 0;
    }

    case 'focus':
    case 'seen':
    case 'hide': {
      if (!a.pos[0]) {
        console.error(`usage: troop ${cmd} <session>`);
        return 2;
      }
      const id = resolveSession(a.pos[0]);
      if (!id) return 1;
      const r = await rpc(`session.${cmd}`, { session_id: id }, json);
      if (r.result) emit(r.result, cmd === 'focus' ? (r.result.focused ? 'focused' : 'window not found') : 'ok');
      return r.code;
    }

    case 'engines': {
      if (a.flags.has('--check')) {
        const r = await rpc('engines.check', {}, json);
        if (r.code) return r.code;
        if (!json) console.error('checks started; results appear here in a few seconds');
      }
      const rows = withDb((db) =>
        db.prepare(
          `SELECT e.id AS engine, c.installed, c.version, c.auth, c.checked_at
           FROM engine e LEFT JOIN engine_check c ON c.engine_id = e.id
             AND c.checked_at = (SELECT MAX(checked_at) FROM engine_check WHERE engine_id = e.id)
           ORDER BY e.cost_rank`,
        ).all() as Array<Record<string, unknown>>,
      ) ?? [];
      if (json) console.log(JSON.stringify(rows));
      else table(rows.map((r) => ({ ...r, installed: r.installed === null ? '?' : r.installed ? 'yes' : 'no' })), ['engine', 'installed', 'version', 'auth', 'checked_at']);
      return 0;
    }

    case 'stop': {
      const r = await rpc('core.stop', {}, json);
      if (r.result) emit(r.result, 'core stopping');
      return r.code;
    }

    default:
      console.error(USAGE);
      return 2;
  }
}

main().then((code) => { if (code >= 0) process.exit(code); });
