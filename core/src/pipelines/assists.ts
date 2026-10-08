import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { repoDir } from '../paths.ts';
import type { Pipeline } from './validate.ts';

export interface AssistTool {
  name: string;
  repo: string;
  licence: string;
  risk: 'ok' | 'caution';
  risk_note?: string;
  egress: string;
  detect: string[];
  install: string;
  reached_by: 'cli' | 'npm' | 'pip' | 'mcp';
}

export interface AssistResult {
  tool: string;
  installed: boolean;
  version: string | null;
}

const DETECT_TIMEOUT_MS = 5000;

let registryCache: Record<string, AssistTool> | null = null;

export function assistRegistry(): Record<string, AssistTool> {
  registryCache ??= JSON.parse(fs.readFileSync(path.join(repoDir, 'pipelines', 'assists', 'registry.json'), 'utf8'));
  return registryCache as Record<string, AssistTool>;
}

export function assistErrors(p: Pipeline, registry = assistRegistry()): string[] {
  const errors: string[] = [];
  const steps = new Set(p.steps.map((s) => s.id));
  (p.assists ?? []).forEach((a, i) => {
    const tool = registry[a.tool];
    if (!tool) errors.push(`/assists/${i}: unknown helper ${a.tool}`);
    else if (typeof tool.egress !== 'string' || !tool.egress) errors.push(`/assists/${i}: helper ${a.tool} has no egress in pipelines/assists/registry.json`);
    for (const s of a.steps) if (!steps.has(s)) errors.push(`/assists/${i}: step ${s} is not in the pipeline`);
  });
  return errors;
}

/** Resolves an executable on PATH with PATHEXT, returning the argv to spawn without a shell. */
function resolveArgv(argv: string[]): string[] | null {
  const [exe, ...args] = argv;
  if (process.platform !== 'win32') return argv;
  const exts = path.extname(exe) ? [''] : (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';');
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, exe + ext);
      if (!dir || !fs.existsSync(full)) continue;
      return /\.(cmd|bat)$/i.test(full) ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/c', full, ...args] : [full, ...args];
    }
  }
  return null;
}

function detectOne(id: string, tool: AssistTool, cwd: string): Promise<AssistResult> {
  const argv = resolveArgv(tool.detect.map((a) => a.replaceAll('{repo}', repoDir)));
  if (!argv) return Promise.resolve({ tool: id, installed: false, version: null });
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (installed: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const line = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve({ tool: id, installed, version: installed && line ? line.slice(0, 120) : null });
    };
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => {
      if (child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      child.kill();
      finish(false);
    }, DETECT_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
  });
}

/** Runs every referenced helper's detect command in parallel and writes `<runDir>/assists.json`. */
export async function detectAssists(pipe: Pipeline, runDir: string, cwd: string): Promise<AssistResult[]> {
  const registry = assistRegistry();
  const ids = [...new Set((pipe.assists ?? []).map((a) => a.tool))].filter((id) => registry[id]);
  const results = await Promise.all(ids.map((id) => detectOne(id, registry[id], cwd)));
  fs.writeFileSync(path.join(runDir, 'assists.json'), JSON.stringify(results, null, 2) + '\n');
  return results;
}

/** The helper block for an agent step's prompt, from the run's `assists.json`; empty when none is installed. */
export function helperBlock(pipe: Pipeline, runDir: string, stepId: string): string {
  const file = path.join(runDir, 'assists.json');
  if (!pipe.assists?.length || !fs.existsSync(file)) return '';
  const installed = new Set((JSON.parse(fs.readFileSync(file, 'utf8')) as AssistResult[]).filter((r) => r.installed).map((r) => r.tool));
  const registry = assistRegistry();
  const lines = pipe.assists
    .filter((a) => a.steps.includes(stepId) && installed.has(a.tool) && registry[a.tool])
    .map((a) => `- ${registry[a.tool].name}: ${a.use}`);
  return lines.length ? `Helpers installed on this machine (use one when it fits; you do not have to):\n${lines.join('\n')}` : '';
}
