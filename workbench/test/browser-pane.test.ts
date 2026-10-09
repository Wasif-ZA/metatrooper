import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, openSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
// Opt-in (needs Electron + xvfb; slow): set METATROOPER_BROWSER_E2E=1.
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((res) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => res({ server, port: (server.address() as { port: number }).port }));
  });
}

/** Decodes an 8-bit non-interlaced RGB/RGBA PNG into rows of [r,g,b]. */
function decodePng(png: Buffer): { width: number; height: number; pixel: (x: number, y: number) => number[] } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : 3;
  assert.equal(png[24], 8);
  const chunks: Buffer[] = [];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p);
    if (png.toString('latin1', p + 4, p + 8) === 'IDAT') chunks.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const v = raw[y * (stride + 1) + 1 + x];
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth)) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [out[y * stride + x * channels], out[y * stride + x * channels + 1], out[y * stride + x * channels + 2]] };
}

const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;

test('M1-23 / M1-24 / M1-25 a pane blocks unowned targets for page scripts and evaluate, and captures a 5,000 px page with one sticky header', { skip: !runnable && 'set METATROOPER_BROWSER_E2E=1 (Windows, or Linux with xvfb)', timeout: 150_000 }, async () => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  const probeFile = join(iso.home, 'probe.log');
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_WORKBENCH_PROBE: probeFile };

  const hits = { unowned: 0, owned: 0 };
  const unowned = await listen((_req, res) => { hits.unowned++; res.end('secret'); });
  const owned = await listen((req, res) => {
    if (req.url === '/hit') { hits.owned++; res.end('ok'); return; }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/tall') {
      res.end('<!doctype html><style>body{margin:0;background:#fff}header{position:sticky;top:0;height:80px;background:#f00}main{height:4920px;background:#fff}</style><header></header><main></main>');
      return;
    }
    res.end('<!doctype html><title>scripts</title><body>x<button style="position:absolute;left:300px;top:200px;width:80px;height:30px">go</button></body>');
  });

  const core = await startCore({ ...iso, env });
  let wb: ChildProcess | null = null;
  try {
    const pipe = await client(iso.prefix);
    await uiHello(pipe, iso.home);
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const opened = await pipe.request('project.open', { path: project });
    const projectId = opened.result.project_id as string;
    const launched = await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: join(workbench, 'test', 'fixtures', 'browser-engine.cjs') });
    const sessionId = launched.result.session_id as string;
    const pane = await pipe.request('pane.open', { project_id: projectId, session_id: sessionId, url: `http://127.0.0.1:${owned.port}/scripts` });
    const paneId = pane.result.pane_id as string;
    pipe.close();
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('UPDATE browser_pane SET dev_port = ? WHERE id = ?').run(owned.port, paneId);
    await until(() => (db.prepare('SELECT pid FROM session WHERE id = ?').get(sessionId) as { pid: number | null }).pid, 15_000);
    db.close();

    const wbArgs: [string, string[]] = process.platform === 'win32'
      ? [electron, [workbench]]
      : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', workbench]];
    wb = spawn(wbArgs[0], wbArgs[1], { env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });

    const targets = [
      'file:///etc/passwd',
      `http://127.0.0.1:${unowned.port}/`,
      'http://192.168.1.1:81/',
      `http://[::1]:${unowned.port}/`,
      'http://[fd00::1]:81/',
      `http://localhost:${unowned.port}/`,
    ];
    const probe = (t: string) => `fetch(${JSON.stringify(t)}, { mode: 'no-cors' }).then(() => 'reached', () => 'blocked')`;
    const steps: Array<[string, string, object]> = [
      ['wait', 'browser.wait_for', { pane_id: paneId, text: 'x', timeout_ms: 20000 }],
      ['own', 'browser.evaluate', { pane_id: paneId, expression: `fetch('/hit').then((r) => r.status)` }],
      ...targets.map((t, i): [string, string, object] => [`eval${i}`, 'browser.evaluate', { pane_id: paneId, expression: probe(t) }]),
      // A script running inside the page (not through evaluate's own code path) makes the same requests.
      ['inject', 'browser.evaluate', { pane_id: paneId, expression: `document.body.appendChild(Object.assign(document.createElement('script'), { textContent: ${JSON.stringify(targets.map((t) => `fetch(${JSON.stringify(t)}, { mode: 'no-cors' }).catch(() => {});`).join(''))} })), 'injected'` }],
      ['settle', 'browser.wait_for', { pane_id: paneId, text: 'never-there', timeout_ms: 1500 }],
      ['snap', 'browser.snapshot', { pane_id: paneId }],
      ['click', 'browser.click', { pane_id: paneId, ref: 'e1' }],
      ['nav', 'browser.navigate', { pane_id: paneId, url: `http://127.0.0.1:${owned.port}/tall` }],
      ['shot', 'browser.screenshot', { pane_id: paneId, full_page: true }],
    ];
    writeFileSync(join(iso.home, 'browser-job.json'), JSON.stringify({ session_id: sessionId, steps }));
    const outFile = join(iso.home, 'browser-out.json');
    const out = await until(() => (existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null), 40_000).catch((e) => { throw new Error(`${e.message}; wb: ${existsSync(join(iso.home, 'workbench.err')) ? readFileSync(join(iso.home, 'workbench.err'), 'utf8').slice(-1500) : ''}; engine log: ${existsSync(join(iso.home, 'browser-engine.log')) ? readFileSync(join(iso.home, 'browser-engine.log'), 'utf8') : 'none'}`); });

    assert.equal(out.hello.result?.bound, 'session', JSON.stringify(out.hello));
    assert.equal(out.steps.wait.result?.found, true, JSON.stringify(out.steps.wait));
    assert.equal(out.steps.own.result?.value, 200, JSON.stringify(out.steps.own));
    targets.forEach((t, i) => assert.equal(out.steps[`eval${i}`].result?.value, 'blocked', `evaluate reached ${t}: ${JSON.stringify(out.steps[`eval${i}`])}`));
    await sleep(500);
    assert.equal(hits.unowned, 0, 'the unowned loopback port was contacted');
    assert.equal(hits.owned, 1);

    // M1-23: the overlay cursor is within 5 px of the click point before the click lands.
    assert.ok(out.steps.click.result?.ok, JSON.stringify(out.steps.snap) + JSON.stringify(out.steps.click));
    const probes = readFileSync(probeFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).state);
    const ci = probes.findIndex((e) => e.kind === 'cursor');
    const ki = probes.findIndex((e) => e.kind === 'click');
    assert.ok(ci >= 0 && ki > ci, 'cursor probe precedes click probe: ' + JSON.stringify(probes.slice(0, 5)));
    const cur = probes[ci];
    assert.ok(cur.at, 'overlay reported a position');
    assert.ok(Math.hypot(cur.at.x - cur.target.x, cur.at.y - cur.target.y) <= 5, JSON.stringify(cur));

    assert.ok(out.steps.shot.result, JSON.stringify(out.steps.shot) + readFileSync(join(iso.home, 'workbench.err'), 'utf8').split('\n').filter((l) => l.includes('METRICS')).join('\n'));
    const png = Buffer.from(out.steps.shot.result.png_base64, 'base64');
    const img = decodePng(png);
    assert.equal(img.height, 5000);
    assert.ok(isRed(img.pixel(10, 10)), 'sticky header shown at top');
    let redRows = 0;
    for (let y = 0; y < img.height; y++) if (isRed(img.pixel(10, y))) redRows++;
    assert.ok(redRows >= 78 && redRows <= 82, `header appears once (${redRows} red rows)`);
  } finally {
    killTree(wb?.pid);
    unowned.server.close();
    owned.server.close();
    await sleep(300);
    await teardownCore(core, iso);
  }
});
