import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Black-box tests: the brief and contracts/desktop-tools.md are the oracle.
const HELPER = fileURLToPath(new URL('../src/desktop/uia-helper.ps1', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../scripts/electron-fixture/', import.meta.url));
const ELECTRON = fileURLToPath(new URL('../../workbench/node_modules/electron/dist/electron.exe', import.meta.url));
const OPTIONS = {
  timeout: 180000,
  skip: process.platform !== 'win32' ? 'needs Windows UI Automation'
    : !existsSync(ELECTRON) ? 'Electron binary is not installed' : false,
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type State = { hwnd: number; text: string; clicks: number; checked: boolean; size: number };
type Snapshot = { text: string; nodes: number; truncated: boolean };
type Reply = { id: number; result?: any; error?: unknown };

async function pollState(path: string, matches: (state: State) => boolean, timeout: number,
  checkAlive: () => void = () => {}) {
  const end = Date.now() + timeout;
  let last: State | undefined;
  do {
    checkAlive();
    try {
      last = JSON.parse(readFileSync(path, 'utf8')) as State;
      if (matches(last)) return last;
    } catch (error) {
      // The fixture replaces the state file atomically; retry transient reads or partial JSON.
      const code = (error as NodeJS.ErrnoException).code;
      if (!(error instanceof SyntaxError) && !['ENOENT', 'EACCES', 'EPERM'].includes(code ?? '')) throw error;
    }
    await sleep(25);
  } while (Date.now() < end);
  assert.fail('state file did not reach the expected state: ' + JSON.stringify(last));
}

async function freshFixture(t: TestContext, size: number, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-38-row2-'));
  const statePath = join(dir, 'state.json');
  let helper: ChildProcess | undefined;
  let fixture: ChildProcess | undefined;
  let reader: readline.Interface | undefined;
  const waiting = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
  const failPending = (error: Error) => {
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  t.after(async () => {
    failPending(new Error('helper stopped for test cleanup'));
    reader?.close();
    try {
      if (helper && helper.exitCode === null && helper.signalCode === null) {
        const closed = new Promise<void>((resolve) => helper!.once('close', () => resolve()));
        helper.kill();
        await closed;
      }
    } finally {
      try {
        if (fixture?.pid) {
          // Only the process tree this test spawned; never kill Electron by image name.
          execFileSync('taskkill.exe', ['/T', '/F', '/PID', String(fixture.pid)],
            { stdio: 'ignore', windowsHide: true, timeout: 15000 });
        }
      } catch (error) {
        // taskkill can report an already-exited process; other failures must be visible.
        if (fixture?.exitCode === null && fixture.signalCode === null) throw error;
      } finally {
        const child = fixture;
        if (child && child.exitCode === null && child.signalCode === null) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              child.removeListener('exit', done);
              resolve();
            };
            const timer = setTimeout(done, 10000);
            child.once('exit', done);
          });
        }
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
        } catch {
          // Electron profile files can remain locked after exit; cleanup is best effort.
        }
      }
    }
  });

  const h = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy',
    'Bypass', '-File', HELPER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  helper = h;
  let helperFailure: Error | undefined;
  let helperStderr = '';
  h.stderr!.on('data', (chunk) => { helperStderr += String(chunk); });
  const helperFailed = (error: Error) => { helperFailure = error; failPending(error); };
  h.on('error', helperFailed);
  h.on('exit', (code, signal) => helperFailed(new Error('helper exited: ' + code + '/' + signal + ' ' + helperStderr)));
  h.stdin!.on('error', helperFailed);
  reader = readline.createInterface({ input: h.stdout! });
  reader.on('line', (line) => {
    try {
      const reply = JSON.parse(line) as Reply;
      const pending = waiting.get(reply.id);
      waiting.delete(reply.id);
      pending?.resolve(reply);
    } catch (error) { helperFailed(new Error('invalid helper reply: ' + line, { cause: error })); }
  });
  let nextId = 0;
  async function ask(req: Record<string, unknown>): Promise<any> {
    if (helperFailure) throw helperFailure;
    const id = ++nextId;
    const reply = await new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('helper request timed out: ' + JSON.stringify(req) + ' ' + helperStderr));
      }, 30000);
      waiting.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      h.stdin!.write(JSON.stringify({ id, ...req }) + '\n');
    });
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    return reply.result;
  }
  // The helper stands in for the workbench, as in the existing real-helper harnesses.
  const start = await ask({ op: 'process', process: h.pid });
  assert.ok(start.process_start, 'helper process start time is missing');
  const ui = { ui_pid: h.pid!, ui_start: start.process_start };

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  fixture = spawn(ELECTRON, [FIXTURE, '--user-data-dir=' + join(dir, 'profile'),
    '--size', String(size), '--state', statePath, ...extraArgs],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env });
  let fixtureFailure: Error | undefined;
  let fixtureStderr = '';
  fixture.stderr!.on('data', (chunk) => { fixtureStderr += String(chunk); });
  fixture.on('error', (error) => { fixtureFailure = error; });
  const state = await pollState(statePath, (s) => Number.isSafeInteger(s.hwnd) && s.hwnd > 0, 60000, () => {
    if (fixtureFailure) throw fixtureFailure;
    if (fixture!.exitCode !== null || fixture!.signalCode !== null) {
      throw new Error('fixture exited before publishing HWND: ' + fixtureStderr);
    }
  });
  // No warm-up snapshot, list query or startup sleep after the state file yields its HWND.
  const snapshot = await ask({ op: 'snapshot', hwnd: state.hwnd, max_nodes: 400 }) as Snapshot;
  return { snapshot, ask, hwnd: state.hwnd, ui, statePath };
}

