import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Follow-ups from M's review of 42738d22 (fixed in 5105d4da). Each behaviour is a check(mutate) so the suite also
// proves the check fails when its fix is removed from the source (mutated in memory only, never on disk).
const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-rev-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });
const read = (p: string) => readFileSync(join(wb, p), 'utf8');
const mutate = (src: string, from: string, to: string) => { assert.ok(src.includes(from), 'mutation target present: ' + from); return src.replace(from, to); };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const g: any = globalThis;

// ---- (1) queue --------------------------------------------------------------
let qn = 0;
const loadQueue = (src = read('ui/src/queue.js')) => import('data:text/javascript;n=' + ++qn + ',' + encodeURIComponent(src));
const at = (id: string, state_at: string, state = 'idle') => [{ id, state, state_at }];

async function queueRefused(src?: string) {
  const { flushQueued, queuedText, setQueued } = await loadQueue(src);
  const sent: string[] = [];
  const refuse = async (_x: any, t: string) => { sent.push(t); return false; };
  setQueued('r', 'hello');
  flushQueued(at('r', '1'), refuse); await flush();
  assert.deepEqual(sent, ['hello']);
  assert.equal(queuedText('r'), 'hello', 'a refused send goes back in the queue');
  flushQueued(at('r', '1'), refuse); await flush();
  assert.equal(sent.length, 1, 'the same state mark is not tried again');
  flushQueued(at('r', '2'), refuse); await flush();
  assert.equal(sent.length, 2, 'a changed state_at is tried again');
  assert.equal(queuedText('r'), 'hello');
}
async function queueRejected(src?: string) {
  const { flushQueued, queuedText, setQueued } = await loadQueue(src);
  let n = 0;
  setQueued('j', 'boom');
  flushQueued(at('j', '1'), async () => { n++; throw new Error('no'); }); await flush();
  assert.equal(queuedText('j'), 'boom', 'a rejected send goes back in the queue');
  flushQueued(at('j', '1'), async () => { n++; return true; }); await flush();
  assert.equal(n, 1, 'and is not retried on the same mark');
}
async function queueSuccess(src?: string) {
  const { flushQueued, queuedText, setQueued } = await loadQueue(src);
  let n = 0;
  setQueued('s', 'one');
  flushQueued(at('s', '1'), async () => { n++; return true; }); await flush();
  assert.equal(queuedText('s'), ''); assert.equal(n, 1);
  flushQueued(at('s', '2'), async () => { n++; return true; }); await flush();
  assert.equal(n, 1, 'nothing left to send');
  setQueued('s', 'two');
  flushQueued(at('s', '1'), async () => { n++; return true; }); await flush();
  assert.equal(n, 2, 'a successful send cleared the mark, so a new follow-up on the same mark goes out');
}
async function queueSetClearsMark(src?: string) {
  const { flushQueued, setQueued } = await loadQueue(src);
  let n = 0;
  setQueued('m', 'one');
  flushQueued(at('m', '1'), async () => { n++; return false; }); await flush();
  setQueued('m', 'edited');
  flushQueued(at('m', '1'), async () => { n++; return false; }); await flush();
  assert.equal(n, 2, 'setQueued clears the mark');
}
async function queueExited(src?: string) {
  const { flushQueued, queuedText, setQueued } = await loadQueue(src);
  let n = 0;
  setQueued('e', 'gone');
  flushQueued(at('e', '1'), async () => { n++; return false; }); await flush();
  assert.equal(queuedText('e'), 'gone');
  flushQueued(at('e', '2', 'exited'), async () => { n++; return true; }); await flush();
  assert.equal(queuedText('e'), '', 'exited drops the text');
  flushQueued(at('e', '3'), async () => { n++; return true; }); await flush();
  assert.equal(n, 1);
}
const noRestore = (s: string) => mutate(s, 'if (ok) tried.delete(x.id); else if (!queued.has(x.id)) queued.set(x.id, t);', 'if (ok) tried.delete(x.id);');
const noRestoreOnReject = (s: string) => mutate(s, '() => { if (!queued.has(x.id)) queued.set(x.id, t); }', '() => {}');
const noMark = (s: string) => mutate(s, 'if (tried.get(x.id) === mark) continue;', '');
const setKeepsMark = (s: string) => mutate(s, '  tried.delete(id);\n}', '}');

