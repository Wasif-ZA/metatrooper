import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runNode, until } from './helpers.ts';
import { git, panePipeline, revisionHarness, runDone, terminalViewer } from './ui-revision-helpers.ts';

test('#36 first launch installs hooks and declared settings exactly once and reports the files', async () => {
  const h = await revisionHarness();
  try {
    const first = await h.launch('fake');
    assert.deepEqual(new Set(first.setup), new Set([h.env.METATROOPER_CLAUDE_SETTINGS, h.engineSettings]));
    const hooks = JSON.parse(readFileSync(h.env.METATROOPER_CLAUDE_SETTINGS, 'utf8')).hooks;
    for (const event of ['PreToolUse','PostToolUse','UserPromptSubmit','Notification','Stop','SessionEnd']) {
      assert.equal(hooks[event].length, 1); assert.match(hooks[event][0].hooks[0].command, new RegExp(`claude.${event}`));
    }
    assert.deepEqual(JSON.parse(readFileSync(h.engineSettings, 'utf8')), { keep: 'original', enable: true });
    const stateFile = join(h.iso.home, 'hooks-install.json');
    const state = readFileSync(stateFile, 'utf8'); assert.ok(JSON.parse(state).setup.fake);
    const files = [stateFile, h.engineSettings, h.env.METATROOPER_CLAUDE_SETTINGS];
    const before = files.map(f => ({ text: readFileSync(f, 'utf8'), mtime: statSync(f).mtimeMs }));
    const second = await h.launch('fake'); assert.equal(Object.hasOwn(second, 'setup'), false);
    assert.deepEqual(files.map(f => ({ text: readFileSync(f, 'utf8'), mtime: statSync(f).mtimeMs })), before);
  } finally { await h.close(); }
});

test('#36 configured shells resolve fallback, omit missing commands, open and close without session rows', async () => {
  const h = await revisionHarness(); let viewer;
  try {
    writeFileSync(join(h.iso.home, 'settings.json'), JSON.stringify({ terminal: { shells: {
      direct: { label: 'Direct fixture', command: [process.execPath, '-e', 'console.log("shell-fixture-ready");setInterval(()=>{},1000)'] },
      fallback: { label: 'Fallback fixture', command: ['missing-revision-executable'], fallback: [process.execPath, '-e', 'setInterval(()=>{},1000)'] },
      absent: { label: 'Absent fixture', command: ['missing-revision-executable'], fallback: ['missing-revision-fallback'] },
    } } }));
    const shells = (await h.pipe.request('shell.list')).result.shells;
    assert.equal(shells.find(s => s.kind === 'direct').argv[0], process.execPath);
    assert.equal(shells.find(s => s.kind === 'fallback').argv[0], process.execPath);
    assert.ok(!shells.some(s => s.kind === 'absent'));
    const before = h.db.prepare('SELECT * FROM session').all();
    const opened = (await h.pipe.request('shell.open', { kind: 'direct', project_id: h.projectId })).result;
    assert.match(opened.shell_id, /^sh_/); assert.equal(opened.cwd, h.db.prepare('SELECT path FROM project WHERE id = ?').get(h.projectId).path);
    viewer = await terminalViewer(h.iso.prefix, h.iso.home, opened.shell_id);
    await until(() => viewer.messages.some(m => m.data?.includes('shell-fixture-ready')), 10000);
    assert.deepEqual(h.db.prepare('SELECT * FROM session').all(), before);
    assert.deepEqual((await h.pipe.request('shell.close', { shell_id: opened.shell_id })).result, {});
    await until(() => viewer.messages.some(m => m.op === 'exit'), 10000);
    assert.deepEqual(h.db.prepare('SELECT * FROM session').all(), before);
  } finally { viewer?.socket.destroy(); await h.close(); }
});

test('#38 item-set changes only the requested item and rejects unknown items, runs and missing output files', { timeout: 90000 }, async () => {
  const h = await revisionHarness('result-panes');
  try {
    const run = await h.pipeline(panePipeline()); await runDone(h, run);
    const file = join(h.project, 'items.json'); const original = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual((await h.pipe.request('run.item-set', { run_id: run, step_id: 'items', id: 'clip-1', status: 'approved' })).result, {});
    const expected = structuredClone(original); expected[0].status = 'approved';
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), expected);
    const bytes = readFileSync(file, 'utf8');
    for (const [run_id, step_id, id] of [[run,'items','unknown'], ['unknown','items','clip-1'], [run,'document','clip-1'], [run,'missing','clip-1']]) {
      assert.ok((await h.pipe.request('run.item-set', { run_id, step_id, id, status: 'approved' })).error);
      assert.equal(readFileSync(file, 'utf8'), bytes);
    }
    h.db.prepare("UPDATE run_step SET outputs = '{}' WHERE run_id = ? AND step_id = 'items'").run(run);
    assert.ok((await h.pipe.request('run.item-set', { run_id: run, step_id: 'items', id: 'clip-1', status: 'approved' })).error);
    assert.equal(readFileSync(file, 'utf8'), bytes);
  } finally { await h.close(); }
});

test('#38 turn start records dirty working tree or clean HEAD without adding a stash', async () => {
  const h = await revisionHarness();
  try {
    const { session_id } = await h.launch();
    writeFileSync(join(h.project, 'seed.txt'), 'existing stash\n'); git(h.project, 'stash', 'push', '-qm', 'existing');
    const stashes = git(h.project, 'stash', 'list');
    writeFileSync(join(h.project, 'seed.txt'), 'older dirty content\n');
    const event = async (kind: string) => {
      const r = await runNode(['core/event.js', `claude.${kind}`], { ...h.env, TROOP_SESSION_ID: session_id }, '{}'); assert.equal(r.code, 0, r.stderr);
    };
    await event('UserPromptSubmit');
    const dirty = await until(() => h.db.prepare('SELECT turn_base FROM session WHERE id = ?').get(session_id)?.turn_base, 10000) as string;
    assert.notEqual(dirty, git(h.project, 'rev-parse', 'HEAD'));
    assert.equal(git(h.project, 'show', `${dirty}:seed.txt`), 'older dirty content');
    assert.equal(git(h.project, 'stash', 'list'), stashes);
    assert.equal(readFileSync(join(h.project, 'seed.txt'), 'utf8'), 'older dirty content\n');
    await event('Stop'); await until(() => h.db.prepare('SELECT state FROM session WHERE id = ?').get(session_id)?.state === 'done', 10000);
    git(h.project, 'restore', 'seed.txt'); await event('UserPromptSubmit');
    await until(() => h.db.prepare('SELECT turn_base FROM session WHERE id = ?').get(session_id)?.turn_base === git(h.project, 'rev-parse', 'HEAD'), 10000);
    assert.equal(git(h.project, 'stash', 'list'), stashes);
  } finally { await h.close(); }
});
