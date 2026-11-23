import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const R = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '..', 'renderer', f), 'utf8');
const src = R('wall-side.js');
const css = R('wall-ref.css');
const app = R('app.js');

function render(snap: any, projectId: string, needs?: number) {
  const el = { dataset: {} as Record<string, string>, innerHTML: '' };
  const ui = { snap, projectId, git: null, pendingHide: new Set<string>() };
  const ctx: any = {
    ui,
    document: { getElementById: (id: string) => (id === 'hside' ? el : null) },
    project: () => snap.projects.find((p: any) => p.id === projectId),
    projectGroups: (list: any[]) => ({ projects: list, worktrees: [], scratch: [], older: [] }),
    esc: (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`),
    taskOf: (x: any) => x.task || x.engine_id,
    STATE_WORDS: { working: 'working', waiting_for_you: 'waiting for you', done: 'done', idle: 'idle' },
  };
  if (needs !== undefined) ctx.needsCount = () => needs;
  vm.runInNewContext(`${src}\nthis.wallSide = wallSide;`, ctx);
  ctx.wallSide.draw();
  return el.innerHTML;
}

const snap = {
  projects: [{ id: 'p1', name: 'alpha', path: '/a' }, { id: 'p2', name: 'beta', path: '/b' }, { id: 'p3', name: 'gamma', path: '/g' }],
  sessions: [{ id: 's1', engine_id: 'claude', state: 'working', task: 'mine one' }, { id: 's2', engine_id: 'codex', state: 'waiting_for_you', task: 'mine two' }],
  live: [
    { id: 'b1', project_id: 'p2', engine_id: 'claude', state: 'waiting_for_you', task: 'beta wait' },
    { id: 'b2', project_id: 'p2', engine_id: 'codex', state: 'working', task: 'beta work' },
    { id: 'g1', project_id: 'p3', engine_id: 'gemini', state: 'done', task: 'gamma done' },
    { id: 'g2', project_id: 'p3', engine_id: 'claude', state: 'exited' },
  ],
  selected: 's1',
};
const list = (h: string) => h.slice(h.indexOf('<div class="hag-list">'));

test('F16a: agents of three projects show in one list grouped by project, this project first, each with its rows and count', () => {
  const l = list(render(snap, 'p1'));
  const seq = [...l.matchAll(/<div class="hag-proj"><span class="hname">(\w+)<\/span><span class="hgn">(\d)<\/span><\/div>|<button class="hag[^"]*" data-action="[\w-]+" data-id="(\w+)"/g)].map((m) => (m[1] ? `${m[1]}:${m[2]}` : m[3]));
  assert.deepEqual(seq, ['alpha:2', 's1', 's2', 'beta:2', 'b1', 'b2', 'gamma:1', 'g1']);
});

test('F16b: only rows waiting on a person are orange; the orange rule uses --wait and no other row rule does', () => {
  const rows = [...list(render(snap, 'p1')).matchAll(/data-id="(\w+)"[^>]*>.*?<span class="(hst[^"]*)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows, [['s1', 'hst'], ['s2', 'hst hneeds'], ['b1', 'hst hneeds'], ['b2', 'hst'], ['g1', 'hst']]);
  const withWait = css.split('}').filter((r) => r.includes('var(--wait)')).map((r) => r.split('{')[0].trim()).filter((s) => /^\.hag/.test(s));
  assert.deepEqual(withWait.sort(), ['.hag .hst.hneeds', '.hag-head .hneedsn']);
  assert.doesNotMatch(css.match(/^\.hag \.hst \{[^}]*\}/m)![0], /--wait/);
});

test('F16c data: rows of other projects pick-across with no number; this project rows still pick with numbers', () => {
  const l = list(render(snap, 'p1'));
  for (const id of ['b1', 'b2', 'g1']) assert.match(l, new RegExp(`data-action="pick-across" data-id="${id}"`));
  const other = l.slice(l.indexOf('>beta<'));
  assert.doesNotMatch(other, /hnum/);
  assert.doesNotMatch(other, /data-action="pick" /);
  assert.equal([...l.matchAll(/data-action="pick" data-id="s\d"[^>]*><span class="hg[^>]*>[^<]*<\/span><span class="hname"><span class="hnum">\d/g)].length, 2);
});

test('F16c behaviour: pickAcross hides the inbox, sets pendingPick and switches project without focusing; the click case routes to it', () => {
  const fn = app.match(/^function pickAcross\(id\) \{[^]*?^\}/m)![0];
  const calls: string[] = [];
  const inbox: any = { hidden: false };
  const ui: any = { projectId: 'p1', snap: { live: [{ id: 'b1', project_id: 'p2' }, { id: 's1', project_id: 'p1' }] } };
  const ctx: any = { ui, document: { getElementById: (i: string) => (i === 'inbox' ? inbox : null) }, switchProject: (p: string) => calls.push(`switch ${p}`), focus: () => calls.push('focus') };
  vm.runInNewContext(`${fn}\nthis.pickAcross = pickAcross;`, ctx);
  assert.equal(ctx.pickAcross('b1'), true);
  assert.deepEqual(calls, ['switch p2']);
  assert.equal(ui.pendingPick, 'b1');
  assert.equal(inbox.hidden, true);
  assert.equal(ctx.pickAcross('s1'), false);
  // source check (the click handler itself is not booted here): routes to pickAcross and takes no key input
  const c = app.match(/case 'pick-across':[^\n]*/)![0];
  assert.match(c, /pickAcross\(el\.dataset\.id\)/);
  assert.doesNotMatch(c, /focus|sendKey|input/i);
});

test('F16d: head reads all agents with the same need count as the inbox, and no count when none', () => {
  assert.match(render(snap, 'p1', 3), /<div class="hag-head">all agents <span class="hneedsn">3 need you<\/span><\/div>/);
  assert.match(render(snap, 'p1', 1), /<span class="hneedsn">1 needs you<\/span>/);
  const none = render(snap, 'p1', 0);
  assert.match(none, /<div class="hag-head">all agents<\/div>/);
  assert.doesNotMatch(none, /hneedsn/);
});

test('with only the current project: no group headers, head says agents, rows unchanged', () => {
  const h = render({ ...snap, live: [] }, 'p1', 0);
  assert.doesNotMatch(h, /hag-proj/);
  assert.match(h, /<div class="hag-head">agents<\/div>/);
  assert.equal([...h.matchAll(/data-action="pick" /g)].length, 2);
  assert.doesNotMatch(h, /pick-across/);
});
