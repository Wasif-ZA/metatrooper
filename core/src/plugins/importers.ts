import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { headerSecretNames, type Manifest, type McpSpec } from './manifest.ts';

export type ImportSource = 'claude-import' | 'codex-import' | 'agy-import';

export type EnvBinding = { kind: 'literal'; value: string } | { kind: 'ref'; name: string };

/** An importer's result. `env` holds literal values in memory only; install moves them into DPAPI. */
export interface ImportPlan {
  source: ImportSource;
  original: string;
  manifest: Manifest;
  env: Record<string, Record<string, EnvBinding>>;
  skills: string[];
  hooks: string[];
  skipped: string[];
  errors: string[];
}

const REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/;
const KEY = /^[A-Z][A-Z0-9_]{0,63}$/;

export function pluginIdFor(prefix: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported';
  return `${prefix}-${slug}`.slice(0, 41).replace(/-+$/, '');
}

function home(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function listSkills(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => path.join(dir, d.name, 'SKILL.md'))
    .sort();
}

function addServers(
  plan: ImportPlan,
  servers: Record<string, unknown>,
  engine: string,
  substitute: (s: string) => string = (s) => s,
): void {
  const perms = new Set(plan.manifest.permissions ?? []);
  const mcp: McpSpec[] = plan.manifest.mcp ?? [];
  for (const [name, raw] of Object.entries(servers)) {
    const s = raw as Record<string, unknown>;
    if ((s?.type === 'http' || s?.type === 'streamable-http') && typeof s.url === 'string') {
      if (!s.url.startsWith('https://')) { plan.errors.push(`MCP server ${name}: ${s.url} is not https, so it is not imported`); continue; }
      const headers: Record<string, string> = {};
      for (const [h, v] of Object.entries((s.headers ?? {}) as Record<string, unknown>)) {
        const names = headerSecretNames(String(v));
        if (!names.length) {
          plan.errors.push(`MCP server ${name}: header ${h} has no \${SECRET} reference, so it is not imported`);
          continue;
        }
        headers[h] = substitute(String(v));
        for (const key of names) perms.add(`secrets:${key}`);
      }
      const id = name.replace(/[^A-Za-z0-9_-]+/g, '-');
      const hasHeaders = Object.keys(headers).length > 0;
      mcp.push({ id, transport: 'http', url: substitute(s.url), ...(hasHeaders ? { headers } : {}), auth: hasHeaders ? 'header' : 'engine-oauth', writes: 'external', engines: [engine] });
      plan.env[id] = {};
      continue;
    }
    if (typeof s?.command !== 'string') {
      plan.skipped.push(`MCP server ${name}: only stdio servers with a command and http servers can be imported`);
      continue;
    }
    const env: Record<string, EnvBinding> = {};
    for (const [key, value] of Object.entries((s.env ?? {}) as Record<string, unknown>)) {
      if (!KEY.test(key)) {
        plan.errors.push(`MCP server ${name}: env key ${key} is not an upper-case name, so it cannot be a secrets permission`);
        continue;
      }
      const text = String(value);
      const ref = REF.exec(text);
      env[key] = ref ? { kind: 'ref', name: ref[1] } : { kind: 'literal', value: text };
      perms.add(`secrets:${key}`);
    }
    const id = name.replace(/[^A-Za-z0-9_-]+/g, '-');
    mcp.push({
      id,
      command: substitute(s.command),
      args: Array.isArray(s.args) ? s.args.map((a) => substitute(String(a))) : [],
      env_keys: Object.keys(env),
      engines: [engine],
    });
    plan.env[id] = env;
  }
  plan.manifest.mcp = mcp;
  plan.manifest.permissions = [...perms];
}

function emptyPlan(source: ImportSource, original: string, id: string, name: string, version: string, description: string): ImportPlan {
  return {
    source,
    original,
    manifest: { schema: 1, id, version, name: name.slice(0, 80), description: description.slice(0, 400), platforms: ['windows', 'linux', 'macos'], permissions: [], mcp: [] },
    env: {},
    skills: [],
    hooks: [],
    skipped: [],
    errors: [],
  };
}

