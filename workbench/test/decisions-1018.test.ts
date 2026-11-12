import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolation } from '../../core/test/helpers.ts';

/** Runs the fixture in a fresh process and home; `mode` names the one D4 output boundary it drives first. */
function runFixture(mode = '') {
  const iso = isolation();
  // lower case only, so only the saved-secret redaction can catch it, not a credential pattern
  const marker = `secretmarker${randomUUID().replaceAll('-', '')}`.repeat(mode === 'glide' ? 8 : 1);
  try {
    const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/decisions-1018.ts', import.meta.url))], {
      encoding: 'utf8', timeout: 90_000, env: { ...iso.env, M612_MARKER: marker, M612_MODE: mode },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(marker), 'the value is not in any result');
    return { out: JSON.parse(r.stdout.trim().split('\n').pop()!), stdout: r.stdout, stderr: r.stderr, marker };
  } finally {
    rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('D3 the browser pipe never speaks first; D6 wait_for cannot confirm a secret; D8 a busy database delays the audit row, and one busy past every try is logged', () => {
  const { out, stderr } = runFixture();
  assert.deepEqual(out, { waitGuess: { found: false }, waitPlain: { found: true }, unaskedBytes: 0, hello: 'session', auditAfterBusy: 1, auditAfterLongBusy: 0 });
  assert.match(stderr, /browser audit row dropped after 3 tries \(console ok\)/);
});

test('D4 each tool output boundary, run first in a fresh process, scrubs a saved secret this process never decrypted', () => {
  assert.deepEqual(runFixture('evaluate').out, { evaluate: { value: 'Welcome [secret] home' } });
  assert.match(JSON.stringify(runFixture('read').out.read), /Welcome \[secret\] home/);
  assert.deepEqual(runFixture('console').out, { hello: 'session', console: [{ at: 1, level: 'log', text: 'typed [secret]' }] });
  assert.deepEqual(runFixture('panes').out, { hello: 'session', panes: [{ pane_id: 'bp_agent_1', url: 'https://bank.test/cb?code=[secret]', dev_port: null }] });
});

test('D4 an unknown browser method naming a secret is refused without echoing it', () => {
  assert.deepEqual(runFixture('unknown').out, { hello: 'session', unknown: { code: -32601, message: 'unknown method' } });
});

test('D4 console and dialog text captured while the secret store cannot be read is withheld, not cut through a secret; after the store recovers it is scrubbed before the cut', () => {
  const { out, stdout, marker } = runFixture('capture');
  assert.ok(!stdout.includes(marker.slice(0, 15)), 'no prefix of the secret survives the cut');
  assert.deepEqual(out, { dialogWithheld: true, hello: 'session', capture: ['withheld', 'withheld', 'x*1985[secret]'] });
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
    body: { ...node(), classList: { add() {}, remove() {}, toggle() {}, contains: (c: string) => c === 'no-split' } },
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
    document, addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {}, innerWidth: 1400, innerHeight: 260, reportPaneBounds() {},
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  const wall = ctx.wall;
  // a short window: room for 2 fold slots
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


test('D4 AX names and values are withheld when the secret store cannot be loaded', () => {
  assert.deepEqual(runFixture('ax-failure').out, { ax: [[true, true]] });
});


test('D4 cursor server passes complete captions to the scrubber even when a secret crosses 200 characters', () => {
  assert.deepEqual(runFixture('glide').out, { hello: 'session', caption: 'click ' + 'x'.repeat(35) + '[secr' });
});
