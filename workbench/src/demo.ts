import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEMO_TITLE = 'MetaTrooper (demo)';
/** The demo registers its own take-over key, so it never collides with a real workbench holding the default one. */
export const DEMO_TAKEOVER_KEY = 'Control+Alt+F12';

/** The demo's own data folder, pipe prefix and demo flag for this process. */
export function demoEnv(pid: number, tmp = os.tmpdir()): Record<string, string> {
  return { METATROOPER_HOME: path.join(tmp, `metatrooper-demo-${pid}`), METATROOPER_PIPE_PREFIX: `metatrooper-demo-${pid}`, METATROOPER_DEMO: '1' };
}

/** Why a demo with this home and prefix would touch the real data, or null. */
export function demoProblem(home: string, prefix: string, realHome = path.join(os.homedir(), '.metatrooper')): string | null {
  const same = path.resolve(home).toLowerCase() === path.resolve(realHome).toLowerCase();
  return same || prefix.toLowerCase() === 'metatrooper' ? 'demo would use the real data folder' : null;
}

export const demo = process.argv.includes('--demo');

// runs on import, before main.ts reads any path; inherited METATROOPER_HOME and prefix are overridden
if (demo) {
  const env = demoEnv(process.pid);
  const problem = demoProblem(env.METATROOPER_HOME, env.METATROOPER_PIPE_PREFIX);
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  Object.assign(process.env, env);
  fs.rmSync(env.METATROOPER_HOME, { recursive: true, force: true });
  fs.mkdirSync(env.METATROOPER_HOME, { recursive: true });
}
