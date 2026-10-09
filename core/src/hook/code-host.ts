import { pathToFileURL } from 'node:url';

interface Init {
  type: 'init';
  module: string;
  ctx: { inputs: unknown; steps: unknown; runDir: string; projectPath: string; coreDir: string; plugins: string[] };
}

let next = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function call(method: string, args: unknown[]): Promise<unknown> {
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send?.({ id, method, args });
  });
}

function finish(msg: Record<string, unknown>): void {
  process.send?.(msg, () => process.exit(0));
}

process.on('message', async (raw) => {
  const msg = raw as Init | { id: number; result?: unknown; error?: string };
  if ('id' in msg) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error !== undefined) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
    return;
  }
  if (msg.type !== 'init') return;
  const ctx = Object.freeze({
    inputs: msg.ctx.inputs,
    steps: msg.ctx.steps,
    runDir: msg.ctx.runDir,
    projectPath: msg.ctx.projectPath,
    coreDir: msg.ctx.coreDir,
    plugins: Object.freeze([...(msg.ctx.plugins ?? [])]),
    log: (text: unknown) => call('log', [String(text)]),
    readFile: (rel: string) => call('readFile', [rel]),
    writeFile: (rel: string, text: string) => call('writeFile', [rel, text]),
    startAgent: (opts: unknown) => call('startAgent', [opts]),
  });
  try {
    const mod = await import(pathToFileURL(msg.module).href);
    if (typeof mod.run !== 'function') throw new Error('the module does not export run(ctx)');
    const value = await mod.run(ctx);
    const text = JSON.stringify(value);
    if (text === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('run(ctx) must return a JSON object');
    finish({ type: 'result', value: JSON.parse(text) });
  } catch (e) {
    finish({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
});
