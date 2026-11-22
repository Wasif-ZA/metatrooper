import fs from 'node:fs';
import path from 'node:path';

export type SlashCommand = { name: string; description: string; source: 'project' | 'user' | 'plugin' };

const HEAD_BYTES = 4096;

function head(file: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

function frontmatter(text: string): Record<string, string> {
  const m = /^﻿?---\r?\n([\s\S]*?)(?:\r?\n---|$)/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  lines.forEach((line, i) => {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) return;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) v = (lines.slice(i + 1).find((l) => /^\s+\S/.test(l)) || '').trim();
    out[kv[1].toLowerCase()] = v.replace(/^(["'])(.*)\1$/, '$2');
  });
  return out;
}

const describe = (fm: Record<string, string>) => {
  const d = (fm.description || '').split(/\r?\n/)[0].trim();
  return d.length > 100 ? `${d.slice(0, 99)}…` : d;
};

const entries = (dir: string) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

function scan(root: string, prefix: string, source: SlashCommand['source']): SlashCommand[] {
  const out: SlashCommand[] = [];
  for (const d of entries(path.join(root, 'skills'))) {
    if ((!d.isDirectory() && !d.isSymbolicLink()) || /^[._]/.test(d.name)) continue;
    const text = head(path.join(root, 'skills', d.name, 'SKILL.md'));
    if (!text) continue;
    const fm = frontmatter(text);
    if (/^false$/i.test(fm['user-invocable'] || '')) continue;
    out.push({ name: prefix + (/^[\w:.-]+$/.test(fm.name || '') ? fm.name : d.name), description: describe(fm), source });
  }
  for (const f of entries(path.join(root, 'commands'))) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith('.md') || /^[._]/.test(f.name)) continue;
    out.push({ name: prefix + f.name.slice(0, -3), description: describe(frontmatter(head(path.join(root, 'commands', f.name)))), source });
  }
  return out;
}

const readJson = (file: string): any => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function pluginRoots(home: string): [string, string][] {
  const enabled = readJson(path.join(home, '.claude', 'settings.json'))?.enabledPlugins;
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const list = installed?.plugins ?? installed;
  if (!enabled || typeof enabled !== 'object' || !list || typeof list !== 'object') return [];
  return Object.keys(list).filter((k) => enabled[k] === true).flatMap((k) => {
    const where = Array.isArray(list[k]) ? list[k][0]?.installPath : list[k]?.installPath;
    return typeof where === 'string' ? [[k.split('@')[0], where] as [string, string]] : [];
  });
}

/** Claude's slash commands for a project: project, then user, then enabled plugins; the first of a name wins. */
export function listCommands(home: string, projectRoot: string | null): SlashCommand[] {
  const all = [
    ...(projectRoot ? scan(path.join(projectRoot, '.claude'), '', 'project') : []),
    ...scan(path.join(home, '.claude'), '', 'user'),
    ...pluginRoots(home).flatMap(([name, root]) => scan(root, `${name}:`, 'plugin')),
  ];
  const seen = new Map<string, SlashCommand>();
  for (const c of all) if (!seen.has(c.name.toLowerCase())) seen.set(c.name.toLowerCase(), c);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
