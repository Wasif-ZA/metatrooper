import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolation } from '../../core/test/helpers.ts';

test('D3 the browser pipe never speaks first; D4 tool output scrubs a saved secret this process never decrypted; D6 wait_for cannot confirm a secret; D8 a busy database delays the audit row, and one busy past every try is logged', () => {
  const iso = isolation();
  // lower case only, so only the saved-secret redaction can catch it, not a credential pattern
  const marker = `secretmarker${randomUUID().replaceAll('-', '')}`;
  try {
    const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/decisions-1018.ts', import.meta.url))], {
      encoding: 'utf8', timeout: 90_000, env: { ...iso.env, M612_MARKER: marker },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(marker), 'the value is not in any result');
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
      waitGuess: { found: false },
      waitPlain: { found: true },
      evaluate: { value: 'Welcome [secret] home' },
      unaskedBytes: 0,
      hello: 'session',
      console: [{ at: JSON.parse(r.stdout.trim().split('\n').pop()!).console[0].at, level: 'log', text: 'typed [secret]' }],
      auditAfterBusy: 1,
      auditAfterLongBusy: 0,
    });
    assert.match(r.stderr, /browser audit row dropped after 3 tries \(console ok\)/);
  } finally {
    rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('D35 folded done tiles past the cap leave a "+N more" bar in the last slot, which opens the session list', async () => {
  const vm = await import('node:vm');
  const { readFileSync } = await import('node:fs');
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, remove() {}, querySelector: () => node(), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const tiles = new Map<string, any>();
  let more: any = null;
  let listOpened = false;
  const listBtn = { ...node(), classList: { toggle() {} }, setAttribute: (_k: string, v: boolean) => { listOpened = v; } };
  const centre = { ...node(), appendChild: (el: any) => { more = el; } };
  const document = {
    body: node(),
    querySelector: (s: string) => (s === '#foldMore' ? more : s === '#centre' ? centre : s === '#listBtn' ? listBtn : node()),
    createElement: () => {
      const t: any = { content: { firstChild: null } };
      Object.defineProperty(t, 'innerHTML', { set: () => { const click: Array<() => void> = []; t.content.firstChild = { hidden: false, textContent: '', title: '', addEventListener: (_e: string, f: () => void) => click.push(f), click: () => click.forEach((f) => f()) }; } });
      return t;
    },
  };
  const set: Array<[unknown, Record<string, unknown>]> = [];
  const tw = (target: unknown, vars: Record<string, unknown>) => { set.push([target, vars]); return { kill() {} }; };
  const ctx = vm.createContext({
    gsap: { to: tw, set: tw, fromTo: tw, delayedCall: tw }, termView: { tile: (id: string) => tiles.get(id) ?? tiles.set(id, node()).get(id) }, matchMedia: () => ({ matches: false }),
    document, addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {}, innerWidth: 1400, innerHeight: 300, reportPaneBounds() {},
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  const wall = ctx.wall;
  // 300 px tall: 176 px of wall, so 2 fold slots
  wall.decide([{ id: 'w', state: 'working' }, ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, state: 'done' }))], 'w');
  wall.layout(false);
  assert.ok(more, 'the bar exists');
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, '+4 more');
  assert.equal(['a', 'b', 'c', 'd', 'e'].filter((id) => !tiles.get(id).hidden).length, 1, 'one folded tile keeps its bar, the slot under it counts the other four');
  more.click();
  assert.equal(listOpened, true);
  wall.decide([{ id: 'w', state: 'working' }, { id: 'a', state: 'done' }], 'w');
  wall.layout(false);
  assert.equal(more.hidden, true, 'no bar once every folded tile fits');
});
