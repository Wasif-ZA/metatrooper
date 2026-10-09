import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, root, until } from './helpers.ts';
import { git, revisionHarness } from './ui-revision-helpers.ts';
import { captured, capturingEngine } from './pipeline-fixup-helpers.ts';
import { qaWindow } from './qa-electron-helpers.ts';

before(buildGenerated);

test('report.mjs lists fixed and open findings and follows reverify', async () => {
  const { run } = await import('../..//pipelines/e2e-browser-qa/report.mjs');
  const writes = new Map<string, string>();
  const findings = [{ severity: 'high', title: 'Crash', file: 'app.js', line: 4, detail: 'TypeError', fixed_by: 'fix' }, { severity: 'low', title: 'Copy', detail: 'unclear' }];
  const ctx: any = { steps: { qa: { branch: 'troop/qa' }, reverify: { passed: true, exit_code: 0 } }, readFile: async (name: string) => name === 'findings.json' ? JSON.stringify(findings) : JSON.stringify({ passed: true, exit_code: 0 }), writeFile: async (p: string, v: string) => writes.set(p, v) };
  assert.deepEqual(await run(ctx), { document: 'qa-report.md', fixed: 1, open: 1, passed: true });
  assert.match(writes.get('qa-report.md')!, /Fixed \(1\)[\s\S]*Crash[\s\S]*Still open \(1\)[\s\S]*Copy/);
  await assert.rejects(run({ ...ctx, steps: { qa: {}, reverify: { passed: false, exit_code: 1 } }, readFile: async (name: string) => { if (name === 'findings.json') throw new Error('missing'); return ''; } }), /missing/);
});

test('report.mjs throws when findings.json is missing', async () => {
  const { run } = await import('../..//pipelines/e2e-browser-qa/report.mjs');
  await assert.rejects(run({ readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, steps: {}, writeFile: async () => {} }), /missing/);
});

async function startQa(h: Awaited<ReturnType<typeof revisionHarness>>, waitForBrowser = false) {
    // npm executes this recorder in the same cwd as the fixture's real test script.
    const packageFile = join(h.project, 'package.json');
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
    pkg.scripts.pretest = 'node record-test-cwd.cjs';
    writeFileSync(packageFile, JSON.stringify(pkg));
    writeFileSync(join(h.project, 'record-test-cwd.cjs'), "require('node:fs').writeFileSync('reverify-cwd.json', JSON.stringify(process.cwd()));\n");
    git(h.project, 'add', 'package.json', 'record-test-cwd.cjs');
    git(h.project, 'commit', '-qm', 'Record real npm test cwd');
    const def = JSON.parse(readFileSync(join(root, 'pipelines/e2e-browser-qa.json'), 'utf8'));
    const moduleDir = join(h.project, '.troop/pipelines/e2e-browser-qa');
    mkdirSync(moduleDir, { recursive: true });
    cpSync(join(root, 'pipelines/e2e-browser-qa/report.mjs'), join(moduleDir, 'report.mjs'));
    const finding = { severity: 'high', title: 'Add crashes', file: 'app.js', detail: 'wrong id' };
    for (const step of def.steps) if (step.kind === 'agent') {
      step.engine = 'fake';
      const directive = step.id === 'qa'
        ? { run_files: { 'findings.json': JSON.stringify([finding]) }, outputs: { findings: 'findings.json' } }
        : step.id === 'fix'
          ? { delay_ms: 2000, ...(waitForBrowser ? { wait_file: 'release-fix', observe_fix: true } : {}), files: { 'app.js': readFileSync(join(h.project, 'app.js'), 'utf8').replace('item-input', 'item') }, run_files: { 'findings.json': JSON.stringify([{ ...finding, fixed_by: 'fix' }]) }, commit: 'Fix add', outputs: { summary: 'fixed' } }
          : { outputs: { summary: 'flows' } };
      step.prompt = `FAKE ${JSON.stringify(directive)}\n${step.prompt}`;
    }
    return h.pipeline(def, { focus: 'add items' });
}

