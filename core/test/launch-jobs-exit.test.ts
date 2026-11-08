import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { isolation, pipePath, root, runNode } from './helpers.ts';

const cli = join(root, 'core', 'cli.ts');

async function recordingCli(failingEngine?: string) {
  const iso = isolation();
  const env = { ...iso.env, TROOP_SESSION_ID: '' };
  const launches: Array<Record<string, unknown>> = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        let result: Record<string, unknown> | undefined;
        let error: { code: number; message: string } | undefined;
        switch (request.method) {
          case 'project.open':
            result = { project_id: 'recorded-project' };
            break;
          case 'worktree.create': {
            const path = join(iso.home, request.params.branch);
            mkdirSync(path, { recursive: true });
            result = { path, branch: request.params.branch, trusted: true };
            break;
          }
          case 'session.launch':
            launches.push(request.params);
            if (request.params.engine_id === failingEngine) {
              error = { code: -32003, message: 'chosen job failed' };
            } else {
              result = { session_id: 'session-' + launches.length, approval: 'ask' };
            }
            break;
          default:
            error = { code: -32601, message: 'unexpected RPC: ' + request.method };
        }
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
          ...(error ? { error } : { result }),
        }) + '\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath(iso.prefix), resolve);
    });
  } catch (error) {
    rmSync(iso.home, { recursive: true, force: true });
    throw error;
  }
  return { ...iso, env, launches, async teardown() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(iso.home, { recursive: true, force: true });
  } };
}

test('troop launch --jobs prints every successful session once and exits 0', async () => {
  const h = await recordingCli();
  try {
    const jobsFile = join(h.home, 'jobs.json');
    writeFileSync(jobsFile, JSON.stringify([
      { engine: 'claude' },
      { engine: 'codex', worktree: 'feature' },
      { engine: 'agy' },
    ]));
    const r = await runNode([cli, 'launch', '--jobs', jobsFile, '--project', h.home], h.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.split(/\r?\n/).filter((line) => line.startsWith('launched ')), [
      'launched claude (approval ask): session session-1',
      'launched codex on feature (approval ask): session session-2',
      'launched agy (approval ask): session session-3',
    ]);
    assert.equal(h.launches.length, 3, 'each job must launch exactly once');
    assert.deepEqual(h.launches.map((params) => params.engine_id), ['claude', 'codex', 'agy']);
    assert.doesNotMatch(r.stderr, /jobs failed/);
  } finally { await h.teardown(); }
});

test('troop launch --jobs reports a failed second job, launches the third and exits 1', async () => {
  const h = await recordingCli('bad');
  try {
    const jobsFile = join(h.home, 'jobs.json');
    writeFileSync(jobsFile, JSON.stringify([
      { engine: 'claude' },
      { engine: 'bad', worktree: 'broken' },
      { engine: 'agy', worktree: 'after-failure' },
    ]));
    const r = await runNode([cli, 'launch', '--jobs', jobsFile, '--project', h.home], h.env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.split(/\r?\n/).filter((line) => line.startsWith('launched ')), [
      'launched claude (approval ask): session session-1',
      'launched agy on after-failure (approval ask): session session-3',
    ]);
    assert.match(r.stderr, /1 of 3 jobs failed: job 2 \(bad on broken\)/);
    assert.equal(h.launches.length, 3, 'each job must be attempted exactly once');
    assert.deepEqual(h.launches.map((params) => params.engine_id), ['claude', 'bad', 'agy']);
  } finally { await h.teardown(); }
});
