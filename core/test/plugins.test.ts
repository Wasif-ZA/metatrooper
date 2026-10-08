import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, sleep, startCore, teardownCore, uiHello, until, withEnv } from './helpers.ts';
import { validate } from '../src/jsonschema.ts';
import { validateManifest } from '../src/plugins/manifest.ts';
import { actionEnv, BASE_ENV, runAction } from '../src/plugins/actions.ts';
import { checkPaneMessage, paneCsp, resolvePaneFile } from '../src/plugins/bridge.ts';
import { importClaude, importCodex, parseToml } from '../src/plugins/importers.ts';
import { bindRole } from '../src/engines/registry.ts';
import { mcpAttachArgs } from '../src/plugins/mcp.ts';

before(buildGenerated);

const PLATFORMS = ['windows', 'linux', 'macos'];
const node = process.execPath;

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'troop-plugin-fixture-'));
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function script(dir: string, name: string, body: string): string {
  const file = join(dir, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
  return file;
}

async function withCore(fn: (h: { home: string; prefix: string }) => Promise<void>): Promise<void> {
  const iso = isolation();
  const env = { ...iso.env, METATROOPER_FAKE_DPAPI: '1', METATROOPER_ENGINES: join(iso.home, 'engines.json') };
  writeFileSync(env.METATROOPER_ENGINES, '[]');
  const core = await startCore({ ...iso, env });
  try {
    await fn(iso);
  } finally {
    await teardownCore(core, iso);
  }
}

async function ui(h: { home: string; prefix: string }) {
  const c = await client(h.prefix);
  await uiHello(c, h.home);
  return c;
}

function allFilesContain(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (readFileSync(p).includes(Buffer.from(needle))) hits.push(p);
    }
  };
  walk(dir);
  return hits;
}

test('the schema validator covers the keywords the manifest schema uses', () => {
  const schema = {
    type: 'object', required: ['a'], additionalProperties: false,
    properties: { a: { type: 'string', pattern: '^x' }, b: { type: 'array', items: { type: 'integer' }, minItems: 1, uniqueItems: true } },
    allOf: [{ if: { required: ['a'], properties: { a: { const: 'xy' } } }, then: { required: ['b'] } }],
  };
  assert.deepEqual(validate(schema, { a: 'xz' }), []);
  assert.deepEqual(validate(schema, { a: 'xy' }), ['/: missing required property b']);
  assert.deepEqual(validate(schema, { a: 'y', b: [1, 1], c: 1 }).sort(), ['/a: must match ^x', '/b/1: duplicate item', '/c: unknown property'].sort());
});