function control(snapshot: Snapshot, role: string, name: string, action: string) {
  const line = snapshot.text.split(/\r?\n/).find((line) =>
    line.trimStart().startsWith(role + ' ') && line.includes('"' + name + '"'));
  assert.ok(line, 'missing ' + role + ' ' + name + '\n' + snapshot.text);
  const actions = /actions=\[([^\]]*)\]/.exec(line);
  assert.ok(actions, 'missing actions: ' + line);
  assert.ok(actions[1].split(',').map((value) => value.trim()).includes(action), 'missing ' + action + ': ' + line);
  const ref = /\[ref=(e\d+)\]/.exec(line);
  assert.ok(ref, 'missing ref: ' + line);
  return ref[1];
}

test('M8-38b: the first snapshot of a fresh size-8 Electron fixture contains its page and actions', OPTIONS, async (t) => {
  const { snapshot } = await freshFixture(t, 8);
  assert.match(snapshot.text, /^\s*document\b/m);
  control(snapshot, 'button', 'Fixture submit', 'Invoke');
  control(snapshot, 'edit', 'Fixture input', 'SetValue');
  control(snapshot, 'checkbox', 'Fixture toggle', 'Toggle');
  assert.match(snapshot.text, /^\s*text\s+"Fixture label"[^\r\n]*\[ref=e\d+\]/m);
  control(snapshot, 'button', 'Item 7', 'Invoke');
  assert.equal(snapshot.nodes, snapshot.text.split(/\r?\n/).filter((line) => line.includes('[ref=')).length);
  assert.equal(snapshot.truncated, false);
});

test('M8-38b: controls from the first snapshot can set the input and submit once', OPTIONS, async (t) => {
  const { snapshot, ask, hwnd, ui, statePath } = await freshFixture(t, 8);
  const input = control(snapshot, 'edit', 'Fixture input', 'SetValue');
  const submit = control(snapshot, 'button', 'Fixture submit', 'Invoke');
  const value = 'm8-38-row2-' + randomUUID();
  await ask({ op: 'set_text', hwnd, ref: input, value, ...ui });
  await ask({ op: 'click', hwnd, ref: submit, ...ui });
  const state = await pollState(statePath, (s) => s.text === value && s.clicks === 1, 5000);
  assert.equal(state.text, value);
  assert.equal(state.clicks, 1);
});

test('M8-38b: the first snapshot of a fresh size-64 Electron fixture contains Item 63', OPTIONS, async (t) => {
  const { snapshot } = await freshFixture(t, 64);
  control(snapshot, 'button', 'Item 63', 'Invoke');
});

test('M8-38b: the first snapshot includes the page when 20 menu items put the frame above the small-tree retry threshold', OPTIONS, async (t) => {
  const { snapshot } = await freshFixture(t, 8, ['--menu', '20']);
  assert.match(snapshot.text, /^[^\r\n]*"Menu 19"[^\r\n]*$/m);
  assert.match(snapshot.text, /^\s*document\b/m);
  control(snapshot, 'button', 'Fixture submit', 'Invoke');
});
