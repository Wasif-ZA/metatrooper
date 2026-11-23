// M8-33: the Changed group refreshes every 2 s, flags files two agents touched, one status system per row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const requireUI = createRequire(new URL('../ui/package.json', import.meta.url));
const { transformSync } = requireUI('esbuild');
const source = fs.readFileSync(new URL('../ui/src/ide.jsx', import.meta.url), 'utf8');
const fragment = (name: string) => {
  const body = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'))?.[0];
  assert.ok(body, `${name} must exist in ide.jsx`);
  return body;
};
const build = (names: string[], deps: Record<string, any>, ret: string) => {
  const compiled = transformSync(names.map(fragment).join('\n'), { loader: 'jsx', jsxFactory: 'h', format: 'cjs' }).code;
  return new Function(...Object.keys(deps), compiled + `\nreturn ${ret};`)(...Object.values(deps));
};
const flat = (n: any): any[] => Array.isArray(n) ? n.flatMap(flat) : n && typeof n === 'object' ? [n, ...flat(n.children || [])] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.children || []) : n == null || n === false ? '' : String(n);

function groupHarness(files: any[], owners: Record<string, string> = {}, counts: Record<string, number> = {}) {
  const effects: Array<() => any> = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 0;
  const cleared: any[] = [];
  const loads: any[] = [];
  const doc: any = { hidden: false };
  const pending: Array<() => void> = [];
  const deps = {
    h: (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children }),
    useEffect: (fn: () => any) => { effects.push(fn); },
    setTimeout: (fn: () => void, ms: number) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout: (t: any) => { cleared.push(t); timers.delete(t); },
    globalThis: { document: doc },
    loadGitStatus: (st: any) => { loads.push(st); return new Promise<void>((r) => pending.push(r)); },
    openFile: () => {}, FileIcon: 'FileIcon', base: (p: string) => p.split('/').pop(),
    statusLetter: build(['statusLetter'], {}, 'statusLetter'),
  };
  const ChangedGroup = build(['ChangedGroup'], deps, 'ChangedGroup');
  const st: any = { git: { files }, owners: new Map(Object.entries(owners)), ownerCount: new Map(Object.entries(counts)) };
  const render = () => { effects.length = 0; return ChangedGroup({ st }); };
  const rows = (root: any) => flat(root).filter((n) => n.type === 'button');
  return { st, render, rows, effects, timers, cleared, loads, doc, pending };
}

const tick = () => new Promise((r) => setImmediate(r));
test('M8-33a: polling is a 2000 ms timeout chained after each load, skipped while hidden, stopped on cleanup', async () => {
  const h = groupHarness([{ path: 'a.txt', index: '.', worktree: 'M' }]);
  h.render();
  assert.equal(h.effects.length, 1);
  const cleanup = h.effects[0]();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 2000);
  const fire = () => { const [id, t] = [...h.timers][0]; h.timers.delete(id); t.fn(); };
  fire();
  await tick();
  assert.deepEqual(h.loads, [h.st]);
  assert.equal(h.timers.size, 0, 'no next timer while the load is pending');
  h.pending[0]();
  await tick();
  assert.equal(h.timers.size, 1, 'next timer scheduled after the load resolves');
  assert.equal([...h.timers.values()][0].ms, 2000);
  assert.equal(h.loads.length, 1);
  h.doc.hidden = true;
  fire();
  await tick();
  assert.equal(h.loads.length, 1, 'hidden window skips the load');
  assert.equal(h.timers.size, 1, 'but keeps polling');
  h.doc.hidden = false;
  fire();
  await tick();
  cleanup();
  h.pending[1]();
  await tick();
  assert.equal(h.timers.size, 0, 'cleanup stops polling even with a load in flight');
  assert.ok(h.cleared.length >= 1);
});

test('M8-33a: a file that appears in st.git.files shows as a row on the next render', () => {
  const h = groupHarness([]);
  assert.equal(h.render(), null);
  h.st.git.files.push({ path: 'outside.txt', index: '.', worktree: '?' });
  const rows = h.rows(h.render());
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /outside\.txt/);
  assert.equal(rows[0].props.title, 'outside.txt');
});

