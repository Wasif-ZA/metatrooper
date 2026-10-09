import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COPYLEFT = /\b(A?GPL|SSPL|EUPL|OSL|CC-BY-SA)\b/i;
const WEAK = /\b(LGPL|MPL|EPL|CDDL)\b/i;

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const licenceOf = (pkg) => (pkg && (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type ?? l).join(' OR ') : null))) || null;

// ponytail: npm projects only; add pip and cargo when a pipeline run needs them.
export function listDeps(input, outdated = npmOutdated) {
  const dir = path.resolve(input.path);
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!pkg) throw new Error(`no package.json in ${dir}`);
  const late = outdated(dir);
  const deps = [];
  for (const [field, dev] of [['dependencies', false], ['devDependencies', true]]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      const installed = readJson(path.join(dir, 'node_modules', name, 'package.json'));
      const o = late[name];
      deps.push({
        name, ecosystem: 'npm', dev, range, installed: installed?.version ?? o?.current ?? null,
        wanted: o?.wanted ?? null, latest: o?.latest ?? null, outdated: Boolean(o), major: Boolean(o && major(o.latest) > major(o.current ?? installed?.version)),
        licence: licenceOf(installed),
      });
    }
  }
  const result = { project: pkg.name ?? path.basename(dir), licence: licenceOf(pkg), deps };
  if (input.out) write(input.out, JSON.stringify(result, null, 2));
  return { out: input.out ?? null, total: deps.length, outdated: deps.filter((d) => d.outdated).length, major: deps.filter((d) => d.major).length };
}

const major = (v) => Number(String(v ?? '').replace(/^[^\d]*/, '').split('.')[0]) || 0;

function npmOutdated(dir) {
  const r = spawnSync('npm', ['outdated', '--json'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`npm could not start: ${r.error.message}`);
  if (r.status && !r.stdout.trim()) throw new Error(`npm outdated failed: ${(r.stderr || '').trim().slice(-300)}`);
  let out;
  try { out = JSON.parse(r.stdout || '{}'); } catch { throw new Error(`npm outdated printed no JSON: ${(r.stderr || '').slice(0, 300)}`); }
  if (out.error) throw new Error(`npm outdated failed: ${out.error.summary ?? out.error.code ?? 'unknown'}`);
  return out;
}

function packages(nodeModules, found = []) {
  if (!fs.existsSync(nodeModules)) return found;
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(nodeModules, entry);
    if (entry.startsWith('@')) { packages(full, found); continue; }
    const pkg = readJson(path.join(full, 'package.json'));
    if (pkg?.name) found.push({ name: pkg.name, version: pkg.version, licence: licenceOf(pkg) });
    packages(path.join(full, 'node_modules'), found);
  }
  return found;
}

export function licenceReport(input) {
  const dir = path.resolve(input.path);
  const own = licenceOf(readJson(path.join(dir, 'package.json')));
  const ownCopyleft = own && COPYLEFT.test(own);
  const seen = new Map();
  for (const p of packages(path.join(dir, 'node_modules'))) seen.set(`${p.name}@${p.version}`, p);
  const all = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const conflicts = ownCopyleft ? [] : all.filter((p) => p.licence && COPYLEFT.test(p.licence) && !/\bOR\b/.test(p.licence));
  const review = all.filter((p) => p.licence && (WEAK.test(p.licence) || (COPYLEFT.test(p.licence) && /\bOR\b/.test(p.licence))));
  const unknown = all.filter((p) => !p.licence);
  const row = (p) => `| ${p.name} | ${p.version} | ${p.licence ?? 'none declared'} |`;
  const table = (title, list) => (list.length ? [`## ${title} (${list.length})`, '', '| Package | Version | Licence |', '|---|---|---|', ...list.map(row), ''] : [`## ${title} (0)`, '']);
  const md = [`# Licence report`, '', `Project licence: ${own ?? 'none declared'}. Packages: ${all.length}.`, '',
    ...table('Conflicts', conflicts), ...table('Review', review), ...table('No licence declared', unknown)].join('\n');
  if (input.out) write(input.out, md);
  return { out: input.out ?? null, licence_conflict: conflicts.length > 0, conflicts: conflicts.map((p) => `${p.name}@${p.version} (${p.licence})`), review: review.length, unknown: unknown.length, total: all.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const fn = { 'list-deps': listDeps, 'licence-report': licenceReport }[process.argv[2]];
    if (!fn) throw new Error(`unknown action ${process.argv[2]}`);
    process.stdout.write(JSON.stringify({ ok: true, outputs: fn(req.input || {}) }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
  }
}
