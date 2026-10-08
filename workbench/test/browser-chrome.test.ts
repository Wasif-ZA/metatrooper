import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/browser-chrome.js', import.meta.url))).href);
const bc = (globalThis as any).browserChrome;

const steps = (check: string) => [
  { id: 'build', title: 'Build', status: 'done' },
  { id: 'deploy', title: 'Deploy', status: 'done' },
  { id: 'check', title: 'Check', status: check },
  { id: 'approve', title: 'Approve', status: undefined },
];
const run = (check = 'running') => ({ id: 'r1', name: 'ship-pricing #14', steps: steps(check), check: 2, before: null, after: null });
const bannerFor = (pane: { run_id: string | null }, check = 'running', now = 0) => bc.banner(pane.run_id ? run(check) : null, now);

test('the run banner renders only for a pane with a run_id', () => {
  bc.reset();
  assert.equal(bannerFor({ run_id: null }), '');
  const html = bannerFor({ run_id: 'r1' });
  assert.match(html, /Opened by run <b data-scr="run">ship-pricing #14<\/b>/);
  assert.equal((html.match(/class="step /g) || []).length, 4);
  assert.match(html, /class="step done"[^>]*title="build/);
  assert.match(html, /class="step run"[^>]*title="check/);
  assert.match(html, /class="step pending"[^>]*title="approve/);
  assert.equal((html.match(/thumb empty/g) || []).length, 2);
});

test('rendering twice does not re-add the animation class', () => {
  bc.reset();
  assert.doesNotMatch(bc.tabs([{ id: 'a' }, { id: 'b' }], 'a', 0), / move/);
  const first = bc.tabs([{ id: 'a' }, { id: 'b' }], 'b', 1000);
  assert.match(first, /class="ind move"/);
  assert.equal(bc.tabs([{ id: 'a' }, { id: 'b' }], 'b', 1010), first, 'a re-render inside the animation leaves the DOM alone');
  assert.match(bc.tabs([{ id: 'a' }, { id: 'b' }], 'b', 2000), /class="ind"/);
  assert.match(bc.tabs([{ id: 'a' }, { id: 'b' }], 'b', 2010), /class="ind"/);

  assert.match(bannerFor({ run_id: 'r1' }, 'running', 3000), /runb wipe/);
  assert.doesNotMatch(bannerFor({ run_id: 'r1' }, 'running', 4000), /wipe/);
  assert.match(bannerFor({ run_id: 'r1' }, 'done', 5000), /step done tick/);
  assert.doesNotMatch(bannerFor({ run_id: 'r1' }, 'done', 6000), /tick/);
  assert.doesNotMatch(bannerFor({ run_id: 'r1' }, 'done', 6010), /tick|wipe/);
});

test('the first Before capture wipes in, and an existing one does not', () => {
  bc.reset();
  assert.doesNotMatch(bc.banner(run(), 0), /thumb dev/);
  assert.match(bc.banner({ ...run(), before: { id: 's1', src: 'data:x' } }, 1000), /class="thumb dev"/);
  bc.reset();
  assert.doesNotMatch(bc.banner({ ...run(), before: { id: 's1', src: 'data:x' } }, 0), /thumb dev/);
});

test('a step first seen as done does not tick', () => {
  bc.reset();
  assert.doesNotMatch(bannerFor({ run_id: 'r1' }, 'done', 0), /tick/);
});

test('the Driven by submenu marks the current owner', () => {
  const items = bc.menuItems({ session_id: 's2' }, [{ id: 's1', label: 'one' }, { id: 's2', label: 'two' }], 'live', false);
  const sub = items.find((i: any) => i.label === 'Driven by').submenu;
  assert.deepEqual(sub.map((i: any) => [i.id, i.checked]), [['own:', false], ['own:s1', false], ['own:s2', true]]);
  assert.equal(items.find((i: any) => i.id === 'mode').enabled, false);
});
