import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crashAction, engineFix } from '../src/queries.ts';

test('h-sum-checkerror: an engine whose check threw gets a fix line', () => {
  assert.match(engineFix({ id: 'codex' }, 'check-error') ?? '', /codex/);
});

test('h-rv-ponytail: a pane that fails setup twice in a row is not rebuilt on the very next sync', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/pane-setup-backoff.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { retried: 4, waited: 4 });
});

test('h-d-d1: a crashed main window reloads once, and a second crash within a minute stops instead of looping', () => {
  assert.equal(crashAction('crashed', -Infinity, 1_000_000), 'reload');
  assert.equal(crashAction('oom', 1_000_000, 1_030_000), 'stop');
  assert.equal(crashAction('crashed', 1_000_000, 1_090_000), 'reload');
  assert.equal(crashAction('clean-exit', -Infinity, 1_000_000), 'none');
});

test('UI-02: the native browser pane hides while a toast, sheet, palette, Inbox, menu or usage popover is open, and comes back after', () => {
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  const fn = app.match(/^function reportPaneBounds\([^]*?\n}\n/m)![0];
  const overlays = app.split('\n').find((l) => l.startsWith('const PANE_OVERLAYS'))!;
  const shown: unknown[] = [];
  let open: string | null = null;
  const document = {
    getElementById: () => ({ getBoundingClientRect: () => ({ x: 633, y: 64, width: 959, height: 776 }) }),
    querySelector: (sel: string) => (open && sel.split(', ').some((s) => s.startsWith(open!)) ? {} : null),
  };
  const ui = { tab: 'browser', split: true, comment: null, browserMode: 'live', paneId: 'bp_1', lastBounds: null };
  const api = { paneShow: (id: unknown, r: unknown) => { shown.push(r ? id : null); } };
  const report = new Function('document', 'ui', 'api', `${overlays}\n${fn}; return reportPaneBounds;`)(document, ui, api);
  report();
  for (const sel of ['#toasts', '#sheet', '#palette', '#inbox', '#sinks', '#menu', '#usage']) {
    open = sel;
    report();
    open = null;
    report();
  }
  assert.deepEqual(shown, ['bp_1', ...Array(7).fill([null, 'bp_1']).flat()]);
});
