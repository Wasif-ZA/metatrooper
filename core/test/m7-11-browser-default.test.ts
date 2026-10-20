import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { attachesBrowser } from '../src/plugins/mcp.ts';
import type { EngineSpec } from '../src/engines/registry.ts';
import { buildGenerated, client, isolation, root, runNode, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const engine = (kind = 'claude-mcp-config-flag') => ({
  id: 'claude', command: process.execPath, args: [], prompt_arg: 'positional',
  state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none',
  provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  mcp_attach: { kind },
});

async function fixture(kind = 'claude-mcp-config-flag', settings?: object) {
  const iso = isolation();
  const script = join(iso.home, 'engine.mjs');
  writeFileSync(script, 'setTimeout(() => process.exit(0), 1500);');
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ ...engine(kind), args: [script] }]));
  if (settings) writeFileSync(join(iso.home, 'settings.json'), JSON.stringify(settings));
  const isolated = { ...iso, env: { ...iso.env, METATROOPER_ENGINES: registry } };
  const core = await startCore(isolated);
  const pipe = await client(iso.prefix);
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const opened = await pipe.request('project.open', { path: project });
  assert.ok(opened.result?.project_id, JSON.stringify(opened));
  const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
  return {
    ...isolated, pipe, db, projectId: opened.result.project_id as string,
    async launch(browser?: unknown) {
      return pipe.request('session.launch', {
        project_id: opened.result.project_id, engine_id: 'claude',
        ...(browser === undefined ? {} : { browser }),
      });
    },
    browser(id: string) {
      return (db.prepare('SELECT browser FROM session WHERE id = ?').get(id) as { browser: number }).browser;
    },
    config(id: string) {
      const file = join(iso.home, 'mcp', `${id}.json`);
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },
    async close() { db.close(); pipe.close(); await teardownCore(core, isolated); },
  };
}

test('M7-11a launch defaults to a Claude browser MCP server and stores browser 1', async () => {
  const h = await fixture();
  try {
    const r = await h.launch();
    assert.ok(r.result?.session_id, JSON.stringify(r));
    const id = r.result.session_id;
    assert.ok(h.config(id)?.mcpServers?.['metatrooper-browser']);
    assert.equal(h.browser(id), 1);
  } finally { await h.close(); }
});

test('M7-11b browser false omits the MCP server and stores browser 0', async () => {
  const h = await fixture();
  try {
    const r = await h.launch(false);
    assert.ok(r.result?.session_id, JSON.stringify(r));
    const id = r.result.session_id;
    assert.equal(h.config(id)?.mcpServers?.['metatrooper-browser'], undefined);
    assert.equal(h.browser(id), 0);
  } finally { await h.close(); }
});

test('M7-11b sessions.browser false disables an omitted browser param', async () => {
  const h = await fixture('claude-mcp-config-flag', { sessions: { browser: false } });
  try {
    const r = await h.launch();
    assert.ok(r.result?.session_id, JSON.stringify(r));
    const id = r.result.session_id;
    assert.equal(h.config(id)?.mcpServers?.['metatrooper-browser'], undefined);
    assert.equal(h.browser(id), 0);
  } finally { await h.close(); }
});

test('M7-11 session.launch rejects browser string with -32602', async () => {
  const h = await fixture();
  try {
    const r = await h.launch('yes');
    assert.equal(r.error?.code, -32602);
  } finally { await h.close(); }
});

test('M7-11 agy-config cannot attach the browser and stores browser 0', async () => {
  const h = await fixture('agy-config');
  try {
    const r = await h.launch();
    assert.ok(r.result?.session_id, JSON.stringify(r));
    assert.equal(h.browser(r.result.session_id), 0);
    assert.equal(h.config(r.result.session_id), null);
  } finally { await h.close(); }
});

test('M7-11c resume of an exited browser session attaches it again', async () => {
  const h = await fixture();
  try {
    const first = await h.launch();
    assert.ok(first.result?.session_id, JSON.stringify(first));
    const oldId = first.result.session_id;
    assert.equal(h.browser(oldId), 1);
    await until(() => (h.db.prepare('SELECT state FROM session WHERE id = ?').get(oldId) as { state: string }).state === 'exited', 6000);
    const resumed = await h.pipe.request('session.resume', { session_id: oldId });
    assert.ok(resumed.result?.session_id, JSON.stringify(resumed));
    assert.notEqual(resumed.result.session_id, oldId);
    assert.equal(h.browser(resumed.result.session_id), 1);
    assert.ok(h.config(resumed.result.session_id)?.mcpServers?.['metatrooper-browser']);
  } finally { await h.close(); }
});

test('attachesBrowser accepts stdio-capable kinds and rejects unsupported kinds', () => {
  const cases: Array<[EngineSpec['mcp_attach'], boolean]> = [
    [{ kind: 'claude-mcp-config-flag' }, true],
    [{ kind: 'codex-config' }, true],
    [{ kind: 'args-template', template: ['--mcp', '{name}', '{node}', '{shim}'] }, true],
    [{ kind: 'args-template', template: ['--mcp', '{url}'] }, false],
    [{ kind: 'env-json', env: 'MCP_JSON' }, true],
    [{ kind: 'env-json' }, false],
    [{ kind: 'config-dir', env: 'MCP_DIR' }, true],
    [{ kind: 'config-dir' }, false],
    [{ kind: 'agy-config' }, false],
    [undefined, false],
  ];
  for (const [mcp_attach, expected] of cases) {
    assert.equal(attachesBrowser({ ...engine(), mcp_attach } as EngineSpec), expected, JSON.stringify(mcp_attach));
  }
});

test('attachesBrowser rejects an args-template with no arguments to carry the server', () => {
  assert.equal(attachesBrowser({ ...engine(), mcp_attach: { kind: 'args-template', template: [] } } as EngineSpec), false);
});

test('M7-11e browser tool returns the closed-workbench error promptly', async () => {
  const iso = isolation();
  const child = spawn(process.execPath, [join(root, 'core', 'metatrooper-browser.js')], {
    cwd: root, env: iso.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    const reply = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('browser tool hung while workbench was closed')), 4000);
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        clearTimeout(timer);
        resolve(JSON.parse(buffer.slice(0, end)));
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`browser MCP exited ${code} before replying`)));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'panes', arguments: {} } }) + '\n');
    });
    assert.equal(reply.id, 1);
    assert.equal(reply.result?.isError, true);
    assert.equal(reply.result?.content?.[0]?.text, 'browser not available: the MetaTrooper workbench is closed');
  } finally {
    child.kill();
    rmSync(iso.home, { recursive: true, force: true });
  }
});

test('troop launch rejects simultaneous --browser and --no-browser with exit 2', async () => {
  const iso = isolation();
  try {
    const r = await runNode(['core/cli.ts', 'launch', 'claude', '--browser', '--no-browser'], iso.env);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /--browser or --no-browser/);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('troop launch rejects a jobs entry with a non-boolean browser', async () => {
  const iso = isolation();
  try {
    const jobs = join(iso.home, 'jobs.json');
    writeFileSync(jobs, JSON.stringify([{ engine: 'claude', browser: 'x' }]));
    const r = await runNode(['core/cli.ts', 'launch', '--jobs', jobs], iso.env);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /browser must be true or false/);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});