test('manifest validation: an action without external needs no destination_field; the rules the schema cannot say are checked', () => {
  const dir = fixtureDir();
  try {
    const ok = { schema: 1, id: 'demo', version: '1.0.0', name: 'Demo', actions: [{ id: 'go', run: ['node', '-v'] }] };
    assert.deepEqual(validateManifest(ok, dir), []);
    const bad = {
      schema: 1, id: 'demo', version: '1.0.0', name: 'Demo', permissions: [],
      actions: [{ id: 'go', run: ['../outside.js'] }, { id: 'go', run: ['node'], external: true, destination_field: 'to' }],
      mcp: [{ id: 's', command: 'x', env_keys: ['TOKEN'], engines: ['*'] }],
      pane_methods: ['gate.resolve'],
    };
    const errors = validateManifest(bad, dir);
    assert.ok(errors.includes('/actions: duplicate id go'), errors.join('\n'));
    assert.ok(errors.includes('/mcp/0/env_keys: TOKEN needs the permission secrets:TOKEN'));
    assert.ok(errors.includes('/pane_methods/0: gate.resolve cannot be called from a pane'));
    assert.ok(errors.includes('/actions/0/run/0: path must stay inside the plugin folder'));
    const external = validateManifest({ schema: 1, id: 'demo', version: '1.0.0', name: 'Demo', actions: [{ id: 'go', run: ['node'], external: true }] }, null);
    assert.deepEqual(external, ['/actions/0: missing required property destination_field']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M1-15 a plugin engine appears in engine and binds to a role; an invalid manifest is rejected with its schema errors', async () => {
  const dir = fixtureDir();
  try {
    writeJson(join(dir, 'troop-plugin.json'), {
      schema: 1, id: 'fake-engine', version: '1.0.0', name: 'Fake engine', platforms: PLATFORMS,
      engines: [{ id: 'fakecli', command: node, version_cmd: [node, '--version'], state_source: 'process', roles: ['research', 'review'], cost_rank: 1 }],
    });
    const badDir = fixtureDir();
    writeJson(join(badDir, 'troop-plugin.json'), { schema: 1, id: 'Bad Id', version: '1', name: 'x', engines: [{ id: 'e' }] });
    await withCore(async (h) => {
      const c = await ui(h);
      try {
        const noUi = await client(h.prefix);
        const refused = await noUi.request('plugin.install', { source: dir, approved_permissions: [] });
        noUi.close();
        assert.equal(refused.error.code, -32012);

        const bad = await c.request('plugin.install', { source: badDir, approved_permissions: [] });
        assert.equal(bad.error.code, -32003);
        assert.ok(bad.error.data.errors.some((e: string) => e.startsWith('/id: must match')), JSON.stringify(bad.error));
        assert.ok(bad.error.data.errors.some((e: string) => e.startsWith('/version: must match')));
        assert.ok(bad.error.data.errors.some((e: string) => e === '/engines/0: missing required property command'));

        const preview = await c.request('plugin.preview', { source: dir });
        assert.equal(preview.result.valid, true);
        assert.deepEqual(preview.result.screen.engines, [{ id: 'fakecli', command: node, roles: ['research', 'review'] }]);

        const installed = await c.request('plugin.install', { source: dir, approved_permissions: [], manifest_hash: preview.result.manifest_hash });
        assert.equal(installed.result.plugin_id, 'fake-engine');

        const db = new DatabaseSync(join(h.home, 'troop.db'));
        try {
          assert.equal((db.prepare("SELECT plugin_id FROM engine WHERE id = 'fakecli'").get() as { plugin_id: string }).plugin_id, 'fake-engine');
          await until(() => db.prepare("SELECT installed FROM engine_check WHERE engine_id = 'fakecli' AND installed = 1").get(), 5000);
          assert.equal(bindRole(db, 'research')?.id, 'fakecli');
          assert.equal(bindRole(db, 'plan'), null);
        } finally {
          db.close();
        }

        const removed = await c.request('plugin.remove', { plugin_id: 'fake-engine' });
        assert.deepEqual(removed.result, {});
        const db2 = new DatabaseSync(join(h.home, 'troop.db'), { readOnly: true });
        try {
          assert.equal(db2.prepare("SELECT 1 FROM engine WHERE id = 'fakecli'").get(), undefined);
          assert.equal(db2.prepare("SELECT 1 FROM plugin WHERE id = 'fake-engine'").get(), undefined);
        } finally {
          db2.close();
        }
      } finally {
        c.close();
      }
    });
    rmSync(badDir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install refuses approvals that do not match the permissions asked for, and a manifest that changed since preview', async () => {
  const dir = fixtureDir();
  try {
    writeJson(join(dir, 'troop-plugin.json'), { schema: 1, id: 'perm-demo', version: '1.0.0', name: 'Perm demo', platforms: PLATFORMS, permissions: ['network', 'secrets:TOKEN'] });
    await withCore(async (h) => {
      const c = await ui(h);
      try {
        const preview = await c.request('plugin.preview', { source: dir });
        assert.deepEqual(preview.result.screen.permissions.map((p: { permission: string }) => p.permission), ['network', 'secrets:TOKEN']);
        assert.ok(preview.result.screen.warnings.some((w: string) => w.includes('does not block')));
        const partial = await c.request('plugin.install', { source: dir, approved_permissions: ['network'] });
        assert.equal(partial.error.code, -32003);
        assert.deepEqual(partial.error.data.errors, ['not approved: secrets:TOKEN']);
        const changed = await c.request('plugin.install', { source: dir, approved_permissions: ['network', 'secrets:TOKEN'], manifest_hash: 'f'.repeat(64) });
        assert.equal(changed.error.code, -32003);
        const ok = await c.request('plugin.install', { source: dir, approved_permissions: ['network', 'secrets:TOKEN'] });
        assert.deepEqual(ok.result.missing_secrets, ['TOKEN']);
        const db = new DatabaseSync(join(h.home, 'troop.db'), { readOnly: true });
        try {
          assert.equal((db.prepare("SELECT text FROM needs_you WHERE kind = 'missing-secret' AND resolved_at IS NULL").get() as { text: string }).text, 'set TOKEN for perm-demo');
        } finally {
          db.close();
        }
        const set = await c.request('plugin.secret.set', { plugin_id: 'perm-demo', name: 'TOKEN', value: 'tok-value-991' });
        assert.deepEqual(set.result, {});
        assert.deepEqual(allFilesContain(h.home, 'tok-value-991'), []);
      } finally {
        c.close();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function pluginRecord(dir: string, actions: unknown[], permissions: string[] = []) {
  return {
    id: 'act', version: '1.0.0', path: dir, source: 'native' as const, enabled: true, permissions,
    manifest: { schema: 1 as const, id: 'act', version: '1.0.0', name: 'Act', permissions, actions: actions as never },
  };
}

test('M1-16 an action sees only the base variables, the TROOP_ paths and approved secrets', async () => {
  const dir = fixtureDir();
  const runDir = join(dir, 'run');
  try {
    script(dir, 'bin/env.js', `
      const fs = require('node:fs');
      let input = '';
      process.stdin.on('data', c => input += c).on('end', () => {
        fs.writeFileSync(process.env.TROOP_RUN_DIR + '/env.json', JSON.stringify(process.env));
        console.error('line one'); console.error('line two');
        process.stdout.write(JSON.stringify({ ok: true, outputs: { got: JSON.parse(input) } }));
      });`);
    process.env.TROOP_TEST_LEAK = 'leaked';
    const r = await runAction({
      plugin: pluginRecord(dir, [{ id: 'env', run: ['bin/env.js'], output_schema: { type: 'object', required: ['got'] } }], ['secrets:API_TOKEN', 'network']),
      actionId: 'env', input: { a: 1 }, projectDir: dir, run: { id: 'r1', dir: runDir },
      secret: (n) => (n === 'API_TOKEN' ? 'sekrit' : null),
    });
    delete process.env.TROOP_TEST_LEAK;
    assert.equal(r.ok, true, JSON.stringify(r));
    const got = (r as { outputs: { got: Record<string, unknown> } }).outputs.got;
    assert.deepEqual({ schema: got.schema, action: got.action, input: got.input, run: got.run }, { schema: 1, action: 'env', input: { a: 1 }, run: { id: 'r1', dir: runDir } });
    const env = JSON.parse(readFileSync(join(runDir, 'env.json'), 'utf8'));
    const allowed = new Set([...BASE_ENV, 'TROOP_RUN_DIR', 'TROOP_PROJECT_DIR', 'TROOP_PLUGIN_DIR', 'API_TOKEN']);
    // libuv's required_vars (src/win/process.c) are copied from the parent on every Windows spawn.
    if (process.platform === 'win32') for (const k of ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME']) allowed.add(k);
    const unexpected = Object.keys(env).filter((k) => !allowed.has(k.toUpperCase()) && !(process.platform === 'win32' && k.startsWith('=')));
    assert.deepEqual(unexpected, []);
    assert.equal(env.API_TOKEN, 'sekrit');
    assert.equal(env.TROOP_TEST_LEAK, undefined);
    const log = readFileSync(join(runDir, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => l.line), ['line one', 'line two']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an action receives the TROOP_ tool path overrides its plugin reads', () => {
  const dir = fixtureDir();
  try {
    const env = withEnv({ TROOP_CHROME: 'C:/edge.exe', TROOP_PDFTOTEXT: 'C:/pdftotext.exe' }, () => actionEnv({
      plugin: pluginRecord(dir, []), actionId: 'x', input: {}, projectDir: dir, run: { id: 'r', dir }, secret: () => null,
    }).env);
    assert.equal(env.TROOP_CHROME, 'C:/edge.exe');
    assert.equal(env.TROOP_PDFTOTEXT, 'C:/pdftotext.exe');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an action\'s stderr reaches log.jsonl with its secret values redacted', async () => {
  const dir = fixtureDir();
  try {
    script(dir, 'bin/leak.js', `process.stdin.resume(); process.stdin.on('end', () => { console.error('token=' + process.env.API_TOKEN); process.stderr.write('tail ' + process.env.API_TOKEN); process.stdout.write('{"ok":true,"outputs":{}}'); });`);
    const lines: string[] = [];
    const r = await runAction({
      plugin: pluginRecord(dir, [{ id: 'leak', run: ['bin/leak.js'] }], ['secrets:API_TOKEN']),
      actionId: 'leak', input: {}, projectDir: dir, run: { id: 'r', dir: join(dir, 'run') }, secret: () => 'sekrit-991',
    }, (l) => lines.push(l));
    assert.equal(r.ok, true);
    assert.ok(!readFileSync(join(dir, 'run', 'log.jsonl'), 'utf8').includes('sekrit-991'));
    assert.deepEqual(lines, ['token=[redacted]', 'tail [redacted]']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a timed-out action resolves while an orphaned grandchild still holds its stdout', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const dir = fixtureDir();
  try {
    script(dir, 'bin/orphan.cmd', '@start /b ping -n 8 127.0.0.1\r\n');
    const started = Date.now();
    const r = await runAction({
      plugin: pluginRecord(dir, [{ id: 'orphan', run: ['bin/orphan.cmd'], timeout_seconds: 1 }]),
      actionId: 'orphan', input: {}, projectDir: tmpdir(), run: { id: 'r', dir: join(dir, 'run') }, secret: () => null,
    });
    assert.deepEqual(r, { ok: false, error: { message: 'action timed out after 1 s', retryable: true } });
    assert.ok(Date.now() - started < 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M1-16 a hung action is killed with its child processes at its timeout', async () => {
  const dir = fixtureDir();
  try {
    script(dir, 'bin/hang.js', `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      require('node:fs').writeFileSync(process.env.TROOP_RUN_DIR + '/child.pid', String(child.pid));
      setInterval(() => {}, 1000);`);
    const started = Date.now();
    const r = await runAction({
      plugin: pluginRecord(dir, [{ id: 'hang', run: ['bin/hang.js'], timeout_seconds: 1 }]),
      actionId: 'hang', input: {}, projectDir: dir, run: { id: 'r2', dir: join(dir, 'run') }, secret: () => null,
    });
    assert.deepEqual(r, { ok: false, error: { message: 'action timed out after 1 s', retryable: true } });
    assert.ok(Date.now() - started < 5000);
    const pid = Number(readFileSync(join(dir, 'run', 'child.pid'), 'utf8'));
    await until(() => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }, 3000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an action that writes anything but one result object fails with "action wrote invalid output"', async () => {
  const dir = fixtureDir();
  try {
    script(dir, 'bin/noisy.js', `process.stdin.resume(); process.stdin.on('end', () => { console.log('hello'); console.log(JSON.stringify({ ok: true, outputs: {} })); });`);
    script(dir, 'bin/soft-fail.js', `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ ok: false, error: { message: 'rate limited', retryable: true } })); process.exitCode = 3; });`);
    const plugin = pluginRecord(dir, [{ id: 'noisy', run: ['bin/noisy.js'] }, { id: 'soft', run: ['bin/soft-fail.js'] }]);
    const base = { plugin, input: {}, projectDir: dir, run: { id: 'r3', dir: join(dir, 'run') }, secret: () => null };
    assert.deepEqual(await runAction({ ...base, actionId: 'noisy' }), { ok: false, error: { message: 'action wrote invalid output', retryable: false } });
    assert.deepEqual(await runAction({ ...base, actionId: 'soft' }), { ok: false, error: { message: 'rate limited', retryable: true } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M1-25a an action with the stripped environment runs npm by name', async () => {
  const dir = fixtureDir();
  try {
    script(dir, 'bin/npm-version.js', `
      const { execFileSync } = require('node:child_process');
      process.stdin.resume();
      process.stdin.on('end', () => {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const v = execFileSync(npm, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
        process.stdout.write(JSON.stringify({ ok: true, outputs: { v } }));
      });`);
    const r = await runAction({
      plugin: pluginRecord(dir, [{ id: 'nested', run: ['bin/npm-version.js'] }]),
      actionId: 'nested', input: {}, projectDir: dir, run: { id: 'r4', dir: join(dir, 'run') }, secret: () => null,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match((r as { outputs: { v: string } }).outputs.v, /^\d+\.\d+\.\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M1-25a an action runs a .cmd script by name', { skip: process.platform !== 'win32' && 'needs cmd.exe' }, async () => {
  const dir = fixtureDir();
  try {
    script(dir, 'tools/say.cmd', '@echo {"ok":true,"outputs":{"said":"%~1"}}\r\n');
    const withPath = process.env.PATH;
    process.env.PATH = `${join(dir, 'tools')};${withPath}`;
    try {
      const r2 = await runAction({
        plugin: pluginRecord(dir, [{ id: 'say', run: ['say', 'hi'] }]),
        actionId: 'say', input: {}, projectDir: dir, run: { id: 'r5', dir: join(dir, 'run') }, secret: () => null,
      });
      assert.deepEqual(r2, { ok: true, outputs: { said: 'hi' } });
    } finally {
      process.env.PATH = withPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pane bridge: CSP, file resolution inside the plugin, and each message rule', () => {
  const dir = fixtureDir();
  try {
    script(dir, 'pane/index.html', '<p>hi</p>');
    assert.equal(paneCsp('demo'), "default-src troop-plugin://demo data:; connect-src 'none'");
    assert.ok(resolvePaneFile(dir, '/pane/index.html')?.endsWith('index.html'));
    assert.equal(resolvePaneFile(dir, '/pane/../../etc/passwd'), null);
    assert.equal(resolvePaneFile(dir, '/pane/%2e%2e/%2e%2e/x'), null);
    assert.equal(resolvePaneFile(dir, '/missing.html'), null);

    const plugin = { id: 'demo', permissions: [], manifest: { pane_methods: ['run.start'] } };
    assert.deepEqual(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'read', query: 'runs' }), { allow: true, kind: 'read', query: 'runs', id: undefined });
    assert.equal(checkPaneMessage(plugin, 'other', { plugin_id: 'demo', type: 'read', query: 'runs' }).allow, false);
    assert.equal(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'read', query: 'secrets' }).allow, false);
    assert.equal(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'command', method: 'run.start', params: {} }).allow, true);
    assert.equal(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'command', method: 'gate.resolve', params: {} }).allow, false);
    assert.equal(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'clipboard.write', text: 'x' }).allow, false);
    assert.equal(checkPaneMessage({ ...plugin, permissions: ['clipboard'] }, 'demo', { plugin_id: 'demo', type: 'clipboard.write', text: 'x' }).allow, true);
    assert.equal(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'open', url: 'file:///c:/x' }).allow, false);
    assert.equal(checkPaneMessage(plugin, 'demo', { plugin_id: 'demo', type: 'open', url: 'https://example.com/a' }).allow, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex importer reads mcp_servers tables and env from config.toml', () => {
  const dir = fixtureDir();
  try {
    const file = script(dir, 'config.toml', [
      'model = "gpt"',
      'notify = ["node", "C:\\\\tools\\\\n.js"]',
      '[mcp_servers.docs]',
      'command = "npx"',
      'args = ["-y", "docs-mcp"]',
      'env = { DOCS_KEY = "abc123", HOME_DIR = "${HOME}" }',
      '',
      '[mcp_servers."web search"]',
      "command = 'web'",
      '[mcp_servers."web search".env]',
      'WEB_TOKEN = "${WEB_TOKEN}"',
    ].join('\n'));
    assert.equal((parseToml(readFileSync(file, 'utf8')).notify as string[])[1], 'C:\\tools\\n.js');
    const plan = importCodex(file);
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.manifest.mcp?.map((s) => [s.id, s.command, s.args, s.env_keys, s.engines]), [
      ['docs', 'npx', ['-y', 'docs-mcp'], ['DOCS_KEY', 'HOME_DIR'], ['codex']],
      ['web-search', 'web', [], ['WEB_TOKEN'], ['codex']],
    ]);
    assert.deepEqual(plan.env.docs, { DOCS_KEY: { kind: 'literal', value: 'abc123' }, HOME_DIR: { kind: 'ref', name: 'HOME' } });
    assert.deepEqual(plan.manifest.permissions, ['secrets:DOCS_KEY', 'secrets:HOME_DIR', 'secrets:WEB_TOKEN']);
    assert.deepEqual(validateManifest(plan.manifest, null), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mcpClient(shimArgs: string[], env: Record<string, string | undefined>): Promise<{ reply: Record<string, any>; code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [join(root, 'core', 'mcp-shim.js'), ...shimArgs], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let stderr = '';
    let reply: Record<string, any> | null = null;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`shim did not answer: ${stderr}`)); }, 8000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      out += c;
      const i = out.indexOf('\n');
      if (i >= 0 && !reply) {
        reply = JSON.parse(out.slice(0, i));
        child.stdin.end();
      }
    });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ reply: reply ?? {}, code, stderr }); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  });
}

test('M1-17 and M1-25b an imported Claude plugin: secrets:<KEY> asked for, literal moved to the store only, server starts through the shim, a missing variable is reported', async () => {
  const dir = fixtureDir();
  const literal = 'literal-secret-value-7731';
  try {
    const server = script(dir, 'server.js', `
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => {
        buf += c;
        const i = buf.indexOf('\\n');
        if (i < 0) return;
        const msg = JSON.parse(buf.slice(0, i));
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { key: process.env.API_KEY, other: process.env.OTHER_KEY ?? null } }) + '\\n');
      });
      process.stdin.on('end', () => process.exit(0));`);
    writeJson(join(dir, '.claude-plugin', 'plugin.json'), {
      name: 'Fixture Tools', version: '1.2.3', description: 'fixture',
      mcpServers: {
        tools: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'], env: { API_KEY: literal } },
        needs: { command: 'node', args: [server], env: { OTHER_KEY: '${TROOP_TEST_UNSET_VAR}' } },
      },
      hooks: { PreToolUse: [] },
    });
    script(dir, 'skills/demo/SKILL.md', '# demo');
    const plan = importClaude(dir);
    assert.equal(plan.manifest.id, 'claude-fixture-tools');
    assert.deepEqual(plan.manifest.permissions, ['secrets:API_KEY', 'secrets:OTHER_KEY']);

    await withCore(async (h) => {
      const c = await ui(h);
      try {
        const source = `claude-import:${dir}`;
        const preview = await c.request('plugin.preview', { source });
        assert.equal(preview.result.valid, true, JSON.stringify(preview.result.errors));
        assert.deepEqual(preview.result.screen.permissions.map((p: { permission: string }) => p.permission), ['secrets:API_KEY', 'secrets:OTHER_KEY']);
        assert.deepEqual(preview.result.screen.secrets_migrated, ['API_KEY']);
        assert.equal(preview.result.screen.skills.length, 1);
        assert.match(preview.result.screen.hooks[0], /not imported/);
        assert.equal(existsSync(join(h.home, 'plugins', 'claude-fixture-tools')), false);

        const installed = await c.request('plugin.install', { source, approved_permissions: ['secrets:API_KEY', 'secrets:OTHER_KEY'] });
        assert.ok(installed.result, JSON.stringify(installed.error));
        assert.equal(installed.result.plugin_id, 'claude-fixture-tools');
        assert.deepEqual(installed.result.missing_secrets, []);

        const shimEnv = { ...process.env, METATROOPER_HOME: h.home, METATROOPER_PIPE_PREFIX: h.prefix };
        delete shimEnv.TROOP_TEST_UNSET_VAR;
        const ok = await mcpClient(['claude-fixture-tools', 'tools'], shimEnv);
        assert.deepEqual(ok.reply, { jsonrpc: '2.0', id: 1, result: { key: literal, other: null } }, ok.stderr);

        const missing = await mcpClient(['claude-fixture-tools', 'needs'], shimEnv);
        assert.equal(missing.code, 1);
        assert.match(missing.reply.error.message, /OTHER_KEY/);
        const withVar = await mcpClient(['claude-fixture-tools', 'needs'], { ...shimEnv, TROOP_TEST_UNSET_VAR: 'from-env' });
        assert.equal(withVar.reply.result.other, 'from-env');

        const db = new DatabaseSync(join(h.home, 'troop.db'));
        const previousCodexPath = process.env.METATROOPER_CODEX_CONFIG;
        const codexConfig = join(h.home, 'codex-config.toml');
        process.env.METATROOPER_CODEX_CONFIG = codexConfig;
        try {
          await until(() => db.prepare("SELECT 1 FROM needs_you WHERE kind = 'missing-secret' AND text = 'set OTHER_KEY for claude-fixture-tools'").get());
          const claude = { id: 'claude', command: 'claude', version_cmd: ['claude'], state_source: 'hooks' as const, roles: ['worker'], cost_rank: 3, mcp_attach: { kind: 'claude-mcp-config-flag' } };
          const args = withEnv({ METATROOPER_HOME: h.home }, () => mcpAttachArgs(db, claude, 'S1'));
          assert.equal(args.length, 1);
          assert.ok(args[0].startsWith('--mcp-config='));
          const config = readFileSync(args[0].slice('--mcp-config='.length), 'utf8');
          assert.match(config, /mcp-shim\.js/);
          assert.match(config, /metatrooper-browser\.js/);
          assert.ok(!config.includes(literal));
          const codex = withEnv({ METATROOPER_HOME: h.home }, () => mcpAttachArgs(db, { ...claude, id: 'codex', mcp_attach: { kind: 'codex-config' } }, 'S2'));
          assert.ok(!existsSync(codexConfig));
          assert.equal(codex.filter((a) => a === '-c').length, 2);
          assert.match(codex[1], /^mcp_servers\.metatrooper-browser\.command=".*"$/);
          assert.match(codex[3], /^mcp_servers\.metatrooper-browser\.args=\[".*metatrooper-browser\.js"\]$/);
          assert.ok(!codex.join(' ').includes(literal));
        } finally {
          if (previousCodexPath === undefined) delete process.env.METATROOPER_CODEX_CONFIG;
          else process.env.METATROOPER_CODEX_CONFIG = previousCodexPath;
          db.close();
        }
        await sleep(300);
        assert.deepEqual(allFilesContain(h.home, literal), []);
        const dpapi = join(h.home, 'secrets', 'claude-fixture-tools', 'API_KEY.dpapi');
        assert.ok(statSync(dpapi).size > 0);

        await c.request('plugin.remove', { plugin_id: 'claude-fixture-tools' });
        assert.equal(existsSync(dpapi), false);
        assert.equal(existsSync(join(h.home, 'plugins', 'claude-fixture-tools')), false);
        assert.ok(existsSync(join(dir, '.claude-plugin', 'plugin.json')));
      } finally {
        c.close();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plugin actions resolve a .js entry through node and refuse paths outside the plugin', async () => {
  const dir = fixtureDir();
  try {
    const out = script(dir, 'x.sh', '#!/bin/sh\necho ok\n');
    chmodSync(out, 0o755);
    const r = await runAction({
      plugin: pluginRecord(dir, [{ id: 'out', run: ['../../bin/sh'] }]),
      actionId: 'out', input: {}, projectDir: dir, run: { id: 'r6', dir: join(dir, 'run') }, secret: () => null,
    });
    assert.deepEqual(r, { ok: false, error: { message: 'command not found: ../../bin/sh', retryable: false } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