test('M7-14 review: a refused send restores the text, is not retried on the same mark and is retried when state_at changes', () => queueRefused());
test('M7-14 review: a rejected send restores the text and is not retried on the same mark', () => queueRejected());
test('M7-14 review: a successful send clears the mark; setQueued clears it too; exited drops text', async () => { await queueSuccess(); await queueSetClearsMark(); await queueExited(); });
test('M7-14 review mutants: removing the restore, the mark check, or the setQueued mark reset is caught', async () => {
  const q = read('ui/src/queue.js');
  await assert.rejects(queueRefused(noRestore(q)));
  await assert.rejects(queueRejected(noRestoreOnReject(q)));
  await assert.rejects(queueRefused(noMark(q)));
  await assert.rejects(queueSetClearsMark(setKeepsMark(q)));
});

// ---- (3) plainAsk, Home and the Needs you answer box ----------------------------
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');
let bn = 0;
async function bundle(edit: (file: string, src: string) => string = (_f, s) => s) {
  const out = join(temp, `ui${++bn}.mjs`);
  await build({
    absWorkingDir: join(wb, 'ui'), tsconfigRaw: {}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: out, loader: { '.css': 'empty' },
    stdin: { contents: "export { plainAsk } from './src/home.jsx'; export { DetailAsk } from './src/inbox.jsx';", resolveDir: join(wb, 'ui'), loader: 'js' },
    plugins: [{ name: 'ui', setup(b: any) {
      b.onResolve({ filter: /^[^.\/]/ }, (a: any) => ({ path: pathToFileURL(requireUI.resolve(a.path)).href, external: true }));
      b.onLoad({ filter: /\.jsx?$/ }, (a: any) => {
        let s = readFileSync(a.path, 'utf8');
        if (a.path.endsWith('inbox.jsx')) s += '\nexport { DetailAsk };';
        return { contents: edit(a.path.replace(/\\/g, '/'), s), loader: a.path.endsWith('.jsx') ? 'jsx' : 'js' };
      });
    } }],
  });
  return import(pathToFileURL(out).href);
}

const chatOf = (o: any = {}) => ({ items: [{ kind: 'text', text: 'Keep it?' }], ...o });
function plainTable(plainAsk: any) {
  const a: any = { id: 's', reason: 'question' };
  assert.equal(plainAsk(a, a, chatOf()), true);
  assert.equal(plainAsk(a, a, chatOf({ items: [] })), true, 'an empty but loaded chat is loaded');
  for (const reason of [null, undefined, 'permission', 'trust', 'stopped: x']) {
    const p = { ...a, reason };
    assert.equal(plainAsk(p, p, chatOf()), false, `reason ${reason} is not a question`);
  }
  assert.equal(plainAsk(a, a, chatOf({ waiting: { id: 't' } })), false, 'a waiting tool');
  assert.equal(plainAsk(a, a, null), false, 'chat not loaded');
  assert.equal(plainAsk(a, a, undefined), false);
  assert.equal(plainAsk(a, a, { error: true }), false, 'chat errored');
  assert.equal(plainAsk(a, a, { items: 'x' }), false, 'items not an array');
  assert.equal(plainAsk(a, { ...a }, chatOf()), false, 'ask is not x');
}
test('M8 review: plainAsk is true only for a loaded chat with no waiting tool on a question wait of that same session', async () => {
  plainTable((await bundle()).plainAsk);
});

