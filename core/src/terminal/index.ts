import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { IPty } from 'node-pty';
import { homeDir } from '../paths.ts';
import { settings } from '../settings.ts';
import { PARENT_SESSION_ENV } from './parent-env.ts';
import { windowsBuild } from './windows-build.ts';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');

export const PAUSE_BYTES = 1024 * 1024;
export const RESUME_BYTES = 256 * 1024;

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
  attaching: Set<Viewer>;
  exitCode: number | null;
  killed: boolean;
  written: number;
  parsed: number;
  behind: number;
  paused: boolean;
  at: number;
}

export interface TermHooks {
  onExit?(id: string, code: number, killed: boolean): void;
  onBell?(id: string): void;
  onTitle?(id: string, title: string): void;
  onOutput?(id: string, data: string): void;
}

const terms = new Map<string, Term>();
const exitCodes = new Map<string, number>();
let hooks: TermHooks = {};

/** The exit code of a terminal that has exited, kept after the terminal itself is gone. */
export function exitCodeOf(id: string): number | undefined {
  return exitCodes.get(id);
}

export function setTermHooks(h: TermHooks): void {
  hooks = h;
}

export { PARENT_SESSION_ENV };

export function open(id: string, argv: string[], cwd: string, env: Record<string, string | undefined>, cols = settings().terminal.cols, rows = settings().terminal.rows): number {
  if (terms.has(id)) throw new Error(`terminal ${id} already open`);
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !PARENT_SESSION_ENV.has(k.toUpperCase())) cleanEnv[k] = v;
  const proc = pty.spawn(argv[0], argv.slice(1), { name: 'xterm-256color', cols, rows, cwd, env: cleanEnv, useConpty: true });
  const build = windowsBuild();
  const head = new Terminal({ cols, rows, scrollback: settings().terminal.scrollback, allowProposedApi: true, ...(build ? { windowsPty: { backend: 'conpty' as const, buildNumber: build } } : {}) });
  const ser = new SerializeAddon();
  head.loadAddon(ser);
  const t: Term = { proc, head, ser, viewers: new Set(), attaching: new Set(), exitCode: null, killed: false, written: 0, parsed: 0, behind: 0, paused: false, at: 0 };
  terms.set(id, t);
  head.onBell(() => hooks.onBell?.(id));
  head.onTitleChange((title) => hooks.onTitle?.(id, title.slice(0, 200)));
  head.onData((reply) => { if (t.viewers.size === 0 && t.exitCode === null) t.proc.write(reply); });
  proc.onData((data) => {
    const n = ++t.written;
    t.at = Date.now();
    t.behind += data.length;
    if (!t.paused && t.behind > PAUSE_BYTES) { t.paused = true; t.proc.pause(); }
    head.write(data, () => {
      t.parsed = n;
      t.behind -= data.length;
      if (t.paused && t.behind < RESUME_BYTES && t.exitCode === null) { t.paused = false; t.proc.resume(); }
    });
    for (const v of t.viewers) v.output(data);
    hooks.onOutput?.(id, data);
  });
  proc.onExit(({ exitCode }) => {
    t.exitCode = exitCode;
    exitCodes.set(id, exitCode);
    if (!t.killed) releasePty(proc);
    for (const v of t.viewers) v.exit(exitCode);
    t.viewers.clear();
    hooks.onExit?.(id, exitCode, t.killed);
    // head.write is async; save the last screen and dispose after pending writes flush
    head.write('', () => { saveScreen(id, t); head.dispose(); terms.delete(id); });
  });
  return proc.pid;
}

/** Frees the conout worker and pipes that node-pty 1.1 on Windows frees only in kill(); without this an exited process leaves them and its conhost.exe running. */
function releasePty(proc: IPty): void {
  const agent = (proc as unknown as { _agent?: { _conoutSocketWorker?: { dispose(): void }; _inSocket?: { destroy(): void }; _outSocket?: { destroy(): void } } })._agent;
  try {
    agent?._conoutSocketWorker?.dispose();
    agent?._inSocket?.destroy();
    agent?._outSocket?.destroy();
  } catch {}
}

/** Whether the pty is paused because the headless terminal is more than PAUSE_BYTES behind. */
export function paused(id: string): boolean {
  return terms.get(id)?.paused ?? false;
}

/** The pid of the process the terminal started, while the terminal is open. */
export function ptyPid(id: string): number | null {
  return terms.get(id)?.proc.pid ?? null;
}

