import type { DatabaseSync } from 'node:sqlite';

process.removeAllListeners('warning');
process.on('warning', () => {});

const BUDGET_MS = 240;
const started = Date.now();
setTimeout(() => process.exit(0), BUDGET_MS).unref();

interface Parsed {
  kind: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { kind: argv[0] || '', flags: {} };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out.flags[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function readStdin(limitMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const t = setTimeout(() => resolve(data), limitMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

async function logError(err: unknown): Promise<void> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { logsDir } = await import('../paths.ts');
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(path.join(logsDir(), 'event-errors.log'), `${new Date().toISOString()} ${String((err as Error)?.stack ?? err)}\n`);
  } catch {}
}

async function deliverComments(db: DatabaseSync, sessionId: string): Promise<void> {
  const rows = db
    .prepare('SELECT id, kind, body FROM comment WHERE session_id = ? AND prompt_at IS NULL ORDER BY rowid')
    .all(sessionId) as Array<{ id: string; kind: string; body: string }>;
  if (rows.length === 0) return;
  const comments = rows.filter((r) => r.kind !== 'notice');
  const notices = rows.filter((r) => r.kind === 'notice');
  const context = [
    comments.length ? 'Comments from the MetaTrooper browser:\n\n' + comments.map((r) => r.body).join('\n\n') : '',
    notices.length ? 'Notices from MetaTrooper:\n\n' + notices.map((r) => r.body).join('\n\n') : '',
  ].filter(Boolean).join('\n\n');
  const line = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }) + '\n';
  await new Promise<void>((resolve) => process.stdout.write(line, () => resolve()));
  const { nowIso } = await import('../time.ts');
  const mark = db.prepare('UPDATE comment SET prompt_at = ? WHERE id = ? AND prompt_at IS NULL');
  const at = nowIso();
  for (const r of rows) mark.run(at, r.id);
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** Tells the agent, without blocking, that the file it is about to edit holds another live session's uncommitted work. */
async function warnOwner(db: DatabaseSync, sessionId: string, payload: Record<string, unknown>): Promise<void> {
  const file = (payload.tool_input as { file_path?: unknown } | undefined)?.file_path;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  if (typeof file !== 'string' || !EDIT_TOOLS.has(String(payload.tool_name))) return;
  const { otherOwner, labelOf } = await import('../sessions/owners.ts');
  const other = otherOwner(db, sessionId, file, cwd);
  if (!other) return;
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const abs = path.resolve(cwd, file);
  try {
    const left = Math.max(30, BUDGET_MS - (Date.now() - started) - 40);
    if (!execFileSync('git', ['status', '--porcelain', '--', path.basename(abs)], { cwd: path.dirname(abs), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: left, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()) return;
  } catch {
    return;
  }
  const text = `${file} has uncommitted changes from session ${labelOf(db, other.id)}, state ${other.state}. Edit only your own lines; do not reformat or revert the file.`;
  const line = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }) + '\n';
  await new Promise<void>((resolve) => process.stdout.write(line, () => resolve()));
}

async function main(): Promise<void> {
  const { kind, flags } = parseArgs(process.argv.slice(2));
  if (!kind) return;
  let sessionId = flags.session || process.env.TROOP_SESSION_ID || '';
  const outside = !sessionId && kind.startsWith('claude.');
  if (!sessionId && !outside) return;
  let raw: Record<string, unknown> = {};
  if (kind === 'launch') {
    raw = { session_id: sessionId, pid: Number(flags.pid) || null, cwd: flags.cwd || process.cwd(), engine: flags.engine || '' };
  } else {
    const text = await readStdin(Math.max(20, BUDGET_MS - (Date.now() - started) - 120));
    try { raw = text ? JSON.parse(text) : {}; } catch { raw = {}; }
  }
  const { buildPayload } = await import('../redact.ts');
  const { appendEvent } = await import('../events/append.ts');
  const payload = buildPayload(kind, raw);
  if (kind === 'launch') {
    const { nowIso } = await import('../time.ts');
    payload.started_at = nowIso();
  }
  let db: DatabaseSync | null;
  if (outside) {
    if (typeof payload.session_id !== 'string' || typeof payload.cwd !== 'string' || process.env.METATROOPER_SPOOL) return;
    const { openWriterDb } = await import('../events/append.ts');
    db = openWriterDb(200);
    if (!db) return;
    const known = db.prepare("SELECT id FROM session WHERE native_id = ? AND NOT (host = 'external' AND state = 'exited') ORDER BY julianday(started_at) DESC LIMIT 1").get(payload.session_id) as { id: string } | undefined;
    if (!known) {
      const { projectFor } = await import('../sessions/owners.ts');
      if (!projectFor(db.prepare('SELECT id, path FROM project').all() as Array<{ id: string; path: string }>, payload.cwd)) { db.close(); return; }
    }
    appendEvent(kind, null, payload, db);
    sessionId = known?.id ?? '';
  } else {
    db = appendEvent(kind, sessionId, payload);
  }
  if (!db) return;
  try {
    if (sessionId && kind === 'claude.UserPromptSubmit') await deliverComments(db, sessionId);
    if (sessionId && kind === 'claude.PreToolUse') await warnOwner(db, sessionId, payload);
  } finally {
    db.close();
  }
}

main().catch(logError).finally(() => process.exit(0));