test('M2-01 browser QA fixes and commits in the QA worktree and finishes without a gate', async () => {
  const h = await revisionHarness('e2e-browser-qa', capturingEngine);
  try {
    const runId = await startQa(h);
    await until(() => (h.db.prepare("SELECT status FROM run_step WHERE run_id=? AND step_id='fix'").get(runId) as any)?.status === 'running', 30000);
    const pane: any = h.db.prepare('SELECT dev_port FROM browser_pane WHERE run_id=?').get(runId);
    assert.equal((await fetch(`http://127.0.0.1:${pane.dev_port}/`)).status, 200);
    await until(() => {
      const run: any = h.db.prepare('SELECT status,paused_why FROM run WHERE id=?').get(runId);
      if (run.status === 'failed') throw new Error(JSON.stringify(h.db.prepare('SELECT * FROM run_step WHERE run_id=?').all(runId)));
      return run.status === 'done';
    }, 60000);
    const qa: any = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id=? AND step_id='qa'").get(runId) as any).outputs);
    const fixRow: any = h.db.prepare("SELECT session_id FROM run_step WHERE run_id=? AND step_id='fix'").get(runId);
    const fixSession: any = h.db.prepare('SELECT cwd FROM session WHERE id=?').get(fixRow.session_id);
    assert.equal(fixSession.cwd.replaceAll('\\', '/'), qa.worktree.replaceAll('\\', '/'));
    assert.equal(captured(h, fixRow.session_id).cwd.replaceAll('\\', '/').toLowerCase(), qa.worktree.replaceAll('\\', '/').toLowerCase());
    assert.equal(git(qa.worktree, 'branch', '--show-current'), qa.branch);
    assert.match(git(qa.worktree, 'log', '-1', '--pretty=%s'), /Fix add/);
    assert.doesNotMatch(git(h.project, 'log', '-1', '--pretty=%s'), /Fix add/);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM gate WHERE run_id=?').get(runId).n, 0);
    const verify = JSON.parse(h.db.prepare("SELECT outputs FROM run_step WHERE run_id=? AND step_id='reverify'").get(runId).outputs as string);
    assert.equal(verify.passed, true, verify.output_tail);
    assert.equal(verify.exit_code, 0);
    assert.equal(JSON.parse(readFileSync(join(qa.worktree, 'reverify-cwd.json'), 'utf8')).replaceAll('\\', '/').toLowerCase(), qa.worktree.replaceAll('\\', '/').toLowerCase());
    assert.equal(existsSync(join(h.project, 'reverify-cwd.json')), false);
    const report = JSON.parse(h.db.prepare("SELECT outputs FROM run_step WHERE run_id=? AND step_id='report'").get(runId).outputs as string);
    assert.deepEqual(report, { document: 'qa-report.md', fixed: 1, open: 0, passed: true });
    const runDir = h.db.prepare('SELECT run_dir FROM run WHERE id=?').get(runId).run_dir as string;
    assert.ok(existsSync(join(runDir, 'qa-report.md')));
    assert.match(readFileSync(join(runDir, 'qa-report.md'), 'utf8'), /Fixed \(1\)[\s\S]*Add crashes[\s\S]*Still open \(0\)/);
  } finally { try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; } }
});

test('real Electron shopping-list flow before and after the fix', {
  skip: process.env.METATROOPER_BROWSER_E2E !== '1' && 'set METATROOPER_BROWSER_E2E=1 to run Electron browser QA', timeout: 150000,
}, async () => {
  const h = await revisionHarness('e2e-browser-qa', capturingEngine);
  let window: Awaited<ReturnType<typeof qaWindow>> | undefined;
  try {
    const runId = await startQa(h, true);
    await until(() => h.db.prepare("SELECT session_id FROM run_step WHERE run_id=? AND step_id='fix' AND status='running'").get(runId), 30000);
    const pane = h.db.prepare('SELECT * FROM browser_pane WHERE run_id=?').get(runId);
    assert.ok(pane.dev_port);
    await h.pipe.request('session.focus', { session_id: pane.session_id });
    window = await qaWindow(h, Number(pane.dev_port));
    const w = window;
    await w.reload();
    await until(() => w.evaluate('document.querySelector("#count")?.textContent === "0 items"'), 10000);
    await w.evaluate("document.getElementById('item').value = 'Apples'; document.getElementById('add-form').requestSubmit();");
    await until(() => w.errors.some(e => e.includes('TypeError')), 5000).catch(async error => {
      throw new Error(`${error}; before page=${await w.evaluate('document.body.innerText')}; errors=${w.errors.join('\n')}`);
    });
    assert.equal(await w.evaluate('document.querySelector("#count").textContent'), '0 items');
    assert.equal(await w.evaluate('document.querySelectorAll("#list li").length'), 0);
    assert.match(w.errors.join('\n'), /TypeError/);
    writeFileSync(join(h.iso.home, 'release-fix'), 'go');
    await until(() => existsSync(join(h.iso.home, 'fix-ready')), 10000);
    w.errors.length = 0;
    await w.reload();
    await until(() => w.evaluate('document.querySelector("#item")?.value === "" && document.querySelector("#count")?.textContent === "0 items"'), 10000);
    await w.evaluate("document.getElementById('item').value = 'Apples'; document.getElementById('add-form').requestSubmit();");
    await until(() => w.evaluate('document.querySelector("#count")?.textContent === "1 item"'), 5000).catch(async error => {
      throw new Error(`${error}; page=${await w.evaluate('document.body.innerText')}; errors=${w.errors.join('\n')}`);
    });
    assert.equal(await w.evaluate('document.querySelector("#list").textContent'), 'Apples');
    assert.deepEqual(w.errors, []);
    writeFileSync(join(h.iso.home, 'release-fix-result'), 'go');
    await until(() => h.db.prepare("SELECT 1 FROM run WHERE id=? AND status='done'").get(runId), 30000);
  } finally { await window?.close(); try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; } }
});