const detail = (m: any, x: any) => {
  const slots: any[] = []; const sent: any[] = []; const toasts: any[] = [];
  g.ui = { projectId: 'p1', snap: { projects: [{ id: 'p1', name: 'Alpha' }], git: {} } };
  g.toast = (...a: any[]) => toasts.push(a);
  g.troop = { termInput: async (...a: any[]) => { sent.push(a); return true; } };
  const internals = requireUI('react').__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const render = (plain: any) => {
    let cursor = 0; const prev = internals.H;
    internals.H = { useState: (init: any) => { const i = cursor++; if (!(i in slots)) slots[i] = init; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      useRef: (init: any) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; }, useEffect() {}, useLayoutEffect() {}, useMemo: (f: any) => f(), useCallback: (f: any) => f };
    try { return m.DetailAsk({ x, plain }); } finally { internals.H = prev; }
  };
  return { render, sent, toasts };
};
const walk = (n: any, f: (n: any) => boolean, seen = new Set()): any => {
  if (!n || typeof n !== 'object' || seen.has(n)) return null; seen.add(n);
  if (Array.isArray(n)) { for (const c of n) { const r = walk(c, f, seen); if (r) return r; } return null; }
  if (n.props && f(n)) return n;
  for (const v of Object.values(n.props || {})) { const r = walk(v, f, seen); if (r) return r; }
  return null;
};
const answerField = (tree: any) => walk(tree, (n) => n.props.label === 'Answer' && 'onEnter' in n.props);
const note = (tree: any) => walk(tree, (n) => n.props.role === 'status' && String(n.props.className).includes('ou-hm-chatnote'));
const inboxSrc = read('ui/src/inbox.jsx');
const ASK = { id: 's', project_id: 'p1', engine_id: 'claude', state: 'waiting_for_you' };

