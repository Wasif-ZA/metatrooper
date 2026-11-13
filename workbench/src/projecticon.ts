import fs from 'node:fs';
import path from 'node:path';

// From t3code (MIT), apps/web/src/projectIconColors.ts: the colour names a project icon can take (hex here, no Tailwind).
export const PROJECT_COLOURS: Record<string, string> = {
  gray: '#9ca3af', red: '#f87171', orange: '#fb923c', amber: '#fbbf24', yellow: '#facc15', lime: '#a3e635',
  green: '#4ade80', emerald: '#34d399', teal: '#2dd4bf', cyan: '#22d3ee', sky: '#38bdf8', blue: '#60a5fa',
  indigo: '#818cf8', violet: '#a78bfa', purple: '#c084fc', fuchsia: '#e879f9', pink: '#f472b6', rose: '#fb7185',
};

/** The pickable line icons; the names follow the repo icon picker in Orca (MIT), mobile/src/components/MobileRepoIcon.tsx. */
export const PICK_ICONS = ['folder', 'code', 'terminal', 'bot', 'package', 'database', 'globe', 'server', 'layers', 'box', 'braces', 'briefcase', 'building', 'cpu', 'gauge', 'palette', 'rocket', 'shapes', 'sparkles', 'wrench'] as const;

export type ProjectIcon =
  | { kind: 'image'; src: string; file: string }
  | { kind: 'monogram'; text: string; colour: string }
  | { kind: 'emoji'; emoji: string }
  | { kind: 'icon'; name: string; colour: string };

export type IconOverride = Exclude<ProjectIcon, { kind: 'image' }>;

// Where repos keep their favicon or logo, most specific first.
const CANDIDATES = [
  'favicon.svg', 'favicon.png', 'favicon.ico',
  'public/favicon.svg', 'public/favicon.png', 'public/favicon.ico', 'static/favicon.svg', 'static/favicon.png', 'static/favicon.ico',
  'app/favicon.ico', 'src/app/favicon.ico', 'src/app/icon.svg', 'src/app/icon.png', 'app/icon.svg', 'app/icon.png',
  'assets/favicon.svg', 'assets/favicon.png', 'assets/logo.svg', 'assets/logo.png', 'public/logo.svg', 'public/logo.png',
  'logo.svg', 'logo.png', 'icon.svg', 'icon.png', '.github/logo.svg', '.github/logo.png',
];
const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const MAX_BYTES = 256 * 1024;
const RECHECK_MS = 60_000;
const found = new Map<string, { at: number; icon: Extract<ProjectIcon, { kind: 'image' }> | null }>();

/** The repo's own favicon or logo as a data URL, read from disk only; cached per folder for a minute. */
export function findFavicon(dir: string, now = Date.now()): Extract<ProjectIcon, { kind: 'image' }> | null {
  const hit = found.get(dir);
  if (hit && now - hit.at < RECHECK_MS) return hit.icon;
  let icon: Extract<ProjectIcon, { kind: 'image' }> | null = null;
  for (const rel of CANDIDATES) {
    const file = path.join(dir, rel);
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) continue;
      icon = { kind: 'image', src: `data:${MIME[path.extname(rel)]};base64,${fs.readFileSync(file).toString('base64')}`, file: rel };
      break;
    } catch {}
  }
  found.set(dir, { at: now, icon });
  if (found.size > 200) found.delete(found.keys().next().value as string);
  return icon;
}

/** Override first, then the repo's favicon or logo, else null (the UI draws its plain folder icon). */
export function resolveProjectIcon(p: { path: string; name: string }, override?: IconOverride | null): ProjectIcon | null {
  return override || findFavicon(p.path);
}

/** Validates an override from the UI; null clears it. Throws on anything else. */
export function checkOverride(v: unknown): IconOverride | null {
  if (v === null) return null;
  const o = v as Record<string, unknown>;
  const colour = (c: unknown) => { if (typeof c !== 'string' || !(c in PROJECT_COLOURS)) throw new Error('unknown colour'); return c; };
  if (o?.kind === 'monogram' && typeof o.text === 'string' && Array.from(o.text.trim()).length >= 1 && Array.from(o.text.trim()).length <= 2) return { kind: 'monogram', text: o.text.trim().toUpperCase(), colour: colour(o.colour) };
  if (o?.kind === 'emoji' && typeof o.emoji === 'string' && o.emoji.length > 0 && o.emoji.length <= 16 && !/[<>&"']/.test(o.emoji)) return { kind: 'emoji', emoji: o.emoji };
  if (o?.kind === 'icon' && typeof o.name === 'string' && (PICK_ICONS as readonly string[]).includes(o.name)) return { kind: 'icon', name: o.name, colour: colour(o.colour) };
  throw new Error('icon must be a monogram (1-2 letters), an emoji, or a listed icon with a colour');
}

/** Per-project overrides, kept in <home>/project-icons.json. */
export function readOverrides(file: string): Record<string, IconOverride> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, IconOverride>; } catch { return {}; }
}

export function writeOverride(file: string, projectId: string, icon: IconOverride | null): void {
  const all = readOverrides(file);
  if (icon) all[projectId] = icon; else delete all[projectId];
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, file);
}
