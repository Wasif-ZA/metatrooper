import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolation, root, sleep, until } from '../../core/test/helpers.ts';
import { revisionHarness } from '../../core/test/ui-revision-helpers.ts';
import { capturingEngine } from '../../core/test/pipeline-fixup-helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const local = /^(?:127\.\d+\.\d+\.\d+|localhost|\[::1\])(?::\d+)?$/;
// Chromium looks up `wpad` when Windows "Automatically detect settings" is on (spec.md, Open core): allowed, nothing else is.
const allowed = (host: string) => local.test(host) || /^wpad(?::\d+)?$/i.test(host);

/** Every host a Chromium net-log connects to or requests, by URL or by host:port, that is not on this machine. */
function outboundHosts(netlog: string): string[] {
  const hosts = new Set<string>();
  for (const m of netlog.matchAll(/(?:https?|wss?):\/\/([^"\s\/]+)/g)) hosts.add(m[1]);
  for (const m of netlog.matchAll(/"host":"([^"]+)"/g)) hosts.add(m[1]);
  return [...hosts].filter((h) => !allowed(h));
}

test('M3-06 signed out, the workbench window and the core make no outbound connection during a full spec-to-pr run', { skip: process.platform !== 'win32' || !existsSync(electron) ? 'needs Windows and the Electron binary' : false }, async () => {
  const home = isolation().home;
  const nodeLog = join(home, 'node-outbound.log');
  const netLog = join(home, 'netlog.json');
  const prev = { NODE_OPTIONS: process.env.NODE_OPTIONS, TROOP_NO_NET_LOG: process.env.TROOP_NO_NET_LOG };
  process.env.NODE_OPTIONS = `${prev.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(root, 'core/test/no-network-hook.mjs')).href}`;
  process.env.TROOP_NO_NET_LOG = nodeLog;
  let h: Awaited<ReturnType<typeof revisionHarness>>;
  try { h = await revisionHarness('spec-to-pr', capturingEngine); } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const wb = spawn(electron, [`--log-net-log=${netLog}`, workbench], {
    env: { ...h.env, NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'core/test/no-network-hook.mjs')).href}`, TROOP_NO_NET_LOG: nodeLog },
    stdio: 'ignore',
  });
  try {
    await until(() => existsSync(netLog), 30000);
    const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
    for (const s of def.steps) {
      if (s.kind !== 'agent') continue;
      s.engine = 'fake';
      const d = s.id === 'spec' ? { outputs: { title: 'Add greet' } } : s.id === 'build' ? { files: { 'greet.js': 'export const greet = (n) => n;\n' }, commit: 'Add greet', outputs: { summary: 'Adds greet.' } } : { outputs: { summary: s.id } };
      s.prompt = `FAKE ${JSON.stringify(d)}\n${s.prompt}`;
    }
    const runId = await h.pipeline(def, { idea: readFileSync(join(h.project, 'idea.md'), 'utf8'), repo: 'fake/repo' });
    for (;;) {
      const status = await until(() => {
        const r = h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any;
        return ['paused', 'done', 'failed'].includes(r.status) ? r.status : null;
      }, 60000);
      if (status !== 'paused') { assert.equal(status, 'done'); break; }
      const gate: any = h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId);
      await sleep(1500);
      assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
      await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status !== 'paused', 10000);
    }
    await sleep(3000);
  } finally {
    if (wb.pid) spawnSync('taskkill', ['/PID', String(wb.pid), '/T'], { stdio: 'ignore' });
    await until(() => wb.exitCode !== null, 10000).catch(() => killTree(wb.pid));
    await h.close();
  }
  assert.equal(existsSync(nodeLog) ? readFileSync(nodeLog, 'utf8') : '', '');
  assert.ok(existsSync(netLog), 'Chromium wrote no net-log');
  const log = readFileSync(netLog, 'utf8');
  // ponytail: a killed workbench leaves the net-log unclosed and may drop its last unflushed events; read it line by line.
  const events = log.split(/\r?\n/).filter((l) => l.startsWith('{"params"') || l.startsWith('{"phase"'));
  assert.ok(events.length > 20, `the net-log holds only ${events.length} events`);
  assert.deepEqual(outboundHosts(log), []);
  assert.deepEqual(outboundHosts('"url":"https://example.com/a","x":"http://127.0.0.1:3001/","host":"wpad:80","h":"y","host":"evil.example:443"'), ['example.com', 'evil.example:443']);
});
