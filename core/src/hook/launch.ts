import { spawn } from 'node:child_process';
import { resolveCommand } from './resolve.ts';

process.removeAllListeners('warning');
process.on('warning', () => {});

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function recordLaunch(sessionId: string, engine: string): Promise<void> {
  try {
    const { buildPayload } = await import('../redact.ts');
    const { appendEvent } = await import('../events/append.ts');
    const { nowIso } = await import('../time.ts');
    const payload = buildPayload('launch', { session_id: sessionId, pid: process.pid, cwd: process.cwd(), engine, started_at: nowIso() });
    appendEvent('launch', sessionId, payload)?.close();
  } catch {}
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const sessionId = a.session || '';
  let argv: unknown = [];
  try {
    argv = JSON.parse(Buffer.from(a['args-b64'] || '', 'base64').toString('utf8'));
  } catch {}
  if (!Array.isArray(argv) || argv.length === 0) {
    console.error('troop launch: no command given');
    process.exit(2);
  }
  const args = argv.map(String);
  process.env.TROOP_SESSION_ID = sessionId;
  await Promise.race([recordLaunch(sessionId, a.engine || ''), new Promise((r) => setTimeout(r, 250))]);
  const resolved = resolveCommand(args[0]);
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const child = resolved
    ? spawn(resolved[0], [...resolved.slice(1), ...args.slice(1)], { stdio: 'inherit', windowsHide: false })
    : spawn([args[0], ...args.slice(1).map(quote)].join(' '), { stdio: 'inherit', shell: true, windowsHide: false });
  process.on('SIGINT', () => {});
  process.on('SIGBREAK', () => {});
  child.on('error', (e) => {
    console.error(`troop launch: could not start ${args[0]}: ${e.message}`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

main();
