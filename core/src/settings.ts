import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './paths.ts';

const SANS = "'Segoe UI', system-ui, sans-serif";
const MONO = "'Cascadia Mono', Consolas, monospace";

export const DEFAULTS = {
  terminal: {
    cols: 120,
    rows: 30,
    scrollback: 10_000,
    font_size: 13,
    chunk_bytes: 64 * 1024,
    slow_viewer_bytes: 4 * 1024 * 1024,
    bell_silent_ms: 30_000,
    prompt_wait_ms: 60_000,
    last_line_every_ms: 1000,
    last_line_chars: 200,
    git_every_ms: 10_000,
  },
  ui: {
    theme: 'graphite',
    rail_width: 290,
    split_width: 420,
    toast_ms: 3500,
    error_toast_ms: 7000,
    themes: {
      graphite: {
        label: 'Graphite', scheme: 'dark', bg: '#111316', panel: '#171a1f', panel2: '#1d2127', line: '#2a2f37', text: '#d8dbe0', muted: '#8a919c',
        accent: '#7aa2f7', on_accent: '#0c0e11', ok: '#73c991', warn: '#e0b45c', bad: '#e06c75', grey: '#5c6370', unseen: '#c792ea',
        term_bg: '#0c0e11', term_fg: '#cfd3da', add_bg: '#73c99118', add_fg: '#a9e6bf', del_bg: '#e06c7518', del_fg: '#f0a8ae', font_ui: SANS, font_mono: MONO,
      },
      paper: {
        label: 'Warm paper', scheme: 'light', bg: '#f4f1ea', panel: '#ebe6dc', panel2: '#e0d9cb', line: '#d3cbbb', text: '#2b2620', muted: '#7a7062',
        accent: '#b5562f', on_accent: '#ffffff', ok: '#3f8f5a', warn: '#b07a12', bad: '#b52626', grey: '#9a907f', unseen: '#8a4fbf',
        term_bg: '#faf8f3', term_fg: '#2b2620', add_bg: '#3f8f5a22', add_fg: '#22653a', del_bg: '#b5262622', del_fg: '#8f2020', font_ui: `Georgia, ${SANS}`, font_mono: MONO,
      },
      terminal: {
        label: 'Terminal native', scheme: 'dark', bg: '#000000', panel: '#0a0a0a', panel2: '#161616', line: '#262626', text: '#e6e6e6', muted: '#7d7d7d',
        accent: '#f0a830', on_accent: '#000000', ok: '#8fdc8f', warn: '#f0a830', bad: '#ff7a7a', grey: '#555555', unseen: '#c792ea',
        term_bg: '#000000', term_fg: '#e6e6e6', add_bg: '#2e7d3222', add_fg: '#8fdc8f', del_bg: '#c6282822', del_fg: '#ff9a9a', font_ui: MONO, font_mono: MONO,
      },
      slate: {
        label: 'Soft slate', scheme: 'dark', bg: '#1b1e2b', panel: '#222638', panel2: '#2c3148', line: '#353b55', text: '#e4e6f0', muted: '#9196b0',
        accent: '#a78bfa', on_accent: '#14121f', ok: '#5eead4', warn: '#fbbf24', bad: '#fb7185', grey: '#5d6385', unseen: '#f0abfc',
        term_bg: '#151826', term_fg: '#d6d9e8', add_bg: '#5eead422', add_fg: '#99f6e4', del_bg: '#fb718522', del_fg: '#fda4af', font_ui: `'Segoe UI Variable', ${SANS}`, font_mono: "'Cascadia Code', Consolas, monospace",
      },
      light: {
        label: 'Crisp light', scheme: 'light', bg: '#ffffff', panel: '#f5f6f8', panel2: '#e9ecf1', line: '#dde1e8', text: '#1f2328', muted: '#656d76',
        accent: '#0969da', on_accent: '#ffffff', ok: '#1a7f37', warn: '#9a6700', bad: '#cf222e', grey: '#8c959f', unseen: '#8250df',
        term_bg: '#ffffff', term_fg: '#1f2328', add_bg: '#1a7f3722', add_fg: '#116329', del_bg: '#cf222e22', del_fg: '#a40e26', font_ui: SANS, font_mono: MONO,
      },
    } as Record<string, Record<string, string>>,
  },
};

export type Settings = typeof DEFAULTS;

export function settingsFile(): string {
  return path.join(homeDir(), 'settings.json');
}

let cache: { mtime: number; value: Settings } | null = null;

/** DEFAULTS overlaid with ~/.metatrooper/settings.json; a key of the wrong type keeps its default, new keys are kept. */
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

/** The active theme's values, falling back to the default theme for any missing key. */
export function activeTheme(s = settings()): Record<string, string> {
  const base = DEFAULTS.ui.themes[DEFAULTS.ui.theme];
  return { ...base, ...(s.ui.themes[s.ui.theme] ?? {}), name: s.ui.themes[s.ui.theme] ? s.ui.theme : DEFAULTS.ui.theme };
}

function merge(base: Record<string, unknown>, over: unknown): Record<string, unknown> {
  const o = over && typeof over === 'object' && !Array.isArray(over) ? (over as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v && typeof v === 'object') out[k] = merge(v as Record<string, unknown>, o[k]);
    else out[k] = typeof o[k] === typeof v ? o[k] : v;
  }
  for (const [k, v] of Object.entries(o)) {
    if (!(k in base) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge({}, v);
    else if (!(k in base) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) out[k] = v;
  }
  return out;
}
