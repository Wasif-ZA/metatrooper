import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { coreDir, homeDir } from '../paths.ts';
import type { InstalledPlugin } from './store.ts';

export type Plan = { file: string; args: string[]; verbatim: boolean };

const SOURCE = path.join(coreDir, 'src', 'plugins', 'boxrun.cs');

/** True when this plugin's cli actions run in the AppContainer: an installed plugin on Windows; plugins shipped in plugins/ run as before. */
export function boxed(plugin: InstalledPlugin, platform = process.platform): boolean {
  return platform === 'win32' && plugin.source !== 'builtin';
}

/** The AppContainer profile name for a plugin: letters, digits, dot and dash, at most 64 characters. */
export function containerName(pluginId: string): string {
  const hash = crypto.createHash('sha256').update(pluginId).digest('hex').slice(0, 8);
  return `cc.plugin.${pluginId.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 40)}.${hash}`;
}

/** One argument quoted for a Windows command line, by the rules CommandLineToArgvW reads. */
export function winQuote(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** The folders an action may touch, from its approved permissions: plugin folder read, project read or write, run folder write. */
export function grants(plugin: InstalledPlugin, projectDir: string, runDir: string): string[] {
  const has = (p: string) => plugin.permissions.includes(p);
  const lines = [`r ${plugin.path}`];
  if (has('project:write')) lines.push(`w ${projectDir}`);
  else if (has('project:read')) lines.push(`r ${projectDir}`);
  if (has('run:write')) lines.push(`w ${runDir}`);
  return lines;
}

/** Builds boxrun.exe from its source with the .NET Framework compiler on first use; null when there is no compiler. */
export function launcher(): string | null {
  const src = fs.readFileSync(SOURCE);
  const exe = path.join(homeDir(), 'bin', `boxrun-${crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)}.exe`);
  if (fs.existsSync(exe)) return exe;
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) return null;
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  const tmp = `${exe}.${process.pid}.tmp.exe`;
  try {
    execFileSync(csc, ['-nologo', `-out:${tmp}`, SOURCE], { stdio: 'pipe', windowsHide: true, timeout: 60_000 });
    fs.renameSync(tmp, exe);
  } catch {
    fs.rmSync(tmp, { force: true });
    return fs.existsSync(exe) ? exe : null;
  }
  return exe;
}

/** Wraps a planned command in boxrun and confines its environment to the run folder; an error string when the sandbox cannot start, never an unconfined plan. */
export function boxPlan(plan: Plan, plugin: InstalledPlugin, projectDir: string, runDir: string, env: Record<string, string>, exe = launcher()): Plan | string {
  if (!exe) return 'the plugin sandbox needs the .NET Framework compiler (csc.exe), which this PC does not have';
  fs.mkdirSync(runDir, { recursive: true });
  const grantFile = path.join(runDir, 'box-grants.txt');
  fs.writeFileSync(grantFile, grants(plugin, projectDir, runDir).join('\n') + '\n');
  env.TEMP = env.TMP = runDir;
  env.npm_config_cache = path.join(runDir, 'npm-cache');
  env.NODE_OPTIONS = '--preserve-symlinks --preserve-symlinks-main';
  const cmdline = plan.verbatim ? [winQuote(plan.file), ...plan.args].join(' ') : [plan.file, ...plan.args].map(winQuote).join(' ');
  const net = plugin.permissions.includes('network') ? '1' : '0';
  return { file: exe, args: [containerName(plugin.id), net, grantFile, cmdline], verbatim: false };
}
