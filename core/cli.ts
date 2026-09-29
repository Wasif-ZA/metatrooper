import readline from 'node:readline/promises';
import { installClaude, installCodex, lineDiff, planClaudeInstall, uninstallClaude, uninstallCodex } from './src/hooks/install.ts';
import { call, type CallOutcome } from './src/pipe/client.ts';
import { openReaderDb } from './src/store/db.ts';

process.removeAllListeners('warning');
process.on('warning', () => {});

const USAGE = `usage: troop <command> [--json]

  serve                         run the core service in this terminal
  ping                          check the core is up
  open [path]                   register a project folder (default: current folder)
  launch <engine> [--project <path>] [--prompt <text>]
                                open claude, codex or agy in a new Windows Terminal window
  sessions [--all]              list sessions (hidden ones with --all)
  focus|seen|hide <session>     act on a session by id or id prefix
  engines [--check]             show engine health (--check re-runs the checks)
  stop                          stop the core
  hooks install|uninstall [--codex] [--yes]`;

interface Args {
  pos: string[];
  flags: Set<string>;
  opts: Map<string, string>;
}

const VALUED = new Set(['--project', '--prompt']);

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
    if (!yes && !(await confirm('Apply?'))) {
      console.log('Nothing changed.');
      return 1;
    }
    installClaude();
    if (codex) installCodex();
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
    console.log('Hooks removed.');
    return 0;
  }
  console.error('usage: troop hooks install|uninstall [--codex] [--yes]');
  return 2;
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
      const engine = a.pos[0];
      if (!engine) {
        console.error('usage: troop launch <engine> [--project <path>] [--prompt <text>]');
        return 2;
      }
      const opened = await rpc('project.open', { path: a.opts.get('--project') ?? process.cwd() }, json);
      if (!opened.result) return opened.code || 3;
      const params: Record<string, unknown> = { project_id: opened.result.project_id, engine_id: engine };
      const prompt = a.opts.get('--prompt');
      if (prompt) params.prompt = prompt;
      const r = await rpc('session.launch', params, json);
      if (r.result) emit(r.result, `launched ${engine}: session ${r.result.session_id}`);
      return r.code;
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
