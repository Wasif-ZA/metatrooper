import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';
import { settings } from '../settings.ts';
import { PARENT_SESSION_ENV } from './parent-env.ts';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');

export interface Viewer {
  snapshot(data: string): void;
  output(data: string): void;
  exit(code: number): void;
}

interface Term {
  proc: IPty;
  head: InstanceType<typeof Terminal>;
  ser: InstanceType<typeof SerializeAddon>;
  viewers: Set<Viewer>;
  exitCode: number | null;
  killed: boolean;
  written: number;
  parsed: number;
}

export interface TermHooks {
  onExit?(id: string, code: number, killed: boolean): void;
  onBell?(id: string): void;
  onTitle?(id: string, title: string): void;
  onOutput?(id: string): void;
}

const terms = new Map<string, Term>();
let hooks: TermHooks = {};

export function setTermHooks(h: TermHooks): void {
  hooks = h;
}

export { PARENT_SESSION_ENV };

export function open(id: string, argv: string[], cwd: string, env: Record<string, string | undefined>, cols = settings().terminal.cols, rows = settings().terminal.rows): number {
  if (terms.has(id)) throw new Error(`terminal ${id} already open`);
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !PARENT_SESSION_ENV.has(k.toUpperCase())) cleanEnv[k] = v;
  const proc = pty.spawn(argv[0], argv.slice(1), { name: 'xterm-256color', cols, rows, cwd, env: cleanEnv, useConpty: true });
  const head = new Terminal({ cols, rows, scrollback: settings().terminal.scrollback, allowProposedApi: true });
  const ser = new SerializeAddon();
  head.loadAddon(ser);
  const t: Term = { proc, head, ser, viewers: new Set(), exitCode: null, killed: false, written: 0, parsed: 0 };
  terms.set(id, t);
  head.onBell(() => hooks.onBell?.(id));
  head.onTitleChange((title) => hooks.onTitle?.(id, title.slice(0, 200)));
  proc.onData((data) => {
    const n = ++t.written;
    head.write(data, () => { t.parsed = n; });
    for (const v of t.viewers) v.output(data);
    hooks.onOutput?.(id);
  });
  proc.onExit(({ exitCode }) => {
    t.exitCode = exitCode;
    for (const v of t.viewers) v.exit(exitCode);
    t.viewers.clear();
    hooks.onExit?.(id, exitCode, t.killed);
    // head.write is async; dispose after pending writes flush
    head.write('', () => { head.dispose(); terms.delete(id); });
  });
  return proc.pid;
}

export function has(id: string): boolean {
  const t = terms.get(id);
  return !!t && t.exitCode === null;
}

export function write(id: string, data: string): boolean {
  const t = terms.get(id);
  if (!t || t.exitCode !== null) return false;
  t.proc.write(data);
  return true;
}

/** Last non-empty row of the headless terminal once pending output is parsed, trimmed to `max` characters. */
export function lastLine(id: string, max: number): Promise<string | null> {
  const t = terms.get(id);
  if (!t) return Promise.resolve(null);
  return new Promise((resolve) => t.head.write('', () => {
    const b = t.head.buffer.active;
    for (let i = b.length - 1; i >= 0; i--) {
      const line = b.getLine(i)?.translateToString(true).trim();
      if (line) return resolve(line.slice(0, max));
    }
    resolve(null);
  }));
}

export function bracketedPaste(id: string): boolean {
  const t = terms.get(id);
  return !!t && t.head.modes.bracketedPasteMode;
}

/** Writes text as one paste: wrapped in bracketed-paste markers when the program turned that mode on. */
export function paste(id: string, text: string): boolean {
  return write(id, bracketedPaste(id) ? `\x1b[200~${text}\x1b[201~` : text);
}

export function resize(id: string, cols: number, rows: number): void {
  const t = terms.get(id);
  if (!t || t.exitCode !== null) return;
  cols = Math.max(2, Math.min(1000, Math.floor(cols)));
  rows = Math.max(1, Math.min(500, Math.floor(rows)));
  t.proc.resize(cols, rows);
  t.head.resize(cols, rows);
}

export function kill(id: string): void {
  const t = terms.get(id);
  if (!t || t.exitCode !== null) return;
  t.killed = true;
  try { t.proc.kill(); } catch {}
}

/** Waits for pending writes to reach the headless terminal, then serializes it. */
export function snapshot(id: string): Promise<string | null> {
  const t = terms.get(id);
  if (!t) return Promise.resolve(null);
  return new Promise((resolve) => t.head.write('', () => resolve(t.ser.serialize())));
}

/** Snapshot, then only the chunks the snapshot does not hold, so a viewer sees no gap and no repeat. */
export function attach(id: string, viewer: Viewer): boolean {
  const t = terms.get(id);
  if (!t || t.exitCode !== null) return false;
  const pending: Array<[number, string]> = [];
  let exited: number | null = null;
  const buffering: Viewer = {
    snapshot: () => {},
    output: (data) => pending.push([t.written, data]),
    exit: (code) => { exited = code; },
  };
  t.viewers.add(buffering);
  t.head.write('', () => {
    t.viewers.delete(buffering);
    viewer.snapshot(t.ser.serialize());
    for (const [n, data] of pending) if (n > t.parsed) viewer.output(data);
    if (exited !== null) viewer.exit(exited);
    else if (t.exitCode === null) t.viewers.add(viewer);
  });
  return true;
}

export function detach(id: string, viewer: Viewer): void {
  terms.get(id)?.viewers.delete(viewer);
}

export function killAll(): void {
  for (const id of terms.keys()) kill(id);
}