/** Claude Code plugin folder: `.claude-plugin/plugin.json` mcpServers (inline or a file), `.mcp.json`, skills and hooks. */
export function importClaude(dir: string): ImportPlan {
  const root = path.resolve(home(dir));
  const manifestFile = path.join(root, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`no .claude-plugin/plugin.json in ${root}`);
  const pj = readJson(manifestFile);
  const name = typeof pj.name === 'string' ? pj.name : path.basename(root);
  const version = typeof pj.version === 'string' && /^\d+\.\d+\.\d+$/.test(pj.version) ? pj.version : '0.0.0';
  const plan = emptyPlan('claude-import', manifestFile, pluginIdFor('claude', name), name, version, typeof pj.description === 'string' ? pj.description : '');
  const substitute = (s: string) => s.split('${CLAUDE_PLUGIN_ROOT}').join(root.split(String.fromCharCode(92)).join('/'));

  const sources: Array<Record<string, unknown>> = [];
  if (typeof pj.mcpServers === 'string') {
    const f = path.resolve(root, pj.mcpServers);
    if (fs.existsSync(f)) sources.push(((readJson(f).mcpServers ?? readJson(f)) as Record<string, unknown>));
  } else if (pj.mcpServers && typeof pj.mcpServers === 'object') {
    sources.push(pj.mcpServers as Record<string, unknown>);
  }
  const dotMcp = path.join(root, '.mcp.json');
  if (fs.existsSync(dotMcp)) {
    const j = readJson(dotMcp);
    sources.push((j.mcpServers ?? j) as Record<string, unknown>);
  }
  for (const servers of sources) addServers(plan, servers, 'claude', substitute);

  plan.skills = listSkills(path.join(root, 'skills'));
  const hooksFile = path.join(root, 'hooks', 'hooks.json');
  if (pj.hooks || fs.existsSync(hooksFile)) {
    const hooks = (pj.hooks && typeof pj.hooks === 'object' ? pj.hooks : fs.existsSync(hooksFile) ? readJson(hooksFile).hooks ?? {} : {}) as Record<string, unknown>;
    plan.hooks = Object.keys(hooks).map((event) => `${event} hook: not imported; install it through Claude Code itself`);
    if (!plan.hooks.length) plan.hooks.push('hooks: not imported; install them through Claude Code itself');
  }
  return plan;
}

type Toml = Record<string, unknown>;

function parseTomlValue(src: string): [unknown, string] {
  const s = src.trimStart();
  if (s.startsWith('"""') || s.startsWith("'''")) throw new Error('multi-line strings are not supported');
  if (s.startsWith('"')) {
    let out = '';
    let i = 1;
    for (; i < s.length && s[i] !== '"'; i++) {
      if (s[i] === String.fromCharCode(92)) {
        const c = s[++i];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', b: '\b', f: '\f' };
        map[String.fromCharCode(92)] = String.fromCharCode(92);
        if (c === 'u' || c === 'U') {
          const len = c === 'u' ? 4 : 8;
          out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 1 + len), 16));
          i += len;
        } else out += map[c] ?? c;
      } else out += s[i];
    }
    return [out, s.slice(i + 1)];
  }
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    return [s.slice(1, end), s.slice(end + 1)];
  }
  if (s.startsWith('[')) {
    const arr: unknown[] = [];
    let rest = s.slice(1);
    for (;;) {
      rest = rest.replace(/^[\s,]+/, '');
      if (rest.startsWith(']')) return [arr, rest.slice(1)];
      const [v, r] = parseTomlValue(rest);
      arr.push(v);
      rest = r;
    }
  }
  if (s.startsWith('{')) {
    const obj: Toml = {};
    let rest = s.slice(1);
    for (;;) {
      rest = rest.replace(/^[\s,]+/, '');
      if (rest.startsWith('}')) return [obj, rest.slice(1)];
      const km = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=/.exec(rest);
      if (!km) throw new Error(`bad inline table near ${rest.slice(0, 20)}`);
      const [v, r] = parseTomlValue(rest.slice(km[0].length));
      obj[unquote(km[1])] = v;
      rest = r;
    }
  }
  const m = /^(true|false|[+-]?\d[\d_]*(?:\.\d+)?)/.exec(s);
  if (!m) throw new Error(`unsupported value near ${s.slice(0, 20)}`);
  const v = m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1].replace(/_/g, ''));
  return [v, s.slice(m[0].length)];
}

