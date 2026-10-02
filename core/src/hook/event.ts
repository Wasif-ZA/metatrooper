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
    .prepare('SELECT id, body FROM comment WHERE session_id = ? AND prompt_at IS NULL ORDER BY rowid')
    .all(sessionId) as Array<{ id: string; body: string }>;
  if (rows.length === 0) return;
  const context = 'Comments from the Metatrooper browser:\n\n' + rows.map((r) => r.body).join('\n\n');
  const line = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }) + '\n';
  await new Promise<void>((resolve) => process.stdout.write(line, () => resolve()));
  const { nowIso } = await import('../time.ts');
  const mark = db.prepare('UPDATE comment SET prompt_at = ? WHERE id = ? AND prompt_at IS NULL');
  const at = nowIso();
  for (const r of rows) mark.run(at, r.id);
}

async function main(): Promise<void> {
  const { kind, flags } = parseArgs(process.argv.slice(2));
  if (!kind) return;
  const sessionId = flags.session || process.env.TROOP_SESSION_ID || '';
  if (!sessionId) return;
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
  const db = appendEvent(kind, sessionId, payload);
  if (!db) return;
  try {
    if (kind === 'claude.UserPromptSubmit') await deliverComments(db, sessionId);
  } finally {
    db.close();
  }
}

main().catch(logError).finally(() => process.exit(0));
