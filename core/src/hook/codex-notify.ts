import { spawn } from 'node:child_process';

process.removeAllListeners('warning');
process.on('warning', () => {});
setTimeout(() => process.exit(0), 240).unref();

function forwardToPrevious(previous: unknown, notification: string): void {
  if (!Array.isArray(previous) || previous.length === 0) return;
  try {
    const [cmd, ...args] = previous.map(String);
    const child = spawn(cmd, [...args, notification], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) return;
  const notification = argv[argv.length - 1];
  let previous: unknown = [];
  if (argv.length >= 2) {
    try { previous = JSON.parse(argv[0]); } catch {}
  }
  forwardToPrevious(previous, notification);
  const sessionId = process.env.TROOP_SESSION_ID;
  if (!sessionId) return;
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(notification); } catch { return; }
  const { buildPayload } = await import('../redact.ts');
  const { appendEvent } = await import('../events/append.ts');
  appendEvent('codex.turn', sessionId, buildPayload('codex.turn', raw))?.close();
}

main().catch(() => {}).finally(() => process.exit(0));