/** Whether any terminal is open. */
export function anyOpen(): boolean {
  return terms.size > 0;
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

/** Last non-empty line of the headless terminal (wrapped rows joined) once pending output is parsed, trimmed to `max` characters. */
export function lastLine(id: string, max: number): Promise<string | null> {
  const t = terms.get(id);
  if (!t) return Promise.resolve(null);
  return new Promise((resolve) => t.head.write('', () => {
    const b = t.head.buffer.active;
    for (let i = b.length - 1; i >= 0; i--) {
      let line = b.getLine(i)?.translateToString(true) ?? '';
      if (!line.trim()) continue;
      while (i > 0 && b.getLine(i)?.isWrapped) line = (b.getLine(--i)?.translateToString(true) ?? '') + line;
      return resolve(line.trim().slice(0, max));
    }
    resolve(null);
  }));
}

export interface Hit { session_id: string; line: number; text: string }

/** Lines (wrapped rows joined) of every live terminal, or only those in `only`, that contain `query`, ignoring case; most recent terminal and line first. */
export async function search(query: string, max: number, only?: Set<string>): Promise<Hit[]> {
  const q = query.toLowerCase();
  const live = [...terms].filter(([id, t]) => t.exitCode === null && (!only || only.has(id))).sort(([, a], [, b]) => b.at - a.at);
  await Promise.all(live.map(([, t]) => new Promise<void>((r) => t.head.write('', r))));
  const hits: Hit[] = [];
  for (const [id, t] of live) {
    const b = t.head.buffer.active;
    for (let i = b.length - 1; i >= 0 && hits.length < max; i--) {
      let line = b.getLine(i)?.translateToString(true) ?? '';
      while (i > 0 && b.getLine(i)?.isWrapped) line = (b.getLine(--i)?.translateToString(true) ?? '') + line;
      if (!line.toLowerCase().includes(q)) continue;
      // 300 characters around the match, so a match late in a long line still shows in the preview
      const text = line.trim();
      // lowercase one character at a time and keep where each came from, since some (like İ) grow when lowercased and would shift the window off the match
      let low = '';
      const at: number[] = [];
      let j = 0;
      for (const ch of text) {
        const l = ch.toLowerCase();
        low += l;
        for (let k = 0; k < l.length; k++) at.push(j);
        j += ch.length;
      }
      const k = low.indexOf(q);
      const from = Math.max(0, Math.min((k < 0 ? 0 : at[k]) - 100, text.length - 300));
      hits.push({ session_id: id, line: i, text: text.slice(from, from + 300) });
    }
  }
  return hits;
}

const typed = new Map<string, number>();
// Focus, device and cursor reports, arrow keys and a bare Escape; a bracketed paste carries text, so it does not match.
const NOT_TYPING = /^(?:\x1b(?:\[[\d;?>]*[A-Za-z~]|O[A-Za-z])?)+$/;

/** Notes when the user last typed into a terminal from the workbench, held in memory only. ponytail: an Up-arrow history recall is not counted as a draft. */
export function noteTyped(id: string, data: string): void {
  if (!NOT_TYPING.test(data)) typed.set(id, Date.now());
}

/** Epoch ms of the user's last typing into the terminal, 0 when none since the core started. */
export function typedAt(id: string): number {
  return typed.get(id) ?? 0;
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
  if (!t || t.exitCode !== null || t.killed) return;
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
  t.attaching.add(viewer);
  t.head.write('', () => {
    t.viewers.delete(buffering);
    if (!t.attaching.delete(viewer)) return;
    viewer.snapshot(t.ser.serialize());
    for (const [n, data] of pending) if (n > t.parsed) viewer.output(data);
    if (exited !== null) viewer.exit(exited);
    else if (t.exitCode === null) t.viewers.add(viewer);
  });
  return true;
}

export function detach(id: string, viewer: Viewer): void {
  const t = terms.get(id);
  t?.viewers.delete(viewer);
  t?.attaching.delete(viewer);
}

export function killAll(): void {
  for (const id of terms.keys()) kill(id);
}

export const SCREEN_ROWS = 200;

export interface SavedScreen { code: number | null; screen: string; text: string }

export function screensDir(): string {
  return path.join(homeDir(), 'screens');
}

const screenFile = (id: string) => path.join(screensDir(), `${id.replace(/[^\w-]/g, '_')}.json`);

/** The last SCREEN_ROWS rows of the headless terminal as plain text. */
function textOf(t: Term): string {
  const b = t.head.buffer.active;
  const rows: string[] = [];
  for (let i = Math.max(0, b.length - SCREEN_ROWS); i < b.length; i++) rows.push(b.getLine(i)?.translateToString(true) ?? '');
  return rows.join('\n').replace(/\s+$/, '');
}

/** Writes the terminal's last SCREEN_ROWS rows, serialized and as plain text, to screens/<id>.json. */
function saveScreen(id: string, t: Term): void {
  try {
    const saved: SavedScreen = { code: t.exitCode, screen: t.ser.serialize({ scrollback: Math.max(0, SCREEN_ROWS - t.head.rows) }), text: textOf(t) };
    fs.mkdirSync(screensDir(), { recursive: true });
    fs.writeFileSync(screenFile(id), JSON.stringify(saved));
  } catch {}
}

/** The screen saved when the session's terminal ended, or null. */
export function savedScreen(id: string): SavedScreen | null {
  try { return JSON.parse(fs.readFileSync(screenFile(id), 'utf8')) as SavedScreen; } catch { return null; }
}

/** Plain text of the last SCREEN_ROWS rows: from the live terminal once pending output is parsed, else from the saved screen. */
export function screenText(id: string): Promise<string | null> {
  const t = terms.get(id);
  if (!t) return Promise.resolve(savedScreen(id)?.text ?? null);
  return new Promise((resolve) => t.head.write('', () => resolve(textOf(t))));
}

/** Saves the screen of every open terminal, for a core that is about to stop. */
export async function saveAllScreens(): Promise<void> {
  await Promise.all([...terms].map(([id, t]) => new Promise<void>((resolve) => t.head.write('', () => { saveScreen(id, t); resolve(); }))));
}

/** Deletes saved screens older than `days`. */
export function pruneScreens(days = 30, now = Date.now()): void {
  try {
    for (const name of fs.readdirSync(screensDir())) {
      const file = path.join(screensDir(), name);
      if (now - fs.statSync(file).mtimeMs > days * 86_400_000) fs.rmSync(file, { force: true });
    }
  } catch {}
}
