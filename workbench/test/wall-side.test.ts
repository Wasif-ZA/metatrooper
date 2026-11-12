import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'renderer', 'wall-side.js'), 'utf8');

function render(snap: any, projectId: string, git: any = null) {
  const el = { dataset: {} as Record<string, string>, innerHTML: '' };
  const ui = { snap, projectId, git, pendingHide: new Set<string>() };
  const ctx: any = {
    ui,
    document: { getElementById: (id: string) => (id === 'hside' ? el : null) },
    project: () => snap.projects.find((p: any) => p.id === projectId),
    projectGroups: (list: any[]) => ({ projects: list.filter((p) => !p.scratch), worktrees: [], scratch: list.filter((p) => p.scratch), older: [] }),
    esc: (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`),
    taskOf: (x: any) => x.task || x.engine_id,
    STATE_WORDS: { starting: 'starting', working: 'working', waiting_for_you: 'waiting for you', done: 'done', idle: 'idle' },
  };
  vm.runInNewContext(`${src}\nthis.wallSide = wallSide;`, ctx);
  ctx.wallSide.draw();
  return el.innerHTML;
}

const snap = {
  projects: [{ id: 'p1', name: 'alpha', path: '/a' }, { id: 'p2', name: 'beta', path: '/b', scratch: true }],
  sessions: [
    { id: 's1', engine_id: 'claude', state: 'working', task: 'fix login' },
    { id: 's2', engine_id: 'codex', state: 'waiting_for_you', task: 'add tests' },
    { id: 's3', engine_id: 'gemini', state: 'idle' },
    { id: 's4', engine_id: 'old', state: 'exited' },
  ],
  live: [{ id: 'x1', project_id: 'p2', state: 'done' }],
  selected: 's2',
};

test('wall sidebar numbers the open project first with its branch, then the others with their worst live state', () => {
  const html = render(snap, 'p1', { project: 'p1', branch: 'main' });
  const ws = [...html.matchAll(/<button class="hws( on)?" data-action="project" data-id="(\w+)"[^>]*><span class="hn">(\d)<\/span><span class="hname">(\w+)<\/span>(?:<span class="hsdot hk-(\w+)">)?/g)].map((m) => [m[2], m[3], m[4], Boolean(m[1]), m[5]]);
  assert.deepEqual(ws, [['p1', '1', 'alpha', true, 'block'], ['p2', '2', 'beta', false, 'done']]);
  assert.match(html, /<span class="hbr">main<\/span>/);
});

test('wall sidebar lists each live session of the project by number, engine and pane title, with the same state word the pane header uses, and marks the selected one', () => {
  const html = render(snap, 'p1');
  const rows = [...html.matchAll(/<button class="hag( on)?" data-action="pick" data-id="(\w+)"[^>]*><span class="hg hk-(\w+)">[^<]*<\/span><span class="hname"><span class="hnum">(\d)<\/span> <span class="heng">(\w+)<\/span> <span class="htask">([\w ]+)<\/span><\/span><span class="hst">([\w ]+)<\/span>/g)].map((m) => [m[2], m[3], `${m[4]} ${m[5]} ${m[6]}`, m[7], Boolean(m[1])]);
  assert.deepEqual(rows, [['s1', 'work', '1 claude fix login', 'working', false], ['s2', 'block', '2 codex add tests', 'waiting for you', true], ['s3', 'idle', '3 gemini gemini', 'idle', false]]);
  assert.match(html, /data-action="launch-menu"[^>]*>new</);
});

test('wall sidebar shows no branch for a project whose git status is for another project', () => {
  assert.doesNotMatch(render(snap, 'p1', { project: 'p2', branch: 'dev' }), /hbr/);
});
