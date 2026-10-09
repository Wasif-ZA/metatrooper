import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { homeDir } from '../paths.ts';
import { headerSecretNames, insideDir, type Manifest, type McpSpec } from './manifest.ts';

export type ImportSource = 'claude-import' | 'codex-import' | 'agy-import' | 'marketplace-import' | 'registry-import';

/** Where a catalogue import came from; an update is a re-import of the same name. */
export interface ImportOrigin {
  kind: 'registry' | 'marketplace';
  name: string;
  version: string;
  sha: string;
}

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
  origin?: ImportOrigin;
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

const SHA = /^[0-9a-fA-F]{40}$/;

function git(args: string[], cwd?: string, local = false): string {
  return execFileSync('git', ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...(local ? ['-c', 'protocol.file.allow=always'] : []), ...args], { cwd, stdio: 'pipe', timeout: 120_000, windowsHide: true }).toString().trim();
}

function httpsOnly(url: string, what: string): string {
  if (!/^https:\/\/[^\s/]+\//.test(url)) throw new Error(`${what}: only https git URLs are imported, not ${url}`);
  return url;
}

/** `dir` when its real path stays inside `root` after following symlinks, else null. */
function realInside(root: string, dir: string | null): string | null {
  if (!dir || !fs.existsSync(dir)) return dir;
  const r = fs.realpathSync(root), d = fs.realpathSync(dir);
  return d === r || d.startsWith(r + path.sep) ? dir : null;
}

/** Fetches `url` at exactly `sha` into `~/.metatrooper/plugins/.sources/<sha>`, reused when already there. */
function checkoutAt(url: string, sha: string, local = false): string {
  const dir = path.join(homeDir(), 'plugins', '.sources', sha);
  if (fs.existsSync(path.join(dir, '.git')) && git(['rev-parse', 'HEAD'], dir) === sha) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    git(['init', '-q'], dir);
    git(['fetch', '-q', '--depth', '1', '--', url, sha], dir, local);
    git(['checkout', '-q', '--detach', 'FETCH_HEAD'], dir);
    if (git(['rev-parse', 'HEAD'], dir) !== sha) throw new Error('checked out the wrong commit');
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`git fetch of ${url} at ${sha} failed: ${String((e as { stderr?: Buffer }).stderr ?? (e as Error).message).trim()}`);
  }
  return dir;
}

/** `<owner/repo | git url | local folder>[#<plugin>]`: reads `.claude-plugin/marketplace.json`, fetches the plugin at its listed sha, then runs the Claude importer. */
export function importMarketplace(spec: string): ImportPlan {
  const [repo, want] = spec.split('#');
  const local = path.resolve(home(repo));
  let root = local;
  let sha = '';
  let localMarketplace = false;
  if (fs.existsSync(path.join(local, '.claude-plugin', 'marketplace.json'))) {
    try { sha = git(['rev-parse', 'HEAD'], local); } catch { throw new Error(`${local} is not a git repository, so nothing pins what would be imported`); }
    localMarketplace = true;
    if (git(['status', '--porcelain'], local)) throw new Error(`${local} has uncommitted changes; commit them so the import is pinned to ${sha.slice(0, 12)}`);
  } else {
    const url = httpsOnly(/^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo, 'marketplace');
    sha = git(['ls-remote', '--', url, 'HEAD']).split(/\s/)[0].toLowerCase();
    if (!SHA.test(sha)) throw new Error(`no HEAD commit at ${url}`);
    root = checkoutAt(url, sha);
  }
  const listed = readJson(path.join(root, '.claude-plugin', 'marketplace.json'));
  const plugins = (Array.isArray(listed.plugins) ? listed.plugins : []) as Array<Record<string, unknown>>;
  const names = plugins.map((p) => String(p.name)).join(', ');
  const entry = want ? plugins.find((p) => p.name === want) : plugins.length === 1 ? plugins[0] : undefined;
  if (!entry) throw new Error(want ? `${repo} has no plugin ${want}; it lists: ${names}` : `${repo} lists ${plugins.length} plugins, pick one with #<name>: ${names}`);
  const name = String(entry.name);
  let dir: string | null;
  if (typeof entry.source === 'string') {
    dir = /^\.\/?$/.test(entry.source) ? root : insideDir(root, entry.source);
  } else {
    const s = (entry.source ?? {}) as Record<string, unknown>;
    const url = s.source === 'github' && typeof s.repo === 'string' ? `https://github.com/${s.repo}.git` : (s.source === 'url' || s.source === 'git-subdir') && typeof s.url === 'string' ? s.url : '';
    if (!url) throw new Error(`plugin ${name}: source ${String(s.source)} is not supported`);
    if (typeof s.sha !== 'string' || !SHA.test(s.sha)) throw new Error(`plugin ${name}: no pinned sha listed, so it is not imported`);
    sha = s.sha.toLowerCase();
    const isLocal = localMarketplace && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && path.isAbsolute(url);
    const checkout = isLocal ? checkoutAt(path.resolve(url), sha, true) : checkoutAt(httpsOnly(url, `plugin ${name}`), sha);
    dir = realInside(checkout, s.source === 'git-subdir' ? insideDir(checkout, String(s.path ?? '')) : checkout);
  }
  if (typeof entry.source === 'string') dir = realInside(root, dir);
  if (!dir) throw new Error(`plugin ${name}: source path leaves the repository`);
  const plan = importClaude(dir);
  plan.source = 'marketplace-import';
  plan.origin = { kind: 'marketplace', name: `${repo}#${name}`, version: typeof entry.version === 'string' ? entry.version : plan.manifest.version, sha };
  return plan;
}

