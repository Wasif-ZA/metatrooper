import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUILT_IN, type EngineSpec } from '../../core/src/engines/registry.ts';
import { planArgs } from '../../core/src/sessions/launch.ts';
import { resolveCommand } from '../../core/src/hook/resolve.ts';
import { killTree } from '../helpers/kill-tree.ts';

const require = createRequire(import.meta.url);
const pty = require('../../core/node_modules/node-pty') as typeof import('node-pty');
const prompt = 'create a file named probe.txt containing ok';
const pattern = /\x1b\](9|99|777);[^\x07\x1b]*(\x07|\x1b\\)/g;
const engineFilter = process.argv.indexOf('--engine');
const selectedId = engineFilter >= 0 ? process.argv[engineFilter + 1] : undefined;
const engines = BUILT_IN.filter((engine) => ['claude', 'codex', 'agy'].includes(engine.id)
  && (!selectedId || engine.id === selectedId));

if (selectedId && engines.length === 0) {
  throw new Error(`unknown engine: ${selectedId}`);
}

interface ProbeResult {
  engine: string;
  codes: number[];
  samples: string[];
  note: string;
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? `git ${args.join(' ')} failed`);
  }
}

async function probe(engine: EngineSpec): Promise<ProbeResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `m4-osc-${engine.id}-`));
  try {
    runGit(['init'], dir);
    runGit(['-c', 'user.name=M4 OSC Probe', '-c', 'user.email=m4-osc-probe@localhost', 'commit', '--allow-empty', '-m', 'probe'], dir);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { engine: engine.id, codes: [], samples: [], note: `not run: ${error instanceof Error ? error.message : String(error)}` };
  }

  const plan = planArgs(engine, prompt, 'ask');
  const resolved = resolveCommand(plan.argv[0]) ?? [plan.argv[0]];
  const executable = resolved[0];
  const argv = [...resolved.slice(1), ...plan.argv.slice(1)];
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  let child: import('node-pty').IPty;
  try {
    child = pty.spawn(executable, argv, {
      name: 'xterm-256color', cols: 120, rows: 30, cwd: dir, env, useConpty: true,
    });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { engine: engine.id, codes: [], samples: [], note: `not run: ${error instanceof Error ? error.message : String(error)}` };
  }

  const codes = new Set<number>();
  const samples: string[] = [];
  let raw = '';
  let scanFrom = 0;
  let startedAt = Date.now();
  let firstMatchAt: number | undefined;
  let exitAt: number | undefined;
  let exited = false;
  child.onData((chunk) => {
    raw += chunk;
    pattern.lastIndex = scanFrom;
    for (let match; (match = pattern.exec(raw));) {
      const code = Number(match[1]);
      codes.add(code);
      if (samples.length < 3) samples.push(match[0]);
      firstMatchAt ??= Date.now();
    }
    scanFrom = Math.max(0, raw.length - 1024);
    if (raw.length > 64_000) {
      const dropped = raw.length - 4_000;
      raw = raw.slice(-4_000);
      scanFrom = Math.max(0, scanFrom - dropped);
    }
  });
  child.onExit(() => { exited = true; exitAt = Date.now(); });

  // Engines with prompt_arg receive the prompt in argv; interactive engines receive it after startup.
  if (!engine.prompt_arg) child.write(`${prompt}\r`);
  startedAt = Date.now();
  try {
    while (Date.now() - startedAt < 120_000) {
      if (firstMatchAt && Date.now() - firstMatchAt >= 10_000) break;
      if (exited && exitAt && Date.now() - exitAt >= 5_000) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    killTree(child.pid);
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  if (exited && exitAt !== undefined && exitAt - startedAt < 5_000 && codes.size === 0) {
    return { engine: engine.id, codes: [], samples: [], note: 'not run: process exited within 5 s' };
  }
  if (!codes.size && Date.now() - startedAt >= 120_000) return { engine: engine.id, codes: [], samples: [], note: 'no OSC 9/99/777 sequence emitted within 120 s' };
  return { engine: engine.id, codes: [...codes].sort((a, b) => a - b), samples, note: '' };
}

const results: ProbeResult[] = [];
for (const engine of engines) results.push(await probe(engine));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
