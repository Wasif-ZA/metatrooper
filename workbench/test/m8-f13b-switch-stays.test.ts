import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkWorkspace, VIEWS } from '../../core/src/workspace.ts';

// M8-F13b / M8-17b: no workspace change can remove the Home / IDE / Wall switch, the title bar or the status bar.
// The renderer cannot be driven here (no DOM), so this is a source-level check plus the layout data.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../renderer/index.html');
const ideSrc = read('../ui/src/ide.jsx');
const wsSrc = read('../ui/src/workspace.jsx');
const layoutDirs = ['../ui/src/workspaces/', '../../core/test/fixtures/workspaces/'];
const layouts = layoutDirs.flatMap(d => readdirSync(new URL(d, import.meta.url)).filter(f => /^(n\d\d-.*|persona-.*|dev|video|bakery|revise)\.json$/.test(f)).map(f => ({ f, ws: JSON.parse(read(d + f)) })));

// The workspace renderer must stay inside the IDE container: no DOM lookups, no frame/strip/view-button selectors.
export function touchesFrame(src: string): string[] {
  const bad = [/document\s*\./, /querySelector/, /getElementBy/, /createPortal/, /data-action/, /#frame\b/, /\bfnav\b/, /#strip\b/, /\bstrip\b/, /titlebar/i, /statusbar/i];
  return bad.filter(r => r.test(src)).map(String);
}

test('M8-F13b the frame has the three view buttons and the status bar, all enabled', () => {
  for (const v of ['home', 'ide', 'wall']) {
    const m = html.match(new RegExp(`<button[^>]*data-action="view"[^>]*data-view="${v}"[^>]*>`));
    assert.ok(m, `view button ${v} in index.html`);
    assert.ok(!/\bdisabled\b|\bhidden\b/.test(m![0]), `${v} button is enabled and visible`);
  }
  assert.match(html, /<footer id="strip" class="strip"/);
});

test('M8-F13b the workspace renderer only writes inside the IDE container', () => {
  assert.deepEqual(touchesFrame(wsSrc), [], 'workspace.jsx never reaches outside its own panes');
  assert.match(ideSrc, /<div className="ou-ws-root"><Pane /);
  assert.ok(ideSrc.indexOf('ou-ws-root') > 0);
});

test('M8-F13b every example and approved layout is only panes inside the IDE (no frame target)', () => {
  assert.ok(layouts.length >= 15, `read ${layouts.length} layouts`);
  const walk = (n: any, f: string) => n.split ? n.children.forEach((c: any) => walk(c, f)) : assert.ok(VIEWS.includes(n.view), `${f}: ${n.view}`);
  for (const { f, ws } of layouts) {
    assert.deepEqual(Object.keys(ws).filter(k => /frame|title|status|strip|switch|nav|view/i.test(k)), [], `${f} has no field aimed at the frame`);
    assert.deepEqual(checkWorkspace(ws, () => true), [], f);
    walk(ws.layout, f);
  }
});

test('M8-F13b / M8-17b the schema cannot name the frame, title bar or status bar', () => {
  assert.deepEqual(VIEWS.filter(v => /frame|titlebar|statusbar|strip|home|ide/i.test(v)), []);
  for (const view of ['frame', 'titlebar', 'statusbar', 'home', 'ide']) {
    const r = checkWorkspace({ name: 'x', rail: [], layout: { split: 'row', sizes: [50, 50], children: [{ view }, { view: 'editor' }] } }, () => true);
    assert.ok(r.some(x => x.includes(`"${view}" is not a pane cc can show`)), `${view} refused: ${r}`);
  }
});

test('M8-F13b the source check catches a renderer that hides the view buttons', () => {
  assert.notDeepEqual(touchesFrame(wsSrc + `\ndocument.querySelectorAll('[data-action="view"]').forEach(b => { b.hidden = true; });`), []);
});