export const REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';

function fetchText(url: string): string {
  const script = 'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); process.stdout.write(await r.text()); })';
  return execFileSync(process.execPath, ['-e', script, url], { stdio: 'pipe', timeout: 60_000, windowsHide: true }).toString();
}

function onPath(cmd: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  return (process.env.PATH ?? '').split(path.delimiter).some((d) => d && exts.some((e) => fs.existsSync(path.join(d, cmd + e))));
}

function envName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+/, '');
}

/** MCP registry `<name>`: the exact-name match from a `search` query, or from a saved response in `file`. */
export function importRegistry(name: string, file?: string): ImportPlan {
  const url = `${REGISTRY_URL}?search=${encodeURIComponent(name)}&version=latest`;
  const text = file ? fs.readFileSync(path.resolve(home(file)), 'utf8') : fetchText(url);
  const rows = ((JSON.parse(text) as { servers?: Array<{ server: Record<string, unknown> }> }).servers ?? []).map((r) => r.server);
  const server = rows.find((s) => s.name === name);
  if (!server) throw new Error(`no registry server named ${name}${rows.length ? `; close matches: ${rows.map((s) => s.name).join(', ')}` : ''}`);
  return mapRegistryServer(server, file ? path.resolve(home(file)) : url);
}

/** Maps one registry `server.json`: pinned npm, pypi and oci stdio packages, and streamable-http remotes. */
export function mapRegistryServer(server: Record<string, unknown>, original: string): ImportPlan {
  const name = String(server.name);
  const version = String(server.version ?? '');
  const title = typeof server.title === 'string' ? server.title : name;
  const plan = emptyPlan('registry-import', original, pluginIdFor('registry', name), title, /^\d+\.\d+\.\d+$/.test(version) ? version : '0.0.0', typeof server.description === 'string' ? server.description : '');
  plan.origin = { kind: 'registry', name, version, sha: '' };
  const perms = new Set<string>();
  const mcp: McpSpec[] = [];
  const uid = (base: string) => {
    let id = base;
    for (let n = 2; mcp.some((s) => s.id === id); n++) id = `${base}-${n}`;
    return id;
  };

  for (const pkg of (server.packages ?? []) as Array<Record<string, unknown>>) {
    const type = String(pkg.registryType);
    const ident = String(pkg.identifier);
    const v = String(pkg.version ?? version);
    const transport = (pkg.transport as { type?: string } | undefined)?.type ?? 'stdio';
    if (!['npm', 'pypi', 'oci'].includes(type)) { plan.skipped.push(`${type} package ${ident}: skipped, ${type === 'mcpb' ? 'bundled binaries run unsigned native code' : 'not a supported package type'}`); continue; }
    if (transport !== 'stdio') { plan.skipped.push(`${type} package ${ident}: ${transport} transport is not imported`); continue; }
    if (!/^[@\w][\w@./:+-]*$/.test(ident)) { plan.errors.push(`${type} package ${ident}: not a package name`); continue; }
    if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v) || ident.endsWith(':latest')) { plan.skipped.push(`${type} package ${ident}: no exact version, so it is not imported`); continue; }
    if (type === 'oci' && !onPath('docker')) { plan.skipped.push(`oci package ${ident}: Docker is not on PATH`); continue; }
    const envKeys: string[] = [];
    const env: Record<string, string> = {};
    let bad = false;
    for (const e of (pkg.environmentVariables ?? []) as Array<Record<string, unknown>>) {
      const key = String(e.name);
      if (!KEY.test(key)) { plan.errors.push(`${type} package ${ident}: env key ${key} is not an upper-case name`); bad = true; continue; }
      if (e.isSecret || (e.isRequired && e.default === undefined)) { envKeys.push(key); perms.add(`secrets:${key}`); }
      else if (e.default !== undefined) env[key] = String(e.default);
    }
    const args: string[] = [];
    for (const a of (pkg.packageArguments ?? []) as Array<Record<string, unknown>>) {
      const value = typeof a.value === 'string' && !a.value.includes('{') ? a.value : undefined;
      if (a.type === 'named' && (value !== undefined || a.format === undefined)) args.push(String(a.name), ...(value !== undefined ? [value] : []));
      else if (a.type === 'positional' && value !== undefined) args.push(value);
      else if (a.isRequired) { plan.skipped.push(`${type} package ${ident}: argument ${String(a.name ?? a.valueHint)} needs a value, so it is not imported`); bad = true; }
    }
    if (bad) continue;
    const image = /[:@][^/]*$/.test(ident) ? ident : `${ident}:${v}`;
    const [command, head] = type === 'npm' ? ['npx', ['-y', `${ident}@${v}`]]
      : type === 'pypi' ? ['uvx', [`${ident}==${v}`]]
      : ['docker', ['run', '-i', '--rm', ...[...envKeys, ...Object.keys(env)].flatMap((k) => ['-e', k]), image]];
    const id = uid(type);
    mcp.push({ id, command, args: [...head, ...args], env_keys: envKeys, ...(Object.keys(env).length ? { env } : {}), engines: ['*'] });
    plan.env[id] = {};
  }

  for (const r of (server.remotes ?? []) as Array<Record<string, unknown>>) {
    const url = String(r.url);
    if (r.type !== 'streamable-http') { plan.skipped.push(`remote ${url}: ${String(r.type)} transport is not imported`); continue; }
    if (!url.startsWith('https://') || url.includes('{')) { plan.skipped.push(`remote ${url}: not a fixed https URL, so it is not imported`); continue; }
    const headers: Record<string, string> = {};
    for (const h of (r.headers ?? []) as Array<Record<string, unknown>>) {
      const tmpl = typeof h.value === 'string' ? h.value.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v: string) => `\${${envName(v)}}`) : `\${${envName(String(h.name))}}`;
      const keys = headerSecretNames(tmpl);
      if (!keys.length) { plan.errors.push(`remote ${url}: header ${String(h.name)} has no \${SECRET} template, so it is not imported`); continue; }
      headers[String(h.name)] = tmpl;
      for (const k of keys) perms.add(`secrets:${k}`);
    }
    const id = uid('remote');
    const hasHeaders = Object.keys(headers).length > 0;
    mcp.push({ id, transport: 'http', url, ...(hasHeaders ? { headers } : {}), auth: hasHeaders ? 'header' : 'engine-oauth', writes: 'external', engines: ['*'] });
    plan.env[id] = {};
  }

  if (!mcp.length) plan.errors.push(`${name}: no package or remote could be imported`);
  plan.manifest.mcp = mcp;
  plan.manifest.permissions = [...perms];
  return plan;
}

/** Parses a `plugin.install` source: `<importer>:<path>[;project=<dir>]`, `registry-import:<name>[;file=<saved response>]` or `claude-marketplace:<repo>[#<plugin>]`. */
export function importFromSource(source: string): ImportPlan | null {
  if (source.startsWith('claude-marketplace:')) return importMarketplace(source.slice('claude-marketplace:'.length));
  const m = /^(claude|codex|agy|registry)-import:(.+)$/.exec(source);
  if (!m) return null;
  const [target, ...opts] = m[2].split(';');
  const project = opts.find((o) => o.startsWith('project='))?.slice(8);
  if (m[1] === 'claude') return importClaude(target);
  if (m[1] === 'codex') return importCodex(target, project);
  if (m[1] === 'registry') return importRegistry(target, opts.find((o) => o.startsWith('file='))?.slice(5));
  return importAgy(target, project);
}
