import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { EngineSpec } from '../engines/registry.ts';
import { coreDir, logsDir, repoDir } from '../paths.ts';
import { containerRuntime, imageTag } from './checks.ts';

export const NETWORK = 'troop-egress';
export const PROXY = 'troop-proxy';

/** Every egress host the engines declare, plus the npm registry. */
export function allowList(engines: EngineSpec[]): string[] {
  return [...new Set(['registry.npmjs.org', ...engines.flatMap((e) => e.sandbox?.egress ?? [])])].sort();
}

/** The Dockerfile with one RUN line per engine install command, run as root before the USER line. */
export function dockerfile(template: string, engines: EngineSpec[]): string {
  const lines = engines.flatMap((e) => e.sandbox?.install ?? []).map((l) => `RUN ${l}`);
  return template.replace('# ENGINE INSTALL LINES', lines.join('\n'));
}

export const HASH_LABEL = 'troop.hash';

/** A hash of everything the image is built from: the hook files and dist, the sandbox scripts, the Dockerfile with engine installs, and the egress list (M7-19a). */
export function imageHash(engines: EngineSpec[], roots = { core: coreDir, repo: repoDir }): string {
  const h = crypto.createHash('sha256');
  const add = (name: string, data: Buffer | string) => h.update(`${name}\0`).update(data).update('\0');
  for (const f of ['event.js', 'codex-notify.js']) add(f, fs.readFileSync(path.join(roots.core, f)));
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) add(r, fs.readFileSync(path.join(dir, e.name)));
    }
  };
  walk(path.join(roots.core, 'dist'), 'dist');
  for (const f of ['entry.sh', 'proxy.js', 'selftest.js']) {
    const src = path.join(roots.repo, 'sandbox', f);
    if (fs.existsSync(src)) add(f, fs.readFileSync(src, 'utf8').replaceAll('\r\n', '\n'));
  }
  add('Dockerfile', dockerfile(fs.readFileSync(path.join(roots.repo, 'sandbox', 'Dockerfile'), 'utf8'), engines));
  add('egress', allowList(engines).join('\n'));
  return h.digest('hex').slice(0, 32);
}

function stage(engines: EngineSpec[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-sandbox-'));
  const troop = path.join(dir, 'troop');
  fs.mkdirSync(troop);
  for (const f of ['event.js', 'codex-notify.js']) fs.copyFileSync(path.join(coreDir, f), path.join(troop, f));
  fs.cpSync(path.join(coreDir, 'dist'), path.join(troop, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(troop, 'package.json'), '{"type":"module"}\n');
  for (const f of ['entry.sh', 'proxy.js', 'selftest.js']) {
    const src = path.join(repoDir, 'sandbox', f);
    if (fs.existsSync(src)) fs.writeFileSync(path.join(troop, f), fs.readFileSync(src, 'utf8').replaceAll('\r\n', '\n'));
  }
  const template = fs.readFileSync(path.join(repoDir, 'sandbox', 'Dockerfile'), 'utf8');
  fs.writeFileSync(path.join(dir, 'Dockerfile'), dockerfile(template, engines));
  return dir;
}

function run(cmd: string, args: string[], log: (s: string) => void, inherit = false): number {
  const r = spawnSync(cmd, args, { stdio: inherit ? 'inherit' : 'pipe', encoding: 'utf8', windowsHide: true });
  if (!inherit && r.status !== 0) log((r.stderr || r.stdout || '').trim());
  return r.status ?? 1;
}

/** Builds the trooper image, creates the internal network and (re)starts the egress proxy on it. */
export function buildSandbox(engines: EngineSpec[], log: (s: string) => void = console.log): number {
  const rt = containerRuntime();
  if (!rt) { log('no container runtime answers; start Docker Desktop'); return 1; }
  const dir = stage(engines);
  try {
    log(`building ${imageTag()}`);
    if (run(rt, ['build', '--label', `${HASH_LABEL}=${imageHash(engines)}`, '-t', imageTag(), dir], log, true) !== 0) return 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (run(rt, ['network', 'inspect', NETWORK], () => {}) !== 0 && run(rt, ['network', 'create', '--internal', NETWORK], log) !== 0) return 1;
  run(rt, ['rm', '-f', PROXY], () => {});
  fs.mkdirSync(logsDir(), { recursive: true });
  const proxyArgs = ['run', '-d', '--name', PROXY, '--restart', 'unless-stopped', '--user', '1000:1000', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', `${logsDir()}:/logs`,
    '-e', 'TROOP_PROXY=1', '-e', `ALLOW=${allowList(engines).join(',')}`, imageTag(), 'node', '/opt/troop/proxy.js'];
  if (run(rt, proxyArgs, log) !== 0) return 1;
  if (run(rt, ['network', 'connect', NETWORK, PROXY], log) !== 0) return 1;
  log(`proxy ${PROXY} allows ${allowList(engines).join(', ')}`);
  return 0;
}
