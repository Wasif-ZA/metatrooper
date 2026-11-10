import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoProblem } from '../../core/src/paths.ts';

export const DEMO_TITLE = 'Ouros (demo)';
/** The demo registers its own take-over key, so it never collides with a real workbench holding the default one. */
export const DEMO_TAKEOVER_KEY = 'Control+Alt+Shift+Q';

/** The demo's own data folder, pipe prefix and demo flag for this process. */
export function demoEnv(pid: number, tmp = os.tmpdir()): Record<string, string> {
  return { METATROOPER_HOME: path.join(tmp, `metatrooper-demo-${pid}`), METATROOPER_PIPE_PREFIX: `metatrooper-demo-${pid}`, METATROOPER_DEMO: '1' };
}

export { demoProblem };

export const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** Kills `pid` and every process it started. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  else try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

/** Waits up to `ms` for `pid` to exit, then kills its tree; true once it is gone. */
export async function stopPid(pid: number, ms: number): Promise<boolean> {
  const gone = async (limit: number) => {
    for (const end = Date.now() + limit; alive(pid) && Date.now() < end;) await new Promise((r) => setTimeout(r, 100));
    return !alive(pid);
  };
  if (await gone(ms)) return true;
  killTree(pid);
  return gone(5000);
}

/** Deletes `dir` once every pid has exited, retrying while its files stay locked; a detached node, since this process holds files until it exits. */
export function removeWhenGone(dir: string, pids: number[]): void {
  const script = `const fs=require('fs');const pids=${JSON.stringify(pids)};const dir=${JSON.stringify(dir)};`
    + `const alive=(p)=>{try{process.kill(p,0);return true}catch(e){return e.code==='EPERM'}};`
    + `setInterval(()=>{if(pids.some(alive))return;try{fs.rmSync(dir,{recursive:true,force:true});process.exit(0)}catch{}},250);setTimeout(()=>process.exit(1),120000);`;
  spawn('node', ['-e', script], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', (e) => console.error(`demo home not removed: ${e.message}`)).unref();
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
