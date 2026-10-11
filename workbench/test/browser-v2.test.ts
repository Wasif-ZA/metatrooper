import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, openSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';
import { tokenCount } from '../../core/src/meter.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

test('M6-11 browser tools version 2 e2e contract', { skip: !runnable }, async () => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  const engineFile = join(iso.home, 'browser-engine.cjs');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  writeFileSync(engineFile, readFileSync(join(workbench, 'test', 'fixtures', 'browser-engine.cjs')));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };

  const page1Html = `<!doctype html>
<html>
<head><title>v2-fixtures</title></head>
<body>
  <button id="remover" onclick="document.getElementById('to-remove').remove()">remover</button>
  <button id="to-remove">removable</button>
  <div id="host"></div>
  <iframe id="subframe"></iframe>
  <script>
    const host = document.getElementById('host');
    const shadow = host.attachShadow({ mode: 'open' });
    const sBtn = document.createElement('button');
    sBtn.id = 'shadow-btn';
    sBtn.textContent = 'shadow-btn';
    sBtn.onclick = () => { document.body.dataset.shadowClicked = '1'; };
    shadow.appendChild(sBtn);

    const f = document.getElementById('subframe');
    const doc = f.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><body><button id="frame-btn" onclick="document.body.dataset.frameClicked=\\'1\\'">frame-btn</button></body></html>');
    doc.close();
  </script>
</body>
</html>`;
  const page1Url = 'data:text/html,' + encodeURIComponent(page1Html);

  const page20kHtml = `<!doctype html>
<html>
<head><title>20k</title></head>
<body>
  <div id="container"></div>
  <script>
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 20000; i++) {
      const el = document.createElement('div');
      el.textContent = 'item ' + i;
      frag.appendChild(el);
    }
    document.getElementById('container').appendChild(frag);
  </script>
</body>
</html>`;
  const page20kUrl = 'data:text/html,' + encodeURIComponent(page20kHtml);

  const core = await startCore({ ...iso, env });
  let wb: ChildProcess | null = null;
  try {
    const pipe = await client(iso.prefix);
    await uiHello(pipe, iso.home);
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;
    const session = await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: engineFile });
    const sid = session.result.session_id as string;
    const pane = await pipe.request('pane.open', { project_id: projectId, session_id: sid, url: page1Url });
    const userPaneId = pane.result.pane_id as string;
    pipe.close();

    await until(() => {
      const db = new DatabaseSync(join(iso.home, 'troop.db'));
      try {
        return (db.prepare('SELECT pid FROM session WHERE id = ?').get(sid) as { pid: number | null } | undefined)?.pid;
      } finally {
        db.close();
      }
    }, 15000);

    const args: [string, string[]] = process.platform === 'win32'
      ? [electron, [workbench]]
      : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', workbench]];
    wb = spawn(args[0], args[1], { env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });

    const steps: Array<[string, string, object]> = [
      // Take two snapshots of the unchanged page.
      ['snap1', 'browser.snapshot', { pane_id: userPaneId }],
      ['snap2', 'browser.snapshot', { pane_id: userPaneId }],

      // Click the frame button to set marker inside iframe.
      ['clickFrame', 'browser.click', { pane_id: userPaneId, ref: '@frame-btn' }],
      ['evalFrame', 'browser.evaluate', { pane_id: userPaneId, expression: "document.getElementById('subframe').contentDocument.body.dataset.frameClicked" }],

      // Click the shadow button to set marker in host document.
      ['clickShadow', 'browser.click', { pane_id: userPaneId, ref: '@shadow-btn' }],
      ['evalShadow', 'browser.evaluate', { pane_id: userPaneId, expression: 'document.body.dataset.shadowClicked' }],

      // Take a screenshot of the viewport with default format.
      ['shot', 'browser.screenshot', { pane_id: userPaneId }],

      // Click remover button to remove the target element.
      ['clickRemover', 'browser.click', { pane_id: userPaneId, ref: '@remover' }],

      // Snapshot with since_last lists the removed element line.
      ['snapSinceLast', 'browser.snapshot', { pane_id: userPaneId, since_last: true }],

      // Clicking removed element old ref fails.
      ['clickRemoved', 'browser.click', { pane_id: userPaneId, ref: '@removable' }],

      // Snapshot before navigating iframe.
      ['snapBeforeNav', 'browser.snapshot', { pane_id: userPaneId }],

      // Navigate iframe to invalidate child frame refs.
      ['navIframe', 'browser.evaluate', { pane_id: userPaneId, expression: "document.getElementById('subframe').srcdoc = '<p>navigated</p>'" }],
      ['settleIframe', 'browser.wait_for', { pane_id: userPaneId, text: 'never-matching-text', timeout_ms: 600 }],

      // Read iframe text to verify navigation.
      ['frameText', 'browser.evaluate', { pane_id: userPaneId, expression: "document.getElementById('subframe').contentDocument.body.innerText" }],

      // Clicking old frame ref fails after frame navigation.
      ['clickOldFrame', 'browser.click', { pane_id: userPaneId, ref: '@frame-btn' }],

      // Navigate to page with 20,000 elements.
      ['nav20k', 'browser.navigate', { pane_id: userPaneId, url: page20kUrl }],
      ['wait20k', 'browser.wait_for', { pane_id: userPaneId, text: 'item 19999', timeout_ms: 15000 }],

      // Snapshot 20,000 elements with token budget and follow cursors.
      ['snap20k', 'browser.snapshot', { pane_id: userPaneId, max_tokens: 4000, follow_cursor: true }],
    ];

    writeFileSync(join(iso.home, `browser-job-${sid}.json`), JSON.stringify({ steps }));
    const outFile = join(iso.home, `browser-out-${sid}.json`);
    const out = await until(() => (existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null), 40000);

    // Verify session binding.
    assert.equal(out.hello.result?.bound, 'session');

    // Two snapshots of unchanged page give identical text.
    assert.equal(out.steps.snap1.result?.text, out.steps.snap2.result?.text);

    // Snapshot contains button from iframe with f-tagged ref and button from shadow root.
    const snap1Text = String(out.steps.snap1.result?.text ?? '');
    assert.match(snap1Text, /button "frame-btn" \[ref=f1e\d+\]/);
    assert.match(snap1Text, /button "shadow-btn" \[ref=e\d+\]/);

    // Clicking frame ref sets marker inside iframe.
    assert.equal(out.steps.clickFrame.result?.ok, true);
    assert.equal(out.steps.evalFrame.result?.value, '1');

    // Clicking shadow button sets marker in document.
    assert.equal(out.steps.clickShadow.result?.ok, true);
    assert.equal(out.steps.evalShadow.result?.value, '1');

    // Click returns url, title, and changes diff.
    assert.ok(out.steps.clickRemover.result?.url);
    assert.ok(out.steps.clickRemover.result?.title);
    assert.ok(typeof out.steps.clickRemover.result?.changes === 'string');

    // Snapshot with since_last lists the removed element line starting with minus.
    const sinceLastText = String(out.steps.snapSinceLast.result?.text ?? '');
    assert.ok(sinceLastText.split('\n').some((l: string) => l.startsWith('- ') && l.includes('"removable"')));

    // Clicking the removed element old ref fails with no longer on the page.
    assert.match(out.steps.clickRemoved.error?.message ?? '', /no longer on the page/);

    // Verify frame content reflects navigation.
    assert.ok(String(out.steps.frameText.result?.value ?? '').includes('navigated'));

    // Clicking the old frame ref after iframe navigation fails with no longer on the page.
    assert.match(out.steps.clickOldFrame.error?.message ?? '', /no longer on the page/);

    // Screenshot returns image/jpeg with dimensions within 1568 pixels.
    assert.equal(out.steps.shot.result?.mime, 'image/jpeg');
    assert.ok(out.steps.shot.result?.width <= 1568);
    assert.ok(out.steps.shot.result?.height <= 1568);
    assert.ok(out.steps.shot.result?.data_base64);

    // Snapshot of 20,000 elements fits within 4000 tokens and returns cursor.
    const snap20kPages = out.steps.snap20k.pages;
    assert.ok(Array.isArray(snap20kPages) && snap20kPages.length > 1);
    const firstChunk = snap20kPages[0].result;
    assert.ok(tokenCount(firstChunk.text) <= 4000);
    assert.ok(firstChunk.continue);

    // Following cursors until none returns all remaining lines without repetition.
    const allLines: string[] = [];
    for (const page of snap20kPages) {
      const lines = String(page.result?.text ?? '').split('\n');
      if (page.result?.continue) {
        lines.pop();
      }
      allLines.push(...lines);
    }
    assert.equal(new Set(allLines).size, allLines.length, 'none repeated');
    assert.ok(allLines.length >= 20000, 'returns all remaining lines');
  } finally {
    killTree(wb?.pid);
    await sleep(300);
    await teardownCore(core, iso);
  }
});
