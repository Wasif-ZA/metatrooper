import fs from 'node:fs';
import path from 'node:path';
import { logsDir } from './paths.ts';
import { redactSecretValues } from './redact.ts';
import { knownSecretValues } from './secrets.ts';

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

/** Appends to logs/<name>.log, rotating to .1 and .2 at 5 MB so at most three files exist; never throws. */
export function appendLog(name: string, text: string): void {
  try {
    const dir = logsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.log`);
    const line = redactSecretValues(text, knownSecretValues());
    let size = 0;
    try { size = fs.statSync(file).size; } catch {}
    if (size > 0 && size + Buffer.byteLength(line) > LOG_MAX_BYTES) {
      for (let i = KEEP - 1; i >= 1; i--) {
        const from = i === 1 ? file : `${file}.${i - 1}`;
        try { fs.renameSync(from, `${file}.${i}`); } catch {}
      }
    }
    fs.appendFileSync(file, line);
  } catch {}
}

function stamp(text: string): string {
  return text.split(/(?<=\n)/).map((l) => `${new Date().toISOString()} ${l}`).join('');
}

/** Copies this process's stdout and stderr into logs/<name>.log and records uncaught errors there; exits on them unless told not to. */
export function captureProcessLog(name: string, exitOnError = true): void {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      appendLog(name, stamp(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8')));
      try { return write(chunk, ...rest); } catch { return true; }
    }) as typeof stream.write;
  }
  process.on('uncaughtException', (e) => {
    process.stderr.write(`uncaughtException: ${e?.stack ?? String(e)}\n`);
    if (exitOnError) process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    process.stderr.write(`unhandledRejection: ${(e as Error)?.stack ?? String(e)}\n`);
    if (exitOnError) process.exit(1);
  });
}
