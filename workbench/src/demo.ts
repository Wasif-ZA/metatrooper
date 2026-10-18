import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoProblem } from '../../core/src/paths.ts';

export const DEMO_TITLE = 'MetaTrooper (demo)';
/** The demo registers its own take-over key, so it never collides with a real workbench holding the default one. */
export const DEMO_TAKEOVER_KEY = 'Control+Alt+F12';

/** The demo's own data folder, pipe prefix and demo flag for this process. */
export function demoEnv(pid: number, tmp = os.tmpdir()): Record<string, string> {
  return { METATROOPER_HOME: path.join(tmp, `metatrooper-demo-${pid}`), METATROOPER_PIPE_PREFIX: `metatrooper-demo-${pid}`, METATROOPER_DEMO: '1' };
}

export { demoProblem };

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
