import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

// Capture the unmodified prompt and cwd in the agent process, keyed by session.
// Extra directives write run artifacts and vary outputs across loop iterations.
export const capturingEngine = `
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const prompt = process.argv[2] ?? '';
const home = process.env.METATROOPER_HOME;
const captures = join(home, 'captures');
mkdirSync(captures, {recursive:true});
writeFileSync(join(captures, process.env.TROOP_SESSION_ID + '.json'), JSON.stringify({prompt, cwd:process.cwd()}));
const out = /^When you are done, write your result to:\\s*(.+)$/m.exec(prompt)?.[1]?.trim();
const line = prompt.split(/\\r?\\n/).find(s => s.startsWith('FAKE '));
if (out && line) {
  const spec = JSON.parse(line.slice(5));
  if (spec.probe_http) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(home, 'troop.db'), {readOnly:true});
    const {port} = db.prepare('SELECT p.port FROM port_lease p JOIN run_step s ON s.run_id=p.run_id AND s.fanout_index=p.idx WHERE s.session_id=?').get(process.env.TROOP_SESSION_ID);
    db.close();
    try { spec.outputs.probe = (await fetch('http://127.0.0.1:' + port + '/', {signal:AbortSignal.timeout(3000)})).status; }
    catch (e) { spec.outputs.probe = e.cause?.code || e.code || e.message; }
    process.argv[2] = prompt.replace(line, 'FAKE ' + JSON.stringify(spec));
  }
  if (spec.wait_file) {
    const deadline = Date.now() + 90000;
    while (!existsSync(join(home, spec.wait_file))) {
      if (Date.now() > deadline) throw new Error('test did not release fake engine');
      await new Promise(r => setTimeout(r, 50));
    }
  }
  for (const [name, value] of Object.entries(spec.run_files ?? {})) writeFileSync(join(dirname(out), name), String(value));
  if (spec.observe_fix) {
    for (const [name, value] of Object.entries(spec.files)) writeFileSync(join(process.cwd(), name), String(value));
    writeFileSync(join(home, 'fix-ready'), 'ready');
    const deadline = Date.now() + 90000;
    while (!existsSync(join(home, 'release-fix-result'))) {
      if (Date.now() > deadline) throw new Error('test did not finish observing fix');
      await new Promise(r => setTimeout(r, 50));
    }
  }
  if (spec.verdicts) {
    const counter = join(home, 'critique-count.json');
    const n = existsSync(counter) ? JSON.parse(readFileSync(counter, 'utf8')) : 0;
    writeFileSync(counter, JSON.stringify(n + 1));
    spec.outputs.verdict = spec.verdicts[Math.min(n, spec.verdicts.length - 1)];
    process.argv[2] = prompt.replace(line, 'FAKE ' + JSON.stringify(spec));
  }
}
await import(${JSON.stringify(pathToFileURL(join(root, 'core/test/fake-engine.js')).href)});
`;

export function captured(h: { iso: { home: string } }, sessionId: string): { prompt: string; cwd: string } {
  return JSON.parse(readFileSync(join(h.iso.home, 'captures', `${sessionId}.json`), 'utf8'));
}
