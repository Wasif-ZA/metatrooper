import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sleep, until } from '../../core/test/helpers.ts';
import { HeadlessBrowser, HeadlessTab } from '../src/browser/headless.ts';
import { ENGINES, boot, exe, headlessProcs, killHeadless, runnable, served } from './m8-42-headless-e2e.test.ts';

const src = readFileSync(resolve(import.meta.dirname, '..', 'src', 'browser', 'panes.ts'), 'utf8');

// protects=the chrome-headless-shell engine stays off while HEADLESS_HELD is set, and nothing is spawned first
// fails_when=HEADLESS_HELD is empty, or createHeadless builds a HeadlessBrowser before it throws
test('M8-42 held: HEADLESS_HELD is set and createHeadless throws before it builds the browser', () => {
  assert.match(src, /const HEADLESS_HELD = '[^']+'/, 'HEADLESS_HELD is empty');
  const body = src.slice(src.indexOf('private async createHeadless('));
  const thrown = body.indexOf('if (HEADLESS_HELD)');
  const built = body.indexOf('new HeadlessBrowser');
  assert.ok(thrown >= 0 && built > thrown, 'the HEADLESS_HELD throw does not come before new HeadlessBrowser');
});

// protects=with the engine set to chrome-headless-shell the pane never opens (createHeadless throws 'turned off', which sync swallows) and no headless process starts; electron still works
// fails_when=navigate succeeds on headless, a chrome-headless-shell process runs, or electron navigate fails
test('M8-42 held: headless is refused as turned off with no process, electron works', { skip: !runnable && 'needs METATROOPER_BROWSER_E2E=1 and METATROOPER_HEADLESS_EXE', timeout: 240_000 }, async () => {
  killHeadless();
  const srv = await served(() => '<!doctype html><title>held</title><p>hi</p>');
  const run = async (engine: keyof typeof ENGINES) => {
    const h = await boot(ENGINES[engine]);
    try {
      await h.openWorkbench();
      try {
        const s = await h.session(srv.url, srv.port);
        const r = await s.job([['nav', 'mcp.call', { name: 'navigate', arguments: { pane_id: s.pane, url: srv.url } }]]);
        return { text: JSON.stringify(r.steps.nav.reply), procs: headlessProcs() };
      } catch (e) {
        return { text: (e as Error).message, procs: headlessProcs() };
      }
    } finally {
      await h.done();
    }
  };
  try {
    const hl = await run('headless');
    // sync() swallows createHeadless's 'turned off' error; pane() rethrows it from failed.why
    assert.match(hl.text, /isError":true/);
    assert.match(hl.text, /turned off/);
    assert.equal(hl.procs, 0, 'a chrome-headless-shell process started');
    const el = await run('electron');
    assert.doesNotMatch(el.text, /isError":true|"error"/, el.text);
    assert.match(el.text, /held/);
  } finally {
    srv.close();
    killHeadless();
  }
});

// protects=a shared worker ends the tab before its request reaches the server, and a killed tab leaves no page in its context
// fails_when=the tab lives on, the worker's fetch arrives, or a page target remains after kill
test('M8-42 held: a shared worker ends the tab and kill closes the page', { skip: !(exe !== '' && existsSync(exe)) && 'needs METATROOPER_HEADLESS_EXE', timeout: 120_000 }, async () => {
  killHeadless();
  const hits: string[] = [];
  const srv = createServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/sw.js') { res.setHeader('content-type', 'text/javascript'); res.end("fetch('/shared-fetch').catch(() => {});"); return; }
    res.setHeader('content-type', 'text/html');
    res.end("<!doctype html><title>sw</title><script>new SharedWorker('/sw.js')</script>");
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
  const browser = new HeadlessBrowser(exe);
  try {
    const tab = await HeadlessTab.open(browser, 'Mozilla/5.0 test', async () => ({ allow: true }), () => {}, () => {});
    await tab.dbg.sendCommand('Page.enable').catch(() => {});
    await tab.dbg.sendCommand('Page.navigate', { url }).catch(() => {});
    await until(() => tab.dead, 20_000);
    assert.match(tab.dead ?? '', /shared worker/);
    await sleep(1500);
    assert.ok(!hits.includes('/shared-fetch'), `the shared worker's fetch reached the server: ${hits.join(' ')}`);

    // a second tab, killed by hand: its page target must be gone
    const t2 = await HeadlessTab.open(browser, 'Mozilla/5.0 test', async () => ({ allow: true }), () => {}, () => {});
    const pages = async () => ((await browser.send('Target.getTargets')).targetInfos as any[]).filter((t) => t.type === 'page' && t.browserContextId === t2.contextId);
    assert.equal((await pages()).length, 1, 'the second tab has no page before kill');
    t2.kill('x');
    await until(async () => (await pages()).length === 0, 10_000);
  } finally {
    srv.close();
    browser.close();
    await sleep(300);
    killHeadless();
  }
  assert.equal(headlessProcs(), 0);
});