test('M8-33b: a file with two owners shows "2 agents" and the owners text', () => {
  const h = groupHarness([{ path: 'a.txt', index: '.', worktree: 'M' }], { 'a.txt': 'Ann, Bob' }, { 'a.txt': 2 });
  const t = text(h.rows(h.render())[0]);
  assert.match(t, /2 agents/);
  assert.match(t, /Ann, Bob/);
});

test('M8-33b: a file with one owner shows no agents chip', () => {
  const h = groupHarness([{ path: 'a.txt', index: '.', worktree: 'M' }], { 'a.txt': 'Ann' }, { 'a.txt': 1 });
  const t = text(h.rows(h.render())[0]);
  assert.match(t, /Ann/);
  assert.doesNotMatch(t, /agents/);
});

test('M8-33b: a file nobody owns says "not an agent" and has no chip', () => {
  const h = groupHarness([{ path: 'a.txt', index: '.', worktree: 'M' }]);
  const t = text(h.rows(h.render())[0]);
  assert.match(t, /not an agent/);
  assert.doesNotMatch(t, /agents/);
});

test('M8-33c: each row has exactly one status letter, from one status system', () => {
  const cases: Array<[any, string]> = [
    [{ path: 'm.txt', index: '.', worktree: 'M' }, 'M'],
    [{ path: 'u.txt', index: '?', worktree: '?' }, 'U'],
    [{ path: 'a.txt', index: 'A', worktree: '.' }, 'A'],
    [{ path: 'd.txt', index: '.', worktree: 'D' }, 'D'],
    [{ path: 'c.txt', index: 'U', worktree: 'U', conflict: true }, 'C'],
  ];
  const h = groupHarness(cases.map((c) => c[0]));
  const rows = h.rows(h.render());
  assert.equal(rows.length, cases.length);
  rows.forEach((row, i) => {
    const letters = flat(row).filter((n) => n.props && 'data-letter' in n.props);
    assert.equal(letters.length, 1, cases[i][0].path);
    assert.equal(letters[0].props['data-letter'], cases[i][1]);
    assert.equal(text(letters[0]), cases[i][1]);
  });
});

test('M8-33: no changed files renders nothing; header shows the count otherwise', () => {
  assert.equal(groupHarness([]).render(), null);
  const h = groupHarness([{ path: 'a', index: '.', worktree: 'M' }, { path: 'b', index: '.', worktree: 'M' }]);
  const t = text(h.render());
  assert.match(t, /Changed/);
  assert.match(t, /2/);
});

test('M8-33: Files renders ChangedGroup only when the search query is blank', () => {
  assert.match(source, /st\.q\.trim\(\) \? null : <ChangedGroup st=\{st\} \/>/);
});

test('M8-33b: loadGitStatus stores ownerCount from the session.owners reply', async () => {
  const bumps: number[] = [];
  let pending: Promise<any> | null = null;
  const deps = {
    api: { git: async () => ({ files: [{ path: 'a.txt', index: '.', worktree: 'M' }] }) },
    rpc: (method: string, args: any) => {
      assert.equal(method, 'session.owners');
      assert.equal(args.project_id, 'p1');
      pending = Promise.resolve({ result: { paths: [
        { path: 'a.txt', owners: [{ title: 'Ann' }, { title: 'Bob' }] },
        { path: 'b.txt', owners: [{ title: 'Cy' }] },
        { path: 'c.txt', owners: [] },
      ] } });
      return pending;
    },
    bump: () => { bumps.push(1); },
  };
  const loadGitStatus = build(['loadGitStatus'], deps, 'loadGitStatus');
  const st: any = { pid: 'p1', gitSeq: 0 };
  await loadGitStatus(st);
  await pending;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...st.ownerCount], [['a.txt', 2], ['b.txt', 1], ['c.txt', 0]]);
  assert.equal(st.owners.get('a.txt'), 'Ann, Bob');
  assert.equal(st.owners.has('c.txt'), false);
});
