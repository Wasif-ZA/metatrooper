import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const wallSource = readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const fn = (name: string) => appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];

function freshWall() {
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, remove() {}, querySelector: (s: string) => (s === '.stamp' ? null : node()), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const tiles = new Map<string, any>();
  const tween = () => ({ kill() {} });
  const gsap = { to: tween, set: tween, fromTo: tween, delayedCall: tween };
  const ctx = vm.createContext({ gsap, termView: { tile: (id: string) => { if (!tiles.has(id)) tiles.set(id, node()); return tiles.get(id); } }, matchMedia: () => ({ matches: false }), document: { body: node(), querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }) }, addEventListener() {}, setInterval() {}, innerWidth: 1400, innerHeight: 900 });
  vm.runInContext(`${wallSource}\nthis.wall = wall;`, ctx);
  return ctx.wall;
}

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test('M6-06a the wall comes back in the same layout as resumed sessions and reopened shells arrive in any order', () => {
  const before = freshWall();
  const saves: unknown[] = [];
  before.onChange(() => saves.push(plain(before.state())));
  const list = [
    { id: 'a', state: 'working' }, { id: 'b', state: 'working' }, { id: 'c', state: 'working' },
    { id: 'd', state: 'done' }, { id: 'sh_1', state: 'idle', shell: true },
  ];
  before.decide(list, 'b');
  before.apply('single');
  before.pair('c');
  before.toggleOpen('d');
  const saved = plain(before.state());
  assert.deepEqual(saved.big, ['b', 'c']);
  assert.deepEqual(saved.open, ['d']);
  assert.deepEqual(saves.at(-1), saved, 'every layout change is reported');

  const tiles = [
    { id: 'nd', from: 'd', state: 'done' }, { id: 'sh_2', from: 'sh_1', state: 'idle', shell: true },
    { id: 'nc', from: 'c', state: 'working' }, { id: 'na', from: 'a', state: 'working' }, { id: 'nb', from: 'b', state: 'working' },
  ];
  const orders = (xs: typeof tiles): Array<typeof tiles> => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));
  for (const back of orders(tiles)) {
    const after = freshWall();
    after.restore(saved);
    for (let i = 1; i <= back.length; i++) { after.decide(back.slice(0, i), null); after.apply('single'); }
    const map = (ids: string[]) => ids.map((id) => back.find((x) => x.id === id)!.from);
    const now = plain(after.state());
    const why = back.map((x) => x.from).join(',');
    assert.deepEqual(map(now.big), saved.big, why);
    assert.deepEqual(map(now.order), saved.order, why);
    assert.deepEqual(map(now.open), saved.open, why);
    assert.equal(now.pair_at, saved.pair_at, why);
    // a workbench-only restart: the saved layout now holds the new ids, and the tiles still carry resumed_from
    const again = freshWall();
    again.restore(now);
    for (let i = 1; i <= back.length; i++) { again.decide([...back].reverse().slice(0, i), null); again.apply('single'); }
    assert.deepEqual(plain(again.state()), now, 'second rebuild ' + why);
  }
});

test('M6-06a a saved tile that has not come back yet stays in the saved layout', () => {
  const wall = freshWall();
  wall.restore({ big: ['b'], order: ['a', 'c'], open: [], pair_at: 0 });
  wall.decide([{ id: 'na', from: 'a', state: 'working' }], null);
  wall.apply('single');
  const s = plain(wall.state());
  assert.ok(s.big.includes('b') && s.order.includes('c') && s.order.includes('na'), JSON.stringify(s));
});

test('M6-06a seedLayout restores the saved layout once per project and reopens its shells; saveLayout writes through settings.set', async () => {
  const restored: unknown[] = [];
  const saved: unknown[] = [];
  const wall = { restore: (s: unknown) => restored.push(s), state: () => ({ big: ['x'], order: [], open: [], pair_at: 0 }) };
  const layout = { big: ['x'], order: [], open: [], pair_at: 0, shells: [{ id: 'sh_old', kind: 'powershell' }] };
  const ui: any = { projectId: 'p', snap: { core: { online: true, pid: 7 } }, settingsLook: { ui: { layout: { p: layout } } }, shells: [], shellKinds: [{ kind: 'powershell', label: 'PowerShell' }], shellSel: 'sh_old' };
  const rpc = async (method: string, params: { kind: string }) => (method === 'shell.open' ? { result: { shell_id: 'sh_new', label: 'PowerShell', cwd: 'C:/p' } } : {});
  const api = { saveLayout: async (p: string, l: unknown) => { saved.push([p, l]); return { ok: true }; } };
  const make = new Function('ui', 'wall', 'rpc', 'render', 'api', `let layoutSent = '', layoutTimer = null;\n${fn('seedLayout')}\n${fn('reopenShell')}\n${fn('saveLayout')}\n${fn('coreRestarted')}\nreturn { seedLayout, saveLayout, coreRestarted };`);
  const app = make(ui, wall, rpc, () => {}, api);
  app.seedLayout();
  app.seedLayout();
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0], layout);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(plain(ui.shells), [{ id: 'sh_new', label: 'PowerShell', cwd: 'C:/p', project_id: 'p', kind: 'powershell', from: 'sh_old' }]);
  assert.equal(ui.shellSel, 'sh_new');

  app.saveLayout();
  app.saveLayout();
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(plain(saved), [['p', { big: ['x'], order: [], open: [], pair_at: 0, shells: [{ id: 'sh_new', kind: 'powershell' }] }]]);

  ui.snap.core.pid = 8;
  app.coreRestarted();
  assert.equal(restored.length, 2, 'a new core pid seeds the wall with its current layout');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ui.shells.length, 1);
  assert.equal(ui.shells[0].from, 'sh_new');
});

test('M6-06a a shell whose reopen meets a dead core opens once the new core is up', async () => {
  let up = false;
  const wall = { restore() {}, state: () => ({ big: [], order: [], open: [], pair_at: 0 }) };
  const ui: any = { projectId: 'p', snap: { core: { online: true, pid: 1 } }, settingsLook: { ui: { layout: { p: { shells: [{ id: 'sh_old', kind: 'bash' }] } } } }, shells: [], shellKinds: [] };
  const rpc = async () => (up ? { result: { shell_id: 'sh_new', label: 'Git Bash', cwd: 'C:/p' } } : { error: { message: 'core offline' } });
  const make = new Function('ui', 'wall', 'rpc', 'render', 'api', `let layoutSent = '', layoutTimer = null;\n${fn('seedLayout')}\n${fn('reopenShell')}\n${fn('coreRestarted')}\nreturn { seedLayout, coreRestarted };`);
  const app = make(ui, wall, rpc, () => {}, {});
  app.seedLayout();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(plain(ui.shells).map((x: any) => [x.id, x.exited]), [['sh_old', true]]);
  up = true;
  ui.snap.core.pid = 2;
  app.coreRestarted();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(plain(ui.shells).map((x: any) => [x.id, x.from]), [['sh_new', 'sh_old']]);
});