function unquote(k: string): string {
  const t = k.trim();
  if (t.startsWith('"')) return parseTomlValue(t)[0] as string;
  if (t.startsWith("'")) return t.slice(1, -1);
  return t;
}

function splitKey(k: string): string[] {
  return [...k.matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'|[^.\s]+/g)].map((m) => unquote(m[0]));
}

/** Parses the TOML subset Codex config uses: tables, dotted keys, strings, numbers, booleans, arrays, inline tables. */
export function parseToml(text: string): Toml {
  const root: Toml = {};
  let table = root;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n].trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[\s*([^\[\]]+?)\s*\]$/.exec(line);
    if (header) {
      table = root;
      for (const k of splitKey(header[1])) table = (table[k] ??= {}) as Toml;
      continue;
    }
    if (/^\[\[/.test(line)) {
      table = {};
      continue;
    }
    const kv = /^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+|\s)+?)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    let valueText = kv[2];
    while (/^\[/.test(valueText.trim()) && !balanced(valueText) && n + 1 < lines.length) valueText += '\n' + lines[++n];
    let value: unknown;
    try {
      value = parseTomlValue(valueText)[0];
    } catch {
      continue;
    }
    const keys = splitKey(kv[1]);
    let t = table;
    for (const k of keys.slice(0, -1)) t = (t[k] ??= {}) as Toml;
    t[keys[keys.length - 1]] = value;
  }
  return root;
}

function balanced(s: string): boolean {
  let depth = 0;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === String.fromCharCode(92) && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '#') break;
  }
  return depth <= 0;
}

/** Codex `[mcp_servers.<name>]` tables from config.toml; `.agents/skills` in `projectDir` when given. */
export function importCodex(configFile: string, projectDir?: string): ImportPlan {
  const file = path.resolve(home(configFile));
  const toml = parseToml(fs.readFileSync(file, 'utf8'));
  const plan = emptyPlan('codex-import', file, 'codex-mcp', 'Codex MCP servers', '0.0.0', `Imported from ${file}`);
  addServers(plan, (toml.mcp_servers ?? {}) as Record<string, unknown>, 'codex');
  if (projectDir) plan.skills = listSkills(path.join(path.resolve(home(projectDir)), '.agents', 'skills'));
  return plan;
}

export const AGY_MCP_DEFAULT = '~/.gemini/antigravity-cli/mcp_config.json';

/** agy MCP servers from its JSON config (`{"mcpServers": {...}}`); `.agents/skills` in `projectDir` when given. */
export function importAgy(configFile: string = AGY_MCP_DEFAULT, projectDir?: string): ImportPlan {
  const file = path.resolve(home(configFile));
  const json = readJson(file);
  const plan = emptyPlan('agy-import', file, 'agy-mcp', 'agy MCP servers', '0.0.0', `Imported from ${file}`);
  addServers(plan, (json.mcpServers ?? {}) as Record<string, unknown>, 'agy');
  if (projectDir) plan.skills = listSkills(path.join(path.resolve(home(projectDir)), '.agents', 'skills'));
  return plan;
}

/** Parses a `plugin.install` source of the form `<importer>:<path>[;project=<dir>]`. */
export function importFromSource(source: string): ImportPlan | null {
  const m = /^(claude|codex|agy)-import:(.+)$/.exec(source);
  if (!m) return null;
  const [target, ...opts] = m[2].split(';');
  const project = opts.find((o) => o.startsWith('project='))?.slice(8);
  if (m[1] === 'claude') return importClaude(target);
  if (m[1] === 'codex') return importCodex(target, project);
  return importAgy(target, project);
}