async function detailChecks(m: any) {
  // Not plain: only the status note, never an answer box, whatever the reason.
  for (const x of [{ ...ASK, reason: 'permission' }, { ...ASK, reason: null }, { ...ASK, reason: 'question' }]) {
    const tree = detail(m, x).render(false);
    assert.equal(answerField(tree), null, 'no answer box when not plain');
    assert.match(String(note(tree)?.props.children), /allow or deny it in its terminal/);
  }
  assert.match(String(note(detail(m, { ...ASK, reason: 'permission' }).render(false)).props.children), /permission menu is open/);
  // Plain: the box and no note.
  const t = detail(m, ASK).render(true);
  assert.ok(answerField(t) && !note(t));
  // And a plain one does write.
  const w = detail(m, ASK);
  answerField(w.render(true)).props.onChange('yes');
  await answerField(w.render(true)).props.onEnter(); await flush();
  assert.deepEqual(w.sent, [['s', 'yes\r']]);
}
// send is unreachable without the box, so the guard itself is pinned in the source as well.
const detailGuard = (src: string) => assert.match(src, /function DetailAsk\(\{ x, plain \}\) \{[^]*?const send = async \(\) => \{\s*if \(!here \|\| sending \|\| !plain\) return;[^]*?termInput/);
test('M8 review: DetailAsk send returns before termInput unless plain', () => detailGuard(inboxSrc));
test('M8 review: DetailAsk renders the status note and never calls termInput when the wait is not plain', async () => { await detailChecks(await bundle()); });

// The inbox decides `plain` from the session.chat result: another session's or an older state_at's result must not count.
const plainExpr = (src: string) => { const m = /<DetailAsk key=\{item\.id\} x=\{item\} plain=\{([^}]*)\} \/>/.exec(src); assert.ok(m, 'DetailAsk gets plain'); return m![1]; };
const pickPlain = (src: string) => { const m = /plain: (Array\.isArray\(res\?\.result\?\.items\) && !res\.result\.waiting)/.exec(src); assert.ok(m, 'said.plain from the chat result'); return m![1]; };
function inboxChecks(src: string) {
  const f: any = new Function('item', 'said', 'return ' + plainExpr(src));
  const item = { id: 's', state_at: 't2', reason: 'question' };
  const said = (o: any = {}) => ({ id: 's', at: 't2', text: 'q', plain: true, ...o });
  assert.equal(f(item, said()), true);
  for (const reason of [null, undefined, 'permission', 'trust', 'stopped: x']) assert.equal(!!f({ ...item, reason }, said()), false, `reason ${reason}`);
  assert.equal(!!f(item, said({ plain: false })), false, 'chat has a waiting tool');
  assert.equal(!!f(item, null), false, 'chat not loaded');
  assert.equal(!!f(item, said({ id: 'other' })), false, 'said is for another session');
  assert.equal(!!f(item, said({ at: 't1' })), false, 'said is for an older state_at');
  const p: any = new Function('res', 'return ' + pickPlain(src));
  assert.equal(p({ result: { items: [] } }), true);
  assert.equal(p({ result: { items: [], waiting: { id: 't' } } }), false);
  assert.equal(p({}), false); assert.equal(p(undefined), false);
}
test('M8 review: Needs you only treats the wait as plain for this session, this state_at, a loaded chat with no waiting tool', () => inboxChecks(inboxSrc));

// B1 scenario: reason null or permission with a loaded chat whose waiting is false (a real Claude permission menu).
test('M8 review: a null or permission reason with a loaded, non-waiting chat shows no answer box on Home or in Needs you and writes no termInput', async () => {
  const m = await bundle();
  const chat = chatOf({ waiting: false });
  for (const reason of [null, 'permission']) {
    const ask: any = { id: 's', reason };
    assert.equal(m.plainAsk(ask, ask, chat), false, `Home plainAsk, reason ${reason}`);
    const f: any = new Function('item', 'said', 'return ' + plainExpr(inboxSrc));
    const item = { id: 's', state_at: 't2', reason };
    assert.equal(!!f(item, { id: 's', at: 't2', text: 'q', plain: true }), false, `Needs you plain, reason ${reason}`);
    const d = detail(m, { ...ASK, reason });
    const tree = d.render(!!f(item, { id: 's', at: 't2', text: 'q', plain: true }));
    assert.equal(answerField(tree), null);
    assert.match(String(note(tree)?.props.children), /allow or deny it in its terminal/);
    await flush();
    assert.deepEqual(d.sent, []);
  }
});

// Home: the Answer box and send are both gated by plainAsk.
function homeChecks(src: string) {
  assert.match(src, /const send = async \(\) => \{\s*const t = answer\.trim\(\);\s*if \(!t \|\| !here \|\| !ask \|\| !plainAsk\(ask, x, chat\)\) return;\s*try \{ if \(!\(await troop\.termInput\(/);
  assert.match(src, /\{ask && plainAsk\(ask, x, chat\) \? \(\s*<div className="ou-hm-ask"><TextInput/);
}
test('M8 review: Home send and its Answer box are both gated by plainAsk, so no termInput without it', () => homeChecks(read('ui/src/home.jsx')));

test('M8 review mutants: plainAsk always true, DetailAsk send without the plain guard or the note, a loose inbox or Home gate are all caught', async () => {
  const bad = await bundle((f, s) => f.endsWith('home.jsx') ? mutate(s, 'export const plainAsk = (ask, x, chat) => ask.reason', 'export const plainAsk = (ask, x, chat) => true || ask.reason') : s);
  assert.throws(() => plainTable(bad.plainAsk));
  const loose = await bundle((f, s) => f.endsWith('home.jsx') ? mutate(s, "ask.reason === 'question' && ask === x", "ask.reason !== 'permission' && ask === x") : s);
  assert.throws(() => plainTable(loose.plainAsk));
  assert.throws(() => detailGuard(mutate(inboxSrc, 'if (!here || sending || !plain) return;', 'if (!here || sending) return;')));
  const noNote = await bundle((f, s) => f.endsWith('inbox.jsx') ? mutate(s, 'if (!plain) return <p', 'if (false) return <p') : s);
  await assert.rejects(detailChecks(noNote));
  assert.throws(() => inboxChecks(mutate(inboxSrc, ' && said?.at === item.state_at', '')));
  assert.throws(() => inboxChecks(mutate(inboxSrc, ' && said?.id === item.id', '')));
  assert.throws(() => inboxChecks(mutate(inboxSrc, ' && said.plain}', '}')));
  assert.throws(() => inboxChecks(mutate(inboxSrc, "item.reason === 'question' && said", 'said')));
  assert.throws(() => inboxChecks(mutate(inboxSrc, "item.reason === 'question'", "item.reason !== 'permission'")));
  const home = read('ui/src/home.jsx');
  assert.throws(() => homeChecks(mutate(home, '!ask || !plainAsk(ask, x, chat)) return;', '!ask) return;')));
  assert.throws(() => homeChecks(mutate(home, '{ask && plainAsk(ask, x, chat) ? (', '{ask && !chat?.waiting ? (')));
});

// ---- (4) VS Code import ----------------------------------------------------------
async function loadBoot() {
  let s = readFileSync(new URL('./m6-26-wall-repairs.test.ts', import.meta.url), 'utf8');
  s = s.slice(0, s.indexOf("\ntest('"));
  const renderer = pathToFileURL(join(wb, 'renderer')).href;
  const mainTs = pathToFileURL(join(wb, 'src/main.ts')).href;
  s = s.split('`../renderer/${f}`').join('`' + renderer + '/${f}`').split("'../src/main.ts'").join("'" + mainTs + "'")
    .replace('function boot() {', 'function boot(opts: any = {}) {')
    .replace("if (name === 'git')", "if (name === 'vscodeImport') return opts.vscode ? async () => opts.vscode() : undefined; if (name === 'git')")
    .replace("if (name === 'uiSettings') return async () => ({ theme: {}, ui: {", "if (name === 'uiSettings') return async () => ({ theme: {}, ui: { theme: opts.uiTheme(),")
    .replace('localStorage: { getItem: () => null, setItem() {}, removeItem() {} }', 'localStorage: opts.ls')
    .replace(/const src = \(f: string\) => (readFileSync\([^;]*\));/, "const src = (f: string) => { const t = $1; return f === 'app.js' && (globalThis as any).__mutApp ? (globalThis as any).__mutApp(t) : t; };");
  assert.ok(s.includes('__mutApp'), 'src hook installed');
  s += '\nexport { boot, snapOf };\n';
  const file = join(temp, 'boot.ts'); writeFileSync(file, s);
  return await import(pathToFileURL(file).href);
}
const { boot, snapOf } = await loadBoot();
const fakeLs = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); } }; };
const found = { theme: 'light', summary: { applied: ['theme "Solarized Light" as Crisp light'], skipped: [] }, keys: [] };
async function vscodeUnreadable(edit?: (s: string) => string) {
  const ls = fakeLs(); let asked = false;
  g.__mutApp = edit;
  let w: any;
  try { w = boot({ ls, vscode: () => { asked = true; return found; }, uiTheme: () => { if (asked) throw new Error('no settings'); return 'neutral'; } }); } finally { delete g.__mutApp; }
  w.t.ui.look = { theme: { name: 'neutral', scheme: 'dark' } };
  await w.snap(snapOf([]));
  assert.ok(asked, 'the import asked');
  assert.equal(ls.m.has('cc.vscodeImport'), false, 'nothing written to localStorage');
  assert.deepEqual(w.el('toasts').children.map((c: any) => c.textContent).filter((t: string) => t.includes('VS Code')), [], 'no toast');
}
test('M8-20 review: when uiSettings rejects, vscodeOnce writes no record and does not toast', () => vscodeUnreadable());
test('M8-20 review mutant: without the prev === null return a record is written and caught', async () => {
  await assert.rejects(vscodeUnreadable((s) => mutate(s, 'if (prev === null) return;', '')));
});
