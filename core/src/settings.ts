import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './paths.ts';

export const DEFAULTS = {
  terminal: {
    cols: 120,
    rows: 30,
    scrollback: 10_000,
    font_family: 'Cascadia Mono, Consolas, monospace',
    font_size: 13,
    background: '#111111',
    foreground: '#d4d4d4',
    border: '#333333',
    chunk_bytes: 64 * 1024,
    slow_viewer_bytes: 4 * 1024 * 1024,
    bell_silent_ms: 30_000,
    prompt_wait_ms: 60_000,
  },
};

export type Settings = typeof DEFAULTS;

export function settingsFile(): string {
  return path.join(homeDir(), 'settings.json');
}

let cache: { mtime: number; value: Settings } | null = null;

/** DEFAULTS overlaid with ~/.metatrooper/settings.json; a key of the wrong type keeps its default. */
export function settings(): Settings {
  let mtime = -1;
  try { mtime = fs.statSync(settingsFile()).mtimeMs; } catch {}
  if (cache && cache.mtime === mtime) return cache.value;
  let raw: Record<string, unknown> = {};
  if (mtime >= 0) {
    try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
  }
  const value = merge(DEFAULTS, raw) as Settings;
  cache = { mtime, value };
  return value;
}

function merge(base: Record<string, unknown>, over: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const o = over && typeof over === 'object' ? (over as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(base)) {
    if (v && typeof v === 'object') out[k] = merge(v as Record<string, unknown>, o[k]);
    else out[k] = typeof o[k] === typeof v ? o[k] : v;
  }
  return out;
}
